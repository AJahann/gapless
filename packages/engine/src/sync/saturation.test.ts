import { describe, expect, it } from 'vitest';
import { computeDigest, createTop100Universe, applyDelta } from '../universe';
import { FakeClock } from './clock';
import { SyncEngine } from './sync-engine';
import type { Delta } from '@gapless/protocol';

describe('pending saturation recovery', () => {
  it.each(['cut', 'stop'] as const)(
    'retries boundedly under loss, converges, and tears down on %s',
    async (teardown) => {
      const clock = new FakeClock();
      const universe = createTop100Universe();
      const serverQuotes = universe.quotes.map((quote) => ({ ...quote }));
      const deltas = new Map<number, Delta>();
      const resumeTimes: number[] = [];
      let replayFrom = -1;
      let receive: (raw: string) => void = () => {};
      let open = true;
      const engine = new SyncEngine({
        feedId: 'top100@100',
        clock,
        connectSocket: (_onOpen, onMessage) => {
          receive = onMessage;
          return {
            send: (raw) => {
              const message = JSON.parse(raw) as { type: string; seq?: number };
              if (message.type === 'resume') {
                resumeTimes.push(clock.now());
                replayFrom = message.seq ?? -1;
              }
            },
            close: () => {
              open = false;
            },
            isOpen: () => open,
          };
        },
        fetchSnapshot: () =>
          Promise.resolve({
            feed: 'top100@100',
            epoch: 'epoch-1',
            seq: 100,
            symbols: universe.symbols,
            quotes: universe.quotes,
          }),
      });
      const deliver = (message: unknown) => receive(JSON.stringify(message));
      engine.start();
      deliver({
        type: 'welcome',
        feed: 'top100@100',
        epoch: 'epoch-1',
        headSeq: 100,
        oldestSeq: 1,
        heartbeatMs: 1000,
        mode: 'snapshot',
      });
      await Promise.resolve();
      await Promise.resolve();
      for (let seq = 101; seq <= 1000; seq++) {
        const delta: Delta = [seq, 0, 68000000000 + seq, 10000, 0, clock.now()];
        deltas.set(seq, delta);
        serverQuotes[0] = applyDelta(serverQuotes[0]!, delta);
        if (seq > 101) {
          deliver({ type: 'deltas', items: [delta, delta] });
        }
        if (seq % 50 === 0) deliver({ type: 'heartbeat', headSeq: seq });
        clock.advanceTimeBy(20);
        expect(engine.currentMetrics.pendingSize).toBeLessThanOrEqual(256);
      }
      expect(engine.currentMetrics.pendingSize).toBe(256);
      const atSaturation = resumeTimes.length;
      replayFrom = -1;
      for (let seq = 1001; seq <= 1100; seq++) {
        const delta: Delta = [seq, 0, 68000000000 + seq, 10000, 0, clock.now()];
        deltas.set(seq, delta);
        serverQuotes[0] = applyDelta(serverQuotes[0]!, delta);
        deliver({ type: 'deltas', items: [delta, delta] });
        if (seq % 50 === 0) deliver({ type: 'heartbeat', headSeq: seq });
        clock.advanceTimeBy(20);
      }
      expect(resumeTimes.length).toBeGreaterThan(atSaturation);
      expect(resumeTimes.length).toBeLessThanOrEqual(221);
      expect(replayFrom).toBe(100);
      for (let i = 1; i < resumeTimes.length; i++) {
        expect(resumeTimes[i]! - resumeTimes[i - 1]!).toBeGreaterThanOrEqual(
          100,
        );
      }
      const replay = Array.from(deltas.values()).filter(
        (delta) => delta[0] > replayFrom,
      );
      deliver({ type: 'deltas', items: replay });
      expect(engine.currentSeq).toBe(1100);
      expect(engine.currentMetrics.pendingSize).toBe(0);
      expect(computeDigest(engine.currentQuotes)).toBe(
        computeDigest(serverQuotes),
      );
      deliver({
        type: 'deltas',
        items: [[1102, 0, 68000001102, 10000, 0, clock.now()]],
      });
      expect(engine.currentMetrics.pendingSize).toBe(1);
      engine[teardown]();
      const stoppedAt = resumeTimes.length;
      clock.advanceTimeBy(5000);
      expect(resumeTimes).toHaveLength(stoppedAt);
    },
  );
});
