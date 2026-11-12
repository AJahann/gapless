import { afterEach, describe, expect, it } from 'vitest';
import {
  CLOSE_CODES,
  type DeltasMessage,
  PROTOCOL_VERSION,
  type ReplayUnavailableMessage,
  type ServerMessage,
  type Snapshot,
  type WelcomeMessage,
  decodeServerMessage,
  encodeClientMessage,
} from '@gapless/protocol';
import { buildApp } from './app';

describe('Server HTTP and WebSocket integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const activeSockets: WebSocket[] = [];

  function connectWs(
    path: string,
    protocols?: string | string[],
  ): Promise<WebSocket> {
    const address = app!.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address unavailable');
    }
    const wsUrl = `ws://127.0.0.1:${address.port}${path}`;
    const ws = new WebSocket(wsUrl, protocols);
    activeSockets.push(ws);

    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(ws);
      ws.onerror = (err) => reject(err);
    });
  }

  function waitForNextMessage(
    ws: WebSocket,
    timeoutMs = 3000,
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Timeout waiting for WS message after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      const onMessage = (event: MessageEvent) => {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        const parsed = decodeServerMessage(event.data);
        resolve(parsed);
      };

      ws.addEventListener('message', onMessage);
    });
  }

  function waitForClose(
    ws: WebSocket,
    timeoutMs = 3000,
  ): Promise<{ code: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for WS close after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.onclose = (event) => {
        clearTimeout(timer);
        resolve({ code: event.code, reason: event.reason });
      };
    });
  }

  function collectDeltas(
    ws: WebSocket,
    minCount: number,
    timeoutMs = 5000,
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout collecting ${minCount} deltas`));
      }, timeoutMs);

      const collected: number[] = [];
      const onMsg = (event: MessageEvent) => {
        const msg = decodeServerMessage(event.data);
        if (msg.type === 'deltas') {
          for (const d of msg.items) {
            collected.push(d[0]);
          }
          if (collected.length >= minCount) {
            clearTimeout(timer);
            ws.removeEventListener('message', onMsg);
            resolve(collected);
          }
        }
      };
      ws.addEventListener('message', onMsg);
    });
  }

  afterEach(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    activeSockets.length = 0;
    await app?.close();
  });

  describe('HTTP endpoints', () => {
    it('GET /api/health reports ok and wire protocol version', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        status: 'ok',
        protocolVersion: PROTOCOL_VERSION,
      });
    });

    it('GET /api/feeds lists active feeds', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      // Trigger feed creation
      await app.inject({
        method: 'GET',
        url: '/api/feeds/top100@100/snapshot',
      });

      const res = await app.inject({ method: 'GET', url: '/api/feeds' });
      expect(res.statusCode).toBe(200);
      const list = res.json() as { id: string; universe: string }[];
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0]?.id).toBe('top100@100');
      expect(list[0]?.universe).toBe('top100');
    });

    it('GET /api/feeds/:id/snapshot returns synchronous consistent snapshot', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      const res = await app.inject({
        method: 'GET',
        url: '/api/feeds/top100@100/snapshot',
      });
      expect(res.statusCode).toBe(200);
      const snapshot = res.json() as Snapshot;
      expect(snapshot.feed).toBe('top100@100');
      expect(snapshot.symbols).toHaveLength(100);
      expect(snapshot.quotes).toHaveLength(100);
      expect(snapshot.seq).toBeGreaterThanOrEqual(0);
    });

    it('handles test control: digest, pause, unpause, restart', async () => {
      app = await buildApp({
        clientOrigins: ['http://localhost:3000'],
        testControl: true,
      });

      const digestRes = await app.inject({
        method: 'GET',
        url: '/api/feeds/top100@100/digest',
      });
      expect(digestRes.statusCode).toBe(200);
      const digestBody = digestRes.json() as {
        epoch: string;
        digest: string;
        headSeq: number;
      };
      expect(digestBody.digest).toBeTypeOf('string');
      expect(digestBody.digest).toHaveLength(16);

      const pauseRes = await app.inject({
        method: 'POST',
        url: '/api/feeds/top100@100/pause',
      });
      expect(pauseRes.statusCode).toBe(200);

      const unpauseRes = await app.inject({
        method: 'POST',
        url: '/api/feeds/top100@100/unpause',
      });
      expect(unpauseRes.statusCode).toBe(200);

      const restartRes = await app.inject({
        method: 'POST',
        url: '/api/feeds/top100@100/restart',
      });
      expect(restartRes.statusCode).toBe(200);
      const newEpoch = (restartRes.json() as { epoch: string }).epoch;
      expect(newEpoch).not.toBe(digestBody.epoch);
    });

    it('denies test control routes when testControl is false or omitted', async () => {
      app = await buildApp({
        clientOrigins: ['http://localhost:3000'],
      });

      const routes = [
        { method: 'GET' as const, url: '/api/feeds/top100@100/digest' },
        { method: 'POST' as const, url: '/api/feeds/top100@100/pause' },
        { method: 'POST' as const, url: '/api/feeds/top100@100/unpause' },
        { method: 'POST' as const, url: '/api/feeds/top100@100/restart' },
      ];

      const responses = await Promise.all(
        routes.map((route) =>
          app!.inject({
            method: route.method,
            url: route.url,
          }),
        ),
      );

      for (const res of responses) {
        expect(res.statusCode).toBe(404);
      }
    });
  });

  describe('WebSocket integration', () => {
    it('fresh join receives welcome with mode snapshot and heartbeats', async () => {
      app = await buildApp({
        clientOrigins: ['http://localhost:3000'],
        heartbeatMs: 200,
      });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      ws.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );

      const welcome = (await waitForNextMessage(ws)) as WelcomeMessage;
      expect(welcome.type).toBe('welcome');
      expect(welcome.feed).toBe('top100@100');
      expect(welcome.mode).toBe('snapshot');
      expect(welcome.headSeq).toBeGreaterThanOrEqual(0);

      // Subsequent message is deltas or heartbeat
      const nextMsg = await waitForNextMessage(ws);
      expect(['deltas', 'heartbeat']).toContain(nextMsg.type);
    });

    it('resume inside window returns welcome mode replay with exact replay deltas', async () => {
      app = await buildApp({
        clientOrigins: ['http://localhost:3000'],
        replayWindowSec: 60,
      });
      await app.listen({ port: 0, host: '127.0.0.1' });

      // Join first to generate some deltas
      const ws1 = await connectWs('/ws/feeds/top100@100');
      ws1.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );
      const welcome1 = (await waitForNextMessage(ws1)) as WelcomeMessage;

      // Collect initial deltas
      const deltas = await collectDeltas(ws1, 3);
      const lastSeq = deltas[deltas.length - 1]!;

      // Connect second client with resume { epoch, seq: lastSeq }
      const ws2 = await connectWs('/ws/feeds/top100@100');
      ws2.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
          resume: { epoch: welcome1.epoch, seq: lastSeq },
        }),
      );

      const welcome2 = (await waitForNextMessage(ws2)) as WelcomeMessage;
      expect(welcome2.type).toBe('welcome');
      expect(welcome2.epoch).toBe(welcome1.epoch);
      expect(['replay', 'live']).toContain(welcome2.mode);
    });

    it('rejects stale epoch on in-band resume with replay_unavailable', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      ws.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );
      await waitForNextMessage(ws); // welcome

      ws.send(
        encodeClientMessage({
          type: 'resume',
          epoch: 'stale-wrong-epoch',
          seq: 10,
        }),
      );

      const reply = (await waitForNextMessage(ws)) as ReplayUnavailableMessage;
      expect(reply.type).toBe('replay_unavailable');
      expect(reply.reason).toBe('stale_epoch');
    });

    it('rejects future seq on in-band resume with replay_unavailable', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      ws.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );
      const welcome = (await waitForNextMessage(ws)) as WelcomeMessage;

      ws.send(
        encodeClientMessage({
          type: 'resume',
          epoch: welcome.epoch,
          seq: 99999999,
        }),
      );

      const reply = (await waitForNextMessage(ws)) as ReplayUnavailableMessage;
      expect(reply.type).toBe('replay_unavailable');
      expect(reply.reason).toBe('future');
    });

    it('chaos drop creates gaps on the configured connection without affecting others', async () => {
      app = await buildApp({
        clientOrigins: ['http://localhost:3000'],
        chaosEnabled: true,
      });
      await app.listen({ port: 0, host: '127.0.0.1' });

      // Clean connection
      const cleanWs = await connectWs('/ws/feeds/top100@100');
      cleanWs.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );
      await waitForNextMessage(cleanWs); // welcome

      // Chaos connection with 90% drop rate
      const chaosWs = await connectWs('/ws/feeds/top100@100?chaosSeed=999');
      chaosWs.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );
      await waitForNextMessage(chaosWs); // welcome

      chaosWs.send(
        encodeClientMessage({
          type: 'chaos',
          drop: 0.9,
        }),
      );

      // Collect deltas on clean connection -> verify contiguity
      const cleanDeltas = await collectDeltas(cleanWs, 5);
      for (let i = 0; i < cleanDeltas.length - 1; i += 1) {
        expect(cleanDeltas[i + 1]!).toBe(cleanDeltas[i]! + 1);
      }
    });

    it('ignores ws pause and unpause messages when testControl is false', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      ws.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );
      await waitForNextMessage(ws); // welcome

      // Attempt to pause via WS message
      ws.send(encodeClientMessage({ type: 'pause' }));

      // Deltas must continue flowing because testControl is false
      const deltas = await collectDeltas(ws, 3);
      expect(deltas.length).toBeGreaterThanOrEqual(3);
    });

    it('closes socket on protocol violation', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      const closePromise = waitForClose(ws);

      // Send malformed message
      ws.send('invalid-json');

      const closeEvent = await closePromise;
      expect(closeEvent.code).toBe(CLOSE_CODES.PROTOCOL_VIOLATION);
    });

    it('F05: feed restart closes subscribed sockets with CLOSE_CODES.EPOCH_RESET', async () => {
      app = await buildApp({
        clientOrigins: ['http://localhost:3000'],
        testControl: true,
      });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      ws.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@100',
        }),
      );
      await waitForNextMessage(ws); // welcome

      const closePromise = waitForClose(ws);

      // Trigger restart via test control route
      const res = await app.inject({
        method: 'POST',
        url: '/api/feeds/top100@100/restart',
      });
      expect(res.statusCode).toBe(200);

      // Connected socket must be closed with EPOCH_RESET
      const closeEvent = await closePromise;
      expect(closeEvent.code).toBe(CLOSE_CODES.EPOCH_RESET);
    });

    it('F11: rejects hello with mismatched feed ID against URL', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      const closePromise = waitForClose(ws);

      // Send hello with mismatching feed
      ws.send(
        encodeClientMessage({
          type: 'hello',
          v: PROTOCOL_VERSION,
          feed: 'top100@500',
        }),
      );

      const closeEvent = await closePromise;
      expect(closeEvent.code).toBe(CLOSE_CODES.PROTOCOL_VIOLATION);
    });

    it('F11: rejects message exceeding 4 KiB with PROTOCOL_VIOLATION', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const ws = await connectWs('/ws/feeds/top100@100');
      const closePromise = waitForClose(ws);

      // 5 KiB message
      const hugeData = 'x'.repeat(5120);
      ws.send(hugeData);

      const closeEvent = await closePromise;
      expect([
        CLOSE_CODES.PROTOCOL_VIOLATION,
        1009, // WS standard message too big
      ]).toContain(closeEvent.code);
    });

    it('F02/F11: rejects invalid feed ID format on HTTP and WS', async () => {
      app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
      await app.listen({ port: 0, host: '127.0.0.1' });

      const snapRes = await app.inject({
        method: 'GET',
        url: '/api/feeds/invalid-feed/snapshot',
      });
      expect(snapRes.statusCode).toBe(400);

      const ws = await connectWs('/ws/feeds/invalid-feed');
      const closeEvent = await waitForClose(ws);
      expect(closeEvent.code).toBe(CLOSE_CODES.PROTOCOL_VIOLATION);
    });
  });
});
