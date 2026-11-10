import { createPrng, type Prng } from '@gapless/engine';
import type { Delta, Quote, SymbolInfo } from '@gapless/protocol';

export interface MarketGeneratorOptions {
  seed?: number | string;
  symbols: SymbolInfo[];
  quotes: Quote[];
  rate: number; // target deltas per second
  tickMs?: number; // default 20ms
  onDeltas: (deltas: Delta[]) => void;
  getSeq: () => number; // sequentially assigned seq generator
}

export class MarketGenerator {
  private readonly prng: Prng;
  private readonly symbols: SymbolInfo[];
  private readonly quotes: Quote[];
  private readonly rate: number;
  private readonly tickMs: number;
  private readonly onDeltas: (deltas: Delta[]) => void;
  private readonly getSeq: () => number;

  private readonly zipfCdf: Float64Array;
  private timer: NodeJS.Timeout | null = null;
  private accumulator = 0;
  private paused = false;

  constructor(options: MarketGeneratorOptions) {
    this.prng = createPrng(options.seed ?? 1337);
    this.symbols = options.symbols;
    this.quotes = options.quotes;
    this.rate = options.rate;
    this.tickMs = options.tickMs ?? 20;
    this.onDeltas = options.onDeltas;
    this.getSeq = options.getSeq;

    this.zipfCdf = this.buildZipfCdf(this.symbols.length, 0.8);
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    if (this.timer) return;
    this.accumulator = 0;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  unpause(): void {
    this.paused = false;
  }

  tick(): Delta[] {
    if (this.paused) return [];

    // Fractional accumulation: meet target rate on average
    this.accumulator += (this.rate * this.tickMs) / 1000;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    if (count <= 0) return [];

    const now = Date.now();
    const deltas: Delta[] = [];

    for (let i = 0; i < count; i += 1) {
      const symIdx = this.sampleZipfIndex();
      const currentQuote = this.quotes[symIdx];
      if (!currentQuote) continue;

      const delta = this.generateDelta(symIdx, currentQuote, now);
      deltas.push(delta);
    }

    if (deltas.length > 0) {
      this.onDeltas(deltas);
    }

    return deltas;
  }

  private sampleZipfIndex(): number {
    const u = this.prng.next();
    let low = 0;
    let high = this.zipfCdf.length - 1;

    while (low < high) {
      const mid = (low + high) >> 1;
      if (u <= this.zipfCdf[mid]!) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return low;
  }

  private generateDelta(symbolIndex: number, quote: Quote, now: number): Delta {
    // GBM-like random step in price (fixed point scale 1e6)
    // Small percentage change with mean 0, stdDev ~ 0.001 (0.1%)
    const pctChange = this.prng.nextGaussian(0, 0.001);
    const newPrice = Math.max(1, Math.round(quote.price * (1 + pctChange)));

    // Trade size: scale 1e4 (e.g. 0.01 to 5 tokens)
    const rawTokens = Math.exp(
      this.prng.nextFloat(Math.log(0.01), Math.log(5.0)),
    );
    const size = Math.max(1, Math.round(rawTokens * 10000));

    // Side: 0 = buy (price >= prev), 1 = sell (price < prev)
    const side = newPrice >= quote.price ? 0 : 1;

    // Never assign seq without emitting the delta
    const seq = this.getSeq();

    return [seq, symbolIndex, newPrice, size, side, now];
  }

  private buildZipfCdf(n: number, s: number): Float64Array {
    const cdf = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const rank = i + 1;
      sum += 1 / rank ** s;
    }

    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      const rank = i + 1;
      acc += 1 / rank ** s / sum;
      cdf[i] = acc;
    }
    // Guarantee last element is 1.0
    if (n > 0) {
      cdf[n - 1] = 1.0;
    }

    return cdf;
  }
}
