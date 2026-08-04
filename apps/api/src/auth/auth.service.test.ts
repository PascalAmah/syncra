import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';

function makeDb() {
  return {
    query: vi.fn(),
    getClient: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
  } as any;
}

function makeJwt() {
  return {
    sign: vi.fn().mockReturnValue('signed.jwt'),
    verify: vi.fn(),
  } as any;
}

function makeConfig() {
  return {
    get: vi.fn().mockImplementation((k: string) => (k === 'JWT_REFRESH_TTL' ? 3600 : undefined)),
  } as any;
}

describe('AuthService', () => {
  let db: ReturnType<typeof makeDb>;
  let jwt: ReturnType<typeof makeJwt>;
  let config: ReturnType<typeof makeConfig>;
  let service: AuthService;

  beforeEach(() => {
    db = makeDb();
    jwt = makeJwt();
    config = makeConfig();
    service = new AuthService(db, jwt, config);
  });

  describe('refresh', () => {
    it('issues a new access token and rotates the refresh token', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tok-1',
            user_id: 'user-1',
            expires_at: new Date(Date.now() + 100000).toISOString(),
          },
        ],
      });
      // UPDATE revoking old token, then INSERT of new refresh token.
      db.query.mockResolvedValueOnce({ rowCount: 1 });
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.refresh('some-refresh-token');

      expect(result.token).toBe('signed.jwt');
      expect(result.expiresIn).toBe(86400);
      expect(result.refreshToken).toBeTruthy();
      // Old token revoked and a new token_hash persisted.
      const updateCall = db.query.mock.calls.find(([sql]: [string]) =>
        sql.includes('UPDATE refresh_tokens')
      );
      expect(updateCall).toBeTruthy();
      const insertCall = db.query.mock.calls.find(([sql]: [string]) =>
        sql.includes('INSERT INTO refresh_tokens')
      );
      expect(insertCall).toBeTruthy();
    });

    it('rejects an unknown refresh token', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an already-used (revoked) refresh token', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // revoked => no active row
      await expect(service.refresh('reused-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired refresh token', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tok-1',
            user_id: 'user-1',
            expires_at: new Date(Date.now() - 100000).toISOString(),
          },
        ],
      });
      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('register', () => {
    it('returns a token and refresh token on success', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'a@b.com' }] });
      const result = await service.register({ email: 'a@b.com', password: 'password123' });
      expect(result.id).toBe('user-1');
      expect(result.token).toBe('signed.jwt');
      expect(result.refreshToken).toBeTruthy();
    });

    it('throws ConflictException on duplicate email', async () => {
      db.query.mockRejectedValueOnce({ code: '23505' });
      await expect(service.register({ email: 'a@b.com', password: 'password123' })).rejects.toThrow(
        ConflictException
      );
    });
  });
});
