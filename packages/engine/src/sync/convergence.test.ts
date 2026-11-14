import {
  type Delta,
  type Snapshot,
  encodeServerMessage,
  safeDecodeClientMessage,
} from '@gapless/protocol';
import { describe, expect, it } from 'vitest';
import { createPrng } from '../prng';
import { RingBuffer } from '../ring-buffer';
import { applyDelta, computeDigest, createTop100Universe } from '../universe';
import { FakeClock } from './clock';
import { SyncEngine } from './sync-engine';
import type { SyncSocket } from './types';

class ResponsiveReplayServer {
  readonly epoch: string;
  headSeq = 0;
  readonly replayRing: RingBuffer<Delta>;
  readonly quotes: ReturnType<typeof createTop100Universe>['quotes'];
  readonly symbols: ReturnType<typeof createTop100Universe>['symbols'];
  private readonly deltaLog = new Map<number, Delta>();

  constructor(epoch: string, replayCapacity = 500) {
    this.epoch = epoch;
    this.replayRing = new RingBuffer<Delta>(replayCapacity);
    const universe = createTop100Universe();
    this.symbols = universe.symbols;
    this.quotes = universe.quotes.map((q) => ({ ...q }));
  }

  generateDelta(prng: ReturnType<typeof createPrng>, now: number): Delta {
    this.headSeq += 1;
    const symIdx = prng.nextInt(0, 99);
    const prevQuote = this.quotes[symIdx]!;
    const pctChange = prng.nextGaussian(0, 0.005);
    const newPrice = Math.max(1, Math.round(prevQuote.price * (1 + pctChange)));
    const size = prng.nextInt(100, 50000);
    const side: 0 | 1 = newPrice >= prevQuote.price ? 0 : 1;
    const delta: Delta = [this.headSeq, symIdx, newPrice, size, side, now];
    this.deltaLog.set(this.headSeq, delta);
    this.replayRing.push(delta);
    this.quotes[symIdx] = applyDelta(prevQuote, delta);
    return delta;
  }

  getSnapshot(): Snapshot {
    return {
      feed: 'top100@100',
      epoch: this.epoch,
      seq: this.headSeq,
      symbols: this.symbols,
      quotes: this.quotes.map((q) => ({ ...q })),
    };
  }

  handleClientMessage(
    raw: string,
    sendToClient: (msg: Parameters<typeof encodeServerMessage>[0]) => void,
  ): void {
    const decoded = safeDecodeClientMessage(raw);
    if (!decoded.success) return;
    const msg = decoded.data;

    if (msg.type === 'hello') {
      this.handleHello(msg.resume, sendToClient);
    } else if (msg.type === 'resume') {
      this.handleResume(msg.epoch, msg.seq, sendToClient);
    }
  }

  private handleHello(
    resume: { epoch: string; seq: number } | undefined,
    sendToClient: (msg: Parameters<typeof encodeServerMessage>[0]) => void,
  ): void {
    const oldestSeq = Math.max(1, this.headSeq - this.replayRing.length + 1);
    if (
      !resume ||
      resume.epoch !== this.epoch ||
      resume.seq < this.headSeq - this.replayRing.length
    ) {
      sendToClient({
        type: 'welcome',
        feed: 'top100@100',
        epoch: this.epoch,
        headSeq: this.headSeq,
        oldestSeq,
        heartbeatMs: 1000,
        mode: 'snapshot',
      });
      return;
    }

    if (resume.seq === this.headSeq) {
      sendToClient({
        type: 'welcome',
        feed: 'top100@100',
        epoch: this.epoch,
        headSeq: this.headSeq,
        oldestSeq,
        heartbeatMs: 1000,
        mode: 'live',
      });
      return;
    }

    sendToClient({
      type: 'welcome',
      feed: 'top100@100',
      epoch: this.epoch,
      headSeq: this.headSeq,
      oldestSeq,
      heartbeatMs: 1000,
      mode: 'replay',
    });
    this.sendReplayDeltas(resume.seq, sendToClient);
  }

