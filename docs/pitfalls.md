# Pitfalls

Monorepo and platform notes. Add entries when something bites, with the fix.

## Tooling

- **pnpm shim on Windows (this host)**: Corepack's global shim breaks on `E:`
  (`Cannot find module 'E:\c\Program Files\nodejs\...'`). Use
  `npx -y pnpm@12.18.0 <cmd>` or `./node_modules/.bin/<tool>` directly.
- **TypeScript**: 5.9.x, not 7.x. Next 16 + ecosystem plugins are validated
  against 5.x here.
- **Emit hygiene**: `pnpm typecheck` runs `tsc --noEmit` per package. Never run
  bare `tsc -b` across mixed packages — stray `.js` next to `.ts` sources get
  picked up by bundlers and Vitest and shadow the TypeScript.
- **Workspace packages ship source**: `exports` points at `src/index.ts`.
  Server bundles them via tsup `noExternal: [/^@gapless\//]`; Next via
  `transpilePackages`. Adding a subpath export means updating both.
- **Line endings**: `git config core.autocrlf input` (already set for this
  repo). Biome CI enforces LF; CRLF checkouts fail format checks in bulk.
- **Env access**: only `apps/*/src/config/env.ts` may read `process.env`
  (oxlint override). Everything else takes typed config by injection — unit
  tests and CI run with no `.env`.

## Real-time specifics

- Browsers cannot send WS ping frames. Liveness is the app-level heartbeat.
- `navigator.onLine` and the `online` event are hints, never proof.
- Hidden tabs throttle timers and stop rAF: apply deltas to state regardless,
  flush once on `visibilitychange`, and re-check elapsed time before declaring
  a connection dead.
- `bufferedAmount` on the server socket is the slow-consumer signal. Never
  silently drop deltas to catch up — close 4000 and let resume recover.
- Snapshot building must stay synchronous, or seq/quotes can tear.
- Every delta keeps its seq even when frames batch them; coalescing seqs on the
  server manufactures false gaps on the client.
- Fixed point on the wire (see protocol). Float accumulation makes the digest
  comparison meaningless.
- Chaos must be seeded and per connection, otherwise tests are not reproducible
  and one visitor can degrade another's stream.
