import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  async create(
    @Body() body: { name: string },
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.projectsService.createProject(req.user.id, body.name);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async findAll(@Req() req: Request & { user: { id: string } }) {
    return this.projectsService.getUserProjects(req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async remove(
    @Param('id') id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    await this.projectsService.deleteProject(req.user.id, id);
  }
}
