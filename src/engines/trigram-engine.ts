import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { QueryProcessor } from '../core/query-processor';
import { ThresholdCalculator } from '../core/threshold-calculator';
import { SqlSanitizer, SqlInjectionError } from '../core/sql-sanitizer';
import { LiteStrategy } from '../strategies/lite-strategy';
import { AdvancedStrategy } from '../strategies/advanced-strategy';
import { VectorStrategy } from '../strategies/vector-strategy';
import { FTSStrategy } from '../strategies/fts-strategy';
import { VectorProvider } from '../providers/vector-provider';
import { CacheProvider } from '../providers/cache-provider';

export { SqlInjectionError };

export enum SearchTier {
    LITE = 'LITE',         // Simple ILIKE, no indices required
    STANDARD = 'STANDARD', // Trigrams + GIN (Current implementation)
    ADVANCED = 'ADVANCED', // Pre-normalized columns + RUM indices
    VECTOR = 'VECTOR'      // Semantic search via pgvector
}

/** Optional structured logger that can be injected into the engine */
export interface SearchLogger {
    /** Called with timing and strategy information after each search */
    info(message: string, context?: Record<string, unknown>): void;
    /** Called when a recoverable issue is detected */
    warn(message: string, context?: Record<string, unknown>): void;
    /** Called on errors */
    error(message: string, context?: Record<string, unknown>): void;
}

export interface TrigramEngineConfig {
    /** Table name to search (must be a valid SQL identifier) */
    tableName: string;
    /** Columns to include in full-text / trigram search */
    searchColumns: string[];
    /** Optional column that stores the language code per row */
    languageColumn?: string;
    /** Primary key column name (default: 'id') */
    idColumn?: string;
    /** Pre-computed tsvector column for Turbo Mode FTS */
    ftsColumn?: string;
    /** Default page size (default: 20, must be > 0) */
    defaultLimit?: number;
    /** Maximum allowed page size (default: 1000) */
    maxLimit?: number;
    /** Strategy tier to use */
    tier?: SearchTier;
    /** Vector embedding provider for VECTOR tier */
    vectorProvider?: VectorProvider;
    /** Cache provider for result caching */
    cacheProvider?: CacheProvider;
    /** Cache TTL in seconds */
    defaultTTL?: number;
    /** Optional structured logger */
    logger?: SearchLogger;
}

export interface SearchOptions {
    query: string;
    language?: string;
    page?: number;
    limit?: number;
    filters?: Record<string, unknown>;
    /** Optional cursor (last seen ID) for keyset pagination (bypasses OFFSET) */
    cursor?: unknown;
    /** External signal to cancel the search */
    abortSignal?: AbortSignal;
}

/** Health status returned by TrigramSearchEngine.health() */
export interface HealthStatus {
    healthy: boolean;
    database: 'ok' | 'error';
    cache: 'ok' | 'error' | 'disabled';
    details?: Record<string, unknown>;
}

/** Maximum number of rows returned in a single query to protect against OOM */
const MAX_ROWS = 10_000;

export class TrigramSearchEngine {
    private inFlightRequests = new Map<string, Promise<SearchResult<any>>>();

    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {
        // --- Config Validation (#15) ---
        if (!config.tableName || typeof config.tableName !== 'string') {
            throw new Error('TrigramEngineConfig: tableName must be a non-empty string');
        }
        SqlSanitizer.validateIdentifier(config.tableName, 'tableName');

        if (!Array.isArray(config.searchColumns) || config.searchColumns.length === 0) {
            throw new Error('TrigramEngineConfig: searchColumns must be a non-empty array');
        }
        SqlSanitizer.validateIdentifiers(config.searchColumns, 'searchColumn');

        if (config.languageColumn) {
            SqlSanitizer.validateIdentifier(config.languageColumn, 'languageColumn');
        }
        if (config.ftsColumn) {
            SqlSanitizer.validateIdentifier(config.ftsColumn, 'ftsColumn');
        }
        if (config.idColumn) {
            SqlSanitizer.validateIdentifier(config.idColumn, 'idColumn');
        }

        this.config.idColumn = config.idColumn || 'id';
        this.config.defaultLimit = config.defaultLimit && config.defaultLimit > 0
            ? config.defaultLimit
            : 20;
        this.config.maxLimit = config.maxLimit && config.maxLimit > 0
            ? config.maxLimit
            : 1000;
        this.config.tier = config.tier || SearchTier.STANDARD;
    }

