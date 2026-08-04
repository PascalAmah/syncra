import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {
    this.pool = new Pool(this.buildPoolConfig());
  }

  private buildPoolConfig() {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    const baseConfig = {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    // Prefer a single connection string when provided, falling back to the
    // individual DB_* component variables (e.g. for local Docker compose).
    if (databaseUrl) {
      return { ...baseConfig, connectionString: databaseUrl };
    }

    return {
      ...baseConfig,
      host: this.configService.get<string>('DB_HOST'),
      port: this.configService.get<number>('DB_PORT'),
      user: this.configService.get<string>('DB_USER'),
      password: this.configService.get<string>('DB_PASS'),
      database: this.configService.get<string>('DB_NAME'),
    };
  }

  async onModuleInit(): Promise<void> {
    const health = await this.checkHealth();
    if (health.connected) {
      this.logger.log('Database connection pool initialized successfully');
    } else {
      this.logger.error(`Database health check failed: ${health.error}`);
      throw new Error(`Database connection failed: ${health.error}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('Database connection pool closed');
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async checkHealth(): Promise<{ connected: boolean; error?: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { connected: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { connected: false, error };
    }
  }
}
