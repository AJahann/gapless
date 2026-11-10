/**
 * Full-jitter exponential backoff with injectable RNG.
 * Formula: sleep = rng() * min(maxMs, baseMs * factor^attempt)
 * Spec: docs/ROADMAP.md Phase 1 and docs/sync-algorithm.md.
 */

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  rng?: () => number;
}

export const DEFAULT_BACKOFF_OPTIONS: Required<BackoffOptions> = {
  baseMs: 100,
  maxMs: 5000,
  factor: 2,
  rng: Math.random,
};

export function computeFullJitterBackoff(
  attempt: number,
  options?: BackoffOptions,
): number {
  const baseMs = options?.baseMs ?? DEFAULT_BACKOFF_OPTIONS.baseMs;
  const maxMs = options?.maxMs ?? DEFAULT_BACKOFF_OPTIONS.maxMs;
  const factor = options?.factor ?? DEFAULT_BACKOFF_OPTIONS.factor;
  const rng = options?.rng ?? DEFAULT_BACKOFF_OPTIONS.rng;

  const boundedAttempt = Math.max(0, attempt);
  const ceiling = Math.min(maxMs, baseMs * factor ** boundedAttempt);
  return Math.floor(rng() * ceiling);
}

export class BackoffController {
  private attempt = 0;
  private readonly options: BackoffOptions;

  constructor(options?: BackoffOptions) {
    this.options = options ?? {};
  }

  get currentAttempt(): number {
    return this.attempt;
  }

  next(): number {
    const delay = computeFullJitterBackoff(this.attempt, this.options);
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }
}
