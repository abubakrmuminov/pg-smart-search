/** Minimal interface for a Redis-compatible client (ioredis, node-redis, etc.) */
export interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, expiryMode: 'EX', time: number): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
    scan(cursor: string, matchOption: 'MATCH', pattern: string, countOption: 'COUNT', count: number): Promise<[string, string[]]>;
}

export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    /** Clears all cache entries managed by this provider */
    clear(): Promise<void>;
}

/**
 * In-memory cache provider. Suitable for single-process environments.
 * Uses a simple Map with per-entry TTL expiry.
 */
export class MemoryCacheProvider implements CacheProvider {
    private cache = new Map<string, { value: unknown; expires: number }>();

    async get<T>(key: string): Promise<T | null> {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return null;
        }
        return item.value as T;
    }

    async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
        this.cache.set(key, {
            value,
            expires: Date.now() + ttlSeconds * 1000,
        });
    }

    async delete(key: string): Promise<void> {
        this.cache.delete(key);
    }

    async clear(): Promise<void> {
        this.cache.clear();
    }
}

/** Key prefix used by pg-smart-search. Used to scope SCAN+DEL on clear(). */
const CACHE_PREFIX = 'ss:';

/**
 * Redis-backed cache provider.
 * Accepts any Redis client that implements the `RedisClient` interface (ioredis, node-redis, etc.)
 *
 * ⚠️ `clear()` deletes only keys with the "ss:" prefix — it does NOT call FLUSHDB.
 */
export class RedisCacheProvider implements CacheProvider {
    constructor(private redis: RedisClient) {}

    async get<T>(key: string): Promise<T | null> {
        const data = await this.redis.get(key);
        return data ? (JSON.parse(data) as T) : null;
    }

    async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }

    async delete(key: string): Promise<void> {
        await this.redis.del(key);
    }

    /**
     * Deletes all cache keys with the "ss:" prefix using SCAN + DEL.
     * Safe: does NOT call FLUSHDB which would wipe unrelated data. (#21)
     */
    async clear(): Promise<void> {
        let cursor = '0';
        do {
            const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', `${CACHE_PREFIX}*`, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } while (cursor !== '0');
    }
}
