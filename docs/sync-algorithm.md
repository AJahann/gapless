# Client sync engine

Lives in `packages/engine/src/sync/`. Pure TypeScript: no DOM, no React, no
timers of its own. Time, randomness, socket and snapshot fetching are injected,
so the whole state machine is testable with fake timers and scripted frames.
The same instance runs on the main thread (Phase 4) and in a Worker (Phase 6).

## States

```
idle → connecting → syncing → live ⇄ replaying
                     ↑          │         │
                     └──────────┴─────────┘   (gap / replay_unavailable)
offline (manual cut)  ·  error (unrecoverable, e.g. repeated snapshot failure)
```

- `connecting`: socket open + hello sent, waiting for welcome.
- `syncing`: welcome mode `snapshot`; buffering deltas while fetching snapshot.
- `replaying`: welcome mode `replay`, or in-band resume in progress.
- `live`: contiguous application at head.
- `offline`: user cut. No timers, no fetches. Socket closed or ignored.

`live` is the only state whose data is presented as fresh. Everything else shows
connection status; data older than the staleness budget is marked stale.

## Delta gate (single entry point: `onDelta`)

```
if epoch mismatch                 → discard all state, enter syncing
if seq <= lastSeq                 → duplicates++, return
if seq == lastSeq + 1             → applyDelta, lastSeq++, drainPending()
else                              → pending.set(seq, delta)
                                    if pending.size > 256 or gapAge > 100 ms
                                      → requestResume()
```

`drainPending`: while `pending.has(lastSeq + 1)` apply and delete. Pending is a
`Map<seq, Delta>`, capped at 256 entries. When full, later deltas are not
staged; while a gap remains, the client retries resume at 100 ms intervals.
Only contiguous deltas advance state, and a successful replay fills the gap.
Cut, stop, socket close, and snapshot sync cancel the retry timer.

`applyDelta` is the shared reducer also used by the server generator. It updates
quote (price/open/high/low/volume/trades/lastSeq/lastTs) and appends to the
symbol's trade-tape ring. Sparkline sampling is a separate 1 Hz sampler, not
part of the reducer.

## Resume

`requestResume()` sends `{type:'resume', epoch, lastSeq}` on the open socket and
enters `replaying`. While replaying, incoming deltas still pass through the same
gate — there is no separate replay code path.

- Deltas arrive → gate resolves them, back to `live` when pending is empty.
- `replay_unavailable` → enter `syncing` (snapshot path).
- Socket closes → backoff reconnect with `hello.resume = {epoch, lastSeq}`.

A gap retry is sent at most once per 100 ms while pending remains non-empty;
there is no wire acknowledgement to identify a single outstanding resume.

## Snapshot path (`syncing`)

1. Record buffered live deltas (they continue through the gate into `pending`,
   but nothing applies below the snapshot's seq).
2. `await fetchSnapshot(feed)` — injected, abortable, 5s timeout.
3. If `snapshot.epoch !== currentEpoch` → restart the whole handshake
   (universe changed mid-sync).
4. Replace quote map with snapshot, set `lastSeq = snapshot.seq`, drop pending
   `<= lastSeq`.
5. Contiguity check: if `pending` is non-empty and its smallest seq is not
   `lastSeq + 1`, the snapshot is already too old for the buffer → one in-band
   resume attempt; if that fails, refetch snapshot. Max 3 attempts, then
   `error`.
6. Drain pending in order → `live`.

Never apply a delta older than the installed snapshot. Never render the
snapshot as live before the buffer drains.

## Heartbeats

- `onHeartbeat(headSeq)`: reset watchdog. If `headSeq > lastSeq` and no delta
  arrives within 250 ms, the tail was dropped → `requestResume()`.
- Watchdog: no heartbeat and no delta for `2 × heartbeatMs` → treat connection
  as dead, close socket, backoff reconnect. This catches `chaos.silent` and real
  half-open TCP. Browsers expose no WS ping, so this is application-level.
- Check the watchdog on `visibilitychange` too: background tabs throttle timers,
  so a firing watchdog is not itself proof of death — verify elapsed time.

## Reconnect policy

Full jitter: `delay = rand(0, min(15000, 500 * 2 ** attempt))`. Reset `attempt`
after 10 s of continuous `live`. On `offline` browser event stop timers; on
`online` retry immediately. Manual cut sets `offline` state and cancels every
pending timer, retry and fetch — restoring starts a fresh `connecting` with the
last known position, which is what demonstrates replay vs snapshot.

## Metrics the engine must expose

Counters, not logs: `deltasIn`, `duplicates`, `gaps`, `resumes`,
`replays` (deltas applied from replay), `snapshots`, `reconnects`,
`pendingSize`, `lastSeq`, `epoch`, `state`, `lastEventAt`.
Rendering metrics (frames, coalescing ratio, receive-to-paint histogram) live in
the web layer, which timestamps arrival and paint.
