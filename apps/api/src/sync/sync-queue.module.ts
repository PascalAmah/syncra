import { forwardRef, Module } from '@nestjs/common';
import { SyncQueueService } from './sync-queue.service';
import { SyncModule } from './sync.module';

@Module({
  imports: [forwardRef(() => SyncModule)],
  providers: [SyncQueueService],
  exports: [SyncQueueService],
})
export class SyncQueueModule {}
