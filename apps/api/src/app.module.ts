import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { configSchema } from '@syncra/config';
import { DatabaseService, MigrationService } from './database';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RecordsModule } from './records/records.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './health/health.module';
import { LoggerService, HttpLoggingMiddleware } from './logger';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => configSchema()],
    }),
    AuthModule,
    ProjectsModule,
    RecordsModule,
    SyncModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseService, MigrationService, LoggerService],
  exports: [DatabaseService, LoggerService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggingMiddleware).forRoutes('*');
  }
}
