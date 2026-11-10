# Wire protocol v1

Authority for `@gapless/protocol`. Every message is JSON, validated with zod
schemas exported from that package. Bump `PROTOCOL_VERSION` for any breaking
change; server rejects hello with mismatched version.

## Identity: feed, epoch, seq

- **feed**: string id such as `top100@100`, `top100@1000`, `wide10k@5000`.
  Format `<universe>@<deltasPerSec>`. Feeds are created lazily on first
  subscriber and stopped after `FEED_IDLE_TTL_SEC` with no subscribers.
- **epoch**: opaque string (e.g. `nanoid`), new on every feed start and on any
  universe/rate/seed change. A client holding a different epoch has no usable
  position and must snapshot.
- **seq**: integer per feed, starts at 1, +1 per delta, never reused within an
  epoch. Deltas may be batched into frames but every delta keeps its own seq.
- Position = `(epoch, seq)`. All resume logic is expressed in these terms.

## Fixed-point numbers

Prices and sizes cross the wire as **integers**:

- `price`: integer, scale 1e6 (`priceUsd = price / 1e6`).
- `size`: integer, scale 1e4.
- Quote fields derived from them (`open`, `volume`, `high`, `low`) are integers
  at the same scales. Formatting to display strings happens only in the view
  layer, with cached `Intl.NumberFormat`.

Rationale: exact client/server state equality and a meaningful digest. No float
drift, no rounding policy to negotiate.

## Client → server

```jsonc
// First message on every connection. Required.
{ "type": "hello", "v": 1, "feed": "top100@100",
  "resume": { "epoch": "abc", "seq": 1234 } }   // optional

// In-band gap recovery on a live socket.
{ "type": "resume", "epoch": "abc", "seq": 1234 }

// Per-connection fault injection. Only when server CHAOS_ENABLED=true.
// Rates 0..1, times in ms. Unknown keys rejected.
{ "type": "chaos", "drop": 0.05, "duplicate": 0.02,
  "reorder": 0.05, "delayMs": 0, "jitterMs": 0,
  "silent": false }                              // silent = half-open simulation

// Test/demo control, only when server TEST_CONTROL=true.
{ "type": "pause" } / { "type": "unpause" }
```

Limits: max client message 4 KiB, max 20 client messages/sec/connection,
`hello` required within 5s of upgrade, handshake `Origin` must be in
`CLIENT_ORIGIN`.

## Server → client

```jsonc
// Answer to hello. mode decides the client's next step.
{ "type": "welcome", "feed": "top100@100", "epoch": "abc",
  "headSeq": 5000, "oldestSeq": 2001, "heartbeatMs": 1000,
  "mode": "replay" | "live" | "snapshot" }
// replay: deltas (lastSeq+1 .. headSeq) follow immediately, then live.
// live: resume seq == headSeq, nothing to replay.
// snapshot: position unusable; client fetches snapshot while buffering deltas.

// Live or replayed deltas. Arrays are consecutive but client must still gate
// each delta by seq — chaos can drop/reorder/duplicate individual deltas.
{ "type": "deltas", "items": [Delta, ...] }

Delta = [seq, symbolIndex, price, size, side, ts]
// seq: number; symbolIndex: index into snapshot symbols (fixed for the epoch)
// price/size: fixed-point integers; side: 0 = buy, 1 = sell
// ts: server ms timestamp (informational; never used for ordering)

// Every heartbeatMs. headSeq lets a client notice a dropped tail.
{ "type": "heartbeat", "headSeq": 5010 }

// Answer to in-band resume when replay cannot satisfy it.
{ "type": "replay_unavailable",
  "reason": "stale_epoch" | "expired" | "future",
  "epoch": "abc", "headSeq": 5000, "oldestSeq": 2001 }

{ "type": "error", "code": string, "message": string }
```

Close codes: `4000` slow_consumer, `4001` protocol_violation, `4002`
unauthorized_origin, `4003` hello_timeout, `1001` server shutdown.

## HTTP

```
GET /api/health                     → { status, protocolVersion }
GET /api/feeds                      → [{ id, universe, rate, subscribers, headSeq }]
GET /api/feeds/:id/snapshot         → Snapshot
GET  /api/feeds/:id/digest          → { epoch, headSeq, digest }   (TEST_CONTROL)
POST /api/feeds/:id/pause|unpause   → { headSeq }                  (TEST_CONTROL)
POST /api/feeds/:id/restart         → { epoch }                    (TEST_CONTROL)
```

```jsonc
Snapshot = {
  "feed": "top100@100", "epoch": "abc", "seq": 5000,
  "symbols": [{ "symbol": "BTC", "name": "Bitcoin", "index": 0 }, ...],
  "quotes": [Quote, ...]        // aligned by symbol index
}

Quote = {
  "price": 67123450000,          // fixed point 1e6
  "open": 66000000000,           // session open, base for change %
  "high": 67500000000, "low": 65500000000,
  "volume": 1234567890,          // Σ price×size, fixed point 1e10
  "trades": 4321, "lastSeq": 4999, "lastTs": 1763000000000
}
```

Snapshot construction is **synchronous** inside the feed's event-loop turn:
no timer or generator step can interleave, so `seq` and quotes are consistent
by construction. Do not make it async.

## Server resume rules

Given `resume {epoch, seq}` and feed state `(epoch, headSeq, oldestSeq)`:

| Condition             | Result                                                      |
| --------------------- | ----------------------------------------------------------- |
| `epoch` mismatch      | welcome mode `snapshot` / `replay_unavailable(stale_epoch)` |
| `seq > headSeq`       | `future` — client position cannot exist                     |
| `seq < oldestSeq - 1` | `expired` — replay window no longer covers the gap          |
| otherwise             | replay deltas `seq+1 .. headSeq` in order, then live        |

Replay is sent in frames of at most 1000 deltas. During replay the connection
must not receive live deltas out of order: queue live frames behind replay
frames, or replay synchronously before subscribing.

## Chaos semantics

Applied per connection, after frame creation, only to `deltas` frames:

- `drop`: remove each delta with probability p (seqs stay global → real gaps).
- `duplicate`: emit an extra copy of a delta (client must dedupe).
- `reorder`: swap adjacent deltas / delay a delta past its successor.
- `delayMs`/`jitterMs`: hold frames before sending.
- `silent`: stop sending everything including heartbeats, keep socket open.

Chaos never alters feed state, seq assignment, or other connections. It must be
seeded per connection (`?chaosSeed=`) so failures are reproducible in tests.
