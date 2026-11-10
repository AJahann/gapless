import { describe, expect, it } from 'vitest';
import { createPrng } from './prng';
import { TopK } from './top-k';

describe('TopK min-heap', () => {
  it('initializes empty with given capacity', () => {
    const top = new TopK<number>(5, (a, b) => a - b);
    expect(top.capacity).toBe(5);
    expect(top.size).toBe(0);
    expect(top.isEmpty).toBe(true);
    expect(top.getSorted()).toEqual([]);
  });

  it('rejects invalid capacity', () => {
    expect(() => new TopK<number>(0, (a, b) => a - b)).toThrow(
      /positive integer/i,
    );
    expect(() => new TopK<number>(-3, (a, b) => a - b)).toThrow(
      /positive integer/i,
    );
  });

  it('selects top-k for deterministic small array', () => {
    const top = new TopK<number>(3, (a, b) => a - b);
    top.pushMany([5, 1, 9, 3, 7, 2, 8]);
    expect(top.getSorted()).toEqual([9, 8, 7]);
  });

  it('maintains exact equivalence with full sort for random inputs', () => {
    const prng = createPrng(12345);
    const K = 10;
    const top = new TopK<number>(K, (a, b) => a - b);

    // Test across 20 trials with randomized lengths up to 1000
    for (let trial = 0; trial < 20; trial++) {
      top.clear();
      const n = prng.nextInt(50, 1000);
      const items: number[] = [];
      for (let i = 0; i < n; i++) {
        items.push(prng.nextInt(-10000, 10000));
      }

      top.pushMany(items);

      const expected = [...items].sort((a, b) => b - a).slice(0, K);
      expect(top.getSorted()).toEqual(expected);
    }
  });

  it('works when input size is smaller than K', () => {
    const top = new TopK<number>(5, (a, b) => a - b);
    top.pushMany([10, 40, 20]);
    expect(top.getSorted()).toEqual([40, 20, 10]);
  });

  it('handles custom object comparator (top price change)', () => {
    interface Mover {
      symbol: string;
      changePct: number;
    }
    const top = new TopK<Mover>(3, (a, b) => a.changePct - b.changePct);
    top.pushMany([
      { symbol: 'A', changePct: 1.2 },
      { symbol: 'B', changePct: 5.4 },
      { symbol: 'C', changePct: -2.1 },
      { symbol: 'D', changePct: 8.9 },
      { symbol: 'E', changePct: 3.3 },
    ]);

    expect(top.getSorted().map((m) => m.symbol)).toEqual(['D', 'B', 'E']);
  });
});
