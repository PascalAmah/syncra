import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';

export type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

export interface LogEntry {
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  [key: string]: unknown;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private formatEntry(level: string, message: unknown, context?: string, extra?: Record<string, unknown>): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      message: String(message),
      ...extra,
    };
    return JSON.stringify(entry);
  }

  log(message: unknown, context?: string): void {
    process.stdout.write(this.formatEntry('info', message, context) + '\n');
  }

  error(message: unknown, trace?: string, context?: string): void {
    const extra: Record<string, unknown> = {};
    if (trace) extra['stack'] = trace;
    process.stderr.write(this.formatEntry('error', message, context, extra) + '\n');
  }

  warn(message: unknown, context?: string): void {
    process.stdout.write(this.formatEntry('warn', message, context) + '\n');
  }

  debug(message: unknown, context?: string): void {
    process.stdout.write(this.formatEntry('debug', message, context) + '\n');
  }

  verbose(message: unknown, context?: string): void {
    process.stdout.write(this.formatEntry('verbose', message, context) + '\n');
  }

  logRequest(data: {
    timestamp: string;
    method: string;
    path: string;
    statusCode: number;
    responseTimeMs: number;
  }): void {
    const entry: LogEntry = {
      timestamp: data.timestamp,
      level: 'info',
      context: 'HTTP',
      message: `${data.method} ${data.path} ${data.statusCode} ${data.responseTimeMs}ms`,
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
      responseTimeMs: data.responseTimeMs,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}
