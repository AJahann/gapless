# Performance

## Budgets

| Metric                   | Budget                                       | How measured                                            |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------- |
| Receive-to-paint latency | p95 < 50 ms @1k/sec main thread              | arrival timestamp → after paint, histogram in web layer |
| Long tasks               | none > 50 ms @100/sec                        | `PerformanceObserver('longtask')`                       |
| Memory                   | flat over 10 min soak                        | rings bounded; heap snapshots before/after              |
| Coalescing               | reported, not targeted                       | deltas applied / frames painted                         |
| Recovery                 | replay ≤ 1 s, snapshot ≤ 2 s after reconnect | E2E counters + timestamps                               |

Clocks: server `ts` and browser time are not comparable. Latency is measured
**receive → paint** only. Do not publish "server-to-screen" numbers from mixed
clocks.

## Method

`scripts/bench.mjs` (Phase 6) drives headless Chromium through a matrix of
rate (100 / 1k / 5k / 10k) × mode (main / worker) × universe (100 / 10k),
30 s per cell plus a 10 min soak for the default cell. Raw output goes to
`perf/results/`, the summary table below is regenerated from it.

Record hardware, OS, browser version and commit SHA with every run. A number
without those is not a result.

## Results

<!-- BENCHMARK_RESULTS_START -->
| Commit    | Hardware                                         | Rate   | Universe | Mode   | p95 recv→paint | Long tasks     | Heap Δ        | Coalescing |
| --------- | ------------------------------------------------ | ------ | -------- | ------ | -------------- | -------------- | ------------- | ---------- |
| `e4d5a76` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 100/s  | top100   | main   | 244.9 ms       | 44 (max 202ms) | 0.0 MB        | 4.6x       |
| `e4d5a76` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 100/s  | top100   | worker | 1127.7 ms      | 17 (max 226ms) | 0.0 MB (main) | 2.0x       |
| `e4d5a76` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 1000/s | top100   | main   | 276.5 ms       | 29 (max 321ms) | 0.0 MB        | 97.5x      |
| `e4d5a76` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 1000/s | top100   | worker | 8442.9 ms      | 71 (max 258ms) | 0.0 MB (main) | 20.6x      |
<!-- BENCHMARK_RESULTS_END -->
