import { TrigramSearchEngine } from '../engines/trigram-engine';

export interface BenchmarkResults {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    throughput: number;
    totalTime: number;
}

export class SearchBenchmark {
    constructor(private engine: TrigramSearchEngine) {}

    async run(queries: string[], iterations: number = 10): Promise<BenchmarkResults> {
        const latencies: number[] = [];
        const startTime = Date.now();

        for (let i = 0; i < iterations; i++) {
            for (const query of queries) {
                const start = performance.now();
                await this.engine.search({ query });
                const end = performance.now();
                latencies.push(end - start);
            }
        }

        const totalTime = Date.now() - startTime;
        latencies.sort((a, b) => a - b);

        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const p50 = latencies[Math.floor(latencies.length * 0.5)];
        const p95 = latencies[Math.floor(latencies.length * 0.95)];
        const p99 = latencies[Math.floor(latencies.length * 0.99)];
        const throughput = (latencies.length / (totalTime / 1000));

        return {
            avg: parseFloat(avg.toFixed(2)),
            p50: parseFloat(p50.toFixed(2)),
            p95: parseFloat(p95.toFixed(2)),
            p99: parseFloat(p99.toFixed(2)),
            throughput: Math.floor(throughput),
            totalTime
        };
    }
}
