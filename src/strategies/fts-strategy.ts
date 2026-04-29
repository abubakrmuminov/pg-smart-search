import { DatabaseAdapter, SearchResult } from '../adapters/base-adapter';
import { SearchOptions, TrigramEngineConfig } from '../engines/trigram-engine';
import { SqlSanitizer } from '../core/sql-sanitizer';

/** Allowed PostgreSQL FTS languages for to_tsvector / websearch_to_tsquery */
const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set([
    'simple', 'arabic', 'armenian', 'basque', 'catalan', 'danish', 'dutch',
    'english', 'finnish', 'french', 'german', 'greek', 'hindi', 'hungarian',
    'indonesian', 'irish', 'italian', 'lithuanian', 'nepali', 'norwegian',
    'portuguese', 'romanian', 'russian', 'serbian', 'spanish', 'swedish',
    'tamil', 'turkish', 'yiddish',
]);

/**
 * FTSStrategy — Full-text search using PostgreSQL's tsvector/tsquery.
 * Uses websearch_to_tsquery for user-friendly query syntax.
 * Supports both a pre-computed tsvector column (Turbo Mode) and on-the-fly generation.
 */
export class FTSStrategy {
    constructor(
        private adapter: DatabaseAdapter,
        private config: TrigramEngineConfig
    ) {}

    /**
     * Searches using PostgreSQL FTS (websearch_to_tsquery).
     *
     * @param normalized - Pre-normalized search query
     * @param options - Search options (pagination, filters, language, abortSignal)
     */
    async search<T>(normalized: string, options: SearchOptions): Promise<SearchResult<T>> {
        const { page = 1, limit = 20, filters = {} } = options;
        const skip = (page - 1) * limit;

        // Validate language against allowlist (#3, #10)
        const rawLang = (options.language || 'english').toLowerCase().trim();
        const language = ALLOWED_LANGUAGES.has(rawLang) ? rawLang : 'english';

        try {
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

            // language is validated above — safe to embed as identifier
            // $1 is the parameterized query value
            const tsquery = `websearch_to_tsquery('${language}', $1)`;

            // searchTarget: use pre-computed column or build on the fly
            // Language name validated above — safe to embed
            const searchTarget = this.config.ftsColumn
                ? SqlSanitizer.quoteIdentifier(this.config.ftsColumn)
                : this.config.searchColumns
                    .map(col => `to_tsvector('${language}', ${SqlSanitizer.quoteIdentifier(col)})`)
                    .join(' || ');

            const table = SqlSanitizer.quoteIdentifier(this.config.tableName, 'tableName');

            const sql = `
                WITH search_results AS (
                    SELECT *, 
                           ts_rank_cd(${searchTarget}, ${tsquery}, 32) as relevance
                    FROM ${table}
                    WHERE (${searchTarget}) @@ ${tsquery} ${where}
                )
                SELECT *, COUNT(*) OVER() as total_count
                FROM search_results
                ORDER BY relevance DESC
                LIMIT ${limit} OFFSET ${skip}
            `;

            const rows = await this.adapter.query<Record<string, unknown>>(sql, params as unknown[], { signal: options.abortSignal });
            return this.mapRowsToResult<T>(rows, page, limit);
        } catch (err: unknown) {
            const error = err as Error;
            if (error.name === 'AbortError' || error.message === 'AbortError') throw err;
            throw new Error(`FTSStrategy search failed: ${error.message}`);
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
