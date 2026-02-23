import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { QueryProcessor } from '../core/query-processor';
import { ThresholdCalculator } from '../core/threshold-calculator';
import { LiteStrategy } from '../strategies/lite-strategy';
import { AdvancedStrategy } from '../strategies/advanced-strategy';
import { VectorStrategy } from '../strategies/vector-strategy';
import { FTSStrategy } from '../strategies/fts-strategy';
import { VectorProvider } from '../providers/vector-provider';
import { CacheProvider } from '../providers/cache-provider';

export enum SearchTier {
    LITE = 'LITE',         // Simple ILIKE, no indices required
    STANDARD = 'STANDARD', // Trigrams + GIN (Current implementation)
    ADVANCED = 'ADVANCED', // Pre-normalized columns + RUM indices
    VECTOR = 'VECTOR'      // Semantic search via pgvector
}

export interface TrigramEngineConfig {
    tableName: string;
    searchColumns: string[];
    languageColumn?: string;
    idColumn?: string;
    ftsColumn?: string; // Pre-computed tsvector column (Turbo Mode)
    defaultLimit?: number;
    tier?: SearchTier;
    vectorProvider?: VectorProvider;
    cacheProvider?: CacheProvider;
    defaultTTL?: number;
}

export interface SearchOptions {
    query: string;
    language?: string;
    page?: number;
    limit?: number;
    filters?: Record<string, any>;
    abortSignal?: AbortSignal; // External signal to cancel the search
}

export class TrigramSearchEngine {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {
        this.config.idColumn = this.config.idColumn || 'id';
        this.config.defaultLimit = this.config.defaultLimit || 20;
        this.config.tier = this.config.tier || SearchTier.STANDARD;
    }

    /**
     * Main search entry point
     */
    async search<T = any>(options: SearchOptions): Promise<SearchResult<T>> {
        const { query, language = 'en', page = 1, limit = this.config.defaultLimit! } = options;
        const trimmed = (query || '').trim();

        // Validation
        const validation = QueryProcessor.validate(trimmed);
        if (!validation.valid) {
            return this.emptyResult(page, limit);
        }

        const normalized = QueryProcessor.normalize(trimmed);
        
        // --- Cache Check ---
        const cacheKey = this.generateCacheKey(normalized, options);
        if (this.config.cacheProvider) {
            const cached = await this.config.cacheProvider.get<SearchResult<T>>(cacheKey);
            if (cached) return cached;
        }

        // Tier-based routing
        if (this.config.tier === SearchTier.LITE) {
            return new LiteStrategy(this.adapter, this.config).search<T>(normalized, options);
        }

        if (this.config.tier === SearchTier.ADVANCED) {
            return new AdvancedStrategy(this.adapter, this.config).search<T>(normalized, options);
        }

        if (this.config.tier === SearchTier.VECTOR) {
            return new VectorStrategy(this.adapter, this.config).search<T>(normalized, options);
        }

        // --- Hybrid Parallel Fast-Track Logic (Zombie Prevention) ---
        // We start FTS and Standard search in parallel. 
        // If FTS wins, we cancel Standard search to save DB resources.
        const internalController = new AbortController();
        const signal = options.abortSignal || internalController.signal;

        const ftsPromise = new FTSStrategy(this.adapter, this.config).search<T>(normalized, { ...options, abortSignal: signal });
        const standardPromise = this.standardSearch<T>(normalized, { ...options, abortSignal: signal });

        let results;
        try {
            results = await ftsPromise;
            
            // If FTS found results, cancel the other branch immediately (Zombie Prevention)
            if (results.pagination.total > 0) {
                internalController.abort();
                // We don't need to await standardPromise, but we should catch any 
                // AbortError it throws to avoid unhandled rejections.
                standardPromise.catch(() => {}); 
                return results;
            }
            
            // If FTS found nothing, wait for already-running standard search
            results = await standardPromise;
        } catch (err: any) {
            // If the failure was due to abort (from external signal), handle it.
            // Note: internal aborts are caught by .catch() above.
            if (err.name === 'AbortError' || err.message === 'AbortError') {
                return this.emptyResult(page, limit);
            }
            throw err;
        }

        // 2. Fuzzy Fallback - only if no good results found yet
        if (results.pagination.total === 0) {
            const fuzzyResults = await this.fuzzySearch<T>(normalized, options);
            if (fuzzyResults.pagination.total > 0) {
                results = fuzzyResults;
            }
        }

        // 3. Smart Layout Fallback (RU context)
        if (results.pagination.total === 0 && language === 'ru' && /^[a-z0-9\s.,!?;:]+$/i.test(normalized)) {
            const corrected = QueryProcessor.convertLayout(normalized);
            if (corrected !== normalized) {
                const correctedResults = await this.fuzzySearch<T>(corrected, options);
                if (correctedResults.pagination.total > 0) {
                    results = correctedResults;
                    results.metadata = { ...results.metadata, correctedFrom: normalized };
                }
            }
        }

        // --- Cache Write ---
        if (this.config.cacheProvider && results.pagination.total > 0) {
            await this.config.cacheProvider.set(cacheKey, results, this.config.defaultTTL);
        }

        return results;
    }

