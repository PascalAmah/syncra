import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from './logger.service';

@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    res.on('finish', () => {
      const responseTimeMs = Date.now() - startTime;
      this.logger.logRequest({
        timestamp,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTimeMs,
      });
    });

    next();
  }
}
