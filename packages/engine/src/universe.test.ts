import type { Delta } from '@gapless/protocol';
import { describe, expect, it } from 'vitest';
import {
  TOP100_SYMBOLS,
  applyDelta,
  computeDigest,
  createInitialQuote,
  createTop100Universe,
  generateSyntheticUniverse,
} from './universe';

describe('universe and reducer', () => {
  it('provides 100 symbols in TOP100 fixture', () => {
    expect(TOP100_SYMBOLS).toHaveLength(100);
    expect(TOP100_SYMBOLS[0]?.symbol).toBe('BTC');
    expect(TOP100_SYMBOLS[0]?.index).toBe(0);
    expect(TOP100_SYMBOLS[99]?.index).toBe(99);
  });

  it('creates top100 universe with matching quotes', () => {
    const { symbols, quotes } = createTop100Universe();
    expect(symbols).toHaveLength(100);
    expect(quotes).toHaveLength(100);
    expect(quotes[0]?.price).toBe(67450000000);
    expect(quotes[0]?.open).toBe(67450000000);
    expect(quotes[0]?.volume).toBe('0');
    expect(quotes[0]?.trades).toBe(0);
  });

  it('generates synthetic 10k universe deterministically', () => {
    const u1 = generateSyntheticUniverse(1000, 999);
    const u2 = generateSyntheticUniverse(1000, 999);
    expect(u1.symbols).toHaveLength(1000);
    expect(u1.quotes).toHaveLength(1000);
    expect(u1.symbols[500]?.symbol).toBe('SYM00500');
    expect(u1.quotes[500]?.price).toBe(u2.quotes[500]?.price);
  });

  it('applies delta immutably with proper high, low, volume, trades update', () => {
    const quote = createInitialQuote(100.0); // 100_000_000
    const delta1: Delta = [1, 0, 105_000_000, 20_000, 0, 1710000000000]; // price 105, size 2.0
    const q1 = applyDelta(quote, delta1);

    expect(q1).not.toBe(quote);
    expect(q1.price).toBe(105_000_000);
    expect(q1.open).toBe(100_000_000);
    expect(q1.high).toBe(105_000_000);
    expect(q1.low).toBe(100_000_000);
    expect(q1.volume).toBe((105_000_000n * 20_000n).toString());
    expect(q1.trades).toBe(1);
    expect(q1.lastSeq).toBe(1);
    expect(q1.lastTs).toBe(1710000000000);

    // Second delta with lower price
    const delta2: Delta = [2, 0, 95_000_000, 10_000, 1, 1710000001000];
    const q2 = applyDelta(q1, delta2);

    expect(q2.price).toBe(95_000_000);
    expect(q2.open).toBe(100_000_000);
    expect(q2.high).toBe(105_000_000);
    expect(q2.low).toBe(95_000_000);
    expect(q2.volume).toBe(
      (105_000_000n * 20_000n + 95_000_000n * 10_000n).toString(),
    );
    expect(q2.trades).toBe(2);
    expect(q2.lastSeq).toBe(2);
  });

  it('F08: accumulates volume losslessly without IEEE-754 precision rounding', () => {
    const quote = createInitialQuote(67450.0);
    const delta: Delta = [1, 0, 67450000001, 49999, 0, 1710000000000];
    const q1 = applyDelta(quote, delta);
    const q2 = applyDelta(q1, [2, 0, 67450000001, 49999, 0, 1710000001000]);
    const q3 = applyDelta(q2, [3, 0, 67450000001, 49999, 0, 1710000002000]);

    // In JS float: 67450000001 * 49999 * 3 = 10117297650149996 (loss of 1)
    // Lossless BigInt string: 10117297650149997
    expect(q3.volume).toBe('10117297650149997');
  });

  it('computes canonical digest deterministically', () => {
    const { quotes } = createTop100Universe();
    const d1 = computeDigest(quotes);
    const d2 = computeDigest(quotes);
    expect(d1).toBe(d2);
    expect(d1).toBeTypeOf('string');
    expect(d1).toHaveLength(16);

    // Mutating any quote changes the digest
    const modified = [...quotes];
    modified[0] = { ...modified[0]!, price: modified[0]!.price + 1 };
    const d3 = computeDigest(modified);
    expect(d3).not.toBe(d1);
  });
});
