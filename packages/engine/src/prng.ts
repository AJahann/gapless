/**
 * Deterministic seeded 32-bit PRNG (SplitMix32).
 * Used by server market generator and chaos simulator for reproducibility.
 * Spec: docs/ROADMAP.md Phase 1.
 */

export interface Prng {
  /** Return a pseudo-random float in [0, 1). */
  next: () => number;
  /** Return an integer in [min, max] inclusive. */
  nextInt: (min: number, max: number) => number;
  /** Return a float in [min, max). */
  nextFloat: (min: number, max: number) => number;
  /** Return a standard normal variable (Box-Muller). */
  nextGaussian: (mean?: number, stdDev?: number) => number;
}

export function stringToSeed(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createPrng(seed: number | string = 1337): Prng {
  let s = (typeof seed === 'string' ? stringToSeed(seed) : seed) >>> 0;

  // SplitMix32 step
  function nextUint32(): number {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = z ^ (z >>> 15);
    return z >>> 0;
  }

  let hasSpareGaussian = false;
  let spareGaussian = 0;

  return {
    next(): number {
      return nextUint32() / 4294967296;
    },

    nextInt(min: number, max: number): number {
      const u = nextUint32() / 4294967296;
      return Math.floor(u * (max - min + 1)) + min;
    },

    nextFloat(min: number, max: number): number {
      return min + (nextUint32() / 4294967296) * (max - min);
    },

    nextGaussian(mean = 0, stdDev = 1): number {
      if (hasSpareGaussian) {
        hasSpareGaussian = false;
        return spareGaussian * stdDev + mean;
      }
      let u = 0;
      let v = 0;
      let sumSq = 0;
      while (sumSq === 0 || sumSq >= 1) {
        u = (nextUint32() / 4294967296) * 2 - 1;
        v = (nextUint32() / 4294967296) * 2 - 1;
        sumSq = u * u + v * v;
      }
      const mul = Math.sqrt((-2 * Math.log(sumSq)) / sumSq);
      spareGaussian = v * mul;
      hasSpareGaussian = true;
      return u * mul * stdDev + mean;
    },
  };
}
