# AGENTS.md — implementer guide

Demo repo: simulated real-time top-100 token dashboard showcasing reconnect,
gap detection, replay and snapshot recovery. Read `docs/ROADMAP.md` for the
current phase and its acceptance gates; implement only that phase.

## Layout

```
apps/server        Fastify + @fastify/websocket (port 4000)
apps/web           Next.js App Router + React 19 (port 3000)
packages/protocol  zod wire schemas — the only place message shapes are defined
packages/engine    framework-free structures, reducer, sync engine
docs/              design, protocol, algorithm, testing, performance, ADRs
```

Dependency direction: `protocol` ← `engine` ← `server`/`web`. `engine` must not
import React, Next, Fastify, DOM or Node built-ins.

## Commands

```sh
npx -y pnpm@12.18.0 install     # pnpm shim is broken on this host
pnpm dev                        # both apps
pnpm check                      # format + lint + typecheck + unit tests
pnpm build
./node_modules/.bin/vitest run --project engine
./node_modules/.bin/biome format --write <files>
```

## Rules

1. Protocol changes start in `docs/protocol.md` + `packages/protocol`, never as
   ad-hoc payloads in app code. Bump `PROTOCOL_VERSION` on breaking changes.
2. `applyDelta` reducer is shared by server and client. Divergence breaks the
   convergence invariant that the whole demo rests on.
3. Every delta keeps its seq. No coalescing of state, only of rendering.
4. No `shift()` in hot paths, no per-delta React setState, no unbounded arrays.
5. Time, RNG, sockets and fetching are injected into the engine; tests use fakes.
6. Tests follow `docs/testing.md`. E2E: real browser and server, no MSW, no
   `waitForTimeout`; poll counters/digest instead.
7. Performance claims require measured numbers in `docs/performance.md`.
8. Process env only in `apps/*/src/config/env.ts`; inject config elsewhere.
9. Format with Biome (LF, single quotes, 80 cols), lint with oxlint. Both must
   pass before committing.
10. Commit small, conventional messages, one phase per branch/PR. Do not push or
    merge unless asked.

## Definition of done (per phase)

Roadmap gates + `pnpm check` green + build green + docs updated when behaviour
or protocol changed.
