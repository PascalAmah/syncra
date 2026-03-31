import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

const mockVerify = vi.fn();
const mockGet = vi.fn().mockReturnValue('test-secret');

const jwtService = { verify: mockVerify } as any;
const configService = { get: mockGet } as any;

function makeContext(authHeader?: string) {
  const request: any = { headers: {} };
  if (authHeader !== undefined) {
    request.headers['authorization'] = authHeader;
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    request,
  } as any;
}

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new AuthGuard(jwtService, configService);
  });

  it('throws 401 when Authorization header is missing', () => {
    const ctx = makeContext();
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when Authorization header does not start with Bearer', () => {
    const ctx = makeContext('Basic sometoken');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when JWT verification fails', () => {
    mockVerify.mockImplementation(() => { throw new Error('invalid'); });
    const ctx = makeContext('Bearer bad.token.here');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('attaches user id to request and returns true for valid token', () => {
    const userId = 'user-123';
    mockVerify.mockReturnValue({ sub: userId });
    const ctx = makeContext('Bearer valid.token.here');
    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toEqual({ id: userId });
  });

  it('uses JWT_SECRET from config when verifying', () => {
    mockVerify.mockReturnValue({ sub: 'user-abc' });
    const ctx = makeContext('Bearer some.token');
    guard.canActivate(ctx);
    expect(mockGet).toHaveBeenCalledWith('JWT_SECRET');
    expect(mockVerify).toHaveBeenCalledWith('some.token', { secret: 'test-secret' });
  });
});
