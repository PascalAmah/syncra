import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ApiKeyGuard } from './api-key.guard';

/**
 * Tries API key auth first (x-api-key header).
 * Falls back to JWT Bearer auth if no API key is present.
 */
@Injectable()
export class DualAuthGuard implements CanActivate {
  constructor(
    private readonly authGuard: AuthGuard,
    private readonly apiKeyGuard: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const hasApiKey = !!request.headers['x-api-key'];

    if (hasApiKey) {
      return this.apiKeyGuard.canActivate(context);
    }
    return this.authGuard.canActivate(context);
  }
}
