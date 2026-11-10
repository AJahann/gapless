import { describe, expect, it } from 'vitest';
import { createPrng, stringToSeed } from './prng';

describe('prng', () => {
  it('produces deterministic sequence given same seed', () => {
    const prng1 = createPrng(42);
    const prng2 = createPrng(42);

    const seq1 = Array.from({ length: 10 }, () => prng1.next());
    const seq2 = Array.from({ length: 10 }, () => prng2.next());

    expect(seq1).toEqual(seq2);
    for (const val of seq1) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('converts strings to numeric seeds deterministically', () => {
    expect(stringToSeed('seed-alpha')).toBe(stringToSeed('seed-alpha'));
    expect(stringToSeed('seed-alpha')).not.toBe(stringToSeed('seed-beta'));
  });

  it('generates integers in range [min, max] inclusive', () => {
    const prng = createPrng('test-int-range');
    for (let i = 0; i < 100; i++) {
      const val = prng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('generates gaussian variables', () => {
    const prng = createPrng('test-gaussian');
    const samples = Array.from({ length: 500 }, () => prng.nextGaussian(0, 1));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.2);
  });
});
