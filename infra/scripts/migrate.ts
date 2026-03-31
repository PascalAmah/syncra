#!/usr/bin/env node
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function runMigrations() {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const dbUser = process.env.DB_USER || 'syncra';
  const dbPass = process.env.DB_PASS || 'syncra123';
  const dbName = process.env.DB_NAME || 'syncra';

  const pool = new Pool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: dbName,
  });

  console.log('Running database migrations...');

  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get list of migration files
    const migrationsDir = path.join(process.cwd(), 'apps', 'api', 'migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file: string) => file.endsWith('.sql'))
      .sort();

    // Get already applied migrations
    const result = await pool.query('SELECT name FROM migrations ORDER BY id');
    const appliedMigrations = result.rows.map((row: { name: string }) => row.name);

    // Run pending migrations
    for (const file of migrationFiles) {
      if (!appliedMigrations.includes(file)) {
        console.log(`Running migration: ${file}`);

        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO migrations (name) VALUES ($1)', [
            file,
          ]);
          await client.query('COMMIT');
          console.log(`✓ Migration ${file} completed`);
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`✗ Migration ${file} failed:`, error);
          throw error;
        } finally {
          client.release();
        }
      } else {
        console.log(`⊘ Migration ${file} already applied`);
      }
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
