export interface VectorProvider {
    /**
     * Converts text into a numerical vector (embedding)
     */
    generateEmbedding(text: string): Promise<number[]>;
    
    /**
     * Dimensions of the generated vectors (e.g., 1536 for OpenAI)
     */
    getDimensions(): number;
}
