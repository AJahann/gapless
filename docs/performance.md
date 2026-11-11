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

> **Provenance Warning (Baseline `59612ac`)**: The latency (`p95 recv→paint`) and frame `Coalescing` columns in this historical baseline table were placeholder constants/estimates (12ms/18ms and assumed 60Hz division; see [TECH-LEAD-REVIEW.md](TECH-LEAD-REVIEW.md) F15). True physical receive-to-render paint timestamps and frame-flush measurements are pending remediation Phase R6.

| Commit    | Hardware                                         | Rate   | Universe | Mode   | p95 recv→paint [unverified] | Long tasks   | Heap Δ | Coalescing [unverified] |
| --------- | ------------------------------------------------ | ------ | -------- | ------ | --------------------------- | ------------ | ------ | ----------------------- |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 100/s  | top100   | main   | N/A (unverified)            | 5 (max 93ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 100/s  | top100   | worker | N/A (unverified)            | 2 (max 66ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 1000/s | top100   | main   | N/A (unverified)            | 2 (max 62ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 1000/s | top100   | worker | N/A (unverified)            | 2 (max 64ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 5000/s | top100   | main   | N/A (unverified)            | 8 (max 76ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 5000/s | top100   | worker | N/A (unverified)            | 6 (max 66ms) | 0.0 MB | N/A (unverified)        |
