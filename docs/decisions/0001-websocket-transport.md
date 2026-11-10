# ADR 0001 — WebSocket + HTTP snapshot

Status: accepted.

Deltas and in-band resume travel over one WebSocket; snapshots over HTTP.
SSE cannot carry resume/chaos control without a second channel, and polling
misses the staleness budget at high rates. One socket for both live and replay
traffic keeps ordering in a single place: the client has one delta gate, not
two code paths.

Consequence: browser WS has no ping API, so liveness needs the application
heartbeat and watchdog described in `docs/sync-algorithm.md`.
