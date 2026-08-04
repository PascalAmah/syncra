import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ApiKeyGuard } from './api-key.guard';
import { DualAuthGuard } from './dual-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ApiKeyGuard, DualAuthGuard],
  exports: [ProjectsService, ApiKeyGuard, DualAuthGuard],
})
export class ProjectsModule {}