    /**
     * Main search entry point. Routes to the appropriate strategy tier.
     *
     * @param options - Search options including query, pagination, filters, and language
     * @returns Paginated search results with metadata
     */
    async search<T = Record<string, unknown>>(options: SearchOptions): Promise<SearchResult<T>> {
        const startTime = Date.now();
        const maxLimit = this.config.maxLimit!;

        // --- Pagination Validation (#18) ---
        const page = Math.max(1, Math.floor(options.page ?? 1));
        const rawLimit = options.limit ?? this.config.defaultLimit!;
        const limit = Math.min(Math.max(1, Math.floor(rawLimit)), maxLimit);

        const { query, language = 'en' } = options;
        const trimmed = (query || '').trim();

        // Validation
        const validation = QueryProcessor.validate(trimmed);
        if (!validation.valid) {
            return this.emptyResult(page, limit);
        }

        const normalized = QueryProcessor.normalize(trimmed);

        // --- Cache Check (#17: in-flight deduplication via early return) ---
        const cacheKey = this.generateCacheKey(normalized, { ...options, page, limit });
        if (this.config.cacheProvider) {
            try {
                const cached = await this.config.cacheProvider.get<SearchResult<T>>(cacheKey);
                if (cached) {
                    this.config.logger?.info('cache hit', { cacheKey, tier: this.config.tier });
                    return cached;
                }
            } catch (err) {
                this.config.logger?.warn('cache get failed', { error: String(err) });
            }
        }

        // --- In-Flight Deduplication & Execution Block (#17) ---
        let promise = this.inFlightRequests.get(cacheKey);
        
        if (!promise) {
            promise = (async () => {
                let results: SearchResult<T>;
                let strategyUsed: string;

                try {
                    // Tier-based routing
                    if (this.config.tier === SearchTier.LITE) {
                        strategyUsed = 'LITE';
                        results = await new LiteStrategy(this.adapter, this.config).search<T>(normalized, { ...options, page, limit });
                    } else if (this.config.tier === SearchTier.ADVANCED) {
                        strategyUsed = 'ADVANCED';
                        results = await new AdvancedStrategy(this.adapter, this.config).search<T>(normalized, { ...options, page, limit });
                    } else if (this.config.tier === SearchTier.VECTOR) {
                        strategyUsed = 'VECTOR';
                        results = await new VectorStrategy(this.adapter, this.config).search<T>(normalized, { ...options, page, limit });
                    } else {
                        // --- Hybrid Parallel Fast-Track Logic (Zombie Prevention) ---
                        strategyUsed = 'STANDARD+FTS';
                        results = await this.hybridSearch<T>(normalized, { ...options, page, limit }, language);
                    }
                } catch (err: unknown) {
                    const error = err as Error;
                    if (error.name === 'AbortError' || error.message === 'AbortError') {
                        return this.emptyResult(page, limit) as unknown as SearchResult<T>;
                    }
                    this.config.logger?.error('search failed', { error: String(err), tier: this.config.tier });
                    throw err;
                }

                // --- Max rows guard (#22) ---
                if (results.pagination.total > MAX_ROWS) {
                    this.config.logger?.warn('result set exceeds MAX_ROWS', {
                        total: results.pagination.total,
                        MAX_ROWS,
                    });
                }

                const elapsed = Date.now() - startTime;
                this.config.logger?.info('search completed', {
                    strategyUsed,
                    elapsed,
                    total: results.pagination.total,
                    cacheHit: false,
                });

                // --- Cache Write ---
                if (this.config.cacheProvider && results.pagination.total > 0) {
                    try {
                        await this.config.cacheProvider.set(cacheKey, results, this.config.defaultTTL);
                    } catch (err) {
                        this.config.logger?.warn('cache set failed', { error: String(err) });
                    }
                }

                return results;
            })();
            
            // Store the inflight promise and remove it when it finishes
            this.inFlightRequests.set(cacheKey, promise);
            promise.catch(() => {}).finally(() => {
                // Remove only if it's the same promise instance (prevents deleting new concurrent identical queries)
                if (this.inFlightRequests.get(cacheKey) === promise) {
                    this.inFlightRequests.delete(cacheKey);
                }
            });
        }

        return promise as unknown as Promise<SearchResult<T>>;
    }

