import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { configSchema } from '@syncra/config';
import { DatabaseModule } from './database';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RecordsModule } from './records/records.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './health/health.module';
import { LoggerService, HttpLoggingMiddleware } from './logger';
import { ProjectsModule } from './projects/projects.module';
import { MetricsModule } from './metrics/metrics.module';
import { AuditModule } from './audit/audit.module';
import { RateLimitModule } from './common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => configSchema()],
    }),
    DatabaseModule,
    AuthModule,
    ProjectsModule,
    RecordsModule,
    SyncModule,
    HealthModule,
    MetricsModule,
    AuditModule,
    RateLimitModule,
  ],
  controllers: [AppController],
  providers: [AppService, LoggerService],
  exports: [LoggerService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggingMiddleware).forRoutes('*');
  }
}
