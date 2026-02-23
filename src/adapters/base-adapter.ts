export interface SearchResult<T = any> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
    metadata?: any;
}

export interface DatabaseAdapter {
    /**
     * Executes a raw SQL query and returns results
     */
    query<T = any>(sql: string, params?: any[], options?: { signal?: AbortSignal }): Promise<T[]>;
    
    /**
     * Executes a raw SQL statement (no return)
     */
    execute(sql: string, params?: any[], options?: { signal?: AbortSignal }): Promise<void>;
    
    /**
     * Wraps multiple operations in a transaction
     */
    transaction<T>(callback: (adapter: DatabaseAdapter) => Promise<T>, options?: { signal?: AbortSignal }): Promise<T>;
}
