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

## Playwright (Phase 5)

Real browser, real server, no MSW, no fixed sleeps — poll on counters/digest.

1. Load → 100 rows live, deltas flowing.
2. Cut 5 s → stale badge; restore → `replays` increases, `snapshots` unchanged.
3. Cut longer than replay window → restore → `snapshots` +1.
4. Chaos drop 10% + duplicate 5% + reorder 5% for 20 s → pause feed → client
   reaches head seq → digest equals server digest.
5. `chaos.silent` → watchdog reconnect within budget.
6. Server restart (TEST_CONTROL) → epoch change → snapshot recovery.
7. 10k feed: table stays virtualized (DOM row count bounded), no long-task storm.

CI runs these with a short replay window and fixed seeds so both recovery paths
are deterministic.
