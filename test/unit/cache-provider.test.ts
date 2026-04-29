import { MemoryCacheProvider, RedisCacheProvider, RedisClient } from '../../src/providers/cache-provider';

describe('MemoryCacheProvider', () => {
    let cache: MemoryCacheProvider;

    beforeEach(() => {
        cache = new MemoryCacheProvider();
    });

    it('returns null for missing keys', async () => {
        expect(await cache.get('missing')).toBeNull();
    });

    it('stores and retrieves a value', async () => {
        await cache.set('key1', { data: 42 }, 60);
        expect(await cache.get('key1')).toEqual({ data: 42 });
    });

    it('respects TTL and returns null after expiry', async () => {
        jest.useFakeTimers();
        await cache.set('expiring', 'value', 1); // 1 second TTL
        jest.advanceTimersByTime(1001); // advance past expiry
        expect(await cache.get('expiring')).toBeNull();
        jest.useRealTimers();
    });

    it('deletes a specific key', async () => {
        await cache.set('toDelete', 'goodbye', 60);
        await cache.delete('toDelete');
        expect(await cache.get('toDelete')).toBeNull();
    });

    it('clears all keys', async () => {
        await cache.set('a', 1, 60);
        await cache.set('b', 2, 60);
        await cache.clear();
        expect(await cache.get('a')).toBeNull();
        expect(await cache.get('b')).toBeNull();
    });
});

describe('RedisCacheProvider', () => {
    let mockRedis: jest.Mocked<RedisClient>;
    let provider: RedisCacheProvider;

    beforeEach(() => {
        mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            scan: jest.fn(),
        };
        provider = new RedisCacheProvider(mockRedis);
    });

    it('get returns null when redis returns null', async () => {
        mockRedis.get.mockResolvedValue(null);
        expect(await provider.get('key')).toBeNull();
    });

    it('get parses JSON from redis', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
        expect(await provider.get('key')).toEqual({ foo: 'bar' });
    });

    it('set serializes value as JSON with EX', async () => {
        mockRedis.set.mockResolvedValue('OK');
        await provider.set('key', { hello: 1 }, 120);
        expect(mockRedis.set).toHaveBeenCalledWith('key', JSON.stringify({ hello: 1 }), 'EX', 120);
    });

    it('delete calls del', async () => {
        mockRedis.del.mockResolvedValue(1);
        await provider.delete('key');
        expect(mockRedis.del).toHaveBeenCalledWith('key');
    });

    it('clear uses SCAN+DEL and NOT FLUSHDB (#21)', async () => {
        // First scan returns two keys, then signals done with cursor '0'
        mockRedis.scan
            .mockResolvedValueOnce(['42', ['ss:key1', 'ss:key2']])
            .mockResolvedValueOnce(['0', []]);
        mockRedis.del.mockResolvedValue(2);

        await provider.clear();

        // Must not call any FLUSHDB
        expect(mockRedis).not.toHaveProperty('flushdb');
        expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'ss:*', 'COUNT', 100);
        expect(mockRedis.del).toHaveBeenCalledWith('ss:key1', 'ss:key2');
        expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    });

    it('clear does not call del if no keys found', async () => {
        mockRedis.scan.mockResolvedValueOnce(['0', []]);
        await provider.clear();
        expect(mockRedis.del).not.toHaveBeenCalled();
    });
});
