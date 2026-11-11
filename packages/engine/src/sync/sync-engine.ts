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

export class SyncEngine {
  readonly feedId: string;
  private readonly clock: Clock;
  private readonly rng: () => number;
  private readonly heartbeatMs: number;
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

  // Timers
  private gapTimer: ClockTimer | null = null;
  private droppedTailTimer: ClockTimer | null = null;
  private watchdogTimer: ClockTimer | null = null;
  private reconnectTimer: ClockTimer | null = null;
  private liveStableTimer: ClockTimer | null = null;

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
    this.setState('idle');
    this.clearAllTimers();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  cut(): void {
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
    this.setState('connecting');
    this.metrics.reconnects += 1;
    this.notifyMetrics();

    this.socket = this.connectSocketFn(
      () => this.onSocketOpen(),
      (data) => this.onSocketMessage(data),
      (code) => this.onSocketClose(code),
      (err) => this.onSocketError(err),
    );
  }

  private onSocketOpen(): void {
    const resume =
      this.epoch && this.lastSeq > 0
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

  private onSocketMessage(rawData: string): void {
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
  }): void {
    if (this.epoch && this.epoch !== msg.epoch) {
      // Feed changed epoch -> reset sequence position
      this.lastSeq = 0;
      this.pending.clear();
    }
    this.epoch = msg.epoch;
    this.resetWatchdog();

    if (msg.mode === 'snapshot') {
      this.startSnapshotSync();
    } else if (msg.mode === 'replay') {
      this.setState('replaying');
    } else if (msg.mode === 'live') {
      this.lastSeq = msg.headSeq;
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
    const [seq, symbolIndex] = delta;

    if (this.droppedTailTimer) {
      this.droppedTailTimer.cancel();
      this.droppedTailTimer = null;
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
    this.pending.set(seq, delta);

    // If gapAge timer not running, start 100ms timer
    if (!this.gapTimer) {
      this.gapTimer = this.clock.setTimeout(() => {
        this.gapTimer = null;
        this.requestResume(true);
      }, GAP_TIMEOUT_MS);
    }

    if (this.pending.size > MAX_PENDING_SIZE) {
      this.requestResume(true);
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
      if (this.state === 'replaying') {
        this.setState('live');
      }
    }
  }

  private handleHeartbeat(headSeq: number): void {
    this.resetWatchdog();

    if (headSeq > this.lastSeq) {
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
    if (this.state === 'offline') return;

    this.setState('syncing');
    if (this.snapshotAbortController) {
      this.snapshotAbortController.abort();
    }
    const ac = new AbortController();
    this.snapshotAbortController = ac;

    this.fetchSnapshotFn(this.feedId, ac.signal)
      .then((snapshot) => {
        if (ac.signal.aborted) return;
        this.onSnapshotFetched(snapshot);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        this.snapshotAttempts += 1;
        if (this.snapshotAttempts >= MAX_SNAPSHOT_RETRIES) {
          this.setState('error');
          this.listeners.onError?.(
            err instanceof Error ? err : new Error(String(err)),
          );
        } else {
          this.clock.setTimeout(
            () => this.startSnapshotSync(),
            500 * this.snapshotAttempts,
          );
        }
      });
  }

  private onSnapshotFetched(snapshot: Snapshot): void {
    if (snapshot.epoch !== this.epoch) {
      // Feed epoch changed mid-sync: restart connection handshake
      this.epoch = snapshot.epoch;
      this.lastSeq = 0;
      this.pending.clear();
      this.socket?.close();
      return;
    }

    this.snapshotAttempts = 0;
    this.symbols = snapshot.symbols;
    this.quotes = snapshot.quotes.map((q) => ({ ...q }));
    this.lastSeq = snapshot.seq;
    this.metrics.snapshots += 1;
    this.listeners.onSnapshotApplied?.(snapshot);

    // Drop pending deltas <= snapshot.seq
    for (const seq of this.pending.keys()) {
      if (seq <= this.lastSeq) {
        this.pending.delete(seq);
      }
    }

    // Check contiguity with pending buffer
    if (this.pending.size > 0) {
      let minPendingSeq = Number.POSITIVE_INFINITY;
      for (const seq of this.pending.keys()) {
        if (seq < minPendingSeq) {
          minPendingSeq = seq;
        }
      }

      if (minPendingSeq > this.lastSeq + 1) {
        // Snapshot is too old for buffered deltas
        this.snapshotAttempts += 1;
        if (this.snapshotAttempts < MAX_SNAPSHOT_RETRIES) {
          this.requestResume();
          return;
        }
        this.setState('error');
        return;
      }
    }

    this.drainPending();
    if (this.pending.size === 0) {
      this.setState('live');
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

  private onSocketClose(_code?: number): void {
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
  }
}
