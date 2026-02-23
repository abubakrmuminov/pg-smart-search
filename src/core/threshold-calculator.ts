export class ThresholdCalculator {
    /**
     * Calculate dynamic similarity threshold based on query length and word count.
     * Optimized for word_similarity (substring matching) which generally produces higher scores
     * than full string similarity.
     */
    static calculate(query: string): number {
        const length = query.length;
        const wordCount = query.split(/\s+/).length;

        // Very short queries (< 5 chars) - need very high precision to avoid noise
        if (length < 5 && wordCount === 1) {
            return 0.8;
        }

        // 5 chars exactly - balanced for partial matches
        if (length === 5 && wordCount === 1) {
            return 0.7;
        }

        // 6-9 chars - balanced for typos
        if (length < 10 && wordCount === 1) {
            return 0.5;
        }

        // Medium queries (10-29 chars)
        if (length < 30) {
            return 0.4;
        }

        // Long queries (30+ chars) - allow more flexibility for typos/omissions
        return 0.3;
    }
}
