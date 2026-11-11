import {
  type ClientMessage,
  type Delta,
  type HelloMessage,
  PROTOCOL_VERSION,
  type PauseMessage,
  type Quote,
  type ResumeMessage,
  type Snapshot,
  type SymbolInfo,
  type UnpauseMessage,
  encodeClientMessage,
  safeDecodeServerMessage,
} from '@gapless/protocol';
import { computeFullJitterBackoff } from '../backoff';
import { applyDelta } from '../universe';
import { SystemClock } from './clock';
import type {
  Clock,
  ClockTimer,
  SyncEngineListeners,
  SyncEngineOptions,
  SyncMetrics,
  SyncSocket,
  SyncState,
} from './types';

const GAP_TIMEOUT_MS = 100;
const DROPPED_TAIL_TIMEOUT_MS = 250;
const MAX_PENDING_SIZE = 256;
const MAX_SNAPSHOT_RETRIES = 3;
const SNAPSHOT_TIMEOUT_MS = 5000;

export class SyncEngine {
  readonly feedId: string;
  private readonly clock: Clock;
  private readonly rng: () => number;
  private heartbeatMs: number;
  private readonly connectSocketFn: SyncEngineOptions['connectSocket'];
  private readonly fetchSnapshotFn: SyncEngineOptions['fetchSnapshot'];
  private readonly listeners: SyncEngineListeners;

  private state: SyncState = 'idle';
  private socket: SyncSocket | null = null;
  private epoch = '';
  private lastSeq = 0;
  private quotes: Quote[] = [];
  private symbols: SymbolInfo[] = [];
  private readonly pending = new Map<number, Delta>();
  private baselineInstalled = false;
  private replayTargetSeq = 0;

  // Generation trackers for async lifecycle ownership (F06)
  private connectionGeneration = 0;
  private snapshotGeneration = 0;

  // Timers
  private gapTimer: ClockTimer | null = null;
  private droppedTailTimer: ClockTimer | null = null;
  private watchdogTimer: ClockTimer | null = null;
  private reconnectTimer: ClockTimer | null = null;
  private liveStableTimer: ClockTimer | null = null;
  private snapshotRetryTimer: ClockTimer | null = null;
  private snapshotDeadlineTimer: ClockTimer | null = null;

  // Snapshot fetch state
  private snapshotAbortController: AbortController | null = null;
  private snapshotAttempts = 0;

  // Reconnect backoff attempt
  private reconnectAttempts = 0;

  // Metrics
  private readonly metrics: SyncMetrics = {
    deltasIn: 0,
    duplicates: 0,
    gaps: 0,
    resumes: 0,
    replays: 0,
    snapshots: 0,
    reconnects: 0,
    pendingSize: 0,
    lastSeq: 0,
    epoch: '',
    state: 'idle',
    lastEventAt: 0,
  };

  constructor(options: SyncEngineOptions) {
    this.feedId = options.feedId;
    this.clock = options.clock ?? new SystemClock();
    this.rng = options.rng ?? Math.random;
    this.heartbeatMs = options.heartbeatMs ?? 1000;
    this.connectSocketFn = options.connectSocket;
    this.fetchSnapshotFn = options.fetchSnapshot;
    this.listeners = options.listeners ?? {};
    if (options.symbols) {
      this.symbols = options.symbols;
    }
    if (options.quotes) {
      this.quotes = options.quotes.map((q) => ({ ...q }));
      if (this.quotes.length > 0) {
        this.baselineInstalled = true;
      }
    }
  }

  get currentState(): SyncState {
    return this.state;
  }

  get currentEpoch(): string {
    return this.epoch;
  }

  get currentSeq(): number {
    return this.lastSeq;
  }

  get currentQuotes(): readonly Quote[] {
    return this.quotes;
  }

  get currentSymbols(): readonly SymbolInfo[] {
    return this.symbols;
  }

  get currentMetrics(): SyncMetrics {
    this.metrics.state = this.state;
    this.metrics.epoch = this.epoch;
    this.metrics.lastSeq = this.lastSeq;
    this.metrics.pendingSize = this.pending.size;
    return this.metrics;
  }