    private generateCacheKey(query: string, options: SearchOptions): string {
        const { language = 'en', page = 1, limit = this.config.defaultLimit!, filters = {} } = options;
        const filterStr = JSON.stringify(filters);
        return `ss:${this.config.tableName}:${query}:${language}:${page}:${limit}:${filterStr}`;
    }

    private async standardSearch<T>(query: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const skip = (page - 1) * limit;
        const escapedQuery = query.replace(/'/g, "''");

        const whereClauses = this.buildFilters(filters);
        const searchOR = this.config.searchColumns
            .map(col => `${col} ILIKE '%${escapedQuery}%'`)
            .join(' OR ');
        
        whereClauses.push(`(${searchOR})`);

        if (this.config.languageColumn && options.language) {
            whereClauses.push(`${this.config.languageColumn} = '${options.language.replace(/'/g, "''")}'`);
        }

        const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        
        const sql = `
            SELECT *, COUNT(*) OVER() as total_count 
            FROM ${this.config.tableName}
            ${where}
            LIMIT ${limit} OFFSET ${skip}
        `;

        const rows = await this.adapter.query(sql, [], { signal: options.abortSignal });
        return this.mapRowsToResult(rows, page, limit);
    }

    private async fuzzySearch<T>(query: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const threshold = ThresholdCalculator.calculate(query);
        const skip = (page - 1) * limit;
        const escapedQuery = query.replace(/'/g, "''");

        return this.adapter.transaction(async (tx) => {
            // Set PG similarity threshold for the transaction
            await tx.execute(`SET pg_trgm.word_similarity_threshold = ${threshold};`, [], { signal: options.abortSignal });

            const whereClauses = this.buildFilters(filters);
            if (this.config.languageColumn && options.language) {
                whereClauses.push(`${this.config.languageColumn} = '${options.language.replace(/'/g, "''")}'`);
            }
            const where = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

            // Build dynamic similarity score for each column
            const simScores = this.config.searchColumns
                .map(col => `word_similarity('${escapedQuery}', ${col})`)
                .join(', ');
            
            const maxSimScore = `GREATEST(${simScores})`;
            
            const filterClause = this.config.searchColumns
                .map(col => `(${col} ILIKE '%${escapedQuery}%' OR '${escapedQuery}' <% ${col})`)
                .join(' OR ');

            const sql = `
                SELECT *, 
                       ${maxSimScore} as relevance,
                       COUNT(*) OVER() as total_count
                FROM ${this.config.tableName}
                WHERE (${filterClause}) ${where}
                ORDER BY relevance DESC
                LIMIT ${limit} OFFSET ${skip}
            `;

            const rows = await tx.query(sql, [], { signal: options.abortSignal });
            return this.mapRowsToResult(rows, page, limit);
        }, { signal: options.abortSignal });
    }

    private buildFilters(filters: Record<string, any>): string[] {
        return Object.entries(filters)
            .filter(([_, val]) => val !== undefined && val !== null && val !== '')
            .map(([key, val]) => {
                const escapedVal = String(val).replace(/'/g, "''");
                return `${key.replace(/'/g, "''")} = '${escapedVal}'`;
            });
    }

    private mapRowsToResult<T>(rows: any[], page: number, limit: number): SearchResult<T> {
        const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
        const totalPages = Math.ceil(total / limit);

        return {
            data: rows as T[],
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            }
        };
    }

    private emptyResult(page: number, limit: number): SearchResult {
        return {
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false }
        };
    }
}
