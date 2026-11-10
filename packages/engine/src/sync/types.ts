import type { Delta, Quote, Snapshot, SymbolInfo } from '@gapless/protocol';

export type SyncState =
  | 'idle'
  | 'connecting'
  | 'syncing'
  | 'live'
  | 'replaying'
  | 'offline'
  | 'error';

export interface SyncMetrics {
  deltasIn: number;
  duplicates: number;
  gaps: number;
  resumes: number;
  replays: number;
  snapshots: number;
  reconnects: number;
  pendingSize: number;
  lastSeq: number;
  epoch: string;
  state: SyncState;
  lastEventAt: number;
}

export interface ClockTimer {
  cancel: () => void;
}

export interface Clock {
  now: () => number;
  setTimeout: (cb: () => void, ms: number) => ClockTimer;
}

export interface SyncSocket {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  isOpen: () => boolean;
}

export interface SnapshotFetcher {
  fetchSnapshot: (feedId: string, signal?: AbortSignal) => Promise<Snapshot>;
}

export interface SyncEngineListeners {
  onStateChange?: (state: SyncState) => void;
  onDeltaApplied?: (delta: Delta, quote: Quote) => void;
  onSnapshotApplied?: (snapshot: Snapshot) => void;
  onMetrics?: (metrics: SyncMetrics) => void;
  onError?: (error: Error) => void;
}

export interface SyncEngineOptions {
  feedId: string;
  clock?: Clock;
  rng?: () => number;
  heartbeatMs?: number;
  connectSocket: (
    onOpen: () => void,
    onMessage: (data: string) => void,
    onClose: (code?: number) => void,
    onError: (err: unknown) => void,
  ) => SyncSocket;
  fetchSnapshot: (feedId: string, signal?: AbortSignal) => Promise<Snapshot>;
  listeners?: SyncEngineListeners;
  symbols?: SymbolInfo[];
  quotes?: Quote[];
}
