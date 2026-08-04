import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configSchema } from './config';

const BASE_ENV = {
  JWT_SECRET: 'test-secret',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/syncra',
  REDIS_URL: 'redis://localhost:6379',
};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearEnv() {
  const keys = [
    'JWT_SECRET',
    'DATABASE_URL',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASS',
    'DB_NAME',
    'REDIS_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASS',
    'PORT',
    'NODE_ENV',
    'CORS_ORIGINS',
    'RATE_LIMIT_ENABLED',
    'RATE_LIMIT_LIMIT',
    'RATE_LIMIT_TTL',
    'BODY_SIZE_LIMIT',
    'JWT_REFRESH_TTL',
  ];
  for (const key of keys) {
    delete process.env[key];
  }
}

beforeEach(() => clearEnv());
afterEach(() => clearEnv());

describe('configSchema', () => {
  it('accepts a single DATABASE_URL plus REDIS_URL', () => {
    setEnv(BASE_ENV);
    const config = configSchema();
    expect(config.DATABASE_URL).toBe(BASE_ENV.DATABASE_URL);
    expect(config.REDIS_URL).toBe(BASE_ENV.REDIS_URL);
    expect(config.JWT_SECRET).toBe('test-secret');
  });

  it('accepts DB_* components plus REDIS_HOST and REDIS_PORT', () => {
    setEnv({
      ...BASE_ENV,
      DATABASE_URL: undefined,
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'syncra',
      DB_PASS: 'syncra123',
      DB_NAME: 'syncra',
      REDIS_URL: undefined,
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
    });
    const config = configSchema();
    expect(config.DB_HOST).toBe('localhost');
    expect(config.DB_PORT).toBe(5432);
    expect(config.REDIS_HOST).toBe('localhost');
    expect(config.REDIS_PORT).toBe(6379);
    expect(config.REDIS_URL).toBeUndefined();
  });

  it('throws when no database connection is configured', () => {
    setEnv({ ...BASE_ENV, DATABASE_URL: undefined });
    expect(() => configSchema()).toThrow(/DATABASE_URL/);
  });

  it('throws when no redis connection is configured', () => {
    setEnv({ ...BASE_ENV, REDIS_URL: undefined, REDIS_HOST: undefined, REDIS_PORT: undefined });
    expect(() => configSchema()).toThrow(/REDIS_URL/);
  });

  it('throws when JWT_SECRET is missing', () => {
    setEnv({ ...BASE_ENV, JWT_SECRET: undefined });
    expect(() => configSchema()).toThrow(/JWT_SECRET/);
  });

  it('applies default PORT and NODE_ENV', () => {
    setEnv({ ...BASE_ENV, PORT: undefined, NODE_ENV: undefined });
    const config = configSchema();
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('accepts REDIS_URL while also allowing explicit Redis components', () => {
    setEnv({
      ...BASE_ENV,
      REDIS_URL: 'redis://localhost:6379',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
    });
    const config = configSchema();
    // REDIS_URL is honored when present alongside components.
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('accepts a database URL with explicit DB_* components too', () => {
    setEnv({
      ...BASE_ENV,
      DATABASE_URL: 'postgresql://localhost/syncra',
      DB_HOST: 'otherhost',
      DB_USER: 'syncra',
      DB_PASS: 'x',
      DB_NAME: 'syncra',
      DB_PORT: '5432',
    });
    const config = configSchema();
    expect(config.DATABASE_URL).toBe('postgresql://localhost/syncra');
  });

  it('applies production-hardening defaults', () => {
    setEnv({ ...BASE_ENV, NODE_ENV: 'production' });
    const config = configSchema();
    expect(config.RATE_LIMIT_ENABLED).toBe('true');
    expect(config.RATE_LIMIT_LIMIT).toBe(100);
    expect(config.RATE_LIMIT_TTL).toBe(60);
    expect(config.BODY_SIZE_LIMIT).toBe(1048576);
    expect(config.JWT_REFRESH_TTL).toBe(2592000);
  });

  it('honors explicit production-hardening overrides', () => {
    setEnv({
      ...BASE_ENV,
      RATE_LIMIT_ENABLED: 'false',
      RATE_LIMIT_LIMIT: '50',
      RATE_LIMIT_TTL: '10',
      BODY_SIZE_LIMIT: '524288',
      JWT_REFRESH_TTL: '3600',
    });
    const config = configSchema();
    expect(config.RATE_LIMIT_ENABLED).toBe('false');
    expect(config.RATE_LIMIT_LIMIT).toBe(50);
    expect(config.RATE_LIMIT_TTL).toBe(10);
    expect(config.BODY_SIZE_LIMIT).toBe(524288);
    expect(config.JWT_REFRESH_TTL).toBe(3600);
  });
});
