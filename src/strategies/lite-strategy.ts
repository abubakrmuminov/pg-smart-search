import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';

export class LiteStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const skip = (page - 1) * limit;
        const escapedQuery = normalized.replace(/'/g, "''");

        const whereClauses: string[] = [];
        
        // Build filter clauses
        Object.entries(filters).forEach(([key, val]) => {
            if (val !== undefined && val !== null && val !== '') {
                whereClauses.push(`${key.replace(/'/g, "''")} = '${String(val).replace(/'/g, "''")}'`);
            }
        });

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
            ORDER BY ${this.config.idColumn} ASC
            LIMIT ${limit} OFFSET ${skip}
        `;

        const rows = await this.adapter.query(sql);
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
