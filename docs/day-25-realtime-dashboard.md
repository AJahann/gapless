# Day 25 — FE system design drill #1: real-time trading dashboard

Design for a demo repo (`gapless`). Simulated top-100 token feed, live table,
and a **Cut connection** button that proves gap/snapshot recovery instead of
just reopening a socket.

## 1. Requirements

| Requirement      | Target                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Symbols          | 100 (default feed); 10,000 stress feed                                                               |
| Update rate      | 100 deltas/sec default; presets 1k, 5k, 10k/sec per feed                                             |
| Delta payload    | seq, symbol, price, size, side, ts — every delta is a trade print                                    |
| Staleness budget | 2s. Any silence beyond 2 heartbeats marks the whole view stale                                       |
| Receive-to-paint | p95 < 50 ms at 1k/sec on main thread (measured, see `docs/performance.md`)                           |
| User actions     | cut/restore connection, chaos knobs (drop/duplicate/reorder/delay), feed switch, sort, select symbol |
| Recovery         | outage ≤ replay window → replay only; longer or epoch mismatch → snapshot                            |
| Consistency      | at equal `lastSeq`, client quote state must equal server quote state                                 |
| Memory           | bounded: replay ring server-side, sparkline + trade-tape rings client-side                           |

Non-goals for v1: authentication, persistence, real exchange data, multi-node
fan-out, binary encoding, mobile app.

## 2. Architecture

```
┌ apps/server ────────────────────────────────────────────────────┐
│ generator (seeded, 20 ms tick) → FeedState + seq++              │
│                                  ├→ replay ring (seq-indexed)   │
│                                  ├→ /api/feeds/:id/snapshot     │
│                                  └→ /ws/feeds/:id subscribers   │
│                                     + per-connection chaos      │
└──────────────────────────────────┬──────────────────────────────┘
                    WS deltas / heartbeats / resume  +  HTTP snapshot
┌ apps/web ────────────────────────┴──────────────────────────────┐
│ transport (WS client, backoff, heartbeat watchdog)              │
│   → sync engine (seq gate, reorder window, gap → resume/resync) │
│   → owned state: Map<symbol, Quote> + rings + trade tape        │
│   → rAF coalescer (dirty Set, latest-wins for rendering)        │
│   → external store + per-symbol subscriptions                   │
│   → table / top-K panel / sparklines / tape / metrics           │
└─────────────────────────────────────────────────────────────────┘
```

State ownership:

- **Server state** (quotes, volume, open price) lives in one `Map`, mutated only
  by the shared reducer `applyDelta`. The client runs the same reducer — that is
  what makes the convergence invariant testable.
- **Derived views** (sorted rows, top gainers) are computed on a schedule, never
  stored as a second copy of quote data.
- **Ephemeral UI state** (selection, sort key, panel open, flash animation) lives
  in React state and never touches the quote map.
- React never owns the quote map. `useSyncExternalStore` reads it; per-frame
  notifications only.

Transport: WebSocket for deltas + in-band `resume`, plain HTTP `fetch` for
snapshots. SSE would need a second channel for resume and chaos control; polling
cannot meet the staleness budget at 10k/sec. Commands in this demo are local UI
actions, so no command channel is required; if trading commands are added later,
use HTTPS POST with idempotency keys, not fire-and-forget WS messages.

## 3. Data structures and Big-O

| Problem                       | Structure                                 | Cost                           | Rejected alternative                          |
| ----------------------------- | ----------------------------------------- | ------------------------------ | --------------------------------------------- |
| Quote by symbol               | `Map<symbol, Quote>`                      | O(1) avg lookup/update         | array scan O(n) per delta                     |
| Server replay window          | ring buffer indexed by `seq`              | O(1) append, O(1) locate start | array `shift()` O(n); unbounded log O(memory) |
| Render coalescing             | dirty `Set<symbol>` + rAF flush           | O(dirty) per frame             | re-render per delta, O(deltas) renders        |
| Sparkline history             | ring of 120 samples/symbol (1 sample/sec) | O(1) overwrite, bounded        | `push`+`shift` O(n)                           |
| Trade tape (every event kept) | ring of last 200 prints/symbol            | O(1) append                    | coalescing would lose events                  |
| Top-K gainers                 | bounded min-heap of size K                | O(n log k) per recompute       | full sort O(n log n) every frame              |
| Visible rows (10k feed)       | virtualization window                     | O(visible) DOM nodes           | 10k rows ≈ 60k+ nodes                         |
| Reorder window                | `Map<seq, Delta>` pending buffer          | O(1) insert/drain, bounded     | sorting arrivals O(m log m)                   |

Selection criteria: 100 rows do **not** need a heap or virtualization — sort them
on a 500 ms cadence and move on. Both structures exist for the 10k feed, and both
are benchmarked against the naive version (`vitest bench`) so the claim is
measured, not asserted. Sorting is deliberately decoupled from painting:
re-sorting every frame makes rows jump under the user's cursor.

