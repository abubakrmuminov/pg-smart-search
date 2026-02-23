import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';
import { ThresholdCalculator } from '../core/threshold-calculator';

export class AdvancedStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const threshold = ThresholdCalculator.calculate(normalized);
        const skip = (page - 1) * limit;
        const escapedQuery = normalized.replace(/'/g, "''");

        return this.adapter.transaction(async (tx) => {
            // Advanced tier optimized for high-volume
            // Ideally should use RUM indexes for faster ordering
            await tx.execute(`SET pg_trgm.word_similarity_threshold = ${threshold};`);

            const whereClauses: string[] = [];
            Object.entries(filters).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== '') {
                    whereClauses.push(`${key.replace(/'/g, "''")} = '${String(val).replace(/'/g, "''")}'`);
                }
            });

            if (this.config.languageColumn && options.language) {
                whereClauses.push(`${this.config.languageColumn} = '${options.language.replace(/'/g, "''")}'`);
            }
            const where = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

            // Using word_similarity with weighted combination for better relevance
            const simScores = this.config.searchColumns
                .map(col => `word_similarity('${escapedQuery}', ${col})`)
                .join(' + ');
            
            const relevanceScore = `(${simScores}) / ${this.config.searchColumns.length}`;
            
            const filterClause = this.config.searchColumns
                .map(col => `(${col} ILIKE '%${escapedQuery}%' OR '${escapedQuery}' <% ${col})`)
                .join(' OR ');

            const sql = `
                WITH search_results AS (
                    SELECT *, 
                           ${relevanceScore} as relevance
                    FROM ${this.config.tableName}
                    WHERE (${filterClause}) ${where}
                )
                SELECT *, COUNT(*) OVER() as total_count
                FROM search_results
                ORDER BY relevance DESC
                LIMIT ${limit} OFFSET ${skip}
            `;

            const rows = await tx.query(sql);
            return this.mapRowsToResult(rows, page, limit);
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
}
