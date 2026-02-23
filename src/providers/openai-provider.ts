import { VectorProvider } from './vector-provider';

export class OpenAIProvider implements VectorProvider {
    constructor(private apiKey: string, private model: string = 'text-embedding-3-small') {}

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                input: text,
                model: this.model
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
        }

        const result: any = await response.json();
        return result.data[0].embedding;
    }

    getDimensions(): number {
        return this.model.includes('3-small') ? 1536 : 3072;
    }
}
