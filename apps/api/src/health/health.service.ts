import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../database';
import { SyncQueueService } from '../sync/sync-queue.service';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly syncQueueService: SyncQueueService,
  ) {}

  async check(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();

    const [dbHealth, redisHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const allHealthy = dbHealth && redisHealth;

    const result: HealthStatus = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      database: dbHealth ? 'connected' : 'disconnected',
      redis: redisHealth ? 'connected' : 'disconnected',
      timestamp,
    };

    if (!allHealthy) {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }

  private async checkDatabase(): Promise<boolean> {
    const health = await this.databaseService.checkHealth();
    return health.connected;
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const connection = this.syncQueueService['connection'] as {
        ping: () => Promise<string>;
        status: string;
      } | null;
      if (!connection || connection.status !== 'ready') {
        return false;
      }
      const result = await connection.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
