export interface RateLimitModuleOptions {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  ttlMs: number;
}

export const RATE_LIMIT_OPTIONS = Symbol('RATE_LIMIT_OPTIONS');
