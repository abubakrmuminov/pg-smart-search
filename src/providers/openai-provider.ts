import { VectorProvider } from './vector-provider';
import { withApiReliability } from '../core/api-utils';
import PQueue from 'p-queue';

/** OpenAI Embeddings API response shape */
interface OpenAIEmbeddingResponse {
    data: Array<{ embedding: number[] }>;
}

/**
 * VectorProvider implementation for OpenAI Embeddings API.
 * Automatically retries transient failures with exponential backoff.
 */
export class OpenAIProvider implements VectorProvider {
    private queue: PQueue;

    constructor(
        private apiKey: string,
        private model = 'text-embedding-3-small',
        /** Maximum retry attempts for failed API calls (default: 3) */
        private maxRetries = 3,
    ) {
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
            throw new Error('OpenAIProvider: apiKey must be a non-empty string');
        }
        
        // Ensure max 50 concurrent requests to OpenAI
        this.queue = new PQueue({ concurrency: 50 });
    }

    /**
     * Generates a vector embedding for the given text using the OpenAI Embeddings API.
     * Retries up to `maxRetries` times with exponential backoff on failure.
     *
     * @param text - The text to embed
     * @returns Array of floats representing the embedding vector
     */
    async generateEmbedding(text: string): Promise<number[]> {
        return withApiReliability(async (signal) => {
            const response = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'X-SDK-Version': '1.2.1',
                    'User-Agent': 'pg-smart-search/1.2.1'
                },
                body: JSON.stringify({ input: text, model: this.model }),
                signal,
            });

            if (!response.ok) {
                const error = await response.json() as { error?: { message?: string } };
                throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
            }

            const result = await response.json() as OpenAIEmbeddingResponse;
            return result.data[0].embedding;
        }, {
            maxAttempts: this.maxRetries,
            timeoutMs: 10000,
            queue: this.queue,
        });
    }

    /** Returns the embedding dimension for the configured model */
    getDimensions(): number {
        return this.model.includes('3-small') ? 1536 : 3072;
    }
}
