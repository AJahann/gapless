import { describe, test } from 'vitest';
import { createPrng } from '../src/prng';
import { RingBuffer } from '../src/ring-buffer';
import { TopK } from '../src/top-k';

describe('RingBuffer vs Array push+shift', () => {
  const SAMPLES_120 = 120;
  const SAMPLES_1000 = 1000;

  test('RingBuffer benchmarks', async ({ bench }) => {
    await bench.compare(
      bench('RingBuffer capacity 120 (10,000 pushes)', () => {
        const ring = new RingBuffer<number>(SAMPLES_120);
        for (let i = 0; i < 10000; i++) {
          ring.push(i);
        }
      }),
      bench('Array push + shift capacity 120 (10,000 pushes)', () => {
        const arr: number[] = [];
        for (let i = 0; i < 10000; i++) {
          arr.push(i);
          if (arr.length > SAMPLES_120) {
            arr.shift();
          }
        }
      }),
      bench('RingBuffer capacity 1,000 (10,000 pushes)', () => {
        const ring = new RingBuffer<number>(SAMPLES_1000);
        for (let i = 0; i < 10000; i++) {
          ring.push(i);
        }
      }),
      bench('Array push + shift capacity 1,000 (10,000 pushes)', () => {
        const arr: number[] = [];
        for (let i = 0; i < 10000; i++) {
          arr.push(i);
          if (arr.length > SAMPLES_1000) {
            arr.shift();
          }
        }
      }),
    );
  });
});

describe('TopK heap vs Array full sort (K=10)', () => {
  const K = 10;
  const prng = createPrng(42);

  const data100 = Array.from({ length: 100 }, () => prng.nextFloat(-100, 100));
  const data10k = Array.from({ length: 10000 }, () =>
    prng.nextFloat(-100, 100),
  );

  test('TopK vs sort benchmarks', async ({ bench }) => {
    await bench.compare(
      bench('TopK heap selection (N=100, K=10)', () => {
        const top = new TopK<number>(K, (a, b) => a - b);
        top.pushMany(data100);
        top.getSorted();
      }),
      bench('Array full sort (N=100, K=10)', () => {
        const copy = [...data100];
        copy.sort((a, b) => b - a);
        copy.slice(0, K);
      }),
      bench('TopK heap selection (N=10,000, K=10)', () => {
        const top = new TopK<number>(K, (a, b) => a - b);
        top.pushMany(data10k);
        top.getSorted();
      }),
      bench('Array full sort (N=10,000, K=10)', () => {
        const copy = [...data10k];
        copy.sort((a, b) => b - a);
        copy.slice(0, K);
      }),
    );
  });
});
