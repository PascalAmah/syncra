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

    // The owning user is resolved server-side from the API key. The user id
    // is NOT taken from any client-supplied header (e.g. x-user-id): trusting
    // a caller-provided identity would let any API-key holder impersonate an
    // arbitrary user and access another user's data (security fix).
    request.user = { id: result.userId };

    return true;
  }
}
