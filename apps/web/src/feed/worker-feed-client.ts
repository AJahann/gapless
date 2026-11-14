import {
  type SyncMetrics,
  type SyncState,
  computeDigest,
} from '@gapless/engine';
import type { ChaosMessage, Delta, Quote, SymbolInfo } from '@gapless/protocol';
import type { WorkerPatchMessage } from './engine.worker';
import {
  type FeedClient,
  type FeedClientOptions,
  type FeedPerformanceMetrics,
  LatencyTracker,
} from './feed-client';

export class WorkerFeedClient implements FeedClient {
  readonly feedId: string;
  private worker: Worker | null = null;
  private readonly wsBaseUrl?: string;
  private readonly httpBaseUrl?: string;
  private readonly heartbeatMs?: number;

  private state: SyncState = 'idle';
  private metrics: SyncMetrics = {
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

  private symbols: SymbolInfo[] = [];
  private quotes: (Quote | undefined)[] = [];
  private topGainers: {
    symbol: SymbolInfo;
    quote: Quote;
    changePct: number;
  }[] = [];
  private tradeArrays = new Map<number, Delta[]>();
  private sparklineArrays = new Map<number, number[]>();

  private static readonly EMPTY_TRADES: Delta[] = [];
  private static readonly EMPTY_SPARKLINE: number[] = [];

  // Performance instrumentation
  private readonly latencyTracker = new LatencyTracker();
  private renderedFrames = 0;

  // Listeners
  private readonly stateListeners = new Set<(state: SyncState) => void>();
  private readonly metricsListeners = new Set<(metrics: SyncMetrics) => void>();
  private readonly symbolListeners = new Map<number, Set<() => void>>();
  private readonly allQuotesListeners = new Set<() => void>();
  private readonly topMoversListeners = new Set<() => void>();

  constructor(options: FeedClientOptions) {
    this.feedId = options.feedId;
    const isBrowser = typeof window !== 'undefined';
    const isLocalDevPort = isBrowser && window.location.port === '3000';
    const wsProto =
      isBrowser && window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    this.wsBaseUrl =
      options.wsBaseUrl ??
      (isBrowser
        ? isLocalDevPort
          ? `ws://${window.location.hostname}:4000`
          : `${wsProto}//${window.location.host}`
        : 'ws://127.0.0.1:4000');
    this.httpBaseUrl =
      options.httpBaseUrl ??
      (isBrowser
        ? isLocalDevPort
          ? `http://${window.location.hostname}:4000`
          : window.location.origin
        : 'http://127.0.0.1:4000');
    this.heartbeatMs = options.heartbeatMs;
  }

  private initWorker(): void {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (event: MessageEvent<WorkerPatchMessage>) => {
      this.handleWorkerPatch(event.data);
    };

    this.worker.postMessage({
      type: 'init',
      feedId: this.feedId,
      wsBaseUrl: this.wsBaseUrl,
      httpBaseUrl: this.httpBaseUrl,
      heartbeatMs: this.heartbeatMs,
    });
  }

  private handleWorkerPatch(patch: WorkerPatchMessage): void {
    this.renderedFrames += 1;
    const recvAt = patch.receivedAt;
    if (recvAt !== undefined && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const paintProxy =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.latencyTracker.record(paintProxy - recvAt);
      });
    }

    if (patch.state !== this.state) {
      this.state = patch.state;
      for (const l of this.stateListeners) l(this.state);
    }
    this.metrics = patch.metrics;
    for (const l of this.metricsListeners) l(this.metrics);

    if (patch.symbols) {
      this.symbols = patch.symbols;
    }
    if (patch.topGainers) {
      this.topGainers = patch.topGainers;
      for (const l of this.topMoversListeners) l();
    }

    this.applyBuffers(patch);
    this.applyQuotes(patch.dirtyQuotes);
  }

  private applyBuffers(patch: WorkerPatchMessage): void {
    if (patch.trades) {
      for (const [idx, t] of patch.trades) {
        this.tradeArrays.set(idx, t);
      }
    }
    if (patch.sparklines) {
      for (const [idx, s] of patch.sparklines) {
        this.sparklineArrays.set(idx, s);
        const listeners = this.symbolListeners.get(idx);
        if (listeners) {
          for (const l of listeners) l();
        }
      }
    }
  }

  private applyQuotes(dirtyQuotes: [number, Quote][]): void {
    if (dirtyQuotes.length === 0) return;
    for (const [idx, q] of dirtyQuotes) {
      this.quotes[idx] = q;
      const listeners = this.symbolListeners.get(idx);
      if (listeners) {
        for (const l of listeners) l();
      }
    }
    for (const l of this.allQuotesListeners) l();
  }

  start(): void {
    if (typeof window === 'undefined') return;
    if (!this.worker) {
      this.initWorker();
    }
    this.worker?.postMessage({ type: 'start' });
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      this.worker.terminate();
      this.worker = null;
    }
  }

  cut(): void {
    this.worker?.postMessage({ type: 'cut' });
  }

  restore(): void {
    this.worker?.postMessage({ type: 'restore' });
  }

  setChaos(chaos: Partial<ChaosMessage>): void {
    this.worker?.postMessage({ type: 'setChaos', chaos });
  }

  pauseFeed(): void {
    this.worker?.postMessage({ type: 'pauseFeed' });
  }

  unpauseFeed(): void {
    this.worker?.postMessage({ type: 'unpauseFeed' });
  }

  getState(): SyncState {
    return this.state;
  }

  getMetrics(): SyncMetrics {
    return this.metrics;
  }

  getSymbols(): SymbolInfo[] {
    return this.symbols;
  }

  getQuote(index: number): Quote | undefined {
    return this.quotes[index];
  }

  getTrades(index: number): Delta[] {
    return this.tradeArrays.get(index) ?? WorkerFeedClient.EMPTY_TRADES;
  }

  getSparkline(index: number): number[] {
    return this.sparklineArrays.get(index) ?? WorkerFeedClient.EMPTY_SPARKLINE;
  }

  getTopGainers(): {
    symbol: SymbolInfo;
    quote: Quote;
    changePct: number;
  }[] {
    return this.topGainers;
  }

  getDigest(): string {
    const validQuotes = this.quotes.filter((q): q is Quote => q !== undefined);
    return computeDigest(validQuotes);
  }

  getPerformanceMetrics(): FeedPerformanceMetrics {
    return {
      renderedFrames: this.renderedFrames,
      p95RecvToPaintMs: this.latencyTracker.getP95(),
      sampleCount: this.latencyTracker.count,
    };
  }

  subscribeState(listener: (state: SyncState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeMetrics(listener: (metrics: SyncMetrics) => void): () => void {
    this.metricsListeners.add(listener);
    return () => this.metricsListeners.delete(listener);
  }

  subscribeSymbol(index: number, listener: () => void): () => void {
    let set = this.symbolListeners.get(index);
    if (!set) {
      set = new Set();
      this.symbolListeners.set(index, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        this.symbolListeners.delete(index);
      }
    };
  }

  subscribeAllQuotes(listener: () => void): () => void {
    this.allQuotesListeners.add(listener);
    return () => this.allQuotesListeners.delete(listener);
  }

  subscribeTopMovers(listener: () => void): () => void {
    this.topMoversListeners.add(listener);
    return () => this.topMoversListeners.delete(listener);
  }
}
