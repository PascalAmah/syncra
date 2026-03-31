import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.runMigrations();
  }

  async runMigrations() {
    const dbHost = this.configService.get<string>('DB_HOST');
    const dbPort = this.configService.get<number>('DB_PORT');
    const dbUser = this.configService.get<string>('DB_USER');
    const dbPass = this.configService.get<string>('DB_PASS');
    const dbName = this.configService.get<string>('DB_NAME');

    this.pool = new Pool({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPass,
      database: dbName,
    });

    this.logger.log('Running database migrations...');

    try {
      // Create migrations tracking table
      await this.createMigrationsTable();

      // Get list of migration files
      const migrationsDir = path.join(process.cwd(), 'migrations');
      const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

      // Get already applied migrations
      const appliedMigrations = await this.getAppliedMigrations();

      // Run pending migrations
      for (const file of migrationFiles) {
        if (!appliedMigrations.includes(file)) {
          await this.runMigration(file, migrationsDir);
        }
      }

      this.logger.log('All migrations completed successfully');
    } catch (error) {
      this.logger.error('Database migration failed:', error);
      throw error;
    } finally {
      await this.pool.end();
    }
  }

  private async createMigrationsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await this.pool.query(query);
  }

  private async getAppliedMigrations(): Promise<string[]> {
    const result = await this.pool.query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY id'
    );
    return result.rows.map((row: { name: string }) => row.name);
  }

  private async runMigration(file: string, migrationsDir: string) {
    this.logger.log(`Running migration: ${file}`);

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      this.logger.log(`Migration ${file} completed`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Migration ${file} failed:`, error);
      throw error;
    } finally {
      client.release();
    }
  }
}
