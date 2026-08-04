import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncQueueModule } from './sync-queue.module';

@Module({
  imports: [AuthModule, ProjectsModule, forwardRef(() => SyncQueueModule)],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
