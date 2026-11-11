import {
  RingBuffer,
  SyncEngine,
  type SyncMetrics,
  type SyncSocket,
  type SyncState,
  TopK,
} from '@gapless/engine';
import {
  type ChaosMessage,
  type Delta,
  type Quote,
  type Snapshot,
  type SymbolInfo,
  encodeClientMessage,
} from '@gapless/protocol';

export interface FeedClient {
  start: () => void;
  stop: () => void;
  cut: () => void;
  restore: () => void;
  setChaos: (chaos: Partial<ChaosMessage>) => void;
  pauseFeed: () => void;
  unpauseFeed: () => void;

  getState: () => SyncState;
  getMetrics: () => SyncMetrics;
  getSymbols: () => SymbolInfo[];
  getQuote: (index: number) => Quote | undefined;
  getTrades: (index: number) => Delta[];
  getSparkline: (index: number) => number[];
  getTopGainers: () => {
    symbol: SymbolInfo;
    quote: Quote;
    changePct: number;
  }[];

  subscribeState: (listener: (state: SyncState) => void) => () => void;
  subscribeMetrics: (listener: (metrics: SyncMetrics) => void) => () => void;
  subscribeSymbol: (index: number, listener: () => void) => () => void;
  subscribeAllQuotes: (listener: () => void) => () => void;
  subscribeTopMovers: (listener: () => void) => () => void;
}

export interface FeedClientOptions {
  feedId: string;
  wsBaseUrl?: string;
  httpBaseUrl?: string;
  heartbeatMs?: number;
}

export class MainThreadFeedClient implements FeedClient {
  readonly feedId: string;
  private readonly wsBaseUrl: string;
  private readonly httpBaseUrl: string;
  private readonly heartbeatMs: number;

  private engine: SyncEngine;
  private activeWs: WebSocket | null = null;
  private symbols: SymbolInfo[] = [];

  // Trade tapes per symbol (RingBuffer of last 200 trades)
  private readonly tradeTapes = new Map<number, RingBuffer<Delta>>();
  private readonly tradeArrays = new Map<number, Delta[]>();
  // Sparklines per symbol (RingBuffer of 120 points, sampled at 1Hz)
  private readonly sparklines = new Map<number, RingBuffer<number>>();
  private readonly sparklineArrays = new Map<number, number[]>();
  private sparklineTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly EMPTY_TRADES: Delta[] = [];
  private static readonly EMPTY_SPARKLINE: number[] = [];

  // Render coalescer state
  private readonly dirtySymbols = new Set<number>();
  private rafId: number | null = null;
  private topMoversTimer: ReturnType<typeof setInterval> | null = null;
  private topGainersCache: {
    symbol: SymbolInfo;
    quote: Quote;
    changePct: number;
  }[] = [];

  // Listeners
  private readonly stateListeners = new Set<(state: SyncState) => void>();
  private readonly metricsListeners = new Set<(metrics: SyncMetrics) => void>();
  private readonly symbolListeners = new Map<number, Set<() => void>>();
  private readonly allQuotesListeners = new Set<() => void>();
  private readonly topMoversListeners = new Set<() => void>();

  private metricsSnapshot: SyncMetrics;

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
    this.heartbeatMs = options.heartbeatMs ?? 1000;

