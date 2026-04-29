// @ts-nocheck
// examples/prisma-example.ts
import { PrismaClient } from '@prisma/client';
import { TrigramSearchEngine, SearchTier, NodePgAdapter } from 'pg-smart-search';
import { Pool } from 'pg';

const prisma = new PrismaClient();

// Note: Prisma does not expose the underlying connection pool directly in a way 
// that we can reuse its active connections perfectly, so we create a standard pg Pool 
// to powers the pg-smart-search engine. The engine handles the heavy PostgreSQL-specific
// search functions, while Prisma handles standard CRUD.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const searchAdapter = new NodePgAdapter(pool);

// Assume we have a 'Product' model in Prisma
const productEngine = new TrigramSearchEngine(searchAdapter, {
    tableName: 'Product', // Must match the actual DB table name Prisma created
    searchColumns: ['name', 'description'],
    tier: SearchTier.STANDARD,
    idColumn: 'id'
});

async function main() {
    console.log("Searching products...");
    
    // 1. Perform Search using pg-smart-search
    const searchResults = await productEngine.search<{ id: number }>({
        query: 'wireless headphones',
        limit: 10
    });

    if (searchResults.data.length === 0) {
        console.log("No results found.");
        return;
    }

    // 2. Fetch the full models using Prisma
    // Extract the primary keys from the search results
    const resultIds = searchResults.data.map(row => row.id);

    // Fetch the strongly-typed Prisma models using an IN clause
    const products = await prisma.product.findMany({
        where: {
            id: { in: resultIds }
        }
    });

    // 3. Map Prisma models back to the search order
    // (Because findMany uses IN(), the database might return them in a different order)
    const orderedProducts = resultIds.map(id => products.find(p => p.id === id)).filter(Boolean);

    console.log(`Found ${searchResults.pagination.total} products.`);
    console.dir(orderedProducts, { depth: null });
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
