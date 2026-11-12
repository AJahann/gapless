import { randomUUID } from 'node:crypto';
import {
  RingBuffer,
  applyDelta,
  computeDigest,
  createTop100Universe,
  generateSyntheticUniverse,
} from '@gapless/engine';
import type { Delta, Quote, Snapshot, SymbolInfo } from '@gapless/protocol';
import { parseFeedId } from '@gapless/protocol';
import { MarketGenerator } from './generator';

export interface FeedOptions {
  id: string; // format: <universe>@<rate>, e.g. "top100@100"
  replayWindowSec?: number; // default 30
  replayMaxEntries?: number; // default 100000
  seed?: number | string;
}

export type DeltaListener = (deltas: Delta[]) => void;
export type RestartListener = (newEpoch: string) => void;

export class Feed {
  readonly id: string;
  readonly universeName: string;
  readonly rate: number;
  readonly replayCapacity: number;

  private _epoch: string;
  private _headSeq = 0;
  private readonly replayRing: RingBuffer<Delta>;
  private symbols: SymbolInfo[] = [];
  private quotes: Quote[] = [];
  private generator: MarketGenerator;
  private readonly listeners = new Set<DeltaListener>();
  private readonly restartListeners = new Set<RestartListener>();

  constructor(options: FeedOptions) {
    this.id = options.id;
    try {
      const parsed = parseFeedId(options.id);
      this.universeName = parsed.universe;
      this.rate = parsed.rate;
    } catch (_err) {
      const [universeName = 'top100', rateStr = '100'] = options.id.split('@');
      this.universeName = universeName;
      this.rate = Math.max(1, Number.parseInt(rateStr, 10) || 100);
    }

    const windowSec = options.replayWindowSec ?? 30;
    const maxEntries = options.replayMaxEntries ?? 100000;
    this.replayCapacity = Math.min(
      Math.max(100, this.rate * windowSec),
      maxEntries,
    );
    this.replayRing = new RingBuffer<Delta>(this.replayCapacity);

    this._epoch = randomUUID().slice(0, 12);
    this.initUniverse();

    this.generator = new MarketGenerator({
      seed: options.seed,
      symbols: this.symbols,
      quotes: this.quotes,
      rate: this.rate,
      onDeltas: (deltas) => this.onGeneratorDeltas(deltas),
      getSeq: () => this.nextSeq(),
    });
  }

  get epoch(): string {
    return this._epoch;
  }

  get headSeq(): number {
    return this._headSeq;
  }

  get oldestSeq(): number {
    if (this.replayRing.isEmpty) {
      return this._headSeq + 1;
    }
    const oldestDelta = this.replayRing.peekOldest();
    return oldestDelta ? oldestDelta[0] : 1;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  get isPaused(): boolean {
    return this.generator.isPaused;
  }

  get isRunning(): boolean {
    return this.generator.isRunning;
  }

  start(): void {
    this.generator.start();
  }

  stop(): void {
    this.generator.stop();
  }

  pause(): void {
    this.generator.pause();
  }

  unpause(): void {
    this.generator.unpause();
  }

  onRestart(listener: RestartListener): () => void {
    this.restartListeners.add(listener);
    return () => {
      this.restartListeners.delete(listener);
    };
  }

  /**
   * Restarts the feed with a fresh epoch, resetting sequence numbers.
   * Spec: protocol.md and testing.md.
   */
  restart(): string {
    this.generator.stop();
    this._epoch = randomUUID().slice(0, 12);
    this._headSeq = 0;
    this.replayRing.clear();
    this.initUniverse();

    this.generator = new MarketGenerator({
      symbols: this.symbols,
      quotes: this.quotes,
      rate: this.rate,
      onDeltas: (deltas) => this.onGeneratorDeltas(deltas),
      getSeq: () => this.nextSeq(),
    });

    this.generator.start();

    // Signal epoch reset to connected sockets (F05)
    for (const listener of this.restartListeners) {
      listener(this._epoch);
    }

    return this._epoch;
  }

  /**
   * Builds atomic, synchronous snapshot of current feed state.
   * MUST be synchronous to avoid event loop interleaving with generator tick.
   */
  getSnapshot(): Snapshot {
    return {
      feed: this.id,
      epoch: this._epoch,
      seq: this._headSeq,
      symbols: [...this.symbols],
      quotes: this.quotes.map((q) => ({ ...q })),
    };
  }

  getDigest(): { epoch: string; headSeq: number; digest: string } {
    const digest = computeDigest(this.quotes);
    return {
      epoch: this._epoch,
      headSeq: this._headSeq,
      digest,
    };
  }

  subscribe(listener: DeltaListener): () => void {
    this.listeners.add(listener);
    if (!this.generator.isRunning) {
      this.generator.start();
    }
    return () => this.unsubscribe(listener);
  }

  unsubscribe(listener: DeltaListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Fetches replayed deltas for catching up from `afterSeq`.
   */
  getReplay(
    afterSeq: number,
  ):
    | { status: 'ok'; deltas: Delta[] }
    | { status: 'future' | 'expired' | 'empty' } {
    if (afterSeq > this._headSeq) {
      return { status: 'future' };
    }
    if (afterSeq === this._headSeq) {
      return { status: 'empty' };
    }
    if (afterSeq < this.oldestSeq - 1) {
      return { status: 'expired' };
    }

    const deltas: Delta[] = [];
    for (const delta of this.replayRing) {
      if (delta[0] > afterSeq && delta[0] <= this._headSeq) {
        deltas.push(delta);
      }
    }

    return { status: 'ok', deltas };
  }

  private nextSeq(): number {
    this._headSeq += 1;
    return this._headSeq;
  }

  private onGeneratorDeltas(deltas: Delta[]): void {
    for (const delta of deltas) {
      const symIdx = delta[1];
      const prevQuote = this.quotes[symIdx];
      if (prevQuote) {
        this.quotes[symIdx] = applyDelta(prevQuote, delta);
      }
      this.replayRing.push(delta);
    }

    for (const listener of this.listeners) {
      listener(deltas);
    }
  }

  private initUniverse(): void {
    const u =
      this.universeName === 'wide10k'
        ? generateSyntheticUniverse(10000)
        : createTop100Universe();
    this.symbols = u.symbols;
    this.quotes = u.quotes;
  }
}
