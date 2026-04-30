import { VectorProvider } from './vector-provider';
import { withApiReliability } from '../core/api-utils';
import PQueue from 'p-queue';

/** Gemini Embeddings API response shape */
interface GeminiEmbeddingResponse {
    embedding: { values: number[] };
}

/**
 * VectorProvider implementation for Google Gemini Embeddings API.
 * Automatically retries transient failures with exponential backoff.
 */
export class GeminiProvider implements VectorProvider {
    private queue: PQueue;

    constructor(
        private apiKey: string,
        private model = 'embedding-001',
        /** Maximum retry attempts for failed API calls (default: 3) */
        private maxRetries = 3,
    ) {
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
            throw new Error('GeminiProvider: apiKey must be a non-empty string');
        }

        // Ensure max 50 concurrent requests to Gemini
        this.queue = new PQueue({ concurrency: 50 });
    }

    /**
     * Generates a vector embedding for the given text using the Gemini Embeddings API.
     * Retries up to `maxRetries` times with exponential backoff on failure.
     *
     * @param text - The text to embed
     * @returns Array of floats representing the embedding vector
     */
    async generateEmbedding(text: string): Promise<number[]> {
        return withApiReliability(async (signal) => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-SDK-Version': '1.2.1'
                },
                body: JSON.stringify({ content: { parts: [{ text }] } }),
                signal,
            });

            if (!response.ok) {
                const error = await response.json() as { error?: { message?: string } };
                throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
            }

            const result = await response.json() as GeminiEmbeddingResponse;
            return result.embedding.values;
        }, {
            maxAttempts: this.maxRetries,
            timeoutMs: 10000,
            queue: this.queue,
        });
    }

    /** Returns the embedding dimension for the configured model */
    getDimensions(): number {
        return 768; // Default for embedding-001
    }
}