  start(): void {
    if (this.state !== 'idle' && this.state !== 'offline') {
      return;
    }
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  stop(): void {
    this.connectionGeneration += 1;
    this.snapshotGeneration += 1;
    this.setState('idle');
    this.clearAllTimers();
    if (this.snapshotAbortController) {
      this.snapshotAbortController.abort();
      this.snapshotAbortController = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  cut(): void {
    this.connectionGeneration += 1;
    this.snapshotGeneration += 1;
    this.setState('offline');
    this.clearAllTimers();
    if (this.snapshotAbortController) {
      this.snapshotAbortController.abort();
      this.snapshotAbortController = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  restore(): void {
    if (this.state !== 'offline') return;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  pauseFeed(): void {
    if (this.socket && this.socket.isOpen()) {
      const msg: PauseMessage = { type: 'pause' };
      this.socket.send(encodeClientMessage(msg));
    }
  }

  unpauseFeed(): void {
    if (this.socket && this.socket.isOpen()) {
      const msg: UnpauseMessage = { type: 'unpause' };
      this.socket.send(encodeClientMessage(msg));
    }
  }

  private setState(newState: SyncState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.metrics.state = newState;

    if (newState === 'live') {
      // If we stay live for 10s, reset reconnect backoff attempt counter
      if (!this.liveStableTimer) {
        this.liveStableTimer = this.clock.setTimeout(() => {
          this.reconnectAttempts = 0;
          this.liveStableTimer = null;
        }, 10000);
      }
    } else if (this.liveStableTimer) {
      this.liveStableTimer.cancel();
      this.liveStableTimer = null;
    }

    this.listeners.onStateChange?.(newState);
    this.notifyMetrics();
  }

  private notifyMetrics(): void {
    this.listeners.onMetrics?.(this.currentMetrics);
  }

  private openSocket(): void {
    this.connectionGeneration += 1;
    const gen = this.connectionGeneration;
    this.setState('connecting');
    this.metrics.reconnects += 1;
    this.notifyMetrics();

    this.socket = this.connectSocketFn(
      () => {
        if (this.connectionGeneration === gen) {
          this.onSocketOpen(gen);
        }
      },
      (data) => {
        if (this.connectionGeneration === gen) {
          this.onSocketMessage(data, gen);
        }
      },
      (code) => {
        if (this.connectionGeneration === gen) {
          this.onSocketClose(code, gen);
        }
      },
      (err) => {
        if (this.connectionGeneration === gen) {
          this.onSocketError(err);
        }
      },
    );
  }

  private onSocketOpen(_gen: number): void {
    const resume =
      this.baselineInstalled && this.epoch && this.lastSeq > 0
        ? { epoch: this.epoch, seq: this.lastSeq }
        : undefined;

    const hello: HelloMessage = {
      type: 'hello',
      v: PROTOCOL_VERSION,
      feed: this.feedId,
      resume,
    };

    if (this.socket && this.socket.isOpen()) {
      this.socket.send(encodeClientMessage(hello));
    }

    this.resetWatchdog();
  }

  private onSocketMessage(rawData: string, _gen: number): void {
    const decoded = safeDecodeServerMessage(rawData);
    if (!decoded.success) return;

    const msg = decoded.data;
    this.metrics.lastEventAt = this.clock.now();

    switch (msg.type) {
      case 'welcome':
        this.handleWelcome(msg);
        break;
      case 'deltas':
        this.handleDeltas(msg.items);
        break;
      case 'heartbeat':
        this.handleHeartbeat(msg.headSeq);
        break;
      case 'replay_unavailable':
        this.handleReplayUnavailable(msg.reason, msg.epoch);
        break;
      case 'error':
        this.listeners.onError?.(new Error(`${msg.code}: ${msg.message}`));
        break;
    }
  }

  private handleWelcome(msg: {
    epoch: string;
    mode: 'replay' | 'live' | 'snapshot';
    headSeq: number;
    heartbeatMs?: number;
  }): void {
    if (msg.heartbeatMs && msg.heartbeatMs > 0) {
      this.heartbeatMs = msg.heartbeatMs;
    }
    if (this.epoch && this.epoch !== msg.epoch) {
      // Feed changed epoch -> reset sequence position
      this.lastSeq = 0;
      this.baselineInstalled = false;
      this.pending.clear();
    }
    this.epoch = msg.epoch;
    this.resetWatchdog();

    if (msg.mode === 'snapshot') {
      this.replayTargetSeq = msg.headSeq;
      this.startSnapshotSync();
    } else if (msg.mode === 'replay') {
      this.replayTargetSeq = msg.headSeq;
      this.setState('replaying');
    } else if (msg.mode === 'live') {
      this.lastSeq = msg.headSeq;
      this.replayTargetSeq = msg.headSeq;
      this.baselineInstalled = true;
      this.setState('live');
    }
  }

  private handleDeltas(deltas: Delta[]): void {
    this.resetWatchdog();

    for (const delta of deltas) {
      this.onDelta(delta);
    }
  }

  private onDelta(delta: Delta): void {
    this.metrics.deltasIn += 1;
    const [seq] = delta;

    if (this.droppedTailTimer) {
      this.droppedTailTimer.cancel();
      this.droppedTailTimer = null;
    }

    // While syncing or before a baseline snapshot is installed:
    // Deltas must be buffered in pending, NEVER applied to uninitialized state
    if (this.state === 'syncing' || !this.baselineInstalled) {
      if (this.pending.size >= MAX_PENDING_SIZE) {
        return;
      }
      this.pending.set(seq, delta);
      return;
    }

    if (seq <= this.lastSeq) {
      this.metrics.duplicates += 1;
      return;
    }

    if (seq === this.lastSeq + 1) {
      this.applySingleDelta(delta);
      this.drainPending();
      return;
    }

    // Gap detected: seq > lastSeq + 1
    this.metrics.gaps += 1;

    // Hard memory bound: cap pending map size at MAX_PENDING_SIZE
    if (this.pending.size >= MAX_PENDING_SIZE) {
      if (!this.gapTimer && this.state !== 'replaying') {
        this.requestResume(true);
      }
      return;
    }

    this.pending.set(seq, delta);

    // If gapTimer not running, start 100ms timer
    if (!this.gapTimer) {
      this.gapTimer = this.clock.setTimeout(() => {
        this.gapTimer = null;
        this.requestResume(true);
      }, GAP_TIMEOUT_MS);
    }
  }

  private applySingleDelta(delta: Delta): void {
    const symIdx = delta[1];
    const prevQuote = this.quotes[symIdx];
    if (prevQuote) {
      const updated = applyDelta(prevQuote, delta);
      this.quotes[symIdx] = updated;
      this.listeners.onDeltaApplied?.(delta, updated);
    }

    this.lastSeq = delta[0];
    if (this.state === 'replaying') {
      this.metrics.replays += 1;
      if (this.pending.size === 0 && this.lastSeq >= this.replayTargetSeq) {
        this.setState('live');
      }
    }
  }

  private drainPending(): void {
    while (this.pending.has(this.lastSeq + 1)) {
      const nextDelta = this.pending.get(this.lastSeq + 1)!;
      this.pending.delete(this.lastSeq + 1);
      this.applySingleDelta(nextDelta);
    }

    if (this.pending.size === 0) {
      if (this.gapTimer) {
        this.gapTimer.cancel();
        this.gapTimer = null;
      }
      if (this.state === 'replaying' && this.lastSeq >= this.replayTargetSeq) {
        this.setState('live');
      }
    }
  }

  private handleHeartbeat(headSeq: number): void {
    this.resetWatchdog();

    if (headSeq > this.lastSeq && this.state !== 'syncing') {
      // Server is ahead: if no delta closes gap within 250ms, request resume
      if (!this.droppedTailTimer) {
        this.droppedTailTimer = this.clock.setTimeout(() => {
          this.droppedTailTimer = null;
          this.requestResume(true);
        }, DROPPED_TAIL_TIMEOUT_MS);
      }
    }
  }

  private handleReplayUnavailable(
    reason: 'stale_epoch' | 'expired' | 'future',
    newEpoch: string,
  ): void {
    if (reason === 'stale_epoch' || reason === 'future') {
      this.lastSeq = 0;
      this.epoch = newEpoch;
      this.baselineInstalled = false;
      this.pending.clear();
    }
    this.startSnapshotSync();
  }

  private requestResume(force = false): void {
    if (
      (!force && this.state === 'replaying') ||
      this.state === 'syncing' ||
      this.state === 'offline' ||
      this.state === 'idle'
    ) {
      return;
    }

    if (!this.socket || !this.socket.isOpen()) return;

    this.metrics.resumes += 1;
    this.setState('replaying');

    const resumeMsg: ResumeMessage = {
      type: 'resume',
      epoch: this.epoch,
      seq: this.lastSeq,
    };
    this.socket.send(encodeClientMessage(resumeMsg));
  }

  private startSnapshotSync(): void {
    if (this.state === 'offline' || this.state === 'idle') return;

    this.setState('syncing');
    if (this.gapTimer) {
      this.gapTimer.cancel();
      this.gapTimer = null;
    }
    if (this.droppedTailTimer) {
      this.droppedTailTimer.cancel();
      this.droppedTailTimer = null;
    }
    if (this.snapshotAbortController) {
      this.snapshotAbortController.abort();
    }
    if (this.snapshotDeadlineTimer) {
      this.snapshotDeadlineTimer.cancel();
      this.snapshotDeadlineTimer = null;
    }
    if (this.snapshotRetryTimer) {
      this.snapshotRetryTimer.cancel();
      this.snapshotRetryTimer = null;
    }

    this.snapshotGeneration += 1;
    const sGen = this.snapshotGeneration;
    const ac = new AbortController();
    this.snapshotAbortController = ac;

    // 5-second snapshot deadline (F03)
    this.snapshotDeadlineTimer = this.clock.setTimeout(() => {
      if (this.snapshotGeneration !== sGen) return;
      ac.abort();
      this.handleSnapshotFailure(
        new Error('Snapshot fetch timed out after 5000ms'),
      );
    }, SNAPSHOT_TIMEOUT_MS);

    this.fetchSnapshotFn(this.feedId, ac.signal)
      .then((snapshot) => {
        if (ac.signal.aborted || this.snapshotGeneration !== sGen) return;
        if (this.snapshotDeadlineTimer) {
          this.snapshotDeadlineTimer.cancel();
          this.snapshotDeadlineTimer = null;
        }
        this.onSnapshotFetched(snapshot);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || this.snapshotGeneration !== sGen) return;
        if (this.snapshotDeadlineTimer) {
          this.snapshotDeadlineTimer.cancel();
          this.snapshotDeadlineTimer = null;
        }
        this.handleSnapshotFailure(
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }

  private handleSnapshotFailure(err: Error): void {
    if (this.state === 'offline' || this.state === 'idle') return;

    this.snapshotAttempts += 1;
    if (this.snapshotAttempts >= MAX_SNAPSHOT_RETRIES) {
      this.setState('error');
      this.listeners.onError?.(err);
      return;
    }

    const delay = 500 * this.snapshotAttempts;
    this.snapshotRetryTimer = this.clock.setTimeout(() => {
      this.snapshotRetryTimer = null;
      this.startSnapshotSync();
    }, delay);
  }

  private pruneObsoletePending(): void {
    for (const seq of this.pending.keys()) {
      if (seq <= this.lastSeq) {
        this.pending.delete(seq);
      }
    }
  }

  private handleBehindBuffer(minPendingSeq: number): boolean {
    if (minPendingSeq <= this.lastSeq + 1) return false;

    this.snapshotAttempts += 1;
    if (this.snapshotAttempts >= MAX_SNAPSHOT_RETRIES) {
      this.setState('error');
      this.listeners.onError?.(
        new Error(
          `Snapshot at seq ${this.lastSeq} behind pending buffer at seq ${minPendingSeq}; exceeded retries`,
        ),
      );
      return true;
    }

    this.setState('replaying');
    this.replayTargetSeq = Math.max(this.replayTargetSeq, minPendingSeq - 1);
    if (this.socket && this.socket.isOpen()) {
      this.metrics.resumes += 1;
      this.socket.send(
        encodeClientMessage({
          type: 'resume',
          epoch: this.epoch,
          seq: this.lastSeq,
        }),
      );
    }
    return true;
  }

  private handleDrainPendingWithGap(): boolean {
    if (this.pending.size === 0) return false;

    this.snapshotAttempts += 1;
    if (this.snapshotAttempts >= MAX_SNAPSHOT_RETRIES) {
      this.setState('error');
      this.listeners.onError?.(
        new Error(
          'Gap in pending buffer after snapshot drain; exceeded retries',
        ),
      );
      return true;
    }
    this.setState('replaying');
    this.requestResume(true);
    return true;
  }

  private onSnapshotFetched(snapshot: Snapshot): void {
    if (this.state === 'offline' || this.state === 'idle') return;

    if (snapshot.epoch !== this.epoch) {
      this.epoch = snapshot.epoch;
      this.lastSeq = 0;
      this.baselineInstalled = false;
      this.pending.clear();
      this.socket?.close();
      return;
    }

    this.symbols = snapshot.symbols;
    this.quotes = snapshot.quotes.map((q) => ({ ...q }));
    this.lastSeq = snapshot.seq;
    this.baselineInstalled = true;
    this.metrics.snapshots += 1;
    this.listeners.onSnapshotApplied?.(snapshot);

    this.pruneObsoletePending();

    if (this.pending.size > 0) {
      let minPendingSeq = Number.POSITIVE_INFINITY;
      for (const seq of this.pending.keys()) {
        if (seq < minPendingSeq) {
          minPendingSeq = seq;
        }
      }
      if (this.handleBehindBuffer(minPendingSeq)) {
        return;
      }
    }

    this.drainPending();

    if (this.handleDrainPendingWithGap()) {
      return;
    }

    this.snapshotAttempts = 0;
    if (this.lastSeq >= this.replayTargetSeq) {
      this.setState('live');
    } else {
      this.setState('replaying');
    }
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer) {
      this.watchdogTimer.cancel();
    }
    // 2 x heartbeatMs silence threshold
    this.watchdogTimer = this.clock.setTimeout(() => {
      this.onWatchdogTimeout();
    }, 2 * this.heartbeatMs);
  }

  private onWatchdogTimeout(): void {
    if (this.state === 'offline' || this.state === 'idle') return;

    // Silence threshold exceeded -> treat connection as dead
    if (this.socket) {
      this.socket.close();
    }
  }

  private onSocketClose(_code?: number, _gen?: number): void {
    this.clearAllTimers();
    this.socket = null;

    if (this.state === 'offline' || this.state === 'idle') return;

    // Schedule backoff reconnect
    const delay = computeFullJitterBackoff(this.reconnectAttempts, {
      baseMs: 500,
      maxMs: 15000,
      rng: this.rng,
    });
    this.reconnectAttempts += 1;

    this.setState('connecting');
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.openSocket();
    }, delay);
  }

  private onSocketError(err: unknown): void {
    if (this.state !== 'offline') {
      this.listeners.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private clearAllTimers(): void {
    if (this.gapTimer) {
      this.gapTimer.cancel();
      this.gapTimer = null;
    }
    if (this.droppedTailTimer) {
      this.droppedTailTimer.cancel();
      this.droppedTailTimer = null;
    }
    if (this.watchdogTimer) {
      this.watchdogTimer.cancel();
      this.watchdogTimer = null;
    }
    if (this.reconnectTimer) {
      this.reconnectTimer.cancel();
      this.reconnectTimer = null;
    }
    if (this.liveStableTimer) {
      this.liveStableTimer.cancel();
      this.liveStableTimer = null;
    }
    if (this.snapshotRetryTimer) {
      this.snapshotRetryTimer.cancel();
      this.snapshotRetryTimer = null;
    }
    if (this.snapshotDeadlineTimer) {
      this.snapshotDeadlineTimer.cancel();
      this.snapshotDeadlineTimer = null;
    }
  }
}
