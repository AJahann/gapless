import {
  CLOSE_CODES,
  type ClientMessage,
  type Delta,
  type DeltasMessage,
  type HeartbeatMessage,
  PROTOCOL_VERSION,
  type ReplayUnavailableMessage,
  type WelcomeMessage,
  encodeServerMessage,
  safeDecodeClientMessage,
} from '@gapless/protocol';
import type { FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { ChaosStage } from '../chaos/chaos-stage';
import type { Feed } from '../feed/feed';
import type { FeedRegistry } from '../feed/registry';

export interface WebSocketHandlerOptions {
  registry: FeedRegistry;
  clientOrigins: string[];
  heartbeatMs?: number;
  chaosEnabled?: boolean;
  testControl?: boolean;
  slowConsumerWatermark?: number; // bytes
}

const MAX_MESSAGE_SIZE = 4096;
const MAX_MESSAGES_PER_SEC = 20;
const HELLO_TIMEOUT_MS = 5000;
const MAX_FRAME_DELTAS = 1000;

export function handleFeedConnection(
  socket: WebSocket,
  request: FastifyRequest<{
    Params: { id: string };
    Querystring: { chaosSeed?: string };
  }>,
  options: WebSocketHandlerOptions,
): void {
  const feedId = request.params.id;
  const { origin } = request.headers;

  // 1. Origin verification
  if (origin && !options.clientOrigins.includes(origin)) {
    socket.close(
      CLOSE_CODES.UNAUTHORIZED_ORIGIN,
      'Unauthorized connection origin',
    );
    return;
  }

  const chaosSeed = request.query.chaosSeed ?? Date.now().toString();
  const chaos = new ChaosStage(chaosSeed, options.chaosEnabled ?? true);
  const slowWatermark = options.slowConsumerWatermark ?? 64 * 1024;
  const heartbeatMs = options.heartbeatMs ?? 1000;

  let feed: Feed | null = null;
  let isHandshaked = false;
  let isReplaying = false;
  let replayingQueue: Delta[] = [];
  let unsubscribeFeed: (() => void) | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  // Rate-limiting tracking (token bucket or 1s sliding window)
  let messageCountInSec = 0;
  let lastSecWindow = Math.floor(Date.now() / 1000);

  // 2. Hello timeout guard
  const helloTimeout = setTimeout(() => {
    if (!isHandshaked) {
      cleanup();
      socket.close(CLOSE_CODES.HELLO_TIMEOUT, 'Hello timeout');
    }
  }, HELLO_TIMEOUT_MS);

  function sendFrame(payload: string): void {
    if (socket.readyState !== socket.OPEN) return;

    // Check slow consumer
    if (socket.bufferedAmount > slowWatermark) {
      cleanup();
      socket.close(CLOSE_CODES.SLOW_CONSUMER, 'Slow consumer');
      return;
    }

    const delay = chaos.delayDurationMs;
    if (delay > 0) {
      setTimeout(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(payload);
        }
      }, delay);
    } else {
      socket.send(payload);
    }
  }

  function sendDeltas(deltas: Delta[]): void {
    if (chaos.isSilent) return;
    const processed = chaos.processDeltas(deltas);
    if (processed.length === 0) return;

    // Chunk into at most MAX_FRAME_DELTAS per frame
    for (let i = 0; i < processed.length; i += MAX_FRAME_DELTAS) {
      const chunk = processed.slice(i, i + MAX_FRAME_DELTAS);
      const frame: DeltasMessage = {
        type: 'deltas',
        items: chunk,
      };
      sendFrame(encodeServerMessage(frame));
    }
  }

  function startHeartbeat(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (!isHandshaked || !feed) return;
      if (chaos.isSilent) return;

      const hb: HeartbeatMessage = {
        type: 'heartbeat',
        headSeq: feed.headSeq,
      };
      sendFrame(encodeServerMessage(hb));
    }, heartbeatMs);
  }

  function handleLiveDeltas(deltas: Delta[]): void {
    if (isReplaying) {
      // Queue live deltas during replay to preserve strictly monotonic order
      replayingQueue.push(...deltas);
      return;
    }
    sendDeltas(deltas);
  }

  function performReplay(afterSeq: number): void {
    if (!feed) return;
    const replay = feed.getReplay(afterSeq);
    if (replay.status === 'ok') {
      isReplaying = true;
      sendDeltas(replay.deltas);

      // Drain queued live deltas that arrived during replay
      const queued = replayingQueue;
      replayingQueue = [];
      isReplaying = false;

      // Filter deltas <= headSeq from replay
      const toSend = queued.filter((d) => d[0] > feed!.headSeq);
      if (toSend.length > 0) {
        sendDeltas(toSend);
      }
    }
  }

  function handleHello(
    message: Extract<ClientMessage, { type: 'hello' }>,
  ): void {
    if (isHandshaked) {
      cleanup();
      socket.close(CLOSE_CODES.PROTOCOL_VIOLATION, 'Duplicate hello');
      return;
    }

    if (message.v !== PROTOCOL_VERSION) {
      cleanup();
      socket.close(CLOSE_CODES.PROTOCOL_VIOLATION, 'Protocol version mismatch');
      return;
    }

    isHandshaked = true;
    clearTimeout(helloTimeout);

    feed = options.registry.getFeed(feedId);
    options.registry.onSubscriberJoined(feedId);

    // Subscribe to feed deltas immediately
    unsubscribeFeed = feed.subscribe(handleLiveDeltas);

    const { resume } = message;
    let mode: 'snapshot' | 'replay' | 'live' = 'snapshot';

    if (resume) {
      if (resume.epoch !== feed.epoch) {
        mode = 'snapshot';
      } else if (resume.seq > feed.headSeq) {
        mode = 'snapshot';
      } else if (resume.seq < feed.oldestSeq - 1) {
        mode = 'snapshot';
      } else if (resume.seq === feed.headSeq) {
        mode = 'live';
      } else {
        mode = 'replay';
      }
    }

    const welcome: WelcomeMessage = {
      type: 'welcome',
      feed: feed.id,
      epoch: feed.epoch,
      headSeq: feed.headSeq,
      oldestSeq: feed.oldestSeq,
      heartbeatMs,
      mode,
    };
    sendFrame(encodeServerMessage(welcome));

    if (mode === 'replay' && resume) {
      performReplay(resume.seq);
    }

    startHeartbeat();
  }

  function handleResume(
    message: Extract<ClientMessage, { type: 'resume' }>,
  ): void {
    if (!isHandshaked || !feed) {
      cleanup();
      socket.close(CLOSE_CODES.PROTOCOL_VIOLATION, 'Resume before hello');
      return;
    }

    if (message.epoch !== feed.epoch) {
      const resp: ReplayUnavailableMessage = {
        type: 'replay_unavailable',
        reason: 'stale_epoch',
        epoch: feed.epoch,
        headSeq: feed.headSeq,
        oldestSeq: feed.oldestSeq,
      };
      sendFrame(encodeServerMessage(resp));
      return;
    }

    if (message.seq > feed.headSeq) {
      const resp: ReplayUnavailableMessage = {
        type: 'replay_unavailable',
        reason: 'future',
        epoch: feed.epoch,
        headSeq: feed.headSeq,
        oldestSeq: feed.oldestSeq,
      };
      sendFrame(encodeServerMessage(resp));
      return;
    }

    if (message.seq < feed.oldestSeq - 1) {
      const resp: ReplayUnavailableMessage = {
        type: 'replay_unavailable',
        reason: 'expired',
        epoch: feed.epoch,
        headSeq: feed.headSeq,
        oldestSeq: feed.oldestSeq,
      };
      sendFrame(encodeServerMessage(resp));
      return;
    }

    performReplay(message.seq);
  }

  function handleClientMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello':
        handleHello(msg);
        break;
      case 'resume':
        handleResume(msg);
        break;
      case 'chaos':
        chaos.updateConfig(msg);
        break;
      case 'pause':
        if (options.testControl && feed) feed.pause();
        break;
      case 'unpause':
        if (options.testControl && feed) feed.unpause();
        break;
    }
  }

  function cleanup(): void {
    clearTimeout(helloTimeout);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (unsubscribeFeed) {
      unsubscribeFeed();
      unsubscribeFeed = null;
    }
    if (feed) {
      options.registry.onSubscriberLeft(feedId);
      feed = null;
    }
  }

  socket.on('message', (raw) => {
    const rawStr = raw.toString();

    // Check message size limit (4 KiB)
    if (rawStr.length > MAX_MESSAGE_SIZE) {
      cleanup();
      socket.close(
        CLOSE_CODES.PROTOCOL_VIOLATION,
        'Message exceeded 4KiB limit',
      );
      return;
    }

    // Rate limiting: 20 msgs / sec
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec === lastSecWindow) {
      messageCountInSec += 1;
      if (messageCountInSec > MAX_MESSAGES_PER_SEC) {
        cleanup();
        socket.close(
          CLOSE_CODES.PROTOCOL_VIOLATION,
          'Rate limit exceeded (max 20 msgs/sec)',
        );
        return;
      }
    } else {
      lastSecWindow = nowSec;
      messageCountInSec = 1;
    }

    const decoded = safeDecodeClientMessage(rawStr);
    if (!decoded.success) {
      cleanup();
      socket.close(
        CLOSE_CODES.PROTOCOL_VIOLATION,
        'Invalid client message schema',
      );
      return;
    }

    handleClientMessage(decoded.data);
  });

  socket.on('close', () => {
    cleanup();
  });

  socket.on('error', () => {
    cleanup();
  });
}
