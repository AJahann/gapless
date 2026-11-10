import { createPrng, type Prng } from '@gapless/engine';
import type { ChaosMessage, Delta } from '@gapless/protocol';

export interface ChaosConfig {
  drop?: number; // 0..1
  duplicate?: number; // 0..1
  reorder?: number; // 0..1
  delayMs?: number;
  jitterMs?: number;
  silent?: boolean;
}

export class ChaosStage {
  private readonly prng: Prng;
  private config: ChaosConfig = {};
  private readonly enabled: boolean;

  constructor(seed: number | string = 1337, enabled = true) {
    this.prng = createPrng(seed);
    this.enabled = enabled;
  }

  updateConfig(newConfig: ChaosMessage): void {
    if (!this.enabled) return;
    this.config = {
      ...this.config,
      drop: newConfig.drop ?? this.config.drop,
      duplicate: newConfig.duplicate ?? this.config.duplicate,
      reorder: newConfig.reorder ?? this.config.reorder,
      delayMs: newConfig.delayMs ?? this.config.delayMs,
      jitterMs: newConfig.jitterMs ?? this.config.jitterMs,
      silent: newConfig.silent ?? this.config.silent,
    };
  }

  get isSilent(): boolean {
    return Boolean(this.enabled && this.config.silent);
  }

  get delayDurationMs(): number {
    if (!this.enabled) return 0;
    const base = this.config.delayMs ?? 0;
    const jitter = this.config.jitterMs ?? 0;
    if (base === 0 && jitter === 0) return 0;

    const addedJitter = jitter > 0 ? this.prng.nextInt(0, jitter) : 0;
    return base + addedJitter;
  }

  /**
   * Applies drop, duplicate, and reorder mutations to deltas for this connection.
   */
  processDeltas(inputDeltas: Delta[]): Delta[] {
    if (!this.enabled || inputDeltas.length === 0) {
      return inputDeltas;
    }

    const { drop = 0, duplicate = 0, reorder = 0 } = this.config;
    if (drop === 0 && duplicate === 0 && reorder === 0) {
      return inputDeltas;
    }

    const filtered = this.applyDropDuplicate(inputDeltas, drop, duplicate);
    return this.applyReorder(filtered, reorder);
  }

  private applyDropDuplicate(
    deltas: Delta[],
    drop: number,
    duplicate: number,
  ): Delta[] {
    const output: Delta[] = [];
    for (const delta of deltas) {
      if (drop > 0 && this.prng.next() < drop) {
        continue;
      }
      output.push(delta);
      if (duplicate > 0 && this.prng.next() < duplicate) {
        output.push(delta);
      }
    }
    return output;
  }

  private applyReorder(deltas: Delta[], reorder: number): Delta[] {
    if (reorder <= 0 || deltas.length <= 1) {
      return deltas;
    }
    const output = [...deltas];
    for (let i = 0; i < output.length - 1; i += 1) {
      if (this.prng.next() < reorder) {
        const tmp = output[i]!;
        output[i] = output[i + 1]!;
        output[i + 1] = tmp;
        i += 1;
      }
    }
    return output;
  }
}
