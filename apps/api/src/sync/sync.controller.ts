import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DualAuthGuard } from '../projects/dual-auth.guard';
import { SyncRequestDto, SyncUpdatesQueryDto } from './dto/sync.dto';
import { SyncService } from './sync.service';
import { SyncQueueService } from './sync-queue.service';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly syncQueueService: SyncQueueService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(DualAuthGuard)
  async push(
    @Body() dto: SyncRequestDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    const jobId = await this.syncQueueService.enqueue({
      userId: req.user.id,
      operations: dto.operations,
      timestamp: Date.now(),
    });

    return { jobId, status: 'queued' };
  }

  @Get('job/:jobId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DualAuthGuard)
  async getJobStatus(@Param('jobId') jobId: string) {
    const result = await this.syncQueueService.getJobStatus(jobId);

    if (result.status === 'unknown') {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    return result;
  }

  @Get('updates')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DualAuthGuard)
  async pull(
    @Query() query: Record<string, string>,
    @Req() req: Request & { user: { id: string } },
  ) {
    const queryDto = plainToInstance(SyncUpdatesQueryDto, {
      cursor: query.cursor !== undefined ? Number(query.cursor) : undefined,
      limit: query.limit !== undefined ? Number(query.limit) : undefined,
      collection: query.collection,
    });
    const errors = await validate(queryDto);
    if (errors.length > 0) {
      throw new BadRequestException(
        'cursor must be a non-negative integer',
      );
    }
    const clientId = req.headers['x-client-id'] as string | undefined;
    return this.syncService.getSyncUpdates(
      req.user.id,
      queryDto.cursor,
      queryDto.limit ?? 1000,
      clientId,
      query.collection,
    );
  }
}
