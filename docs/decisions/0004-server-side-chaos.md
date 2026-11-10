# ADR 0004 — Chaos injected server-side, per connection

Status: accepted.

Faults (drop, duplicate, reorder, delay, silence) are applied per connection on
the server, so the browser runs its real production code path and tests observe
real wire behaviour. A client-side fault wrapper would be easier but would test
a different system than the one demoed.

Guards: opt-in via `CHAOS_ENABLED`, seeded per connection for reproducibility,
scoped so no connection can affect feed state or other connections. Reassess
before public deployment (resource exhaustion is self-inflicted but still
costs server CPU).
