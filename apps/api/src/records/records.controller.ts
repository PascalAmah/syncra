import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { DualAuthGuard } from '../projects/dual-auth.guard';
import { CreateRecordDto } from './dto/create-record.dto';
import { RecordsService } from './records.service';

@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(DualAuthGuard)
  async create(
    @Body() dto: CreateRecordDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.recordsService.create(req.user.id, dto.data);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(DualAuthGuard)
  async findAll(@Req() req: Request & { user: { id: string } }) {
    const records = await this.recordsService.findAllByUser(req.user.id);
    return { records };
  }
}
