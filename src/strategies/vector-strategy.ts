import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';

export class VectorStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        if (!this.config.vectorProvider) {
            throw new Error('VectorProvider is required for VECTOR tier');
        }

        const { page = 1, limit = 20, filters = {} } = options;
        const skip = (page - 1) * limit;

        // Generate embedding from query
        const embedding = await this.config.vectorProvider.generateEmbedding(normalized);
        const vectorString = `[${embedding.join(',')}]`;

        const whereClauses: string[] = [];
        Object.entries(filters).forEach(([key, val]) => {
            if (val !== undefined && val !== null && val !== '') {
                whereClauses.push(`${key.replace(/'/g, "''")} = '${String(val).replace(/'/g, "''")}'`);
            }
        });

        if (this.config.languageColumn && options.language) {
            whereClauses.push(`${this.config.languageColumn} = '${options.language.replace(/'/g, "''")}'`);
        }
        const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Using <=> operator for cosine similarity in pgvector
        // (1 - (embedding <=> column)) is the similarity score
        const sql = `
            SELECT *, 
                   (1 - (embedding <=> '${vectorString}')) as relevance,
                   COUNT(*) OVER() as total_count
            FROM ${this.config.tableName}
            ${where}
            ORDER BY embedding <=> '${vectorString}'
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
