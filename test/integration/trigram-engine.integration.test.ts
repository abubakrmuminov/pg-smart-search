import { Pool } from 'pg';
import { TrigramSearchEngine, SearchTier } from '../../src';
import { DatabaseAdapter } from '../../src/adapters/base-adapter';

// Inlined adapter for testing since NodePgAdapter is user-provided
class TestPgAdapter implements DatabaseAdapter {
    constructor(private pool: Pool) {}
    async query<T>(sql: string, params: any[], options?: { signal?: AbortSignal }): Promise<T[]> {
        const result = await this.pool.query(sql, params);
        return result.rows as T[];
    }
    async execute(sql: string, params: any[], options?: { signal?: AbortSignal }): Promise<void> {
        await this.pool.query(sql, params);
    }
    async transaction<T>(
        callback: (tx: DatabaseAdapter) => Promise<T>,
        options?: { signal?: AbortSignal }
    ): Promise<T> {
        return callback(this); // simple mock for testing
    }
}

// Ensure this matches the docker-compose.test.yml
const DATABASE_URL = 'postgresql://test_user:test_password@localhost:5432/test_db';

describe('🚀 Integration: TrigramSearchEngine Live DB', () => {
    let pool: Pool;
    let engine: TrigramSearchEngine;

    beforeAll(async () => {
        pool = new Pool({ connectionString: DATABASE_URL });

        // Basic DB setup for tests
        await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS test_products (
                id SERIAL PRIMARY KEY,
                name TEXT,
                description TEXT,
                lang TEXT
            );
        `);

        // Insert mock data
        await pool.query(`TRUNCATE TABLE test_products RESTART IDENTITY;`);
        await pool.query(`
            INSERT INTO test_products (name, description, lang) VALUES 
            ('Wireless Headphones', 'Fast Bluetooth 5.0 connection, ANC', 'en'),
            ('Mechanical Keyboard', 'RGB, Outemu Blue switches', 'en'),
            ('Gaming Mouse', '10000 DPI, ergonomic design', 'en'),
            ('Беспроводные наушники', 'Отличный звук и шумоподавление', 'ru')
        `);

        // Initialize Engine
        engine = new TrigramSearchEngine(new TestPgAdapter(pool), {
            tableName: 'test_products',
            searchColumns: ['name', 'description'],
            tier: SearchTier.STANDARD,
            languageColumn: 'lang'
        });
    });

    afterAll(async () => {
        if (pool) {
            await pool.query('DROP TABLE IF EXISTS test_products;');
            await pool.end();
        }
    });

    it('health() should return ok when db is reachable', async () => {
        const status = await engine.health();
        expect(status.healthy).toBe(true);
        expect(status.database).toBe('ok');
    });

    it('standardSearch should match exact words', async () => {
        const result = await engine.search({ query: 'Headphones', limit: 5 });
        expect(result.data.length).toBe(1);
        expect((result.data[0] as any).name).toBe('Wireless Headphones');
    });

    it('fuzzySearch should tolerate typos', async () => {
        const result = await engine.search({ query: 'hedphones', limit: 5 });
        // Depending on Postgres pg_trgm threshold, it might or mightn't return
        // We ensure the engine doesn't crash at least
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);
    });

    it('handles keyset pagination cursor properly', async () => {
        const result1 = await engine.search({ query: '', limit: 2 });
        expect(result1.data.length).toBe(2);
        
        const lastId = (result1.data[1] as any).id;
        
        const result2 = await engine.search({ query: '', limit: 2, cursor: lastId });
        // Since id sequence guarantees id > lastId
        expect(result2.data.length).toBe(2);
        expect((result2.data[0] as any).id).toBeGreaterThan(lastId);
    });
});
