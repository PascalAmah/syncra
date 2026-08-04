import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitGuard, RateLimiter } from './rate-limit.guard';
import { RATE_LIMIT_OPTIONS, RateLimitModuleOptions } from './rate-limit.options';

/**
 * Global module exposing the application-wide rate limiter.
 *
 * The bucket store is periodically pruned in the background so idle client
 * entries don't accumulate indefinitely.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMIT_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RateLimitModuleOptions => ({
        limit: config.get<number>('RATE_LIMIT_LIMIT') ?? 100,
        ttlMs: (config.get<number>('RATE_LIMIT_TTL') ?? 60) * 1000,
      }),
    },
    RateLimiter,
    RateLimitGuard,
  ],
  exports: [RateLimitGuard, RateLimiter],
})
export class RateLimitModule {
  private timer?: ReturnType<typeof setInterval>;
  private readonly limiter: RateLimiter;

  constructor(limiter: RateLimiter) {
    this.limiter = limiter;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => this.limiter.prune(), 60_000);
    // Do not hold the process open solely for the timer.
    this.timer.unref?.();
  }
}
