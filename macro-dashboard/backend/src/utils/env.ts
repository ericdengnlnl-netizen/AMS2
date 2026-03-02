import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  FRED_API_KEY: z.string().min(1),
  SYNC_CRON: z.string().default('5 9 * * *'),
  SYNC_TZ: z.string().default('Asia/Shanghai'),
  CORS_ORIGIN: z.string().default('http://localhost:5173')
});

export function readEnv() {
  return envSchema.parse(process.env);
}
