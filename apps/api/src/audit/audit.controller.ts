import { Controller, Get, HttpCode, HttpStatus, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DualAuthGuard } from '../projects/dual-auth.guard';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(DualAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /api/audit/record/:id
   * Full event log for a specific record (scoped to the authenticated user).
   */
  @Get('record/:id')
  @HttpCode(HttpStatus.OK)
  async getRecordAudit(@Param('id') id: string, @Req() req: Request & { user: { id: string } }) {
    return this.auditService.getRecordAudit(req.user.id, id);
  }

  /**
   * GET /api/audit/client/:id
   * Sync state for a specific client device (scoped to the authenticated user).
   */
  @Get('client/:id')
  @HttpCode(HttpStatus.OK)
  async getClientAudit(@Param('id') id: string, @Req() req: Request & { user: { id: string } }) {
    return this.auditService.getClientAudit(req.user.id, id);
  }
}
