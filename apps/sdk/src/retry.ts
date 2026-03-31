/**
 * Exponential backoff utilities for retry logic.
 * delay = base * (2 ^ retries)
 */

export const MAX_RETRIES = 5;
export const DEFAULT_BASE_DELAY = 1000;

/**
 * Calculates the retry delay in milliseconds using exponential backoff.
 * @param retries - Number of retries already attempted
 * @param base - Base delay in ms (default: 1000)
 * @returns Delay in milliseconds: base * (2 ^ retries)
 */
export function calculateRetryDelay(retries: number, base: number = DEFAULT_BASE_DELAY): number {
  return base * Math.pow(2, retries);
}

/**
 * Calculates the next retry timestamp based on current time and retry count.
 * @param retries - Number of retries already attempted
 * @param base - Base delay in ms (default: 1000)
 * @returns Date representing when the next retry should occur
 */
export function calculateNextRetryAt(retries: number, base: number = DEFAULT_BASE_DELAY): Date {
  const delay = calculateRetryDelay(retries, base);
  return new Date(Date.now() + delay);
}
