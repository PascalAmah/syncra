import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { LoggerService, AllExceptionsFilter } from './logger';
import { RateLimitGuard } from './common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const logger = app.get(LoggerService);
  app.useLogger(logger);
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // Global API prefix (health check lives at /health outside this prefix)
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  // Global rate limiting (enabled by default; set RATE_LIMIT_ENABLED=false to
  // disable, e.g. for load testing). Limits are enforced per user / client / IP.
  const rateLimitGuard = app.get(RateLimitGuard);
  app.useGlobalGuards(rateLimitGuard);

  // CORS — allow the demo / client app to call the API from the browser.
  // Configure CORS_ORIGINS as a comma-separated list of allowed origins to
  // restrict access; when unset, all origins are allowed (dev convenience).
  const config = app.get(ConfigService);
  const corsOrigins = config.get<string>('CORS_ORIGINS');
  const origin = corsOrigins
    ? corsOrigins
        .split(',')
        .map(o => o.trim())
        .filter(Boolean)
    : true; // reflect any origin

  app.enableCors({
    origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-user-id', 'x-client-id'],
    credentials: true,
  });

  // Request size limit — reject oversized bodies before they reach handlers.
  // Configure via BODY_SIZE_LIMIT (bytes, default 1 MB).
  app.useBodyParser('json', {
    limit: config.get<number>('BODY_SIZE_LIMIT') ?? 1048576,
  });

  // Graceful shutdown
  app.enableShutdownHooks();

  // After Nest flushes the app (DB pool, Redis/queue connections all closed
  // via onModuleDestroy), force-exit to guarantee the process doesn't hang on
  // lingering keep-alive sockets or unref'd timers. A hard timeout bounds how
  // long we wait so a stuck drain doesn't block a deploy for ever.
  const forceExitTimer = setTimeout(() => {
    logger.warn('Graceful shutdown timed out; forcing exit', 'Shutdown');
    process.exit(1);
  }, 30_000);
  forceExitTimer.unref?.();

  process.once('SIGTERM', () => {
    logger.log('SIGTERM received; shutting down', 'Shutdown');
    app.close().finally(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  });
  process.once('SIGINT', () => {
    logger.log('SIGINT received; shutting down', 'Shutdown');
    app.close().finally(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  });

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);

  logger.log(`API listening on port ${port}`, 'Bootstrap');
}

bootstrap();
