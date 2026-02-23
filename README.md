# pg-smart-search 🚀

A high-performance Search SDK for PostgreSQL that provides speed and relevance comparable to specialized search engines for most use cases, while maintaining 100% database sovereignty.

## 🌟 Key Features

- 🏎️ **Parallel Search Strategy**: Runs FTS and Trigram searches concurrently for sub-15ms response times.
- 🧟 **Zombie Query Prevention**: Automatically cancels background queries via `AbortSignal` as soon as a winner is found.
- ⚡ **Turbo Mode (AOT)**: Support for stored generated columns (`tsvector`) for lightning-fast linguistic search.
- 🧠 **Smart Hybrid Fallback**: linguistic search -> ILIKE -> Trigram Fuzzy -> Keyboard Layout Correction.
- 🗄️ **Professional Caching**: Built-in Memory and Redis providers with configurable TTL.
- 🏆 **Ranking & Relevance**: Professional BM25-style ranking using `ts_rank_cd`.
- 🤖 **Semantic Vector Search**: Integrated support for OpenAI and Google Gemini embeddings via `pgvector`.
- 📊 **Built-in Benchmarking**: Real-time performance measurement tool included.

## 🚀 Performance (Elite Tier)

| Metric                       | Result (Turbo + Parallel) |
| :--------------------------- | :------------------------ |
| **Average Latency (Hit)**    | **~10.9ms**               |
| **p99 Latency (Worst Case)** | **~62.1ms**               |
| **Throughput**               | **~90 req/sec**           |
*measured on laptop, dedicated server results will vary

## 📊 Search Tiers Comparison

| Tier         | Dataset Size | Engine Features  | Indices Required  |
| :----------- | :----------- | :--------------- | :---------------- |
| **LITE**     | < 100k       | Basic `ILIKE`    | None              |
| **STANDARD** | 100k - 1M    | Trigrams + FTS   | GIN               |
| **ADVANCED** | > 1M         | Normalized + RUM | RUM + Trigrams    |
| **VECTOR**   | Semantic     | OpenAI/Gemini    | `pgvector` (HNSW) |

## 🛠️ Quick Start

### 1. Interactive Setup

The easiest way to initialize your database and generate configuration:

```bash
npm run init
```

### 2. Basic Usage

```typescript
import { TrigramSearchEngine, MemoryCacheProvider } from "pg-smart-search";

const engine = new TrigramSearchEngine(adapter, {
  tableName: "hadiths",
  searchColumns: ["text", "title"],
  ftsColumn: "search_vector", // Enabled via Turbo Mode
  cacheProvider: new MemoryCacheProvider(),
  defaultTTL: 3600,
});

const results = await engine.search({
  query: "prayrr", // Typo handled by Fuzzy fallback
  language: "ru", // Supports automatic layout correction
});
```

## 🔋 Advanced Features

### Smart Caching

Enable Redis for distributed production environments:

```typescript
import { RedisCacheProvider } from "pg-smart-search";
const cache = new RedisCacheProvider(myRedisClient);
```

### Parallel Fast-Track

The engine doesn't wait for all strategies. If the fast FTS finds results, it returns them immediately and cancels the slower trigram searches via `AbortSignal`.

### Benchmark Your Data

Test the actual performance on your dataset with the built-in tool:

```bash
npm run bench
```

## 📦 Installation

```bash
npm install pg-smart-search
```

## Why pg-smart-search?

It's the "Golden Mean":

- **Faster than ILIKE**: Uses GIN/RUM indices and parallel execution.
- **Cheaper than ES**: Zero extra infrastructure costs if you already use PG.
- **Smarter than standard SQL**: Handles typos, layout issues, and BM25 ranking out of the box.

## License

MIT
