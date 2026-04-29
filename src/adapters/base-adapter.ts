/** Metadata attached to a search result (e.g. layout correction info) */
export type SearchMetadata = Record<string, unknown>;

/**
 * Paginated search result returned by all search strategies.
 * @template T - The shape of each result row
 */
export interface SearchResult<T = Record<string, unknown>> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
    metadata?: SearchMetadata;
}

/**
 * DatabaseAdapter — abstraction layer over any PostgreSQL client.
 * Implement this interface for your ORM/client of choice (pg, Prisma, Drizzle, Knex, etc.)
 */
export interface DatabaseAdapter {
    /**
     * Executes a parameterized SQL query and returns result rows.
     * @param sql - The SQL query string (may contain $1, $2, ... placeholders)
     * @param params - Ordered parameter values for the placeholders
     * @param options - Optional AbortSignal for query cancellation
     */
    query<T = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
        options?: { signal?: AbortSignal },
    ): Promise<T[]>;

    /**
     * Executes a parameterized SQL statement without returning rows.
     * @param sql - The SQL statement
     * @param params - Ordered parameter values
     * @param options - Optional AbortSignal for query cancellation
     */
    execute(
        sql: string,
        params?: unknown[],
        options?: { signal?: AbortSignal },
    ): Promise<void>;

    /**
     * Wraps multiple operations in a single database transaction.
     * @param callback - Function that receives a transaction-scoped adapter
     * @param options - Optional AbortSignal for transaction cancellation
     */
    transaction<T>(
        callback: (adapter: DatabaseAdapter) => Promise<T>,
        options?: { signal?: AbortSignal },
    ): Promise<T>;
}
