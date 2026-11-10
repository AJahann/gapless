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

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  CLIENT_ORIGIN: csv.default(['http://localhost:3000']),
  REPLAY_WINDOW_SEC: z.coerce.number().int().positive().default(30),
  REPLAY_MAX_ENTRIES: z.coerce.number().int().positive().default(100000),
  HEARTBEAT_MS: z.coerce.number().int().positive().default(1000),
  CHAOS_ENABLED: z.coerce.boolean().default(true),
  FEED_IDLE_TTL_SEC: z.coerce.number().int().positive().default(300),
  TEST_CONTROL: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
