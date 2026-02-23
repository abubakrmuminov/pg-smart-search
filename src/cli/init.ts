const { Select, Input, Confirm } = require('enquirer');
import pc from 'picocolors';

async function init() {
    console.log(pc.bold(pc.cyan('\n🚀 Welcome to pg-smart-search Setup SDK\n')));

    const tablePrompt = new Input({
        message: 'Enter your table name',
        initial: 'hadiths'
    });
    const table: string = await tablePrompt.run();

    const columnsPrompt = new Input({
        message: 'Enter search columns (comma separated)',
        initial: 'arabic_text'
    });
    const columns: string = await columnsPrompt.run();
    const searchCols: string[] = columns.split(',').map((c: string) => c.trim());

    const hybridPrompt = new Confirm({
        name: 'hybrid',
        message: 'Enable Hybrid Search? (FTS + Trigrams for max speed)',
        initial: true
    });
    const useHybrid = await hybridPrompt.run();

    const tierPrompt = new Select({
        name: 'tier',
        message: 'Select your Search Tier',
        choices: [
            { name: 'LITE', message: pc.green('LITE') + pc.dim('     - Small datasets (<100k), no special indices needed.') },
            { name: 'STANDARD', message: pc.yellow('STANDARD') + pc.dim(' - Medium datasets (100k - 1M), uses Trigrams + GIN.') },
            { name: 'ADVANCED', message: pc.red('ADVANCED') + pc.dim(' - Large datasets (>1M), uses RUM indices and normalization.') },
            { name: 'VECTOR', message: pc.magenta('VECTOR') + pc.dim('   - Semantic search via pgvector (AI-powered).') }
        ]
    });

    const tier = await tierPrompt.run();

    let sql = '';
    let configTier = `SearchTier.${tier}`;
    let providerConfig = '';

    console.log(pc.cyan(`\n✅ ${tier} Tier selected.`));

    if (tier === 'VECTOR') {
        // ... (Vector provider logic)
        const providerPrompt = new Select({
            name: 'provider',
            message: 'Select your Vector Provider',
            choices: [
                { name: 'OpenAI', message: pc.blue('OpenAI') + pc.dim(' - text-embedding-3-small') },
                { name: 'Gemini', message: pc.cyan('Gemini') + pc.dim(' - embedding-001') },
                { name: 'Other', message: pc.white('Other') + pc.dim('  - Custom implementation') }
            ]
        });

        const provider = await providerPrompt.run();

        if (provider !== 'Other') {
            const apiKeyPrompt = new Input({
                message: `Enter your ${provider} API Key`,
                initial: 'YOUR_API_KEY'
            });
            const apiKey = await apiKeyPrompt.run();

            if (provider === 'OpenAI') {
                providerConfig = `\n    vectorProvider: new OpenAIProvider('${apiKey}'),`;
            } else if (provider === 'Gemini') {
                providerConfig = `\n    vectorProvider: new GeminiProvider('${apiKey}'),`;
            }
        } else {
            providerConfig = pc.dim('\n    vectorProvider: new MyCustomProvider(), // Implement VectorProvider interface');
        }

        sql = `
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE ${table} ADD COLUMN embedding vector(${provider === 'Gemini' ? '768' : '1536'});
CREATE INDEX IF NOT EXISTS idx_${table}_vector ON ${table} USING hnsw (embedding vector_cosine_ops);
        `;
    }

    let turboMode = false;
    if (useHybrid && tier !== 'VECTOR' && tier !== 'LITE') {
        const turboPrompt = new Confirm({
            name: 'turbo',
            message: pc.bold(pc.yellow('🚀 Enable Turbo Mode?')) + pc.dim(' (Stored generated column for 5x faster search)'),
            initial: true
        });
        turboMode = await turboPrompt.run();

        if (turboMode) {
            const vectorCol = 'search_vector';
            sql = `
-- Turbo Mode: Pre-computed search vector (Stored Generated Column)
ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${vectorCol} tsvector 
GENERATED ALWAYS AS (to_tsvector('english', ${searchCols.join(" || ' ' || ")})) STORED;

CREATE INDEX IF NOT EXISTS idx_${table}_${vectorCol} ON ${table} USING GIN (${vectorCol});
            ` + (sql || '');
        } else {
            sql = `
-- Standard Hybrid Search Indices
${searchCols.map((col: string) => `CREATE INDEX IF NOT EXISTS idx_${table}_${col}_fts ON ${table} USING GIN (to_tsvector('english', ${col}));`).join('\n')}
            ` + (sql || '');
        }
    }

    switch (tier) {
        case 'STANDARD':
            sql += `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
${searchCols.map((col: string) => `CREATE INDEX IF NOT EXISTS idx_${table}_${col}_trgm ON ${table} USING GIN (${col} gin_trgm_ops);`).join('\n')}
            `;
            break;
        case 'ADVANCED':
            sql += `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS rum; 
${searchCols.map((col: string) => `CREATE INDEX IF NOT EXISTS idx_${table}_${col}_rum ON ${table} USING RUM (${col} rum_trgm_ops);`).join('\n')}
            `;
            break;
    }

    // --- Caching Section ---
    console.log(pc.bold(pc.cyan('\n⚡ Performance Optimization:')));
    const cachePrompt = new Select({
        name: 'cache',
        message: 'Enable Caching?',
        choices: [
            { name: 'None', message: 'No caching (always live data)' },
            { name: 'Memory', message: pc.green('Memory') + pc.dim(' - Fast, zero-config local cache') },
            { name: 'Redis', message: pc.red('Redis') + pc.dim('  - Distributed, for production') }
        ]
    });
    const cacheType = await cachePrompt.run();

    let cacheConfig = '';
    if (cacheType !== 'None') {
        const ttlPrompt = new Input({
            message: 'Set Cache TTL (seconds)',
            initial: '60'
        });
        const ttl = await ttlPrompt.run();

        if (cacheType === 'Memory') {
            cacheConfig = `\n    cacheProvider: new MemoryCacheProvider(),\n    defaultTTL: ${ttl},`;
        } else {
            cacheConfig = `\n    cacheProvider: new RedisCacheProvider(redisClient), // Pass your redis client instance\n    defaultTTL: ${ttl},`;
        }
    }

    if (sql) {
        console.log(pc.yellow('\n📝 Run this SQL in your database:'));
        console.log(pc.dim('---------------------------------'));
        console.log(pc.white(sql.trim()));
        console.log(pc.dim('---------------------------------'));
    }

    let turboConfig = '';
    if (turboMode) {
        turboConfig = `\n    ftsColumn: 'search_vector',`;
    }

    console.log(pc.cyan('\n⚙️  Your SDK Configuration:'));
    console.log(pc.white(`
const engine = new TrigramSearchEngine(adapter, {
    tableName: '${table}',
    searchColumns: [${searchCols.map((c: string) => `'${c}'`).join(', ')}],
    tier: ${configTier},${providerConfig}${cacheConfig}${turboConfig}
});
    `));

    console.log(pc.bold(pc.green('\n✨ Setup complete! Happy coding!\n')));
}

init().catch(err => {
    if (err) console.error(pc.red('\n✖ Setup cancelled or failed.'));
});
