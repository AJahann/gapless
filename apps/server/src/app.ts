import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { PROTOCOL_VERSION } from '@gapless/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { FeedRegistry } from './feed/registry';
import { handleFeedConnection } from './ws/handler';

export interface AppOptions {
  clientOrigins: string[];
  logger?: boolean;
  replayWindowSec?: number;
  replayMaxEntries?: number;
  heartbeatMs?: number;
  chaosEnabled?: boolean;
  feedIdleTtlSec?: number;
  testControl?: boolean;
  registry?: FeedRegistry;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const registry =
    options.registry ??
    new FeedRegistry({
      replayWindowSec: options.replayWindowSec,
      replayMaxEntries: options.replayMaxEntries,
      feedIdleTtlSec: options.feedIdleTtlSec,
    });
  const testControl = options.testControl ?? true;

  await app.register(cors, { origin: options.clientOrigins });
  await app.register(fastifyWebsocket);

  // Health
  app.get('/api/health', (_request, reply) =>
    reply.send({ status: 'ok', protocolVersion: PROTOCOL_VERSION }),
  );

  // List active feeds
  app.get('/api/feeds', (_request, reply) => {
    reply.send(registry.listFeeds());
  });

  // Snapshot
  app.get<{ Params: { id: string } }>(
    '/api/feeds/:id/snapshot',
    (request, reply) => {
      const feed = registry.getFeed(request.params.id);
      reply.send(feed.getSnapshot());
    },
  );

  // Test control routes
  if (testControl) {
    app.get<{ Params: { id: string } }>(
      '/api/feeds/:id/digest',
      (request, reply) => {
        const feed = registry.getFeed(request.params.id);
        reply.send(feed.getDigest());
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/feeds/:id/pause',
      (request, reply) => {
        const feed = registry.getFeed(request.params.id);
        feed.pause();
        reply.send({ headSeq: feed.headSeq });
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/feeds/:id/unpause',
      (request, reply) => {
        const feed = registry.getFeed(request.params.id);
        feed.unpause();
        reply.send({ headSeq: feed.headSeq });
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/feeds/:id/restart',
      (request, reply) => {
        const feed = registry.getFeed(request.params.id);
        const epoch = feed.restart();
        reply.send({ epoch });
      },
    );
  }

  // WebSocket feed route
  app.get<{
    Params: { id: string };
    Querystring: { chaosSeed?: string };
  }>('/ws/feeds/:id', { websocket: true }, (socket, req) => {
    handleFeedConnection(socket, req, {
      registry,
      clientOrigins: options.clientOrigins,
      heartbeatMs: options.heartbeatMs,
      chaosEnabled: options.chaosEnabled,
      testControl,
    });
  });

  // Graceful shutdown hook
  app.addHook('onClose', (_instance, done) => {
    registry.closeAll();
    done();
  });

  return app;
}