## 4. Transport, reconnect, gaps, snapshot

Sequence discipline (full rules in `docs/protocol.md`):

- One global `seq` per feed, incremented for every delta, never coalesced away.
- `(epoch, seq)` identifies a position. `epoch` changes on feed restart or any
  universe/config change; a mismatched epoch always means full snapshot.
- Server keeps a replay ring of `min(rate × window, hard cap)` deltas and can
  answer "give me everything after seq S" in O(1) + O(replayed).
- Heartbeat every 1s carries the head seq. It detects both half-open TCP (no
  events at all) and a dropped stream tail (head seq ahead, no later delta).

Client rules:

- `seq <= lastSeq` → duplicate, drop and count.
- `seq === lastSeq + 1` → apply, then drain any pending entries now contiguous.
- `seq > lastSeq + 1` → park in a bounded reorder buffer (≤100 ms or ≤256
  entries), because the chaos injector can reorder. If the gap does not close,
  send in-band `resume {epoch, lastSeq}`.
- Resume response is either replayed deltas or `replay_unavailable`
  (`stale_epoch` | `expired` | `future`) → snapshot path.

Snapshot path (the classic race, handled explicitly):

1. Keep the socket open and **buffer** live deltas.
2. `GET /api/feeds/:id/snapshot` — server builds it synchronously, so `seq` and
   quotes are atomic.
3. Install snapshot at `snapshot.seq`; drop buffered deltas `<= snapshot.seq`.
4. If the oldest buffered delta is not `snapshot.seq + 1`, the gap is still open:
   try in-band resume once, else refetch the snapshot (bounded retries, then
   surface an error state).
5. Apply the rest in order, transition to `live`.

Reconnect: exponential backoff with **full jitter** (`random(0, min(15s, 500ms ×
2^attempt))`), attempt counter reset only after 10s of stable connection.
`navigator.onLine`/`online` events trigger an immediate retry but are never
treated as proof of connectivity. Manual **Cut connection** closes the socket,
blocks all reconnect timers and snapshot fetches, and marks the view stale —
the feed keeps running server-side, which is exactly what makes replay vs
snapshot observable.

Backpressure: if a subscriber's `bufferedAmount` exceeds the budget, the server
closes it with code 4000 (`slow_consumer`) rather than buffering unboundedly or
silently dropping deltas. The client recovers through the normal resume path, so
slow consumers become a real (not simulated) gap source.

## 5. Rendering strategy and failure modes

- Apply **every** delta to owned state on arrival; coalesce only rendering.
  Quotes render latest-wins; trades append to a bounded tape. Coalescing state
  would break the convergence invariant and lose volume.
- Flush dirty symbols once per `requestAnimationFrame`. At 100 deltas/sec with a
  hot symbol this turns ~100 updates into ≤60 paints, and the metrics panel shows
  the real ratio instead of a claim.
- Sparklines sample once per second per symbol into a `Float32Array` ring, drawn
  on canvas. After replay, backfill the samples; after snapshot, show a visible
  gap rather than inventing history.
- Worker mode (Phase 6) runs transport + parse + sync engine off the main thread
  and posts coalesced patches. The engine is framework-free precisely so both
  modes share one tested implementation. Main-thread mode stays the default
  until measurements justify otherwise.

| Failure mode                    | Handling                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Re-render per delta             | rAF coalescer + per-symbol subscriptions                                             |
| Hidden tab                      | rAF pauses; state keeps applying; one flush on visibility. No unbounded render queue |
| Half-open connection            | heartbeat watchdog (no browser WS ping API)                                          |
| Silent dropped tail             | heartbeat head seq vs `lastSeq`                                                      |
| Duplicate on replay overlap     | seq gate drops, counted                                                              |
| Reordered deltas                | bounded reorder window before declaring a gap                                        |
| Server restart / config change  | new epoch → snapshot                                                                 |
| Slow consumer                   | server close 4000 → client resume                                                    |
| Snapshot/older than live buffer | contiguity check, bounded retry                                                      |
| Unbounded memory                | rings everywhere; caps on reorder buffer and replay log                              |
| Fake performance claims         | `docs/performance.md` requires measured before/after numbers                         |

## Caveats accepted for v1

- 100 rows need no virtualization or heap; they exist for the 10k feed.
- Simulated feed first (deterministic, controllable, testable). Real exchange
  adapter is out of scope: rate limits, no chaos control.
- Chaos is injected server-side per connection so the _real_ client code path is
  exercised; a real TCP WebSocket does not drop or reorder by itself. Real gap
  sources are reconnects, slow-consumer closes, and fan-out bugs.
- Numbers in `docs/performance.md` must come from the benchmark script, never
  estimated.
