# Test strategy

Pyramid: pure engine tests (fast, exhaustive) → server integration over real
sockets → React component tests → a few Playwright recovery journeys.

## The invariant that matters

> After any fault pattern, once the client reaches head seq H, its quote state
> equals the server's state at H.

Enforced three ways:

1. **Property test** (`packages/engine`): script a generator + client through
   random drop/duplicate/reorder/delay/disconnect/snapshot sequences with a
   seeded RNG. Both sides run `applyDelta`. Assert convergence, no duplicate
   application, bounded pending buffer, and termination to `live`.
2. **Digest endpoint**: `GET /api/feeds/:id/digest` returns a canonical digest
   (fixed-point fields, index order, no float formatting). E2E pauses the feed,
   waits for the client to reach the same seq, compares digests.
3. **E2E scenarios** below.

## Engine matrix (Phase 3)

| Case                                    | Expected                                  |
| --------------------------------------- | ----------------------------------------- |
| in-order deltas                         | applied once, live                        |
| duplicate delta                         | dropped, counter +1                       |
| reorder within window                   | applied in seq order, no resume           |
| gap not closing in 100 ms               | one resume sent                           |
| resume → replay                         | catches up, no duplicates                 |
| resume → expired                        | snapshot path                             |
| resume → future / stale epoch           | snapshot path, state reset                |
| snapshot arrives with newer live buffer | drop ≤ snapshot.seq, drain rest           |
| snapshot already behind buffer          | resume once, else refetch, max 3          |
| epoch changes mid-sync                  | restart handshake                         |
| heartbeat headSeq ahead, no deltas      | resume                                    |
| silence > 2×heartbeat                   | close + backoff reconnect                 |
| manual cut                              | no timers/fetches, stale UI               |
| restore after short outage              | replay only (snapshots counter unchanged) |
| restore after long outage               | snapshot counter +1                       |
| server restart                          | new epoch → snapshot                      |

## Server integration (Phase 2)

Real `app.listen` on an ephemeral port + `ws` client: welcome modes, replay
boundaries (`oldestSeq-1` exact edge), frame batching limits, origin rejection,
hello timeout, message size/rate limits, slow-consumer close 4000, chaos scoping,
pause/unpause, digest stability, graceful shutdown.

## React (Phase 4)

jsdom + Testing Library: store notifications once per frame, row re-renders only
for dirty symbols, stale badge appears on watchdog, sort cadence does not thrash,
sparkline ring wraps. Use `getByRole`/`getByLabelText`; no test ids without a
stated reason.

## Playwright (Phases 5 & 8)

Real browser, real server or Docker container stack, no MSW, no fixed sleeps — poll on counters/digest.
Pass `TARGET_URL=http://127.0.0.1:80` (or `:3000`) to execute against running containers.

1. **Scenario 1**: Initial load connects live with 100 assets and deltas incrementing.
2. **Scenario 2**: Short cut (< replay window) recovers via replay without snapshot refetch (`replays` increases, `snapshots` unchanged).
3. **Scenario 3**: Long cut (> replay window) recovers via snapshot refetch (`snapshots` +1).
4. **Scenario 4**: Server restart triggers epoch change and automatic snapshot recovery (`TEST_CONTROL` endpoint `/api/feeds/:id/restart`).
5. **Scenario 5**: Worker mode (`?mode=worker`) connects live with flowing deltas and coalesced updates.
6. **Scenario 6**: Rate switching (`100/s` to `500/s`), live FPS indicator badges, and Concepts Guide accordion expansion.
7. **Scenario 7**: Chaos Drop injection (`drop: 25%`) triggers gap detection and replay recovery without stalling.
8. **Scenario 8**: Chaos Duplicate injection (`duplicate: 20%`) increments duplicates counter without state corruption.
9. **Scenario 9**: Chaos Reorder injection (`reorder: 25%`) detects out-of-order packets and buffers them cleanly.
10. **Scenario 10**: Chaos Jitter (`jitterMs: 150ms`) applies transport latency while maintaining continuous live delivery.
11. **Scenario 11**: Chaos Silent socket (`silent: true`) triggers heartbeat watchdog timeout and automatic reconnection.
12. **Scenario 12**: Feed pause via test control asserts exact canonical 64-bit FNV-1a digest equality between server and client in both main thread and Web Worker execution modes.

CI runs short replay window and fixed seeds so recovery paths are deterministic.
