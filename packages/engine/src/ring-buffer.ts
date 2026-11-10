/**
 * Generic fixed-capacity circular ring buffer.
 * O(1) push/overwrite, indexed access, oldest-first iteration.
 * No Array.prototype.shift() - bound memory.
 * Spec: docs/data-structures.md and docs/ROADMAP.md Phase 1.
 */

export class RingBuffer<T> implements Iterable<T> {
  readonly capacity: number;
  private readonly buffer: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(
        `RingBuffer capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.capacity = capacity;
    this.buffer = Array.from<T | undefined>({ length: capacity });
  }

  get length(): number {
    return this.count;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get isFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * Push an item into the ring.
   * If full, overwrites the oldest item in O(1) and returns it.
   */
  push(item: T): T | undefined {
    let overwritten: T | undefined;
    if (this.count < this.capacity) {
      const idx = (this.start + this.count) % this.capacity;
      this.buffer[idx] = item;
      this.count += 1;
    } else {
      overwritten = this.buffer[this.start];
      this.buffer[this.start] = item;
      this.start = (this.start + 1) % this.capacity;
    }
    return overwritten;
  }

  /**
   * Indexed access from oldest (0) to newest (length - 1).
   * Negative indices count from newest (-1 = newest).
   */
  get(index: number): T | undefined {
    let idx = index;
    if (idx < 0) {
      idx = this.count + idx;
    }
    if (idx < 0 || idx >= this.count) {
      return undefined;
    }
    return this.buffer[(this.start + idx) % this.capacity];
  }

  peekOldest(): T | undefined {
    if (this.count === 0) return undefined;
    return this.buffer[this.start];
  }

  peekNewest(): T | undefined {
    if (this.count === 0) return undefined;
    return this.get(this.count - 1);
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i += 1) {
      result.push(this.buffer[(this.start + i) % this.capacity] as T);
    }
    return result;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i += 1) {
      yield this.buffer[(this.start + i) % this.capacity] as T;
    }
  }
}
