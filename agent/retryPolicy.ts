export async function retry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  const retries = options?.retries ?? 5;
  const baseDelayMs = options?.baseDelayMs ?? 1000;

  let lastError: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if error is transient
      const isTransient = 
        error?.status === 429 ||
        error?.code === 429 ||
        error?.message?.includes('quota') ||
        error?.message?.includes('rate limit') ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ENOTFOUND';

      if (!isTransient || attempt === retries) {
        throw error;
      }

      // Exponential backoff
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
