import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
