import { TrigramSearchEngine, SearchTier, TrigramEngineConfig } from '../../src/engines/trigram-engine';
import { DatabaseAdapter, SearchResult } from '../../src/adapters/base-adapter';
import { MemoryCacheProvider } from '../../src/providers/cache-provider';
import { SqlInjectionError } from '../../src/core/sql-sanitizer';

/** Creates a minimal mock DatabaseAdapter */
function createMockAdapter(rows: Record<string, unknown>[] = []): jest.Mocked<DatabaseAdapter> {
    return {
        query: jest.fn().mockResolvedValue(rows),
        execute: jest.fn().mockResolvedValue(undefined),
        transaction: jest.fn().mockImplementation(async (cb: (a: DatabaseAdapter) => Promise<unknown>) => cb(createMockAdapter(rows))),
    };
}

const BASE_CONFIG: TrigramEngineConfig = {
    tableName: 'articles',
    searchColumns: ['title', 'body'],
    tier: SearchTier.LITE,
};

describe('TrigramSearchEngine — constructor validation (#15)', () => {
    it('throws for empty tableName', () => {
        expect(() => new TrigramSearchEngine(createMockAdapter(), { ...BASE_CONFIG, tableName: '' }))
            .toThrow();
    });

    it('throws for invalid tableName with SQL injection', () => {
        expect(() => new TrigramSearchEngine(createMockAdapter(), {
            ...BASE_CONFIG,
            tableName: 'users; DROP TABLE users--',
        })).toThrow(SqlInjectionError);
    });

    it('throws for empty searchColumns array', () => {
        expect(() => new TrigramSearchEngine(createMockAdapter(), {
            ...BASE_CONFIG,
            searchColumns: [],
        })).toThrow();
    });

    it('throws for invalid column name in searchColumns', () => {
        expect(() => new TrigramSearchEngine(createMockAdapter(), {
            ...BASE_CONFIG,
            searchColumns: ['title', 'bad col'],
        })).toThrow(SqlInjectionError);
    });

    it('constructs successfully with valid config', () => {
        expect(() => new TrigramSearchEngine(createMockAdapter(), BASE_CONFIG)).not.toThrow();
    });
});

describe('TrigramSearchEngine — pagination clamping (#18)', () => {
    it('clamps page to minimum 1', async () => {
        const adapter = createMockAdapter([{ total_count: 0 }]);
        const engine = new TrigramSearchEngine(adapter, BASE_CONFIG);
        // page: -5 should be clamped to 1
        const result = await engine.search({ query: 'hello', page: -5, limit: 10 });
        expect(result.pagination.page).toBe(1);
    });

    it('clamps limit to maxLimit (default 1000)', async () => {
        const adapter = createMockAdapter([{ total_count: 0 }]);
        const engine = new TrigramSearchEngine(adapter, BASE_CONFIG);
        const result = await engine.search({ query: 'hello', page: 1, limit: 99999 });
        expect(result.pagination.limit).toBeLessThanOrEqual(1000);
    });

    it('clamps limit to minimum 1', async () => {
        const adapter = createMockAdapter([{ total_count: 0 }]);
        const engine = new TrigramSearchEngine(adapter, BASE_CONFIG);
        const result = await engine.search({ query: 'hello', page: 1, limit: 0 });
        expect(result.pagination.limit).toBeGreaterThanOrEqual(1);
    });
});

describe('TrigramSearchEngine — cache behavior', () => {
    it('returns cached result without calling adapter', async () => {
        const adapter = createMockAdapter();
        const cache = new MemoryCacheProvider();
        const engine = new TrigramSearchEngine(adapter, { ...BASE_CONFIG, cacheProvider: cache });

        // Pre-populate cache
        const fakeResult: SearchResult = {
            data: [{ id: 1, title: 'cached' }],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
        };
        await cache.set('ss:articles:hello:en:1:20:{}', fakeResult, 60);

        const result = await engine.search({ query: 'hello' });
        expect(result.data).toEqual(fakeResult.data);
        expect(adapter.query).not.toHaveBeenCalled();
    });
});

describe('TrigramSearchEngine — invalid filter keys (#19)', () => {
    it('throws SqlInjectionError for filter key with SQL injection', async () => {
        const adapter = createMockAdapter();
        const engine = new TrigramSearchEngine(adapter, BASE_CONFIG);
        await expect(
            engine.search({ query: 'hello', filters: { "'; DROP TABLE articles--": 'value' } })
        ).rejects.toThrow(/Invalid filter key/);
    });
});

describe('TrigramSearchEngine — health check (#31)', () => {
    it('returns healthy:true when DB responds', async () => {
        const adapter = createMockAdapter([{ '?column?': 1 }]);
        const engine = new TrigramSearchEngine(adapter, BASE_CONFIG);
        const status = await engine.health();
        expect(status.healthy).toBe(true);
        expect(status.database).toBe('ok');
        expect(status.cache).toBe('disabled');
    });

    it('returns healthy:false when DB throws', async () => {
        const adapter = createMockAdapter();
        adapter.query.mockRejectedValue(new Error('connection refused'));
        const engine = new TrigramSearchEngine(adapter, BASE_CONFIG);
        const status = await engine.health();
        expect(status.healthy).toBe(false);
        expect(status.database).toBe('error');
    });

    it('reports cache status when cache is configured', async () => {
        const adapter = createMockAdapter([{ '?column?': 1 }]);
        const engine = new TrigramSearchEngine(adapter, {
            ...BASE_CONFIG,
            cacheProvider: new MemoryCacheProvider(),
        });
        const status = await engine.health();
        expect(status.cache).toBe('ok');
    });
});
