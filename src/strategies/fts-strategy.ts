import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';

export class FTSStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {}, language = 'english' } = options;
        const skip = (page - 1) * limit;
        
        // Convert search query to websearch_to_tsquery or plainto_tsquery
        // websearch_to_tsquery is available since PG 11 and is very user-friendly
        const escapedQuery = normalized.replace(/'/g, "''");
        const tsquery = `websearch_to_tsquery('${language}', '${escapedQuery}')`;

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

        // If we have a dedicated tsvector column (Turbo Mode), use it. 
        // Otherwise, build it on the fly (slower, but works for setup).
        const searchTarget = this.config.ftsColumn || this.config.searchColumns
            .map(col => `to_tsvector('${language}', ${col})`)
            .join(' || ');

        const sql = `
            WITH search_results AS (
                SELECT *, 
                       ts_rank_cd(${searchTarget}, ${tsquery}, 32 /* rank(1) + rank(2) + rank(4) + rank(8) + rank(16) */) as relevance
                FROM ${this.config.tableName}
                WHERE (${searchTarget}) @@ ${tsquery} ${where}
            )
            SELECT *, COUNT(*) OVER() as total_count
            FROM search_results
            ORDER BY relevance DESC
            LIMIT ${limit} OFFSET ${skip}
        `;

        const rows = await this.adapter.query(sql, [], { signal: options.abortSignal });
        return this.mapRowsToResult(rows, page, limit);
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
