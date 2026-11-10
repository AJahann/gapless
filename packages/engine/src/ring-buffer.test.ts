import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer';

describe(RingBuffer, () => {
  it('initializes empty with given capacity', () => {
    const ring = new RingBuffer<number>(3);
    expect(ring.capacity).toBe(3);
    expect(ring).toHaveLength(0);
    expect(ring.isEmpty).toBe(true);
    expect(ring.isFull).toBe(false);
    expect(ring.peekOldest()).toBeUndefined();
    expect(ring.peekNewest()).toBeUndefined();
    expect(ring.toArray()).toEqual([]);
  });

  it('rejects invalid capacity', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(/positive integer/i);
    expect(() => new RingBuffer<number>(-5)).toThrow(/positive integer/i);
    expect(() => new RingBuffer<number>(1.5)).toThrow(/positive integer/i);
  });

  it('pushes elements until full', () => {
    const ring = new RingBuffer<number>(3);
    expect(ring.push(10)).toBeUndefined();
    expect(ring.push(20)).toBeUndefined();
    expect(ring.push(30)).toBeUndefined();

    expect(ring).toHaveLength(3);
    expect(ring.isFull).toBe(true);
    expect(ring.isEmpty).toBe(false);
    expect(ring.peekOldest()).toBe(10);
    expect(ring.peekNewest()).toBe(30);
    expect(ring.toArray()).toEqual([10, 20, 30]);
  });

  it('overwrites oldest elements in O(1) on wrap-around', () => {
    const ring = new RingBuffer<number>(3);
    ring.push(1);
    ring.push(2);
    ring.push(3);

    const overwritten1 = ring.push(4);
    expect(overwritten1).toBe(1);
    expect(ring).toHaveLength(3);
    expect(ring.peekOldest()).toBe(2);
    expect(ring.peekNewest()).toBe(4);
    expect(ring.toArray()).toEqual([2, 3, 4]);

    const overwritten2 = ring.push(5);
    expect(overwritten2).toBe(2);
    expect(ring.toArray()).toEqual([3, 4, 5]);
  });

  it('supports indexed access including negative indexing', () => {
    const ring = new RingBuffer<string>(3);
    ring.push('a');
    ring.push('b');
    ring.push('c');
    ring.push('d'); // overwrites 'a' -> buffer has ['b', 'c', 'd']

    expect(ring.get(0)).toBe('b');
    expect(ring.get(1)).toBe('c');
    expect(ring.get(2)).toBe('d');
    expect(ring.get(3)).toBeUndefined();

    expect(ring.get(-1)).toBe('d');
    expect(ring.get(-2)).toBe('c');
    expect(ring.get(-3)).toBe('b');
    expect(ring.get(-4)).toBeUndefined();
  });

  it('iterates in oldest-first order', () => {
    const ring = new RingBuffer<number>(3);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    ring.push(4);
    ring.push(5); // [3, 4, 5]

    const collected: number[] = [];
    for (const item of ring) {
      collected.push(item);
    }
    expect(collected).toEqual([3, 4, 5]);
  });

  it('clears all items', () => {
    const ring = new RingBuffer<number>(3);
    ring.push(1);
    ring.push(2);
    ring.clear();

    expect(ring).toHaveLength(0);
    expect(ring.isEmpty).toBe(true);
    expect(ring.toArray()).toEqual([]);
  });
});
