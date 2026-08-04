import { z } from 'zod';

const databaseFields = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().positive().optional(),
  DB_USER: z.string().min(1).optional(),
  DB_PASS: z.string().min(1).optional(),
  DB_NAME: z.string().min(1).optional(),
});

const redisFields = z.object({
  REDIS_URL: z.string().min(1).optional(),
  REDIS_HOST: z.string().min(1).optional(),
  REDIS_PORT: z.coerce.number().positive().optional(),
  REDIS_PASS: z.string().optional(),
});

type EnvLike = z.infer<typeof databaseFields> &
  z.infer<typeof redisFields> & {
    JWT_SECRET?: string;
    PORT?: number;
    NODE_ENV?: 'development' | 'production' | 'test';
    CORS_ORIGINS?: string;
    RATE_LIMIT_ENABLED?: 'true' | 'false';
    RATE_LIMIT_LIMIT?: number;
    RATE_LIMIT_TTL?: number;
    BODY_SIZE_LIMIT?: number;
    JWT_REFRESH_TTL?: number;
  };

const envSchema = databaseFields
  .extend(redisFields.shape)
  .extend({
    JWT_SECRET: z.string().min(1),
    PORT: z.coerce.number().positive().optional().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
    // Comma-separated list of allowed browser origins for CORS. Absent/empty
    // means allow all origins (convenient for development).
    CORS_ORIGINS: z.string().optional(),
    // Production hardening: global HTTP rate limiting.
    RATE_LIMIT_ENABLED: z.enum(['true', 'false']).optional().default('true'),
    RATE_LIMIT_LIMIT: z.coerce.number().positive().optional().default(100),
    RATE_LIMIT_TTL: z.coerce.number().positive().optional().default(60),
    // Maximum request body size (bytes) accepted by the JSON body parser.
    BODY_SIZE_LIMIT: z.coerce.number().positive().optional().default(1048576),
    // Lifetime for issued refresh tokens, in seconds (default 30 days).
    JWT_REFRESH_TTL: z.coerce.number().positive().optional().default(2592000),
  })
  .superRefine((env, ctx) => {
    validateDatabase(env, ctx);
    validateRedis(env, ctx);
  });

function validateDatabase(env: EnvLike, ctx: z.RefinementCtx) {
  const hasUrl = !!env.DATABASE_URL;
  const hasAllComponents = [env.DB_HOST, env.DB_PORT, env.DB_USER, env.DB_PASS, env.DB_NAME].every(
    v => v !== undefined
  );

  if (!hasUrl && !hasAllComponents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message:
        'Missing database connection: set DATABASE_URL or all of DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME',
    });
  }
}

function validateRedis(env: EnvLike, ctx: z.RefinementCtx) {
  const hasUrl = !!env.REDIS_URL;
  const hasHost = !!env.REDIS_HOST;
  const hasPort = env.REDIS_PORT !== undefined;

  if (!hasUrl && !(hasHost && hasPort)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['REDIS_URL'],
      message: 'Missing redis connection: set REDIS_URL or both REDIS_HOST and REDIS_PORT',
    });
  }
}

export type EnvConfig = z.infer<typeof envSchema>;

export const configSchema = () => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.errors.map(e => e.path.join('.')).join(', ');

    throw new Error(`Missing required environment variables: ${missing}`);
  }

  return parsed.data;
};
