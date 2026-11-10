# gapless

Simulated real-time market dashboard. Top-100 tokens, live price ticks, and a
**Cut connection** button. The point is not the prices — it is what happens when
the stream is unreliable: sequence gaps, duplicates, replay, snapshot recovery,
and a UI that stays responsive at 100–10,000 updates/sec.

- **Server:** Fastify + `@fastify/websocket`. Deterministic simulated feed, per-feed
  global sequence numbers, bounded replay buffer, atomic snapshot endpoint.
- **Web:** Next.js (App Router) + React 19. Normalized state, `requestAnimationFrame`
  coalescing, ring-buffer sparklines, top-K heap, virtualized rows, Web Worker mode.
- **Shared:** `@gapless/protocol` (wire schemas) and `@gapless/engine`
  (framework-free data structures and sync engine, used by both sides).

All market data is simulated. No exchange connection, no real money, no API keys.

## Status

Phase 0: scaffold + design docs. Implementation roadmap in [docs/ROADMAP.md](docs/ROADMAP.md).

## Quickstart

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm dev          # server :4000, web :3000
```

```sh
pnpm check        # format + lint + typecheck + unit tests
pnpm build
pnpm test:e2e     # Phase 5
```

## Docs

| Doc                                                                    | Contents                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/day-25-realtime-dashboard.md](docs/day-25-realtime-dashboard.md) | System design: requirements, architecture, Big-O, recovery, failure modes |
| [docs/ROADMAP.md](docs/ROADMAP.md)                                     | Phase-by-phase implementation plan with acceptance gates                  |
| [docs/protocol.md](docs/protocol.md)                                   | Wire protocol: message shapes, seq/epoch rules, resume semantics          |
| [docs/sync-algorithm.md](docs/sync-algorithm.md)                       | Client sync engine state machine and edge cases                           |
| [docs/data-structures.md](docs/data-structures.md)                     | Chosen structures, complexity, measurement targets                        |
| [docs/testing.md](docs/testing.md)                                     | Test matrix and the convergence invariant                                 |
| [docs/performance.md](docs/performance.md)                             | Benchmark protocol and results (filled in Phase 6)                        |
| [docs/pitfalls.md](docs/pitfalls.md)                                   | Platform gotchas for this monorepo                                        |
| [docs/decisions/](docs/decisions/)                                     | ADRs                                                                      |
| [AGENTS.md](AGENTS.md)                                                 | Conventions and commands for implementers                                 |

## License

MIT
