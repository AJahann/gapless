import { buildApp } from './app';
import { loadEnv } from './config/env';

const env = loadEnv();
const app = await buildApp({
  clientOrigins: env.CLIENT_ORIGIN,
  replayWindowSec: env.REPLAY_WINDOW_SEC,
  replayMaxEntries: env.REPLAY_MAX_ENTRIES,
  heartbeatMs: env.HEARTBEAT_MS,
  chaosEnabled: env.CHAOS_ENABLED,
  feedIdleTtlSec: env.FEED_IDLE_TTL_SEC,
  testControl: env.TEST_CONTROL,
  logger: true,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
