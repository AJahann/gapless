import { buildApp } from './app';
import { loadEnv } from './config/env';

const env = loadEnv();
const app = await buildApp({ clientOrigins: env.CLIENT_ORIGIN, logger: true });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
