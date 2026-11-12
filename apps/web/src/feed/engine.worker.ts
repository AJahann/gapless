import {
  RingBuffer,
  SyncEngine,
  type SyncMetrics,
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
  safeDecodeSnapshot,
} from '@gapless/protocol';

export type MainToWorkerMessage =
  | {
      type: 'init';
      feedId: string;
      wsBaseUrl?: string;
      httpBaseUrl?: string;
      heartbeatMs?: number;
    }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'cut' }
  | { type: 'restore' }
  | { type: 'setChaos'; chaos: Partial<ChaosMessage> }
  | { type: 'pauseFeed' }
  | { type: 'unpauseFeed' };

export interface WorkerPatchMessage {
  type: 'patch';
  state: SyncState;
  metrics: SyncMetrics;
  symbols?: SymbolInfo[];
  dirtyQuotes: [number, Quote][];
  topGainers: { symbol: SymbolInfo; quote: Quote; changePct: number }[];
  trades?: [number, Delta[]][];
  sparklines?: [number, number[]][];
}

let engine: SyncEngine | null = null;
let activeWs: WebSocket | null = null;
let symbols: SymbolInfo[] = [];
let currentEpoch = '';

const tradeTapes = new Map<number, RingBuffer<Delta>>();
const dirtyTrades = new Set<number>();

const sparklines = new Map<number, RingBuffer<number>>();
const dirtySparklines = new Set<number>();
let sparklineTimer: ReturnType<typeof setInterval> | null = null;

const dirtyQuotes = new Map<number, Quote>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let topMoversTimer: ReturnType<typeof setInterval> | null = null;
let topGainersCache: {
  symbol: SymbolInfo;
  quote: Quote;
  changePct: number;
}[] = [];
let symbolsUpdated = false;

function recomputeTopMovers(): void {
  if (!engine) return;
  const quotes = engine.currentQuotes;
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

  topGainersCache = topHeap.getSorted();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  // Flush coalesced updates to main thread at <= 60Hz (~16ms)
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!engine) return;

    const quotesList: [number, Quote][] = [];
    for (const [idx, q] of dirtyQuotes.entries()) {
      quotesList.push([idx, q]);
    }
    dirtyQuotes.clear();

    let tradesList: [number, Delta[]][] | undefined;
    if (dirtyTrades.size > 0) {
      tradesList = [];
      for (const idx of dirtyTrades) {
        const ring = tradeTapes.get(idx);
        if (ring) {
          tradesList.push([idx, ring.toArray()]);
        }
      }
      dirtyTrades.clear();
    }

    let sparklinesList: [number, number[]][] | undefined;
    if (dirtySparklines.size > 0) {
      sparklinesList = [];
      for (const idx of dirtySparklines) {
        const ring = sparklines.get(idx);
        if (ring) {
          sparklinesList.push([idx, ring.toArray()]);
        }
      }
      dirtySparklines.clear();
    }

    const patch: WorkerPatchMessage = {
      type: 'patch',
      state: engine.currentState,
      metrics: { ...engine.currentMetrics },
      symbols: symbolsUpdated ? symbols : undefined,
      dirtyQuotes: quotesList,
      topGainers: topGainersCache,
      trades: tradesList,
      sparklines: sparklinesList,
    };
    symbolsUpdated = false;

    postMessage(patch);
  }, 16);
}

