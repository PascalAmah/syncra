import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ProjectsService } from './projects.service';

export interface ApiKeyRequest extends Request {
  projectId?: string;
  user?: { id: string };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly projectsService: ProjectsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const result = await this.projectsService.validateApiKey(apiKey);
    if (!result) {
      throw new UnauthorizedException('Invalid API key');
    }

    request.projectId = result.projectId;

    // Attach a synthetic user id from x-user-id header (optional)
    const userId = (request.headers['x-user-id'] as string | undefined) ?? 'default';
    request.user = { id: userId };

    return true;
  }
}