    /**
     * Runs FTS and Standard search in parallel. Returns FTS results if found,
     * otherwise waits for Standard, then falls back to fuzzy + layout correction.
     * Uses Zombie Prevention to abort the losing branch.
     */
    private async hybridSearch<T>(
        normalized: string,
        options: SearchOptions,
        language: string,
    ): Promise<SearchResult<T>> {
        const { page = 1, limit = this.config.defaultLimit! } = options;
        const internalController = new AbortController();
        const signal = options.abortSignal || internalController.signal;

        const ftsPromise = new FTSStrategy(this.adapter, this.config)
            .search<T>(normalized, { ...options, abortSignal: signal });
        const standardPromise = this.standardSearch<T>(normalized, { ...options, abortSignal: signal });

        let results: SearchResult<T>;

        results = await ftsPromise;

        if (results.pagination.total > 0) {
            // FTS won — abort standard search (Zombie Prevention)
            internalController.abort();
            standardPromise.catch(() => {});
            return results;
        }

        // FTS found nothing — wait for already-running standard search
        results = await standardPromise;

        // Fuzzy Fallback
        if (results.pagination.total === 0) {
            const fuzzyResults = await this.fuzzySearch<T>(normalized, options);
            if (fuzzyResults.pagination.total > 0) {
                results = fuzzyResults;
            }
        }

        // Smart Layout Fallback (RU context)
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

        return results;
    }

    /**
     * Performs a parameterized ILIKE search across all search columns.
     */
    private async standardSearch<T>(query: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const skip = options.cursor ? 0 : (page - 1) * limit;

        const params: unknown[] = [query];
        let paramIdx = 2;

        // Build filter params
        const { clauses: filterClauses, params: filterParams, nextIdx } =
            this.buildFilters(filters, paramIdx);
        params.push(...filterParams);
        paramIdx = nextIdx;

        // Search condition: col ILIKE $1
        const searchOR = this.config.searchColumns
            .map(col => `${SqlSanitizer.quoteIdentifier(col)} ILIKE '%' || $1 || '%'`)
            .join(' OR ');

        const whereClauses = [...filterClauses, `(${searchOR})`];

        if (this.config.languageColumn && options.language) {
            whereClauses.push(`${SqlSanitizer.quoteIdentifier(this.config.languageColumn)} = $${paramIdx}`);
            params.push(options.language);
            paramIdx++;
        }

        const table = SqlSanitizer.quoteIdentifier(this.config.tableName, 'tableName');
        const idCol = SqlSanitizer.quoteIdentifier(this.config.idColumn || 'id', 'idColumn');

        if (options.cursor) {
            whereClauses.push(`${idCol} > $${paramIdx}`);
            params.push(options.cursor);
            paramIdx++;
        }

        const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const sql = `
            SELECT *, COUNT(*) OVER() as total_count 
            FROM ${table}
            ${where}
            ORDER BY ${idCol} ASC
            LIMIT ${limit} OFFSET ${skip}
        `;

        const rows = await this.adapter.query<Record<string, unknown>>(sql, params as unknown[], { signal: options.abortSignal });
        return this.mapRowsToResult<T>(rows, page, limit);
    }

