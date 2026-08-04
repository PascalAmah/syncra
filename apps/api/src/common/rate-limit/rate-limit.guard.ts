import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RATE_LIMIT_OPTIONS, RateLimitModuleOptions } from './rate-limit.options';

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * In-process fixed-window rate limiter.
 *
 * Tracks request counts per unique key (default: client IP, falling back to a
 * user/API-key/header-bearing key when available). When the key exceeds
 * `limit` requests within `ttlMs`, subsequent calls are rejected with 429 until
 * the current window rolls over.
 *
 * The store is in-memory, so limits are per-process — acceptable for a single
 * API instance. Multi-instance deployments should swap this for a shared Redis
 * backing store.
 */
@Injectable()
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly ttlMs: number;

  constructor(@Inject(RATE_LIMIT_OPTIONS) options: RateLimitModuleOptions) {
    this.limit = options.limit;
    this.ttlMs = options.ttlMs;
  }

  consume(key: string): void {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || now - existing.windowStart >= this.ttlMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return;
    }

    existing.count += 1;
    if (existing.count > this.limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          retryAfter: Math.ceil((existing.windowStart + this.ttlMs - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  /** Periodic cleanup to avoid unbounded growth of idle buckets. */
  prune(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.ttlMs) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Global guard enforcing an application-wide request rate limit per client.
 * Disabled entirely when `RATE_LIMIT_ENABLED=false`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly configService: ConfigService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.configService.get<string>('RATE_LIMIT_ENABLED') === 'false') {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      user?: { id: string };
      headers: Record<string, string | undefined>;
    }>();

    // Prefer an authenticated identity over a raw IP so each user gets their
    // own budget. Fall back to the forwarded/client IP, then to a global key.
    const key =
      request.user?.id ??
      request.headers['x-api-key'] ??
      request.headers['x-client-id'] ??
      request.ip ??
      'anonymous';

    this.limiter.consume(key);
    return true;
  }
}
