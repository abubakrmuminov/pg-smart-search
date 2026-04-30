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
 * 3. Max timeout execution with real AbortSignal support
 */
export async function withApiReliability<T>(
    fn: (signal: AbortSignal) => Promise<T>,
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
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                return await fn(controller.signal);
            } catch (err: unknown) {
                lastError = err;
                
                // If it was a timeout (aborted by our timer or external)
                if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('timeout'))) {
                    lastError = new Error(`API call timed out after ${timeoutMs}ms`);
                }

                if (attempt < maxAttempts) {
                    const delay = baseDelayMs * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastError;
    };

    if (queue) {
        return queue.add(execute) as Promise<T>;
    }
    
    return execute();
}
