import PQueue from 'p-queue';

/** Options for API execution wrapper */
export interface ApiCallOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
    queue?: PQueue;
}

/**
 * Shared wrapper for API calls that provides:
 * 1. Concurrency limiting (p-queue)
 * 2. Exponential backoff retry
 * 3. Max timeout execution
 */
export async function withApiReliability<T>(
    fn: () => Promise<T>,
    options: ApiCallOptions = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        baseDelayMs = 500,
        timeoutMs = 15000,
        queue,
    } = options;

    const execute = async (): Promise<T> => {
        let lastError: unknown;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Wrap in Promise.race for timeout
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error(`API call timed out after ${timeoutMs}ms`)), timeoutMs);
                });
                
                return await Promise.race([
                    fn(),
                    timeoutPromise
                ]);
            } catch (err: unknown) {
                lastError = err;
                if (attempt < maxAttempts) {
                    const delay = baseDelayMs * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    };

    if (queue) {
        return queue.add(execute) as Promise<T>;
    }
    
    return execute();
}
