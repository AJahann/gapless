# Roadmap

## Technical review qualification

The delivery statuses below record historical feature completion, not proof
that every acceptance gate is satisfied. A technical review of baseline
`a3c0ecb` identified correctness, exposure, test-coverage and measurement gaps.
Use [Technical review and remediation roadmap](TECH-LEAD-REVIEW.md) for findings
F01-F21 and repair phases R0-R7. Start with R0/R1; do not add another feature
phase before closing the relevant correctness and public-deployment gates.

In particular, published latency/coalescing columns are unverified (the runner
uses constants/estimates); component, Worker lifecycle and digest-convergence
E2E gates remain incomplete. See the review for executed checks and blockers.

## Remediation roadmap (Phases R0–R7)

See [TECH-LEAD-REVIEW.md](TECH-LEAD-REVIEW.md) for full rationale and findings F01–F21.

| Phase | Remediation Scope                                                     | Priority             | Status  |
| ----- | --------------------------------------------------------------------- | -------------------- | ------- |
| R0    | Honest baseline & immediate exposure containment (F01, F15, F17, F20) | P0                   | Done    |
| R1    | Repair sync state machine & async ownership (F03, F04, F06, F12, F21) | P0 / Correctness     | Done    |
| R2    | Enforce epoch, identity & numeric contracts (F05, F07, F08, F11)      | P0 / Correctness     | Done    |
| R3    | Bound backend resources & transport work (F02, F09, F10, F11, F20)    | P1 / Hardening       | Done        |
| R4    | Align frontend state, controls & freshness (F13, F14, F19)            | P1 / UX              | Pending |
| R5    | Turn tests into evidence: deterministic harnesses & convergence (F17) | P1 / Verification    | Pending |
| R6    | Real instrumentation & measured optimization (F15, F16, F18)          | P1 / Performance     | Pending |
| R7    | Structural cleanup & release reconciliation (F19, F20)                | P2 / Maintainability | Pending |

## Historical feature roadmap (pre-remediation)

One branch per phase: `phase-N/<slug>` → PR into `main`. Delivery statuses below reflect pre-remediation historical delivery:

| Phase | Deliverable                        | Key gates                                               | Historical Status       |
| ----- | ---------------------------------- | ------------------------------------------------------- | ----------------------- |
| 0     | Scaffold + docs                    | install, lint, tsc, vitest, next build, tsup green      | Completed               |
| 1     | Protocol + shared structures       | schema round-trips; ring/heap/backoff unit + bench      | Completed               |
| 2     | Server feed, snapshot, WS, chaos   | integration tests over real sockets; replay boundaries  | Completed               |
| 3     | Client sync engine                 | scripted + property tests incl. convergence invariant   | Completed               |
| 4     | Web UI                             | live table, kill switch, metrics; component tests       | Completed               |
| 5     | E2E + CI                           | Playwright recovery scenarios green in CI               | Completed               |
| 6     | Worker mode + benchmarks           | measured before/after in docs/performance.md            | Completed (needs R6)    |
| 7     | Polish + deploy                    | README demo, Docker, compose, Caddy reverse proxy       | Completed (needs R0/R3) |
| 8     | Tailwind v4 + controls + chaos E2E | Tailwind v4, rate selector, FPS meter, guide, 11/11 E2E | Completed               |

---

## Phase 1 — protocol and shared structures

- `packages/protocol`: zod schemas + inferred types for every message in
  `docs/protocol.md` (hello, welcome, deltas, heartbeat, resume,
  replay_unavailable, chaos, error, Snapshot, Quote, Delta tuple). Encode/decode
  helpers for frames. Reject unknown keys on client→server messages.
- `packages/engine/src/ring-buffer.ts`: generic fixed-capacity ring; O(1)
  push/overwrite, oldest-first iteration, indexed access.
- `packages/engine/src/top-k.ts`: bounded min-heap, O(n log k) selection.
- `packages/engine/src/backoff.ts`: full-jitter backoff, injectable random.
- `packages/engine/src/prng.ts`: seeded PRNG (mulberry32 or splitmix) shared by
  generator and chaos.
- `packages/engine/src/universe.ts`: 100-symbol fixture (simulated names/prices)
  - synthetic 10k universe generator; `applyDelta` reducer and canonical digest.

Gates: round-trip tests for every schema; ring boundary tests (wrap, full,
empty); heap result equals full sort for random inputs; `vitest bench` comparing
heap vs sort and ring vs `shift()` at 100 and 10,000 symbols.

## Phase 2 — server

- `feed/generator.ts`: seeded, 20 ms tick, fractional accumulation so configured
  rate is met on average; Zipf-weighted symbol selection (hot symbols tick more);
  GBM-ish price steps in fixed point. Never assign seq without emitting the
  delta — contiguity is the client's gap-detection contract.
- `feed/feed.ts`: `FeedState` (epoch, seq, quote map, replay ring), subscribe/
  unsubscribe, snapshot builder (synchronous), digest, pause/unpause, restart.