    this.engine = this.createEngine();
    this.metricsSnapshot = { ...this.engine.currentMetrics };
  }

  private createEngine(): SyncEngine {
    return new SyncEngine({
      feedId: this.feedId,
      heartbeatMs: this.heartbeatMs,
      connectSocket: (onOpen, onMessage, onClose, onError) => {
        const url = `${this.wsBaseUrl}/ws/feeds/${encodeURIComponent(this.feedId)}`;
        const ws = new WebSocket(url);
        this.activeWs = ws;

        ws.onopen = () => {
          onOpen();
        };
        ws.onmessage = (event) => {
          onMessage(event.data);
        };
        ws.onclose = (event) => {
          this.activeWs = null;
          onClose(event.code);
        };
        ws.onerror = (err) => {
          onError(err);
        };

        return {
          send: (data: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          },
          close: (code?: number, reason?: string) => {
            ws.close(code, reason);
          },
          isOpen: () => ws.readyState === WebSocket.OPEN,
        };
      },
      fetchSnapshot: async (feedId, signal) => {
        const res = await fetch(
          `${this.httpBaseUrl}/api/feeds/${encodeURIComponent(feedId)}/snapshot`,
          { signal },
        );
        if (!res.ok) {
          throw new Error(`Snapshot fetch failed with status ${res.status}`);
        }
        return (await res.json()) as Snapshot;
      },
      listeners: {
        onStateChange: (state) => {
          for (const l of this.stateListeners) l(state);
        },
        onMetrics: (metrics) => {
          this.metricsSnapshot = { ...metrics };
          for (const l of this.metricsListeners) l(this.metricsSnapshot);
        },
        onDeltaApplied: (delta) => {
          this.onDeltaApplied(delta);
        },
        onSnapshotApplied: (snapshot) => {
          this.onSnapshotApplied(snapshot);
        },
      },
    });
  }

  start(): void {
    this.engine.start();
    this.startSparklineSampler();
    this.startTopMoversTimer();
  }

  stop(): void {
    this.stopSparklineSampler();
    this.stopTopMoversTimer();
    this.cancelCoalesce();
    this.engine.stop();
  }

  cut(): void {
    this.engine.cut();
  }

  restore(): void {
    this.engine.restore();
  }

  setChaos(chaos: Partial<ChaosMessage>): void {
    if (this.activeWs && this.activeWs.readyState === WebSocket.OPEN) {
      const msg: ChaosMessage = {
        type: 'chaos',
        ...chaos,
      };
      this.activeWs.send(encodeClientMessage(msg));
    }
  }

  pauseFeed(): void {
    this.engine.pauseFeed();
  }

  unpauseFeed(): void {
    this.engine.unpauseFeed();
  }

  getState(): SyncState {
    return this.engine.currentState;
  }

  getMetrics(): SyncMetrics {
    return this.metricsSnapshot;
  }

  getSymbols(): SymbolInfo[] {
    return this.symbols;
  }

  getQuote(index: number): Quote | undefined {
    return this.engine.currentQuotes[index];
  }

  getTrades(index: number): Delta[] {
    return this.tradeArrays.get(index) ?? MainThreadFeedClient.EMPTY_TRADES;
  }

  getSparkline(index: number): number[] {
    return (
      this.sparklineArrays.get(index) ?? MainThreadFeedClient.EMPTY_SPARKLINE
    );
  }

  getTopGainers(): {
    symbol: SymbolInfo;
    quote: Quote;
    changePct: number;
  }[] {
    return this.topGainersCache;
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

  private onDeltaApplied(delta: Delta): void {
    const symIdx = delta[1];

    // Append to tape ring (bounded 200 items)
    let tape = this.tradeTapes.get(symIdx);
    if (!tape) {
      tape = new RingBuffer<Delta>(200);
      this.tradeTapes.set(symIdx, tape);
    }
    tape.push(delta);
    this.tradeArrays.set(symIdx, tape.toArray());

    // Schedule rAF coalescing for dirty symbols
    this.dirtySymbols.add(symIdx);
    this.scheduleCoalesce();
  }

  private onSnapshotApplied(snapshot: Snapshot): void {
    this.symbols = snapshot.symbols;
    for (let i = 0; i < snapshot.symbols.length; i += 1) {
      this.dirtySymbols.add(i);
    }
    this.recomputeTopMovers();
    this.scheduleCoalesce();
  }

  private scheduleCoalesce(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => this.flushCoalesce());
    } else {
      // Fallback for tests or non-browser environments
      this.rafId = setTimeout(
        () => this.flushCoalesce(),
        16,
      ) as unknown as number;
    }
  }

  private flushCoalesce(): void {
    this.rafId = null;
    if (this.dirtySymbols.size === 0) return;

    for (const symIdx of this.dirtySymbols) {
      const listeners = this.symbolListeners.get(symIdx);
      if (listeners) {
        for (const l of listeners) l();
      }
    }

    for (const l of this.allQuotesListeners) {
      l();
    }

    this.metricsSnapshot = { ...this.engine.currentMetrics };
    for (const l of this.metricsListeners) {
      l(this.metricsSnapshot);
    }

    this.dirtySymbols.clear();
  }

  private cancelCoalesce(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }
    this.dirtySymbols.clear();
  }

  private startSparklineSampler(): void {
    if (this.sparklineTimer) return;
    // 1 Hz cadence: sample latest quote price into 120-item ring
    this.sparklineTimer = setInterval(() => {
      const quotes = this.engine.currentQuotes;
      for (let i = 0; i < quotes.length; i += 1) {
        const q = quotes[i];
        if (!q) continue;

        let ring = this.sparklines.get(i);
        if (!ring) {
          ring = new RingBuffer<number>(120);
          this.sparklines.set(i, ring);
        }
        ring.push(q.price / 1000000); // USD float for sparklines
        this.sparklineArrays.set(i, ring.toArray());
      }
    }, 1000);
  }

  private stopSparklineSampler(): void {
    if (this.sparklineTimer) {
      clearInterval(this.sparklineTimer);
      this.sparklineTimer = null;
    }
  }

  private startTopMoversTimer(): void {
    if (this.topMoversTimer) return;
    // 500 ms cadence: recompute top gainers min-heap
    this.topMoversTimer = setInterval(() => {
      this.recomputeTopMovers();
    }, 500);
  }

  private stopTopMoversTimer(): void {
    if (this.topMoversTimer) {
      clearInterval(this.topMoversTimer);
      this.topMoversTimer = null;
    }
  }

  private recomputeTopMovers(): void {
    const quotes = this.engine.currentQuotes;
    const symbols = this.getSymbols();
    if (quotes.length === 0 || symbols.length === 0) return;

    interface MoverItem {
      symbol: SymbolInfo;
      quote: Quote;
      changePct: number;
    }

    const topHeap = new TopK<MoverItem>(5, (a, b) => a.changePct - b.changePct);

    for (let i = 0; i < quotes.length; i += 1) {
      const q = quotes[i]!;
      const sym = symbols[i];
      if (!sym || q.open === 0) continue;

      const changePct = ((q.price - q.open) / q.open) * 100;
      topHeap.push({ symbol: sym, quote: q, changePct });
    }

    this.topGainersCache = topHeap.getSorted();
    for (const l of this.topMoversListeners) {
      l();
    }
  }
}
