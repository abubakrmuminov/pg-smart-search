import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';
import { SqlSanitizer } from '../core/sql-sanitizer';

/**
 * VectorStrategy — Semantic similarity search using pgvector.
 * Generates embeddings from the query via a VectorProvider and searches
 * using the cosine distance operator (<=>).
 */
export class VectorStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    /**
     * Searches using vector cosine similarity via pgvector's <=> operator.
     *
     * @param normalized - Pre-normalized search query
     * @param options - Search options (pagination, filters, language, abortSignal)
     */
    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        if (!this.config.vectorProvider) {
            throw new Error('VectorProvider is required for VECTOR tier');
        }

        const { page = 1, limit = 20, filters = {} } = options;
        const skip = (page - 1) * limit;

        try {
            // Generate embedding from query
            const embedding = await this.config.vectorProvider.generateEmbedding(normalized);

            const params: unknown[] = [JSON.stringify(embedding)]; // $1 = vector as string (#5)
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

            const where = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';
            const table = SqlSanitizer.quoteIdentifier(this.config.tableName, 'tableName');

            // $1 contains the pgvector-compatible embedding string "#5
            const sql = `
                SELECT *, 
                       (1 - (embedding <=> $1::vector)) as relevance,
                       COUNT(*) OVER() as total_count
                FROM ${table}
                ${where}
                ORDER BY embedding <=> $1::vector
                LIMIT ${limit} OFFSET ${skip}
            `;

            const rows = await this.adapter.query<Record<string, unknown>>(sql, params as unknown[], { signal: options.abortSignal });
            return this.mapRowsToResult<T>(rows, page, limit);
        } catch (err: unknown) {
            const error = err as Error;
            if (error.name === 'AbortError' || error.message === 'AbortError') throw err;
            throw new Error(`VectorStrategy search failed: ${error.message}`);
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