    /**
     * Performs a fuzzy word-similarity search using pg_trgm.
     */
    private async fuzzySearch<T>(query: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const threshold = ThresholdCalculator.calculate(query);
        const skip = (page - 1) * limit;

        return this.adapter.transaction(async (tx) => {
            await tx.execute(`SET pg_trgm.word_similarity_threshold = ${threshold};`, [], { signal: options.abortSignal });

            const params: unknown[] = [query];
            let paramIdx = 2;

            const { clauses: filterClauses, params: filterParams, nextIdx } =
                this.buildFilters(filters, paramIdx);
            params.push(...filterParams);
            paramIdx = nextIdx;

            const whereClauses = [...filterClauses];
            if (this.config.languageColumn && options.language) {
                whereClauses.push(`${SqlSanitizer.quoteIdentifier(this.config.languageColumn)} = $${paramIdx}`);
                params.push(options.language);
                paramIdx++;
            }
            const where = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

            const simScores = this.config.searchColumns
                .map(col => `word_similarity($1, ${SqlSanitizer.quoteIdentifier(col)})`)
                .join(', ');

            const maxSimScore = `GREATEST(${simScores})`;

            const filterClause = this.config.searchColumns
                .map(col => {
                    const quoted = SqlSanitizer.quoteIdentifier(col);
                    return `(${quoted} ILIKE '%' || $1 || '%' OR $1 <% ${quoted})`;
                })
                .join(' OR ');

            const table = SqlSanitizer.quoteIdentifier(this.config.tableName, 'tableName');

            const sql = `
                SELECT *, 
                       ${maxSimScore} as relevance,
                       COUNT(*) OVER() as total_count
                FROM ${table}
                WHERE (${filterClause}) ${where}
                ORDER BY relevance DESC
                LIMIT ${limit} OFFSET ${skip}
            `;

            const rows = await tx.query<Record<string, unknown>>(sql, params as unknown[], { signal: options.abortSignal });
            return this.mapRowsToResult<T>(rows, page, limit);
        }, { signal: options.abortSignal });
    }

    /**
     * Builds parameterized WHERE clauses from a filters object.
     * Validates all column name keys against the SQL identifier whitelist.
     *
     * @param filters - Key-value pairs where keys are column names
     * @param startIdx - The starting $N parameter index
     */
    private buildFilters(
        filters: Record<string, unknown>,
        startIdx: number,
    ): { clauses: string[]; params: unknown[]; nextIdx: number } {
        const clauses: string[] = [];
        const params: unknown[] = [];
        let idx = startIdx;

        for (const [key, val] of Object.entries(filters)) {
            if (val === undefined || val === null || val === '') continue;

            // Validate the column name to prevent injection via filter key (#19)
            SqlSanitizer.validateIdentifier(key, `filter key "${key}"`);

            const quoted = SqlSanitizer.quoteIdentifier(key);
            clauses.push(`${quoted} = $${idx}`);

            // Type-safe coercion (#20): preserve booleans and numbers
            if (typeof val === 'boolean' || typeof val === 'number') {
                params.push(val);
            } else {
                params.push(String(val));
            }

            idx++;
        }

        return { clauses, params, nextIdx: idx };
    }

    private generateCacheKey(query: string, options: SearchOptions): string {
        const { language = 'en', page = 1, limit = this.config.defaultLimit!, filters = {} } = options;
        const filterStr = JSON.stringify(filters);
        return `ss:${this.config.tableName}:${query}:${language}:${page}:${limit}:${filterStr}`;
    }

    private mapRowsToResult<T>(rows: Record<string, unknown>[], page: number, limit: number): SearchResult<T> {
        const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
        const totalPages = Math.ceil(total / limit);

        return {
            data: rows as unknown as T[],
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

    private emptyResult(page: number, limit: number): SearchResult<never> {
        return {
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false }
        };
    }

    /**
     * Checks the health of this engine instance.
     * Verifies database connectivity and cache availability.
     *
     * @returns HealthStatus object with per-component status
     */
    async health(): Promise<HealthStatus> {
        const status: HealthStatus = {
            healthy: true,
            database: 'ok',
            cache: this.config.cacheProvider ? 'ok' : 'disabled',
            details: {},
        };

        // Check DB
        try {
            await this.adapter.query('SELECT 1', []);
        } catch (err) {
            status.database = 'error';
            status.healthy = false;
            status.details!.databaseError = String(err);
        }

        // Check Cache
        if (this.config.cacheProvider) {
            try {
                const testKey = `__health_check_${Date.now()}`;
                await this.config.cacheProvider.set(testKey, 1, 5);
                await this.config.cacheProvider.delete(testKey);
                status.cache = 'ok';
            } catch (err) {
                status.cache = 'error';
                status.healthy = false;
                status.details!.cacheError = String(err);
            }
        }

        return status;
    }
}
