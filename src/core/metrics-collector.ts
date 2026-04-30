/**
 * Production-ready Metrics Collector for pg-smart-search.
 * Tracks performance, cache hits/misses, and provider health.
 */
export class MetricsCollector {
    private metrics = {
        totalSearches: 0,
        cacheHits: 0,
        cacheMisses: 0,
        dbLatencies: [] as number[],
        providerErrors: 0,
        strategyUsage: {} as Record<string, number>
    };

    /** Record a search start */
    recordSearch(strategy: string) {
        this.metrics.totalSearches++;
        this.metrics.strategyUsage[strategy] = (this.metrics.strategyUsage[strategy] || 0) + 1;
    }

    /** Record cache hit */
    recordCacheHit() {
        this.metrics.cacheHits++;
    }

    /** Record cache miss */
    recordCacheMiss() {
        this.metrics.cacheMisses++;
    }

    /** Record database query latency */
    recordDbLatency(ms: number) {
        this.metrics.dbLatencies.push(ms);
        if (this.metrics.dbLatencies.length > 1000) this.metrics.dbLatencies.shift();
    }

    /** Record external provider error (OpenAI/Gemini) */
    recordProviderError() {
        this.metrics.providerErrors++;
    }

    /** Get summary of all metrics */
    getSummary() {
        const avgLatency = this.metrics.dbLatencies.length > 0
            ? this.metrics.dbLatencies.reduce((a, b) => a + b, 0) / this.metrics.dbLatencies.length
            : 0;

        return {
            ...this.metrics,
            avgDbLatencyMs: Math.round(avgLatency * 100) / 100,
            cacheHitRate: this.metrics.totalSearches > 0
                ? Math.round((this.metrics.cacheHits / this.metrics.totalSearches) * 100) / 100
                : 0
        };
    }

    /** Reset all metrics */
    reset() {
        this.metrics = {
            totalSearches: 0,
            cacheHits: 0,
            cacheMisses: 0,
            dbLatencies: [],
            providerErrors: 0,
            strategyUsage: {}
        };
    }
}
