import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  calculateRetryDelay,
  calculateNextRetryAt,
  MAX_RETRIES,
  DEFAULT_BASE_DELAY,
} from './retry';

describe('retry utilities', () => {
  describe('constants', () => {
    it('MAX_RETRIES is 5', () => {
      expect(MAX_RETRIES).toBe(5);
    });

    it('DEFAULT_BASE_DELAY is 1000', () => {
      expect(DEFAULT_BASE_DELAY).toBe(1000);
    });
  });

  describe('calculateRetryDelay', () => {
    it('returns base * 2^0 = base for 0 retries', () => {
      expect(calculateRetryDelay(0)).toBe(1000);
    });

    it('returns base * 2^1 = 2000 for 1 retry', () => {
      expect(calculateRetryDelay(1)).toBe(2000);
    });

    it('returns base * 2^2 = 4000 for 2 retries', () => {
      expect(calculateRetryDelay(2)).toBe(4000);
    });

    it('returns base * 2^3 = 8000 for 3 retries', () => {
      expect(calculateRetryDelay(3)).toBe(8000);
    });

    it('returns base * 2^4 = 16000 for 4 retries', () => {
      expect(calculateRetryDelay(4)).toBe(16000);
    });

    it('returns base * 2^5 = 32000 for 5 retries (max)', () => {
      expect(calculateRetryDelay(5)).toBe(32000);
    });

    it('uses custom base delay', () => {
      expect(calculateRetryDelay(2, 500)).toBe(2000); // 500 * 4
    });
  });

  describe('calculateNextRetryAt', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns a Date offset by the calculated delay', () => {
      const now = 1_700_000_000_000;
      vi.setSystemTime(now);

      const result = calculateNextRetryAt(0);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(now + 1000); // 1000 * 2^0
    });

    it('returns correct timestamp for retry 3', () => {
      const now = 1_700_000_000_000;
      vi.setSystemTime(now);

      const result = calculateNextRetryAt(3);
      expect(result.getTime()).toBe(now + 8000); // 1000 * 2^3
    });

    it('respects custom base delay', () => {
      const now = 1_700_000_000_000;
      vi.setSystemTime(now);

      const result = calculateNextRetryAt(1, 500);
      expect(result.getTime()).toBe(now + 1000); // 500 * 2^1
    });
  });
});
