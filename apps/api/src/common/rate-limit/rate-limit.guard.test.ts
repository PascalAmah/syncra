import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { RateLimiter } from './rate-limit.guard';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ limit: 3, ttlMs: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit', () => {
    expect(() => {
      limiter.consume('client-1');
      limiter.consume('client-1');
      limiter.consume('client-1');
    }).not.toThrow();
  });

  it('throws 429 when the limit is exceeded', () => {
    limiter.consume('client-1');
    limiter.consume('client-1');
    limiter.consume('client-1');
    expect(() => limiter.consume('client-1')).toThrow(HttpException);
    try {
      limiter.consume('client-1');
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(429);
      const body = ex.getResponse() as { statusCode: number; retryAfter: number };
      expect(body.statusCode).toBe(429);
      expect(body.retryAfter).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps keys independent', () => {
    limiter.consume('client-1');
    limiter.consume('client-1');
    limiter.consume('client-1');
    // A different client is unaffected.
    expect(() => {
      limiter.consume('client-2');
      limiter.consume('client-2');
      limiter.consume('client-2');
    }).not.toThrow();
  });

  it('resets the window after the ttl elapses', () => {
    vi.useFakeTimers();
    const ttlLimiter = new RateLimiter({ limit: 3, ttlMs: 1000 });
    ttlLimiter.consume('client-1');
    ttlLimiter.consume('client-1');
    ttlLimiter.consume('client-1');
    // Not yet reset within the window:
    expect(() => ttlLimiter.consume('client-1')).toThrow(HttpException);
    // Advance past the TTL — the window rolls over and the count resets.
    vi.advanceTimersByTime(1001);
    ttlLimiter.prune();
    expect(() => {
      ttlLimiter.consume('client-1');
      ttlLimiter.consume('client-1');
    }).not.toThrow();
  });

  it('prunes idle buckets without affecting active ones', () => {
    vi.useFakeTimers();
    limiter.consume('old-key');
    limiter.consume('active-key');
    limiter.consume('active-key');
    vi.advanceTimersByTime(501);
    limiter.prune();
    // active-key entries are still within the ttl and remain counted.
    expect(() => limiter.consume('active-key')).not.toThrow();
  });
});
