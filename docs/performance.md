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

_Pending Phase 6. No estimated numbers._

| Commit | Hardware | Rate | Universe | Mode | p95 recv→paint | Long tasks | Heap Δ | Coalescing |
| ------ | -------- | ---- | -------- | ---- | -------------- | ---------- | ------ | ---------- |
