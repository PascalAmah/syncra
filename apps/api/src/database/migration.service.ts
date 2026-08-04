import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database.service';
import * as fs from 'fs';
import * as path from 'path';

export const MIGRATIONS_DIR = 'migrations';

@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async onModuleInit() {
    await this.runMigrations();
  }

  /**
   * Applies pending migrations. Reuses DatabaseService's connection pool so
   * there is a single Postgres pool owned by the app and no config drift
   * between the migration path and the runtime data layer.
   */
  async runMigrations() {
    this.logger.log('Running database migrations...');

    try {
      await this.createMigrationsTable();

      const migrationsDir = path.join(process.cwd(), MIGRATIONS_DIR);
      const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();

      const appliedMigrations = await this.getAppliedMigrations();

      for (const file of migrationFiles) {
        if (!appliedMigrations.includes(file)) {
          await this.runMigration(file, migrationsDir);
        }
      }

      this.logger.log('All migrations completed successfully');
    } catch (error) {
      this.logger.error('Database migration failed:', error);
      throw error;
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
    await this.databaseService.query(query);
  }

  private async getAppliedMigrations(): Promise<string[]> {
    const result = await this.databaseService.query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY id'
    );
    return result.rows.map((row: { name: string }) => row.name);
  }

  private async runMigration(file: string, migrationsDir: string) {
    this.logger.log(`Running migration: ${file}`);

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    // Aquire a dedicated connection from the shared pool so the whole
    // migration runs atomically inside a single transaction.
    const client = await this.databaseService.getClient();
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
