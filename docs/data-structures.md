# Data structures: decisions and measurement

Short version of the design doc's section 3, with the numbers each claim must be
checked against. Benchmarks live in `packages/engine/bench/` (`vitest bench`) and
results are pasted into `docs/performance.md` — never estimated.

| Structure                           | Where                      | Complexity               | Bound                                             |
| ----------------------------------- | -------------------------- | ------------------------ | ------------------------------------------------- |
| `Map<symbol, Quote>`                | server feed + client state | O(1) avg get/set         | 100 or 10,000 entries                             |
| `RingBuffer<Delta>`                 | server replay              | O(1) push, O(1) seq→slot | `min(rate*REPLAY_WINDOW_SEC, REPLAY_MAX_ENTRIES)` |
| `RingBuffer<number>` (Float32Array) | sparklines                 | O(1) overwrite           | 120 samples/symbol                                |
| `RingBuffer<Trade>`                 | trade tape                 | O(1) append              | 200 prints/symbol                                 |
| `Set<symbol>` dirty                 | rAF coalescer              | O(1) add, O(dirty) flush | ≤ universe size                                   |
| `Map<seq, Delta>` pending           | reorder window             | O(1) insert/delete       | 256 entries or 100 ms                             |
| min-heap size K                     | top gainers                | O(n log k) recompute     | K=10, 500 ms cadence                              |

Rules of thumb that are _not_ negotiable without a measurement:

- No `Array.prototype.shift()` in any hot path (O(n) per call).
- No full sort per frame. Recompute ordering at 500 ms; paint values at rAF.
- No per-delta React state update. React is notified once per frame at most.
- No unbounded array of "events since connect". Everything historical is a ring.
- Quote objects are replaced immutably per update so `useSyncExternalStore`
  snapshots stay referentially stable for untouched symbols.

Benchmark questions to answer with data:

1. 100 symbols: is a heap ever worth it vs `sort()`? (Expected: no.)
2. 10,000 symbols, K=10: heap vs full sort per 500 ms recompute.
3. Ring vs `push`+`shift` at 120 and 1,000 points.
4. rAF coalescing ratio at 100 / 1k / 10k deltas per second with Zipf hot symbols.
