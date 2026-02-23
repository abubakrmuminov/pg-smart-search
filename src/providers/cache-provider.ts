export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

export class MemoryCacheProvider implements CacheProvider {
    private cache = new Map<string, { value: any, expires: number }>();

    async get<T>(key: string): Promise<T | null> {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return null;
        }
        return item.value as T;
    }

    async set<T>(key: string, value: T, ttlSeconds: number = 60): Promise<void> {
        this.cache.set(key, {
            value,
            expires: Date.now() + (ttlSeconds * 1000)
        });
    }

    async delete(key: string): Promise<void> {
        this.cache.delete(key);
    }

    async clear(): Promise<void> {
        this.cache.clear();
    }
}

/**
 * RedisCacheProvider uses a generic Redis client (like ioredis or redis)
 */
export class RedisCacheProvider implements CacheProvider {
    constructor(private redis: any) {}

    async get<T>(key: string): Promise<T | null> {
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : null;
    }

    async set<T>(key: string, value: T, ttlSeconds: number = 60): Promise<void> {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }

    async delete(key: string): Promise<void> {
        await this.redis.del(key);
    }

    async clear(): Promise<void> {
        // Warning: FLUSHDB is destructive. 
        // In a real SDK, we might want to use prefixes and delete only by pattern.
        await this.redis.flushdb();
    }
}
