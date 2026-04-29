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

/** OpenAI Embeddings API response shape */
interface OpenAIEmbeddingResponse {
    data: Array<{ embedding: number[] }>;
}

/**
 * VectorProvider implementation for OpenAI Embeddings API.
 * Automatically retries transient failures with exponential backoff.
 */
export class OpenAIProvider implements VectorProvider {
    constructor(
        private apiKey: string,
        private model = 'text-embedding-3-small',
        /** Maximum retry attempts for failed API calls (default: 3) */
        private maxRetries = 3,
    ) {
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
            throw new Error('OpenAIProvider: apiKey must be a non-empty string');
        }
    }

    /**
     * Generates a vector embedding for the given text using the OpenAI Embeddings API.
     * Retries up to `maxRetries` times with exponential backoff on failure.
     *
     * @param text - The text to embed
     * @returns Array of floats representing the embedding vector
     */
    async generateEmbedding(text: string): Promise<number[]> {
        return withRetry(async () => {
            const response = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({ input: text, model: this.model }),
            });

            if (!response.ok) {
                const error = await response.json() as { error?: { message?: string } };
                throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
            }

            const result = await response.json() as OpenAIEmbeddingResponse;
            return result.data[0].embedding;
        }, this.maxRetries);
    }

    /** Returns the embedding dimension for the configured model */
    getDimensions(): number {
        return this.model.includes('3-small') ? 1536 : 3072;
    }
}
