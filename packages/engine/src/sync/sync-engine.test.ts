import {
  CLOSE_CODES,
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
      symbols: initialUniverse.symbols,
      quotes: initialUniverse.quotes,
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

  describe('Phase R1 Remediation Specifications', () => {
    it('F03: behind-buffer snapshot transitions to replaying and requests resume', async () => {
      let resolveSnapshot!: (snap: Snapshot) => void;
      const snapshotPromise = new Promise<Snapshot>((resolve) => {
        resolveSnapshot = resolve;
      });

      const engine = new SyncEngine({
        feedId: 'top100@100',
        clock,
        connectSocket: (onOpen, onMessage, onClose) => {
          onSocketMessageCb = onMessage;
          onSocketCloseCb = onClose;
          const sock = createMockSocket();
          queueMicrotask(onOpen);
          return sock;
        },
        fetchSnapshot: () => snapshotPromise,
      });

      engine.start();
      await Promise.resolve();

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

      // Buffer delta 102 (hole at 101)
      const d102: Delta = [102, 0, 68000000000, 10000, 0, clock.now()];
      deliver({ type: 'deltas', items: [d102] });
      expect(engine.currentMetrics.pendingSize).toBe(1);

      // Now resolve snapshot at 100 -> minPendingSeq (102) > 100 + 1
      resolveSnapshot({
        feed: 'top100@100',
        epoch: 'epoch-1',
        seq: 100,
        symbols: initialUniverse.symbols,
        quotes: initialUniverse.quotes,
      });
      await Promise.resolve();

      // Must not deadlock in syncing: transitions to replaying and requests resume
      expect(engine.currentState).toBe('replaying');
      const lastMsg = getLastClientMessage();
      expect(lastMsg).toEqual({
        type: 'resume',
        epoch: 'epoch-1',
        seq: 100,
      });
    });

    it('F03: snapshot deadline times out after 5000ms and fails over to error after retries', async () => {
      const hungSnapshot = () => new Promise<Snapshot>(() => {});
      const engine = new SyncEngine({
        feedId: 'top100@100',
        clock,
        heartbeatMs: 20000,
        connectSocket: (onOpen, onMessage, onClose) => {
          onSocketMessageCb = onMessage;
          onSocketCloseCb = onClose;
          const sock = createMockSocket();
          queueMicrotask(onOpen);
          return sock;
        },
        fetchSnapshot: hungSnapshot,
      });

      engine.start();
      await Promise.resolve();

      deliver({
        type: 'welcome',
        feed: 'top100@100',
        epoch: 'epoch-1',
        headSeq: 100,
        oldestSeq: 1,
        heartbeatMs: 20000,
        mode: 'snapshot',
      });
      expect(engine.currentState).toBe('syncing');

      // Advance 5001ms -> attempt 1 timeout, schedules retry in 500ms
      clock.advanceTimeBy(5001);
      expect(engine.currentState).toBe('syncing');

      // Advance 500ms (retry triggered) + 5001ms -> attempt 2 timeout, schedules retry in 1000ms
      clock.advanceTimeBy(500 + 5001);
      expect(engine.currentState).toBe('syncing');

      // Advance 1000ms (retry triggered) + 5001ms -> attempt 3 timeout -> reaches error state!
      clock.advanceTimeBy(1000 + 5001);
      expect(engine.currentState).toBe('error');
    });

    it('F04: deltas are staged during syncing; cut/restore before baseline does not send resume', async () => {
      let resolveSnapshot!: (snap: Snapshot) => void;
      const snapshotPromise = new Promise<Snapshot>((resolve) => {
        resolveSnapshot = resolve;
      });

      const engine = new SyncEngine({
        feedId: 'top100@100',
        clock,
        connectSocket: (onOpen, onMessage, onClose) => {
          onSocketMessageCb = onMessage;
          onSocketCloseCb = onClose;
          const sock = createMockSocket();
          queueMicrotask(onOpen);
          return sock;
        },
        fetchSnapshot: () => snapshotPromise,
      });

      engine.start();
      await Promise.resolve();

      deliver({
        type: 'welcome',
        feed: 'top100@100',
        epoch: 'epoch-1',
        headSeq: 10,
        oldestSeq: 1,
        heartbeatMs: 1000,
        mode: 'snapshot',
      });

      // Deltas arrive while syncing
      const d1: Delta = [1, 0, 68000000000, 10000, 0, clock.now()];
      const d2: Delta = [2, 0, 68100000000, 10000, 0, clock.now()];
      deliver({ type: 'deltas', items: [d1, d2] });

      // Seq must not advance without installed baseline
      expect(engine.currentSeq).toBe(0);
      expect(engine.currentMetrics.pendingSize).toBe(2);

      // Cut connection before snapshot resolves
      engine.cut();
      expect(engine.currentState).toBe('offline');

      // Restore connection
      engine.restore();
      await Promise.resolve();

      // Must not send resume for seq 2 because baseline was never installed!
      const lastMsg = getLastClientMessage();
      expect(lastMsg).toEqual({
        type: 'hello',
        v: 1,
        feed: 'top100@100',
        resume: undefined,
      });

      // Cleanup snapshot promise
      resolveSnapshot({
        feed: 'top100@100',
        epoch: 'epoch-1',
        seq: 10,
        symbols: initialUniverse.symbols,
        quotes: initialUniverse.quotes,
      });
    });

    it('F04: pending size is hard-bounded at 256 without resume storm', () => {
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

      sentMessages = [];

      // Deliver 300 gap deltas
      for (let s = 20; s < 320; s += 1) {
        const d: Delta = [s, 0, 68000000000, 10000, 0, clock.now()];
        deliver({ type: 'deltas', items: [d] });
      }

      // Hard memory bound: pendingSize is capped at 256
      expect(engine.currentMetrics.pendingSize).toBe(256);

      // No resume storm (sent at most 1 resume on overflow, not 44)
      const resumeCount = sentMessages.filter((m) =>
        m.includes('"resume"'),
      ).length;
      expect(resumeCount).toBeLessThanOrEqual(1);
    });

    it('F06: stop aborts in-flight snapshot and prevents stopped engine resurrection', async () => {
      let resolveSnapshot!: (snap: Snapshot) => void;
      const snapshotPromise = new Promise<Snapshot>((resolve) => {
        resolveSnapshot = resolve;
      });

      const engine = new SyncEngine({
        feedId: 'top100@100',
        clock,
        connectSocket: (onOpen, onMessage, onClose) => {
          onSocketMessageCb = onMessage;
          onSocketCloseCb = onClose;
          const sock = createMockSocket();
          queueMicrotask(onOpen);
          return sock;
        },
        fetchSnapshot: () => snapshotPromise,
      });

      engine.start();
      await Promise.resolve();

      deliver({
        type: 'welcome',
        feed: 'top100@100',
        epoch: 'epoch-1',
        headSeq: 10,
        oldestSeq: 1,
        heartbeatMs: 1000,
        mode: 'snapshot',
      });
      expect(engine.currentState).toBe('syncing');

      // Stop engine while fetch in flight
      engine.stop();
      expect(engine.currentState).toBe('idle');

      // Now late snapshot resolves
      resolveSnapshot({
        feed: 'top100@100',
        epoch: 'epoch-1',
        seq: 10,
        symbols: initialUniverse.symbols,
        quotes: initialUniverse.quotes,
      });
      await Promise.resolve();

      // State must remain idle, not resurrected to live or replaying
      expect(engine.currentState).toBe('idle');
    });

    it('F21: replay does not transition to live before reaching advertised headSeq', () => {
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

      // Now reconnect / receive replay welcome with headSeq 15
      deliver({
        type: 'welcome',
        feed: 'top100@100',
        epoch: 'epoch-1',
        headSeq: 15,
        oldestSeq: 1,
        heartbeatMs: 1000,
        mode: 'replay',
      });
      expect(engine.currentState).toBe('replaying');

      // Deliver replay delta 11
      const d11: Delta = [11, 0, 68000000000, 10000, 0, clock.now()];
      deliver({ type: 'deltas', items: [d11] });
      expect(engine.currentSeq).toBe(11);
      expect(engine.currentMetrics.replays).toBe(1);
      // Head is 15 -> must STILL be replaying, not live!
      expect(engine.currentState).toBe('replaying');

      // Deliver deltas 12, 13, 14
      const d12: Delta = [12, 0, 68000000000, 10000, 0, clock.now()];
      const d13: Delta = [13, 0, 68000000000, 10000, 0, clock.now()];
      const d14: Delta = [14, 0, 68000000000, 10000, 0, clock.now()];
      deliver({ type: 'deltas', items: [d12, d13, d14] });
      expect(engine.currentState).toBe('replaying');

      // Deliver final delta 15 -> headSeq reached, now live!
      const d15: Delta = [15, 0, 68000000000, 10000, 0, clock.now()];
      deliver({ type: 'deltas', items: [d15] });
      expect(engine.currentState).toBe('live');
      expect(engine.currentMetrics.replays).toBe(5);
    });

    it('F05: socket close with EPOCH_RESET reconnects immediately without backoff delay', async () => {
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
      expect(engine.currentState).toBe('live');

      // Socket closed by server with EPOCH_RESET code
      onSocketCloseCb(CLOSE_CODES.EPOCH_RESET);

      // Reconnect is scheduled immediately (0ms delay)
      await Promise.resolve();
      expect(engine.currentState).toBe('connecting');
      expect(socketOpen).toBe(true);
    });

    it('F07: delta with unknown symbol index does not advance lastSeq and triggers snapshot resync', () => {
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

      // Universe has 100 symbols (indices 0..99). Deliver delta with symbolIndex 999.
      const corruptDelta: Delta = [11, 999, 68000000000, 10000, 0, clock.now()];
      deliver({ type: 'deltas', items: [corruptDelta] });

      // Seq must NOT advance past unusable event
      expect(engine.currentSeq).toBe(10);
      // Engine must recover via snapshot sync
      expect(engine.currentState).toBe('syncing');
    });

    it('F07: rejects snapshot with mismatched feed ID', async () => {
      let resolveSnapshot!: (snap: Snapshot) => void;
      const snapshotPromise = new Promise<Snapshot>((resolve) => {
        resolveSnapshot = resolve;
      });

      let capturedError: Error | undefined;
      const engine = new SyncEngine({
        feedId: 'top100@100',
        clock,
        connectSocket: (onOpen, onMessage, onClose) => {
          onSocketMessageCb = onMessage;
          onSocketCloseCb = onClose;
          const sock = createMockSocket();
          queueMicrotask(onOpen);
          return sock;
        },
        fetchSnapshot: () => snapshotPromise,
        listeners: {
          onError: (err) => {
            capturedError = err;
          },
        },
      });

      engine.start();
      await Promise.resolve();

      deliver({
        type: 'welcome',
        feed: 'top100@100',
        epoch: 'epoch-1',
        headSeq: 10,
        oldestSeq: 1,
        heartbeatMs: 1000,
        mode: 'snapshot',
      });
      expect(engine.currentState).toBe('syncing');

      // Resolve snapshot with wrong feed ID
      resolveSnapshot({
        feed: 'wrong-feed@500',
        epoch: 'epoch-1',
        seq: 10,
        symbols: initialUniverse.symbols,
        quotes: initialUniverse.quotes,
      });
      await Promise.resolve();

      // Must fail and reject mismatch
      expect(engine.currentState).toBe('syncing');
    });
  });
});
