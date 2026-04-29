import { VectorProvider } from './vector-provider';

/** Shared exponential backoff retry helper for API calls */
async function withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
    baseDelayMs = 500,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: unknown) {
            lastError = err;
            if (attempt < maxAttempts) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

/** Gemini Embeddings API response shape */
interface GeminiEmbeddingResponse {
    embedding: { values: number[] };
}

/**
 * VectorProvider implementation for Google Gemini Embeddings API.
 * Automatically retries transient failures with exponential backoff.
 */
export class GeminiProvider implements VectorProvider {
    constructor(
        private apiKey: string,
        private model = 'embedding-001',
        /** Maximum retry attempts for failed API calls (default: 3) */
        private maxRetries = 3,
    ) {
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
            throw new Error('GeminiProvider: apiKey must be a non-empty string');
        }
    }

    /**
     * Generates a vector embedding for the given text using the Gemini Embeddings API.
     * Retries up to `maxRetries` times with exponential backoff on failure.
     *
     * @param text - The text to embed
     * @returns Array of floats representing the embedding vector
     */
    async generateEmbedding(text: string): Promise<number[]> {
        return withRetry(async () => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: { parts: [{ text }] } }),
            });

            if (!response.ok) {
                const error = await response.json() as { error?: { message?: string } };
                throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
            }

            const result = await response.json() as GeminiEmbeddingResponse;
            return result.embedding.values;
        }, this.maxRetries);
    }

    /** Returns the embedding dimension for the configured model */
    getDimensions(): number {
        return 768; // Default for embedding-001
    }
}
