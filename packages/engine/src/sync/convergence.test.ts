import {
  type Delta,
  type Snapshot,
  encodeServerMessage,
} from '@gapless/protocol';
import { describe, expect, it } from 'vitest';
import { createPrng } from '../prng';
import { applyDelta, computeDigest, createTop100Universe } from '../universe';
import { FakeClock } from './clock';
import { SyncEngine } from './sync-engine';
import type { SyncSocket } from './types';

describe('Convergence invariant property test', () => {
  it('guarantees client quote state exactly equals server quote state after chaos script', () => {
    const prng = createPrng(424242);
    const clock = new FakeClock();

    const serverUniverse = createTop100Universe();
    const serverQuotes = [...serverUniverse.quotes];
    let serverSeq = 0;
    const epoch = 'epoch-convergence-1';

    // Track all deltas emitted by server
    const serverDeltaLog = new Map<number, Delta>();

    function generateServerDelta(): Delta {
      serverSeq += 1;
      const symIdx = prng.nextInt(0, 99);
      const prevQuote = serverQuotes[symIdx]!;

      const pctChange = prng.nextGaussian(0, 0.005);
      const newPrice = Math.max(
        1,
        Math.round(prevQuote.price * (1 + pctChange)),
      );
      const size = prng.nextInt(100, 50000);
      const side: 0 | 1 = newPrice >= prevQuote.price ? 0 : 1;
      const ts = clock.now();

      const delta: Delta = [serverSeq, symIdx, newPrice, size, side, ts];
      serverDeltaLog.set(serverSeq, delta);
      serverQuotes[symIdx] = applyDelta(prevQuote, delta);
      return delta;
    }

    let socketOpen = false;
    let onSocketMessageCb: (data: string) => void = () => {};
    const clientSent: string[] = [];

    function makeSocket(): SyncSocket {
      socketOpen = true;
      return {
        send: (data: string) => clientSent.push(data),
        close: () => {
          socketOpen = false;
        },
        isOpen: () => socketOpen,
      };
    }

    const engine = new SyncEngine({
      feedId: 'top100@100',
      clock,
      symbols: serverUniverse.symbols,
      quotes: serverUniverse.quotes,
      connectSocket: (onOpen, onMessage) => {
        onSocketMessageCb = onMessage;
        onOpen();
        return makeSocket();
      },
      fetchSnapshot: () => {
        const snap: Snapshot = {
          feed: 'top100@100',
          epoch,
          seq: serverSeq,
          symbols: serverUniverse.symbols,
          quotes: serverQuotes.map((q) => ({ ...q })),
        };
        return Promise.resolve(snap);
      },
    });

    engine.start();

    // Start with welcome live at seq 0
    onSocketMessageCb(
      encodeServerMessage({
        type: 'welcome',
        feed: 'top100@100',
        epoch,
        headSeq: 0,
        oldestSeq: 0,
        heartbeatMs: 1000,
        mode: 'live',
      }),
    );

    // Generate 500 deltas and send through chaotic pipeline
    const generatedDeltas: Delta[] = [];
    for (let i = 0; i < 500; i += 1) {
      generatedDeltas.push(generateServerDelta());
    }

    // Chaotic delivery: shuffle in chunks, duplicate, drop some
    const deliveryQueue: Delta[] = [];
    for (const d of generatedDeltas) {
      const r = prng.next();
      if (r < 0.05) {
        // Drop (causes gap)
        continue;
      }
      deliveryQueue.push(d);
      if (r < 0.1) {
        // Duplicate
        deliveryQueue.push(d);
      }
    }

    // Random small reorders
    for (let i = 0; i < deliveryQueue.length - 1; i += 1) {
      if (prng.next() < 0.15) {
        const tmp = deliveryQueue[i]!;
        deliveryQueue[i] = deliveryQueue[i + 1]!;
        deliveryQueue[i + 1] = tmp;
        i += 1;
      }
    }

    // Feed queue into client
    for (let i = 0; i < deliveryQueue.length; i += 10) {
      const chunk = deliveryQueue.slice(i, i + 10);
      onSocketMessageCb(
        encodeServerMessage({
          type: 'deltas',
          items: chunk,
        }),
      );
      clock.advanceTimeBy(10);
    }

    // Now bridge all gaps by replaying missing deltas sequentially from serverDeltaLog
    const clientSeq = engine.currentSeq;
    const missing: Delta[] = [];
    for (let s = clientSeq + 1; s <= serverSeq; s += 1) {
      const delta = serverDeltaLog.get(s);
      if (delta) {
        missing.push(delta);
      }
    }

    if (missing.length > 0) {
      onSocketMessageCb(
        encodeServerMessage({
          type: 'deltas',
          items: missing,
        }),
      );
    }

    // Assert the convergence invariant:
    expect(engine.currentSeq).toBe(serverSeq);
    expect(engine.currentState).toBe('live');
    expect(engine.currentMetrics.pendingSize).toBe(0);

    const clientDigest = computeDigest(engine.currentQuotes);
    const serverDigest = computeDigest(serverQuotes);

    expect(clientDigest).toBe(serverDigest);
  });
});