  private handleResume(
    epoch: string,
    seq: number,
    sendToClient: (msg: Parameters<typeof encodeServerMessage>[0]) => void,
  ): void {
    const oldestSeq = Math.max(1, this.headSeq - this.replayRing.length + 1);
    if (epoch !== this.epoch || seq < this.headSeq - this.replayRing.length) {
      sendToClient({
        type: 'replay_unavailable',
        reason: epoch !== this.epoch ? 'stale_epoch' : 'expired',
        epoch: this.epoch,
        headSeq: this.headSeq,
        oldestSeq,
      });
      return;
    }
    this.sendReplayDeltas(seq, sendToClient);
  }

  private sendReplayDeltas(
    afterSeq: number,
    sendToClient: (msg: Parameters<typeof encodeServerMessage>[0]) => void,
  ): void {
    const deltas: Delta[] = [];
    for (let s = afterSeq + 1; s <= this.headSeq; s += 1) {
      const d = this.deltaLog.get(s);
      if (d) deltas.push(d);
    }
    if (deltas.length > 0) {
      sendToClient({ type: 'deltas', items: deltas });
    }
  }
}

async function runSeedConvergenceScenario(seed: number) {
  const prng = createPrng(seed);
  const clock = new FakeClock();
  const server = new ResponsiveReplayServer(`epoch-conv-${seed}`, 300);

  let onSocketMessageCb: (data: string) => void = () => {};
  let socketOpen = false;

  const sendToClient = (msg: Parameters<typeof encodeServerMessage>[0]) => {
    if (socketOpen) {
      onSocketMessageCb(encodeServerMessage(msg));
    }
  };

  const sock: SyncSocket = {
    send: (raw: string) => {
      server.handleClientMessage(raw, sendToClient);
    },
    close: () => {
      socketOpen = false;
    },
    isOpen: () => socketOpen,
  };

  const engine = new SyncEngine({
    feedId: 'top100@100',
    clock,
    symbols: server.symbols,
    quotes: server.quotes.map((q) => ({ ...q })),
    connectSocket: (onOpen, onMessage) => {
      socketOpen = true;
      onSocketMessageCb = onMessage;
      queueMicrotask(onOpen);
      return sock;
    },
    fetchSnapshot: () => Promise.resolve(server.getSnapshot()),
  });

  engine.start();
  await Promise.resolve();
  await Promise.resolve();

  // Generate 250 deltas with chaos injection (drops, duplicates, small reorders)
  for (let i = 0; i < 250; i += 1) {
    const delta = server.generateDelta(prng, clock.now());
    const roll = prng.next();

    if (roll < 0.1) {
      // Packet dropped: triggers gap detection on client
      continue;
    }

    sendToClient({ type: 'deltas', items: [delta] });

    if (roll < 0.2) {
      // Packet duplicated
      sendToClient({ type: 'deltas', items: [delta] });
    }

    clock.advanceTimeBy(20);
  }

  // Allow client to detect gaps, request resume, and replay to catch up
  clock.advanceTimeBy(300);

  // Send final quiescent heartbeat at head
  sendToClient({ type: 'heartbeat', headSeq: server.headSeq });
  clock.advanceTimeBy(500);

  // Assert exact sequence and digest convergence
  expect(engine.currentSeq).toBe(server.headSeq);
  expect(engine.currentState).toBe('live');
  expect(engine.currentMetrics.pendingSize).toBe(0);

  const clientDigest = computeDigest(engine.currentQuotes);
  const serverDigest = computeDigest(server.quotes);
  engine.stop();
  return {
    clientDigest,
    serverDigest,
    clientSeq: engine.currentSeq,
    serverSeq: server.headSeq,
  };
}

describe('Convergence invariant property tests (Phase R5)', () => {
  it.each([4242, 90210, 13370])(
    'converges for deterministic seed %i',
    async (seed) => {
      const res = await runSeedConvergenceScenario(seed);
      expect(res.clientSeq).toBe(res.serverSeq);
      expect(res.clientDigest).toBe(res.serverDigest);
    },
  );
});
