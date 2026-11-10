import { describe, expect, it } from 'vitest';
import { BackoffController, computeFullJitterBackoff } from './backoff';

describe('backoff', () => {
  it('computes full jitter backoff within bounds', () => {
    const fixedRng = () => 0.5;
    // attempt 0: baseMs = 100, ceiling = 100 -> 0.5 * 100 = 50
    expect(computeFullJitterBackoff(0, { baseMs: 100, rng: fixedRng })).toBe(
      50,
    );

    // attempt 1: ceiling = 200 -> 0.5 * 200 = 100
    expect(computeFullJitterBackoff(1, { baseMs: 100, rng: fixedRng })).toBe(
      100,
    );

    // attempt 2: ceiling = 400 -> 0.5 * 400 = 200
    expect(computeFullJitterBackoff(2, { baseMs: 100, rng: fixedRng })).toBe(
      200,
    );

    // ceiling capped at maxMs
    expect(
      computeFullJitterBackoff(10, {
        baseMs: 100,
        maxMs: 1000,
        rng: fixedRng,
      }),
    ).toBe(500);
  });

  it('BackoffController increments attempts and resets', () => {
    const fixedRng = () => 1.0;
    const ctrl = new BackoffController({
      baseMs: 100,
      maxMs: 500,
      factor: 2,
      rng: fixedRng,
    });

    expect(ctrl.currentAttempt).toBe(0);
    expect(ctrl.next()).toBe(100);
    expect(ctrl.currentAttempt).toBe(1);
    expect(ctrl.next()).toBe(200);
    expect(ctrl.currentAttempt).toBe(2);
    expect(ctrl.next()).toBe(400);
    expect(ctrl.currentAttempt).toBe(3);
    expect(ctrl.next()).toBe(500); // capped at maxMs

    ctrl.reset();
    expect(ctrl.currentAttempt).toBe(0);
    expect(ctrl.next()).toBe(100);
  });
});
