import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseService } from '../database';
import { SyncQueueModule } from '../sync/sync-queue.module';

@Module({
  imports: [SyncQueueModule],
  controllers: [HealthController],
  providers: [HealthService, DatabaseService],
})
export class HealthModule {}
