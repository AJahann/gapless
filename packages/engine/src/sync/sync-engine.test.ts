import {
  type Delta,
  type DeltasMessage,
  type HeartbeatMessage,
  type ReplayUnavailableMessage,
  type Snapshot,
  type WelcomeMessage,
  encodeServerMessage,
  safeDecodeClientMessage,
} from '@gapless/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTop100Universe } from '../universe';
import { FakeClock } from './clock';
import { SyncEngine } from './sync-engine';
import type { SyncSocket } from './types';

describe('SyncEngine test matrix', () => {
  let clock: FakeClock;
  let sentMessages: string[];
  let socketOpen = false;
  let onSocketMessageCb: (data: string) => void;
  let onSocketCloseCb: (code?: number) => void;
  let fetchSnapshotMock: () => Promise<Snapshot>;
  let initialUniverse: ReturnType<typeof createTop100Universe>;

  function createMockSocket(): SyncSocket {
    socketOpen = true;
    return {
      send: (data: string) => sentMessages.push(data),
      close: () => {
        socketOpen = false;
        onSocketCloseCb();
      },
      isOpen: () => socketOpen,
    };
  }

  function setupEngine(options?: {
    heartbeatMs?: number;
    initialSnapshot?: Snapshot;
  }) {
    initialUniverse = createTop100Universe();
    const defaultSnapshot: Snapshot = options?.initialSnapshot ?? {
      feed: 'top100@100',
      epoch: 'epoch-1',
      seq: 100,
      symbols: initialUniverse.symbols,
      quotes: initialUniverse.quotes,
    };

    fetchSnapshotMock = () => Promise.resolve(defaultSnapshot);

    const engine = new SyncEngine({
      feedId: 'top100@100',
      clock,
      heartbeatMs: options?.heartbeatMs ?? 1000,
      connectSocket: (onOpen, onMessage, onClose) => {
        onSocketMessageCb = onMessage;
        onSocketCloseCb = onClose;
        const sock = createMockSocket();
        queueMicrotask(onOpen);
        return sock;
      },
      fetchSnapshot: () => fetchSnapshotMock(),
    });

    return engine;
  }

  function deliver(msg: Parameters<typeof encodeServerMessage>[0]) {
    onSocketMessageCb(encodeServerMessage(msg));
  }

  function getLastClientMessage() {
    const raw = sentMessages[sentMessages.length - 1];
    if (!raw) return null;
    const decoded = safeDecodeClientMessage(raw);
    return decoded.success ? decoded.data : null;
  }

  beforeEach(() => {
    clock = new FakeClock();
    sentMessages = [];
    socketOpen = false;
  });

  it('in-order deltas: applied once, stays live', () => {
    const engine = setupEngine();
    engine.start();

    // Welcome live
    const welcome: WelcomeMessage = {
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    };
    deliver(welcome);
    expect(engine.currentState).toBe('live');

    // Deliver delta 11, 12, 13
    const d11: Delta = [11, 0, 68000000000, 10000, 0, clock.now()];
    const d12: Delta = [12, 0, 68100000000, 10000, 0, clock.now()];
    const d13: Delta = [13, 0, 68200000000, 10000, 0, clock.now()];

    deliver({ type: 'deltas', items: [d11, d12, d13] });

    expect(engine.currentSeq).toBe(13);
    expect(engine.currentMetrics.duplicates).toBe(0);
    expect(engine.currentMetrics.gaps).toBe(0);
    expect(engine.currentState).toBe('live');
  });

  it('duplicate delta: dropped, duplicates counter +1', () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    const d11: Delta = [11, 0, 68000000000, 10000, 0, clock.now()];
    deliver({ type: 'deltas', items: [d11] });
    expect(engine.currentSeq).toBe(11);

    // Deliver same delta again
    deliver({ type: 'deltas', items: [d11] });
    expect(engine.currentSeq).toBe(11);
    expect(engine.currentMetrics.duplicates).toBe(1);
  });

  it('reorder within window: applied in seq order, no resume', () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    const d11: Delta = [11, 0, 68000000000, 10000, 0, clock.now()];
    const d12: Delta = [12, 0, 68100000000, 10000, 0, clock.now()];

    // Deliver d12 first (gap), then d11 (fills gap)
    deliver({ type: 'deltas', items: [d12] });
    expect(engine.currentSeq).toBe(10);
    expect(engine.currentMetrics.gaps).toBe(1);
    expect(engine.currentMetrics.pendingSize).toBe(1);

    deliver({ type: 'deltas', items: [d11] });
    expect(engine.currentSeq).toBe(12);
    expect(engine.currentMetrics.pendingSize).toBe(0);
    expect(engine.currentMetrics.resumes).toBe(0);
    expect(engine.currentState).toBe('live');
  });

  it('gap not closing in 100 ms: one resume sent', () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    // Delta 13 arrives when expected was 11
    const d13: Delta = [13, 0, 68200000000, 10000, 0, clock.now()];
    deliver({ type: 'deltas', items: [d13] });

    expect(engine.currentMetrics.resumes).toBe(0);
    expect(engine.currentState).toBe('live');

    // Advance 50 ms -> no resume yet
    clock.advanceTimeBy(50);
    expect(engine.currentMetrics.resumes).toBe(0);

    // Advance another 51 ms (total 101 ms) -> gap timer fires
    clock.advanceTimeBy(51);
    expect(engine.currentMetrics.resumes).toBe(1);
    expect(engine.currentState).toBe('replaying');

    const lastMsg = getLastClientMessage();
    expect(lastMsg).toEqual({
      type: 'resume',
      epoch: 'epoch-1',
      seq: 10,
    });
  });

  it('resume -> replay: catches up without duplicates', () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    // Gap: d13 arrives
    const d13: Delta = [13, 0, 68200000000, 10000, 0, clock.now()];
    deliver({ type: 'deltas', items: [d13] });
    clock.advanceTimeBy(101); // Trigger resume

    expect(engine.currentState).toBe('replaying');

    // Replay deltas arrive: 11, 12, 13
    const d11: Delta = [11, 0, 68000000000, 10000, 0, clock.now()];
    const d12: Delta = [12, 0, 68100000000, 10000, 0, clock.now()];

    deliver({ type: 'deltas', items: [d11, d12] });
    expect(engine.currentSeq).toBe(13); // drained 13 from pending!
    expect(engine.currentState).toBe('live');
    expect(engine.currentMetrics.pendingSize).toBe(0);
  });

  it('resume -> expired: switches to snapshot path', async () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    const unavail: ReplayUnavailableMessage = {
      type: 'replay_unavailable',
      reason: 'expired',
      epoch: 'epoch-1',
      headSeq: 5000,
      oldestSeq: 2000,
    };
    deliver(unavail);

    expect(engine.currentState).toBe('syncing');

    // Allow promise tick for fetchSnapshot
    await Promise.resolve();
    expect(engine.currentState).toBe('live');
    expect(engine.currentMetrics.snapshots).toBe(1);
    expect(engine.currentSeq).toBe(100);
  });

  it('resume -> future / stale epoch: resets position and enters snapshot path', async () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    // Mock returns matching epoch
    fetchSnapshotMock = () =>
      Promise.resolve({
        feed: 'top100@100',
        epoch: 'epoch-2',
        seq: 50,
        symbols: initialUniverse.symbols,
        quotes: initialUniverse.quotes,
      });

    const unavail: ReplayUnavailableMessage = {
      type: 'replay_unavailable',
      reason: 'stale_epoch',
      epoch: 'epoch-2',
      headSeq: 50,
      oldestSeq: 1,
    };
    deliver(unavail);

    expect(engine.currentEpoch).toBe('epoch-2');
    expect(engine.currentState).toBe('syncing');

    await Promise.resolve();
    expect(engine.currentState).toBe('live');
    expect(engine.currentSeq).toBe(50);
  });

  it('snapshot arrives newer than live buffer: drops <= snapshot.seq, drains rest', async () => {
    const engine = setupEngine();
    engine.start();

    // Welcome mode snapshot
    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 100,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'snapshot',
    });
    expect(engine.currentState).toBe('syncing');

    // Live deltas arrive while snapshot is in-flight: 95, 101, 102
    const d95: Delta = [95, 0, 67000000000, 10000, 0, clock.now()];
    const d101: Delta = [101, 0, 67100000000, 10000, 0, clock.now()];
    const d102: Delta = [102, 0, 67200000000, 10000, 0, clock.now()];
    deliver({ type: 'deltas', items: [d95, d101, d102] });

    // Snapshot arrives with seq 100
    await Promise.resolve();

    expect(engine.currentSeq).toBe(102);
    expect(engine.currentState).toBe('live');
    expect(engine.currentMetrics.pendingSize).toBe(0);
  });

  it('heartbeat headSeq ahead without deltas triggers resume', () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    // Heartbeat says headSeq is 15 (5 deltas dropped)
    const hb: HeartbeatMessage = {
      type: 'heartbeat',
      headSeq: 15,
    };
    deliver(hb);

    // After 251ms, dropped tail timer triggers resume
    clock.advanceTimeBy(251);
    expect(engine.currentMetrics.resumes).toBe(1);
    expect(engine.currentState).toBe('replaying');
  });

  it('silence > 2x heartbeat closes socket and reconnects with backoff', () => {
    const engine = setupEngine({ heartbeatMs: 1000 });
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    expect(socketOpen).toBe(true);

    // 2001 ms silence
    clock.advanceTimeBy(2001);
    expect(socketOpen).toBe(false); // Closed due to silence!
    expect(engine.currentState).toBe('connecting');
  });

  it('manual cut stops timers, fetches, and sets offline state', async () => {
    const engine = setupEngine();
    engine.start();

    deliver({
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 10,
      oldestSeq: 1,
      heartbeatMs: 1000,
      mode: 'live',
    });

    engine.cut();
    expect(engine.currentState).toBe('offline');
    expect(socketOpen).toBe(false);

    // Time passing in offline triggers zero timers
    clock.advanceTimeBy(10000);
    expect(engine.currentState).toBe('offline');
    expect(socketOpen).toBe(false);

    // Restore starts connecting with last known position
    engine.restore();
    await Promise.resolve();
    expect(engine.currentState).toBe('connecting');
    expect(socketOpen).toBe(true);

    const lastMsg = getLastClientMessage();
    expect(lastMsg).toEqual({
      type: 'hello',
      v: 1,
      feed: 'top100@100',
      resume: { epoch: 'epoch-1', seq: 10 },
    });
  });
});
