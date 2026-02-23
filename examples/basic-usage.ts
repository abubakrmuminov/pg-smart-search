import { 
    TrigramSearchEngine, 
    DatabaseAdapter, 
    SearchResult 
} from '../src';

/**
 * Mock Prisma Adapter to demonstrate integration
 */
class MockPrismaAdapter implements DatabaseAdapter {
    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
        console.log('Executing SQL:', sql);
        // In a real app, you would call: return this.prisma.$queryRawUnsafe(sql, ...params);
        return []; 
    }

    async execute(sql: string, params?: any[]): Promise<void> {
        console.log('Executing Statement:', sql);
    }

    async transaction<T>(callback: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
        return callback(this);
    }
}

async function runExample() {
    const adapter = new MockPrismaAdapter();
    
    // Initialize the engine for translations table
    const engine = new TrigramSearchEngine(adapter, {
        tableName: 'translations',
        searchColumns: ['text'],
        languageColumn: 'language_code',
        defaultLimit: 10
    });

    console.log('--- Searching for "prayer" with typos ---');
    await engine.search({
        query: 'paryer', // Typo
        language: 'en',
        filters: { grade: 'sahih' }
    });

    console.log('\n--- Searching with wrong layout ---');
    await engine.search({
        query: 'vjkbndf', // "молитва" in EN layout
        language: 'ru'
    });
}

runExample().catch(console.error);
