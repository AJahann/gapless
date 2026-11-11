import { z } from 'zod';

/**
 * The only module allowed to read process.env (see oxlint.config.ts).
 * Everything else receives typed config through buildApp(options).
 */
const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

export function booleanString(defaultValue: boolean) {
  return z
    .preprocess((val) => {
      if (val === undefined || val === '') return defaultValue;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'number') {
        if (val === 1) return true;
        if (val === 0) return false;
        return val;
      }
      if (typeof val === 'string') {
        const lower = val.trim().toLowerCase();
        if (lower === 'true' || lower === '1') return true;
        if (lower === 'false' || lower === '0') return false;
      }
      return val;
    }, z.boolean())
    .default(defaultValue);
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  CLIENT_ORIGIN: csv.default(['http://localhost:3000']),
  REPLAY_WINDOW_SEC: z.coerce.number().int().positive().default(30),
  REPLAY_MAX_ENTRIES: z.coerce.number().int().positive().default(100000),
  HEARTBEAT_MS: z.coerce.number().int().positive().default(1000),
  CHAOS_ENABLED: booleanString(true),
  FEED_IDLE_TTL_SEC: z.coerce.number().int().positive().default(300),
  TEST_CONTROL: booleanString(false),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
