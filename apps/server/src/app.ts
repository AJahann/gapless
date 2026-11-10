import cors from '@fastify/cors';
import { PROTOCOL_VERSION } from '@gapless/protocol';
import Fastify from 'fastify';

export interface AppOptions {
  clientOrigins: string[];
  logger?: boolean;
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, { origin: options.clientOrigins });

  app.get('/api/health', (_request, reply) =>
    reply.send({ status: 'ok', protocolVersion: PROTOCOL_VERSION }),
  );

  return app;
}