- `feed/registry.ts`: lazy feeds keyed `<universe>@<rate>`, idle TTL stop.
- `ws/`: upgrade route `/ws/feeds/:id`, origin check, hello handling, welcome
  modes, replay-from-ring, in-band resume, heartbeats, slow-consumer close
  (4000), per-connection chaos stage, rate limits.
- `config/env.ts`: extend with all variables in `.env.example`.

Gates (integration tests over real listening sockets, not mocked transport):
fresh join → snapshot mode; resume inside window → exact replay, no loss or
duplication; resume older than window → `expired`; future seq and stale epoch
rejected; snapshot `seq` consistent with quotes; slow consumer closed; chaos
drop produces detectable gaps and never touches other connections; SIGTERM
closes sockets then server.

## Phase 3 — client sync engine

Implement `docs/sync-algorithm.md` in `packages/engine/src/sync/` with injected
clock, socket, snapshot fetcher and RNG. Include connection state machine,
delta gate, reorder window, resume, snapshot race handling, heartbeat watchdog,
backoff, manual cut, counters.

Gates: every row of the test matrix in `docs/testing.md`; property test with
random fault scripts asserting convergence and bounded memory; no DOM/React
imports in the package.

## Phase 4 — web UI

- `feed/transport.ts` (WS + heartbeat), `feed/feed-client.ts` facade behind one
  interface so Phase 6 can swap in a Worker without touching components.
- `state/market-store.ts`: external store, per-symbol `useSyncExternalStore`,
  rAF coalescer with dirty `Set`, sort recompute at 500 ms, top-K at 500 ms.
- `components/market-table/` (plain rows at 100, `@tanstack/react-virtual` above
  500), `top-movers`, `trade-tape`, `sparkline` (canvas, 1 Hz ring), `status-bar`
  with Cut connection + outage presets, `chaos-panel`, `metrics-panel`.
- URL state `?universe=&rate=&mode=` for shareable/benchmarkable configs.
- Landing page shows the table immediately; no auth, no marketing shell.

Gates: 100-symbol table live at 100 deltas/sec; cut → stale badge, restore →
replay or snapshot with visible counters; trades tape keeps every print while
prices coalesce; component tests for store/coalescer/staleness; no layout shift
or per-delta React state updates.

## Phase 5 — E2E and CI

Playwright against real server + real browser, no MSW, no `waitForTimeout`.
Scenarios and the digest comparison in `docs/testing.md`. CI workflow: install,
format, lint, typecheck, unit, build, E2E with server env `TEST_CONTROL=true`,
short replay window, fixed seed.

Gates: all scenarios green in CI on the PR head SHA; artifacts (trace on
failure) uploaded.

## Phase 6 — Worker mode and measurement

- `feed/engine.worker.ts`: transport + parse + sync engine off main thread,
  coalesced patches at ≤60 Hz, same engine code. Toggle via `?mode=worker|main`.
- `scripts/bench.mjs`: scripted runs per rate × mode, collects long tasks, p95
  receive-to-paint, memory; writes `docs/performance.md` results table.

Gates: before/after numbers actually measured on named hardware; worker becomes
default only if the data says so; documented limits (10k × 10k may exceed a
laptop — report, don't hide).

## Phase 7 — polish and deploy

README with 30–60 s GIF (live → cut → restore → replay/snapshot counters),
architecture diagram, design-doc links. Multi-stage Dockerfiles
(`node:24-bookworm-slim`), compose with Caddy routing `/api/*` + `/ws/*`
server and rest web, `output: 'standalone'` already configured.
Optional Cloudflare quick tunnel for public demo. Keep demo read-only:
`TEST_CONTROL` and chaos policy reviewed before exposing publicly.

## Phase 8 — Tailwind CSS v4, stream controls, and individual chaos E2E

- Modernized `@gapless/web` UI using Tailwind CSS v4 with `@tailwindcss/postcss`,
  custom `@theme` brand color definitions, and Biome `tailwindDirectives` support.
- Replaced inline style objects across all components (`StatusBar`, `MarketTable`,
  `TopMovers`, `TradeTape`, `MetricsPanel`, `ChaosPanel`, `page.tsx`) with Tailwind
  utility classes.
- Added live updates-per-second selector pills (`100/s`, `500/s`, `1k/s`, `5k/s`, `10k/s`)
  in `StatusBar` dynamically modifying the URL parameter `?rate=` and reconnecting feeds.
- Added rolling `useFps` hook (sampling frame delta times via `requestAnimationFrame`
  over 500 ms intervals) with color-coded badges in both `StatusBar` and `MetricsPanel`.
- Added educational `ConceptsGuide` accordion cards explaining `seq`, `epoch`, `gap`,
  `replay`, `snapshot`, and `chaos` distributed stream mechanics.
- Expanded Playwright E2E recovery suite (`e2e/recovery.spec.ts`) from 5 to 11 scenarios,
  validating individual Chaos injection modes (Drop, Duplicate, Reorder, Jitter, Silent socket),
  rate switching, FPS badges, and Docker container verification (`TARGET_URL=http://127.0.0.1:80`).
- Resolved replay gap deadlock in `SyncEngine` when loss occurs during in-band replay.
