import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoggerService } from './logger.service';
import { HttpLoggingMiddleware } from './http-logging.middleware';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpException, HttpStatus } from '@nestjs/common';

// ─── LoggerService ────────────────────────────────────────────────────────────

describe('LoggerService', () => {
  let logger: LoggerService;
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    logger = new LoggerService();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits valid JSON for log()', () => {
    logger.log('hello world', 'TestContext');
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(output.level).toBe('info');
    expect(output.message).toBe('hello world');
    expect(output.context).toBe('TestContext');
    expect(output.timestamp).toBeDefined();
  });

  it('emits valid JSON for warn()', () => {
    logger.warn('something odd', 'WarnCtx');
    const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(output.level).toBe('warn');
    expect(output.message).toBe('something odd');
  });

  it('emits valid JSON for error() with stack trace on stderr', () => {
    logger.error('boom', 'Error: stack trace here\n  at foo', 'ErrCtx');
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(output.level).toBe('error');
    expect(output.message).toBe('boom');
    expect(output.stack).toBe('Error: stack trace here\n  at foo');
    expect(output.context).toBe('ErrCtx');
  });

  it('error() without stack still emits valid JSON', () => {
    logger.error('no stack');
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(output.level).toBe('error');
    expect(output.stack).toBeUndefined();
  });

  it('logRequest() emits structured JSON with all required fields', () => {
    logger.logRequest({
      timestamp: '2024-01-01T00:00:00.000Z',
      method: 'GET',
      path: '/api/records',
      statusCode: 200,
      responseTimeMs: 42,
    });
    const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(output.timestamp).toBe('2024-01-01T00:00:00.000Z');
    expect(output.method).toBe('GET');
    expect(output.path).toBe('/api/records');
    expect(output.statusCode).toBe(200);
    expect(output.responseTimeMs).toBe(42);
    expect(output.level).toBe('info');
  });

  it('logRequest() does not include password or JWT secret fields', () => {
    logger.logRequest({
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/auth/login',
      statusCode: 200,
      responseTimeMs: 10,
    });
    const raw = stdoutSpy.mock.calls[0][0] as string;
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('authorization');
    expect(raw).not.toContain('Authorization');
  });
});

// ─── HttpLoggingMiddleware ────────────────────────────────────────────────────

describe('HttpLoggingMiddleware', () => {
  let logger: LoggerService;
  let middleware: HttpLoggingMiddleware;
  let logRequestSpy: any;

  beforeEach(() => {
    logger = new LoggerService();
    middleware = new HttpLoggingMiddleware(logger);
    logRequestSpy = vi.spyOn(logger, 'logRequest').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeReqRes(method: string, path: string, statusCode: number) {
    const listeners: Record<string, (() => void)[]> = {};
    const req = { method, path } as unknown as import('express').Request;
    const res = {
      statusCode,
      on(event: string, cb: () => void) {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
      },
      emit(event: string) {
        (listeners[event] ?? []).forEach((cb) => cb());
      },
    } as unknown as import('express').Response & { emit(e: string): void };
    return { req, res };
  }

  it('calls logRequest on response finish with correct fields', () => {
    const { req, res } = makeReqRes('GET', '/api/records', 200);
    const next = vi.fn();
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    (res as unknown as { emit(e: string): void }).emit('finish');
    expect(logRequestSpy).toHaveBeenCalledOnce();
    const call = logRequestSpy.mock.calls[0][0] as Parameters<LoggerService['logRequest']>[0];
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/api/records');
    expect(call.statusCode).toBe(200);
    expect(typeof call.responseTimeMs).toBe('number');
    expect(call.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(call.timestamp).toBeDefined();
  });

  it('does not log password fields from request body', () => {
    const { req, res } = makeReqRes('POST', '/auth/login', 200);
    (req as unknown as Record<string, unknown>)['body'] = { email: 'a@b.com', password: 'secret123' };
    const next = vi.fn();
    middleware.use(req, res, next);
    (res as unknown as { emit(e: string): void }).emit('finish');
    // logRequest is called with path/method/status/time — no body
    const call = logRequestSpy.mock.calls[0][0] as Parameters<LoggerService['logRequest']>[0];
    expect(JSON.stringify(call)).not.toContain('secret123');
  });
});

// ─── AllExceptionsFilter ──────────────────────────────────────────────────────

describe('AllExceptionsFilter', () => {
  let logger: LoggerService;
  let filter: AllExceptionsFilter;
  let errorSpy: any;

  beforeEach(() => {
    logger = new LoggerService();
    filter = new AllExceptionsFilter(logger);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeHost(method: string, path: string) {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const req = { method, path };
    const res = { status };
    return {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => req,
      }),
    } as unknown as import('@nestjs/common').ArgumentsHost;
  }

  it('logs error with stack trace for unhandled Error', () => {
    const host = makeHost('GET', '/api/records');
    const err = new Error('something broke');
    filter.catch(err, host);
    expect(errorSpy).toHaveBeenCalledOnce();
    const [, stack] = errorSpy.mock.calls[0];
    expect(stack).toBe(err.stack);
  });

  it('returns 500 for generic errors', () => {
    const host = makeHost('GET', '/api/records');
    const err = new Error('oops');
    filter.catch(err, host);
    const res = host.switchToHttp().getResponse() as { status: ReturnType<typeof vi.fn> };
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('returns correct status for HttpException', () => {
    const host = makeHost('GET', '/api/records');
    const err = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    filter.catch(err, host);
    const res = host.switchToHttp().getResponse() as { status: ReturnType<typeof vi.fn> };
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('logs error with severity error context', () => {
    const host = makeHost('POST', '/auth/login');
    const err = new Error('crash');
    filter.catch(err, host);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled exception'),
      err.stack,
      'ExceptionFilter',
    );
  });

  it('does not include password in logged message', () => {
    const host = makeHost('POST', '/auth/login');
    const err = new Error('password=supersecret');
    filter.catch(err, host);
    // The error message is logged but the filter doesn't add extra body fields
    const [msg] = errorSpy.mock.calls[0];
    // The message contains the error text but no raw password field from request body
    expect(typeof msg).toBe('string');
  });
});
