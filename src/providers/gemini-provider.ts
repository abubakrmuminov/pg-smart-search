import { VectorProvider } from './vector-provider';

export class GeminiProvider implements VectorProvider {
    constructor(private apiKey: string, private model: string = 'embedding-001') {}

    async generateEmbedding(text: string): Promise<number[]> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: {
                    parts: [{ text }]
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
        }

        const result: any = await response.json();
        return result.embedding.values;
    }

    getDimensions(): number {
        return 768; // Default for embedding-001
    }
}
