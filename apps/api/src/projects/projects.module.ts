import { Module } from '@nestjs/common';
import { DatabaseService } from '../database';
import { AuthModule } from '../auth/auth.module';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ApiKeyGuard } from './api-key.guard';
import { DualAuthGuard } from './dual-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, DatabaseService, ApiKeyGuard, DualAuthGuard],
  exports: [ProjectsService, ApiKeyGuard, DualAuthGuard],
})
export class ProjectsModule {}