function initEngine(msg: Extract<MainToWorkerMessage, { type: 'init' }>): void {
  const wsBaseUrl = msg.wsBaseUrl ?? 'ws://127.0.0.1:4000';
  const httpBaseUrl = msg.httpBaseUrl ?? 'http://127.0.0.1:4000';
  const heartbeatMs = msg.heartbeatMs ?? 1000;

  engine = new SyncEngine({
    feedId: msg.feedId,
    heartbeatMs,
    connectSocket: (onOpen, onMessage, onClose, onError) => {
      const url = `${wsBaseUrl}/ws/feeds/${encodeURIComponent(msg.feedId)}`;
      const ws = new WebSocket(url);
      activeWs = ws;

      ws.onopen = () => onOpen();
      ws.onmessage = (event) => onMessage(event.data);
      ws.onclose = (event) => {
        if (activeWs === ws) {
          activeWs = null;
        }
        onClose(event.code);
      };
      ws.onerror = (err) => onError(err);

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
        `${httpBaseUrl}/api/feeds/${encodeURIComponent(feedId)}/snapshot`,
        { signal },
      );
      if (!res.ok) {
        throw new Error(`Snapshot fetch failed with status ${res.status}`);
      }
      const json = await res.json();
      const decoded = safeDecodeSnapshot(json);
      if (!decoded.success) {
        throw new Error(
          `Snapshot semantic validation failed: ${decoded.error.message}`,
        );
      }
      return decoded.data;
    },
    listeners: {
      onStateChange: () => {
        scheduleFlush();
      },
      onMetrics: () => {
        scheduleFlush();
      },
      onDeltaApplied: (delta, quote) => {
        const symIdx = delta[1];
        let tape = tradeTapes.get(symIdx);
        if (!tape) {
          tape = new RingBuffer<Delta>(200);
          tradeTapes.set(symIdx, tape);
        }
        tape.push(delta);
        dirtyTrades.add(symIdx);

        dirtyQuotes.set(symIdx, quote);
        scheduleFlush();
      },
      onSnapshotApplied: (snapshot) => {
        if (currentEpoch && currentEpoch !== snapshot.epoch) {
          tradeTapes.clear();
          dirtyTrades.clear();
          sparklines.clear();
          dirtySparklines.clear();
          dirtyQuotes.clear();
        }
        currentEpoch = snapshot.epoch;

        const { symbols: snapSymbols, quotes: snapQuotes } = snapshot;
        symbols = snapSymbols;
        symbolsUpdated = true;
        for (let i = 0; i < snapSymbols.length; i += 1) {
          const q = snapQuotes[i];
          if (q) {
            dirtyQuotes.set(i, q);
          }
        }
        recomputeTopMovers();
        scheduleFlush();
      },
    },
  });

  // Timers are managed by startEngine/stopEngine for restartability
}

function startEngine(): void {
  engine?.start();

  if (!topMoversTimer) {
    topMoversTimer = setInterval(() => {
      recomputeTopMovers();
      scheduleFlush();
    }, 500);
  }

  if (!sparklineTimer) {
    sparklineTimer = setInterval(() => {
      if (!engine) return;
      const quotes = engine.currentQuotes;
      for (let i = 0; i < quotes.length; i += 1) {
        const q = quotes[i];
        if (!q) continue;

        let ring = sparklines.get(i);
        if (!ring) {
          ring = new RingBuffer<number>(120);
          sparklines.set(i, ring);
        }
        ring.push(q.price / 1000000);
        dirtySparklines.add(i);
      }
      scheduleFlush();
    }, 1000);
  }
}

function stopEngine(): void {
  engine?.stop();
  if (sparklineTimer) {
    clearInterval(sparklineTimer);
    sparklineTimer = null;
  }
  if (topMoversTimer) {
    clearInterval(topMoversTimer);
    topMoversTimer = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

const COMMAND_MAP: Record<string, () => void> = {
  start: () => startEngine(),
  stop: () => stopEngine(),
  cut: () => engine?.cut(),
  restore: () => engine?.restore(),
  pauseFeed: () => engine?.pauseFeed(),
  unpauseFeed: () => engine?.unpauseFeed(),
};

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    initEngine(msg);
  } else if (msg.type === 'setChaos') {
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      const chaosMsg: ChaosMessage = {
        type: 'chaos',
        ...msg.chaos,
      };
      activeWs.send(encodeClientMessage(chaosMsg));
    }
  } else {
    COMMAND_MAP[msg.type]?.();
  }
};
