/**
 * Bounded min-heap for top-K selection in O(n log k) time and O(k) memory.
 * Spec: docs/data-structures.md and docs/ROADMAP.md Phase 1.
 */

export type Comparator<T> = (a: T, b: T) => number;

export class TopK<T> {
  readonly capacity: number;
  private readonly compare: Comparator<T>;
  private readonly heap: T[];

  /**
   * @param capacity Maximum number of top elements to retain (k >= 1).
   * @param compare Comparator where compare(a, b) > 0 means `a` is greater/better than `b`.
   */
  constructor(capacity: number, compare: Comparator<T>) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(
        `TopK capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.capacity = capacity;
    this.compare = compare;
    this.heap = [];
  }

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  peekMin(): T | undefined {
    return this.heap[0];
  }

  /**
   * Push an item into the top-k structure.
   * If heap size < k: pushes item and sifts up (O(log k)).
   * If heap size == k: compares with minimum (root). If greater, replaces root and sifts down (O(log k)).
   * Returns true if item was admitted into top-K.
   */
  push(item: T): boolean {
    if (this.heap.length < this.capacity) {
      this.heap.push(item);
      this.siftUp(this.heap.length - 1);
      return true;
    }

    const root = this.heap[0]!;
    // heap is full: root is the minimum element in top-K
    if (this.compare(item, root) > 0) {
      this.heap[0] = item;
      this.siftDown(0);
      return true;
    }

    return false;
  }

  pushMany(items: Iterable<T>): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /**
   * Returns current top-K elements sorted descending (best/largest first).
   */
  getSorted(): T[] {
    const copy = [...this.heap];
    copy.sort((a, b) => this.compare(b, a));
    return copy;
  }

  clear(): void {
    this.heap.length = 0;
  }

  private siftUp(index: number): void {
    let curr = index;
    while (curr > 0) {
      const parent = (curr - 1) >> 1;
      const currVal = this.heap[curr]!;
      const parentVal = this.heap[parent]!;
      // compare(a, b) < 0 means a is smaller than b -> min-heap
      if (this.compare(currVal, parentVal) < 0) {
        this.swap(curr, parent);
        curr = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    const len = this.heap.length;
    let curr = index;
    const half = len >> 1;

    while (curr < half) {
      let minChild = (curr << 1) + 1;
      const right = minChild + 1;

      if (right < len) {
        const rightVal = this.heap[right]!;
        const minChildVal = this.heap[minChild]!;
        if (this.compare(rightVal, minChildVal) < 0) {
          minChild = right;
        }
      }

      const minChildVal = this.heap[minChild]!;
      const currVal = this.heap[curr]!;

      if (this.compare(minChildVal, currVal) < 0) {
        this.swap(curr, minChild);
        curr = minChild;
      } else {
        break;
      }
    }
  }

  private swap(i: number, j: number): void {
    const tmp = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = tmp;
  }
}
