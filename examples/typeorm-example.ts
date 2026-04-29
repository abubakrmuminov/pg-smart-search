// @ts-nocheck
// examples/typeorm-example.ts
import { DataSource, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { TrigramSearchEngine, SearchTier } from 'pg-smart-search';
import { DatabaseAdapter } from 'pg-smart-search/adapters/base-adapter';

// 1. TypeORM Entity
@Entity('users')
export class User {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column()
    bio: string;
}

// 2. Custom Adapter Implementation using TypeORM's query runner
class TypeOrmAdapter implements DatabaseAdapter {
    constructor(private dataSource: DataSource) {}

    async query<T>(sql: string, params: any[], options?: { signal?: AbortSignal }): Promise<T[]> {
        // TypeORM query runner execution
        return this.dataSource.query(sql, params);
    }

    async transaction<T>(
        callback: (tx: DatabaseAdapter) => Promise<T>,
        options?: { signal?: AbortSignal }
    ): Promise<T> {
        return this.dataSource.transaction(async (manager) => {
            // Create a temporary sub-adapter representing this transaction
            const txAdapter: DatabaseAdapter = {
                query: async (sql: string, params: any[]) => manager.query(sql, params),
                transaction: async () => { throw new Error('Nested transactions not supported'); }
            };
            return callback(txAdapter);
        });
    }
}

async function main() {
    const AppDataSource = new DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: [User],
        synchronize: true,
    });

    await AppDataSource.initialize();

    // 3. Instantiate Engine with TypeOrmAdapter
    const adapter = new TypeOrmAdapter(AppDataSource);
    
    const userEngine = new TrigramSearchEngine(adapter, {
        tableName: 'users',
        searchColumns: ['name', 'bio'],
        tier: SearchTier.STANDARD
    });

    // 4. Seeding some data via TypeORM
    const repo = AppDataSource.getRepository(User);
    await repo.save([
        { name: 'Alice', bio: 'Loves rock climbing and algorithms.' },
        { name: 'Alan', bio: 'Builds distributed systems.' }
    ]);

    // 5. Searching via SDK
    console.log("Searching for 'algorithm'...");
    
    // We can map the output type directly if we don't care about TypeORM specific entity methods
    const results = await userEngine.search<User>({
        query: 'algorithm',
        limit: 10
    });

    console.log(`Found ${results.pagination.total} users.`);
    console.log(results.data);

    await AppDataSource.destroy();
}

main().catch(console.error);
