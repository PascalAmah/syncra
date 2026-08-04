import { Controller, Get, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DualAuthGuard } from '../projects/dual-auth.guard';
import { MetricsService } from './metrics.service';

@Controller('metrics')
@UseGuards(DualAuthGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * GET /api/metrics/sync
   * Operation counts, success/failure rates and throughput for the user's syncs.
   */
  @Get('sync')
  @HttpCode(HttpStatus.OK)
  async getSyncMetrics(@Req() req: Request & { user: { id: string } }) {
    return this.metricsService.getSyncMetrics(req.user.id);
  }

  /**
   * GET /api/metrics/conflicts
   * Counts of rejected (version-conflict) operations, broken down by type.
   */
  @Get('conflicts')
  @HttpCode(HttpStatus.OK)
  async getConflictMetrics(@Req() req: Request & { user: { id: string } }) {
    return this.metricsService.getConflictMetrics(req.user.id);
  }
}
