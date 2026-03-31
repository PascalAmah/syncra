import { z } from 'zod';

const envSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().positive(),
  DB_USER: z.string().min(1),
  DB_PASS: z.string().min(1),
  DB_NAME: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().positive().optional().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const configSchema = () => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.errors
      .map((e) => e.path.join('.'))
      .join(', ');

    throw new Error(`Missing required environment variables: ${missing}`);
  }

  return parsed.data;
};
