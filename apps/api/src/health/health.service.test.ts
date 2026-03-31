import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';
import { DatabaseService } from '../database';
import { SyncQueueService } from '../sync/sync-queue.service';

function makeDatabaseService(connected: boolean): Partial<DatabaseService> {
  return {
    checkHealth: vi.fn().mockResolvedValue({ connected }),
  };
}

function makeSyncQueueService(pingResult: string | null, status = 'ready'): Partial<SyncQueueService> {
  const connection =
    pingResult !== null
      ? { ping: vi.fn().mockResolvedValue(pingResult), status }
      : null;
  return { connection } as unknown as Partial<SyncQueueService>;
}

describe('HealthService', () => {
  let service: HealthService;

  describe('when all dependencies are healthy', () => {
    beforeEach(() => {
      service = new HealthService(
        makeDatabaseService(true) as DatabaseService,
        makeSyncQueueService('PONG') as SyncQueueService,
      );
    });

    it('returns status healthy with connected database and redis', async () => {
      const result = await service.check();
      expect(result.status).toBe('healthy');
      expect(result.database).toBe('connected');
      expect(result.redis).toBe('connected');
      expect(result.timestamp).toBeDefined();
    });

    it('returns a valid ISO timestamp', async () => {
      const result = await service.check();
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe('when database is down', () => {
    beforeEach(() => {
      service = new HealthService(
        makeDatabaseService(false) as DatabaseService,
        makeSyncQueueService('PONG') as SyncQueueService,
      );
    });

    it('throws 503 with database disconnected', async () => {
      await expect(service.check()).rejects.toThrow(HttpException);
      try {
        await service.check();
      } catch (err) {
        const e = err as HttpException;
        expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const body = e.getResponse() as { status: string; database: string; redis: string };
        expect(body.status).toBe('unhealthy');
        expect(body.database).toBe('disconnected');
        expect(body.redis).toBe('connected');
      }
    });
  });

  describe('when redis is down', () => {
    beforeEach(() => {
      service = new HealthService(
        makeDatabaseService(true) as DatabaseService,
        makeSyncQueueService(null) as SyncQueueService,
      );
    });

    it('throws 503 with redis disconnected', async () => {
      await expect(service.check()).rejects.toThrow(HttpException);
      try {
        await service.check();
      } catch (err) {
        const e = err as HttpException;
        expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const body = e.getResponse() as { status: string; database: string; redis: string };
        expect(body.status).toBe('unhealthy');
        expect(body.database).toBe('connected');
        expect(body.redis).toBe('disconnected');
      }
    });
  });

  describe('when redis connection is not ready', () => {
    beforeEach(() => {
      service = new HealthService(
        makeDatabaseService(true) as DatabaseService,
        makeSyncQueueService('PONG', 'connecting') as SyncQueueService,
      );
    });

    it('throws 503 with redis disconnected when status is not ready', async () => {
      await expect(service.check()).rejects.toThrow(HttpException);
    });
  });

  describe('when both dependencies are down', () => {
    beforeEach(() => {
      service = new HealthService(
        makeDatabaseService(false) as DatabaseService,
        makeSyncQueueService(null) as SyncQueueService,
      );
    });

    it('throws 503 with both disconnected', async () => {
      await expect(service.check()).rejects.toThrow(HttpException);
      try {
        await service.check();
      } catch (err) {
        const e = err as HttpException;
        const body = e.getResponse() as { status: string; database: string; redis: string };
        expect(body.status).toBe('unhealthy');
        expect(body.database).toBe('disconnected');
        expect(body.redis).toBe('disconnected');
      }
    });
  });
});
