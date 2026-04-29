import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';
import { SqlSanitizer } from '../core/sql-sanitizer';

/**
 * LiteStrategy — Simple ILIKE search with no special PostgreSQL extensions required.
 * Best for development environments or small datasets where performance is not critical.
 */
export class LiteStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    /**
     * Searches using ILIKE pattern matching across all configured search columns.
     *
     * @param normalized - Pre-normalized search query
     * @param options - Search options (pagination, filters, language, abortSignal)
     */
    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const skip = options.cursor ? 0 : (page - 1) * limit;

        try {
            const params: unknown[] = [normalized]; // $1 = search query (#6)
            let paramIdx = 2;

            const whereClauses: string[] = [];

            // Build filter clauses with validated identifiers (#6, #19)
            for (const [key, val] of Object.entries(filters)) {
                if (val === undefined || val === null || val === '') continue;
                SqlSanitizer.validateIdentifier(key, `filter key "${key}"`);
                whereClauses.push(`${SqlSanitizer.quoteIdentifier(key)} = $${paramIdx}`);
                params.push(typeof val === 'boolean' || typeof val === 'number' ? val : String(val));
                paramIdx++;
            }

            // ILIKE search — $1 is the parameterized query
            const searchOR = this.config.searchColumns
                .map(col => `${SqlSanitizer.quoteIdentifier(col)} ILIKE '%' || $1 || '%'`)
                .join(' OR ');

            whereClauses.push(`(${searchOR})`);

            if (this.config.languageColumn && options.language) {
                whereClauses.push(`${SqlSanitizer.quoteIdentifier(this.config.languageColumn)} = $${paramIdx}`);
                params.push(options.language);
                paramIdx++;
            }

            const idCol = SqlSanitizer.quoteIdentifier(this.config.idColumn || 'id', 'idColumn');
            
            if (options.cursor) {
                whereClauses.push(`${idCol} > $${paramIdx}`);
                params.push(options.cursor);
                paramIdx++;
            }

            const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
            const table = SqlSanitizer.quoteIdentifier(this.config.tableName, 'tableName');

            const sql = `
                SELECT *, COUNT(*) OVER() as total_count 
                FROM ${table}
                ${where}
                ORDER BY ${idCol} ASC
                LIMIT ${limit} OFFSET ${skip}
            `;

            const rows = await this.adapter.query<Record<string, unknown>>(sql, params as unknown[], { signal: options.abortSignal });
            return this.mapRowsToResult<T>(rows, page, limit);
        } catch (err: unknown) {
            const error = err as Error;
            if (error.name === 'AbortError' || error.message === 'AbortError') throw err;
            throw new Error(`LiteStrategy search failed: ${error.message}`);
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
