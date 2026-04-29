import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';
import { ThresholdCalculator } from '../core/threshold-calculator';
import { SqlSanitizer } from '../core/sql-sanitizer';

/**
 * AdvancedStrategy — High-performance similarity search using pg_trgm word_similarity.
 * Optimized for high-volume workloads; benefits from RUM indexes for ordering.
 */
export class AdvancedStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    /**
     * Searches using word_similarity scoring with a dynamic threshold set per transaction.
     *
     * @param normalized - Pre-normalized search query
     * @param options - Search options (pagination, filters, language, abortSignal)
     */
    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const threshold = ThresholdCalculator.calculate(normalized);
        const skip = (page - 1) * limit;

        try {
            return await this.adapter.transaction(async (tx) => {
                // Dynamic threshold is a computed number — safe to embed
                await tx.execute(
                    `SET pg_trgm.word_similarity_threshold = ${threshold};`,
                    [],
                    { signal: options.abortSignal },
                );

                const params: unknown[] = [normalized];
                let paramIdx = 2;

                // Build filter clauses
                const filterClauses: string[] = [];
                for (const [key, val] of Object.entries(filters)) {
                    if (val === undefined || val === null || val === '') continue;
                    SqlSanitizer.validateIdentifier(key, `filter key "${key}"`);
                    filterClauses.push(`${SqlSanitizer.quoteIdentifier(key)} = $${paramIdx}`);
                    params.push(typeof val === 'boolean' || typeof val === 'number' ? val : String(val));
                    paramIdx++;
                }

                if (this.config.languageColumn && options.language) {
                    filterClauses.push(`${SqlSanitizer.quoteIdentifier(this.config.languageColumn)} = $${paramIdx}`);
                    params.push(options.language);
                    paramIdx++;
                }

                const where = filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

                // $1 = query — parameterized (#4)
                const simScores = this.config.searchColumns
                    .map(col => `word_similarity($1, ${SqlSanitizer.quoteIdentifier(col)})`)
                    .join(' + ');

                const relevanceScore = `(${simScores}) / ${this.config.searchColumns.length}`;

                const filterClause = this.config.searchColumns
                    .map(col => {
                        const quoted = SqlSanitizer.quoteIdentifier(col);
                        return `(${quoted} ILIKE '%' || $1 || '%' OR $1 <% ${quoted})`;
                    })
                    .join(' OR ');

                const table = SqlSanitizer.quoteIdentifier(this.config.tableName, 'tableName');

                const sql = `
                    WITH search_results AS (
                        SELECT *, 
                               ${relevanceScore} as relevance
                        FROM ${table}
                        WHERE (${filterClause}) ${where}
                    )
                    SELECT *, COUNT(*) OVER() as total_count
                    FROM search_results
                    ORDER BY relevance DESC
                    LIMIT ${limit} OFFSET ${skip}
                `;

                // Pass signal to tx.query (#16)
                const rows = await tx.query<Record<string, unknown>>(sql, params as unknown[], { signal: options.abortSignal });
                return this.mapRowsToResult<T>(rows, page, limit);
            }, { signal: options.abortSignal });
        } catch (err: unknown) {
            const error = err as Error;
            if (error.name === 'AbortError' || error.message === 'AbortError') throw err;
            throw new Error(`AdvancedStrategy search failed: ${error.message}`);
        }
    }

    private mapRowsToResult<T>(rows: Record<string, unknown>[], page: number, limit: number): SearchResult<T> {
        const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
        const totalPages = Math.ceil(total / limit);
        return {
            data: rows as unknown as T[],
            pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
        };
    }
}
