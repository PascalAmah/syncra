import { z } from 'zod';

// Database connection accepts either a single DATABASE_URL string
// (e.g. postgresql://user:pass@host:5432/db) or the individual DB_*
// component variables as a fallback. Exactly one of the two is required.
const databaseFields = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().positive().optional(),
  DB_USER: z.string().min(1).optional(),
  DB_PASS: z.string().min(1).optional(),
  DB_NAME: z.string().min(1).optional(),
});

const envSchema = databaseFields
  .extend({
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(1),
    PORT: z
      .coerce.number()
      .positive()
      .optional()
      .default(3000),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .optional()
      .default('development'),
  })
  .superRefine((env, ctx) => {
    const hasUrl = !!env.DATABASE_URL;
    const hasAllComponents = [
      env.DB_HOST,
      env.DB_PORT,
      env.DB_USER,
      env.DB_PASS,
      env.DB_NAME,
    ].every((v) => v !== undefined);

    if (!hasUrl && !hasAllComponents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message:
          'Missing database connection: set DATABASE_URL or all of DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME',
      });
    }
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
