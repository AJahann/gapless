# Technical review and remediation roadmap

Review baseline: `a3c0ecbb0030d81373fe7ca69132218ad14d6cd5`.

## Verdict

The package boundaries and shared reducer are sound. Keep the architecture;
repair its contracts before adding features or performing broad cleanup.
The repository is a useful demo, not yet a verified implementation of all its
published guarantees. Green tests currently establish less than the roadmap
claims. Public deployment should wait for configuration/resource hardening.

This review compares implementation with `AGENTS.md`, `docs/protocol.md`,
`docs/sync-algorithm.md`, `docs/testing.md`, `docs/performance.md`, and the
original roadmap. Findings below distinguish executed evidence from static
failure paths. No runtime fixes are included in this documentation change.

## Verification baseline

- Unit/integration suite: 64 tests across 10 files pass.
- Biome: passes. Oxlint: exits successfully with eight function-length warnings.
- TypeScript: all four workspace projects pass `tsc --noEmit`.
- Server tsup build: passes. Next.js production build: passes.
- Playwright attempt: blocked by `config.webServer` readiness timeout (60 s).
  No browser scenarios completed in this review; do not call E2E verified.
- Direct env probe: strings `TEST_CONTROL=false` and `CHAOS_ENABLED=false`
  both resolve to `true`.
- Numeric probe: `Number.isSafeInteger(67450000000 * 50000 * 10)` is false.
  This demonstrates an allowed volume accumulation can exceed exact JS integers;
  it does not prove a client/server digest mismatch in a particular run.
- Previous full-suite cold run timed out in the first health test; isolated and
  subsequent full runs passed. Track startup sensitivity; do not mask with retries.

Independent source probes also reproduced: pendingSize 1000 during syncing;
44 immediate resumes for 300 future deltas; snapshot-gap deadlock; late snapshot
resurrecting a stopped engine; old close disrupting a replacement connection;
untracked retry surviving cut/restore; six seconds of healthy heartbeats with
a hung snapshot; premature LIVE below replay head. These were controlled
source-level probes, not browser or production deployment verification.

## Severity and evidence

P0: unsafe exposure or violation of the core stream-correctness contract.
P1: reliability, bounded-resource, test-trust or published-evidence blocker.
P2: scale, UX, maintainability or secondary contract mismatch.
Static findings are code-path analysis unless explicitly marked as executed.
Line references refer to the baseline above, not future revisions.

### F01 — Boolean flags cannot safely disable privileged controls [P0]

Evidence: `apps/server/src/config/env.ts:21-23`; `apps/server/src/app.ts:29`;
`docker-compose.yml:6-15`. Executed env probe confirms non-empty string `false`
coerces to true. Test-control defaults are also true; Compose exposes backend
and frontend host ports and enables globally mutating test endpoints.

Impact: an operator setting `TEST_CONTROL=false` still exposes pause/restart
routes. CORS is not authentication and does not protect against direct HTTP
clients. This is not a request to add accounts: public mode should remove these
routes and deny shared-feed mutations by default.

### F02 — Arbitrary feed IDs permit uncontrolled work/allocation [P0]

Evidence: `apps/server/src/feed/feed.ts:35-47,212-218`;
`apps/server/src/feed/registry.ts:22-40`; `apps/server/src/app.ts:44-49`;
`packages/protocol/src/index.ts:65-73`.

IDs are split and `parseInt`-parsed, not validated against supported universes,
finite rate bounds or canonical syntax. Unknown universes become top100 while
remaining separate registry keys. Replay rings are capped individually, but
feed count and aggregate generation work are not. A huge rate can monopolize
one generator tick; many distinct HTTP IDs can allocate many feeds.

### F03 — Snapshot-behind-buffer path can remain syncing forever [P0]

Evidence: `packages/engine/src/sync/sync-engine.ts:386-394,451-479` versus
`docs/sync-algorithm.md:58-74`.

Install snapshot S while smallest pending seq exceeds S+1. The handler calls
`requestResume()` while state is still `syncing`; that function immediately
returns. Heartbeats keep the socket alive, but gap/tail resume requests are
also rejected in syncing. The intended one-resume/refetch path never starts.
Additionally, attempts reset on every successful fetch before the contiguity
check, so the stated bounded retry policy is not implemented correctly.
The same deadlock occurs after partially draining pending [S+1, S+3].
No five-second snapshot deadline exists: a never-settling fetch with healthy
heartbeats can keep syncing indefinitely. Controlled probes reproduced both
the initial-hole deadlock and missing deadline.

### F04 — Pending map is not a hard memory bound [P1]

Evidence: `sync-engine.ts:310-324,386-406`. Every future delta is inserted first.
Crossing 256 only sends another resume, never caps memory; during syncing,
resume is ignored. Slow/hung snapshots and sustained missing deltas can grow
pending without limit. Forced resume on every overflow delta also risks hitting
the server's 20-messages/sec close policy. Preserve correctness through bounded
resync/reconnect, not silent arbitrary delta eviction.
Executed probes buffered 1000 deltas while syncing without recovery and sent
44 immediate resumes for 300 future deltas after an installed position.
Contiguous deltas also bypass staging while syncing: initial seq 1 and 2 can
advance lastSeq with zero quotes. Cutting before snapshot then advertises a
resume position for which no baseline state was ever installed.

### F05 — Epoch restart is not signaled to connected clients [P0]

Evidence: `apps/server/src/feed/feed.ts:110-126`;
`apps/server/src/ws/handler.ts:115-135`;
`packages/protocol/src/index.ts:133-143`; `sync-engine.ts:299-307,360-370`.

Restart resets seq but retains subscribers. Deltas/heartbeats carry no epoch;
existing clients see lower seq as duplicates and do not necessarily request
resume. When the new stream overtakes the old seq, it can apply new-epoch deltas
to old quotes without installing a new snapshot. Close affected sockets for a
fresh handshake, or design/version an explicit epoch-reset message. Clearing
feed state alone is insufficient.

### F06 — Async lifetimes lack generation ownership [P1]

Evidence: `sync-engine.ts:132-151,200-210,409-438,511-559`.
`stop()` does not abort an in-flight snapshot. Snapshot retry timeouts are not
tracked by `clearAllTimers()`. Close does not invalidate active fetches.
Socket callbacks are not scoped to a connection generation; a delayed old
close/message can affect a newer connection after rapid cut/restore/start.
Controlled source probes reproduced stopped-engine resurrection after snapshot
completion, old-close disruption of a new socket, and an old snapshot retry
starting a fetch after cut/restore. Browser adapter lifecycle remains a separate
regression target.

### F07 — Snapshot and delta semantic validation is incomplete [P1]

Evidence: `apps/web/src/feed/feed-client.ts:154-162`;
`apps/web/src/feed/engine.worker.ts:176-184`;
`packages/protocol/src/index.ts:17-52`; `sync-engine.ts:327-340`.

HTTP snapshots are cast, not schema-validated. Schemas do not establish aligned
symbol/quote arrays, contiguous indices, matching feed identity or valid symbol
bounds. An unknown symbol index still advances lastSeq without applying a quote.
Validate at the boundary and fail/recover explicitly; do not advance past an
unusable event. Specify negative-price and integer-range policy as well.

### F08 — Fixed-point volume is not necessarily exact [P1]

Evidence: `packages/engine/src/universe.ts:190-200`;
`packages/protocol/src/index.ts:34-43`; `docs/decisions/0003-fixed-point-wire.md`.

`price * size` and cumulative volume use Number. Accumulation can exceed safe
integer precision even with normal fixture prices/sizes. Shared arithmetic may
still converge, but does not establish exact integer financial quantities.
Choose an explicit bounded numeric contract or a versioned lossless integer
encoding; do not merely tighten validation and then break normal snapshots.
A source probe with price 67450000001, size 49999, three trades yielded
10117297650149996 instead of exact 10117297650149997. Installed Zod `.int()`
already rejects unsafe integers, but HTTP serialization bypasses validation.
Adding `.safe()` alone cannot repair already-rounded arithmetic.

### F09 — Feed lookup defeats idle expiry [P1]

Evidence: `apps/server/src/feed/registry.ts:22-40,75-90` and HTTP handlers.
HTTP-only creation never schedules the subscriber-left timer. A later HTTP
lookup cancels an existing idle timer without scheduling its replacement.
Unused feeds can remain retained; a previously started generator can continue.
Separate observation from acquisition and make zero-subscriber expiry universal.

### F10 — Delayed socket writes bypass bounded lifetime/backpressure [P1]

Evidence: `apps/server/src/ws/handler.ts:77-97,285-299`;
`packages/protocol/src/index.ts:84-93`.

Delay/jitter have no upper bound; each frame gets an untracked timeout.
`bufferedAmount` is checked before scheduling, not at actual send. Cleanup
cannot cancel delayed work or account for its queued bytes. Delay applies to
control frames too, unlike the documented deltas-only chaos policy.
Bound queued work, recheck send-time backpressure, cancel on close, distinguish
control/data delivery and test deterministic seeded behavior.

### F11 — Handshake identity and payload limits need enforcement [P1]

Evidence: `ws/handler.ts:41,158-215,301-312`; `app.ts:31-32`.
`hello.feed` is never compared with the URL feed. The 4 KiB application check is
string length after decoding, not bytes or a transport-level allocation limit.
Missing Origin is accepted; this needs an explicit non-browser-client policy,
not an assumption that Origin is authentication. Validate before feed allocation,
configure WS maxPayload, reject mismatched identity and test byte boundaries.

### F12 — Worker lifecycle performs side effects during render [P1]

Evidence: `apps/web/src/app/page.tsx:46-58`;
`apps/web/src/feed/worker-feed-client.ts:72-92,140-147`.
Construction starts a Worker inside useMemo/render. stop terminates it; start
cannot recreate it. Strict Mode effect replay, abandoned renders and reuse after
stop can leak or strand clients. Static risk, not browser-reproduced here.
Give effect-owned lifecycle idempotent start/stop and restartability tests.

### F13 — View histories and user controls outlive their connection [P1]

Evidence: `feed-client.ts:195-210,307-314`;
`engine.worker.ts:206-218`; `status-bar.tsx:26-53`;
`apps/web/src/components/chaos-panel/chaos-panel.tsx`.

Epoch replacement does not clear tapes/sparkline histories. Outage timers lack
unmount/client-change cleanup. Chaos controls remain selected after reconnect or
rate change although settings are per socket and are not reapplied/acknowledged.
Define reset versus reapply policy, avoid an endless silent-reconnect loop, and
ensure old timers cannot control discarded clients. Retain epoch in trade keys
or clear histories at the epoch boundary.

### F14 — Freshness and sparse updates disagree with the UI contract [P2]

Evidence: `market-table.tsx:25-27`; `feed-client.ts:364-381`;
`worker-feed-client.ts:115-137`; `docs/sync-algorithm.md:23-24,76-92`.

Connecting/syncing/replaying data is not marked stale. Sparkline-only changes
update caches without symbol notifications; paused/cold rows may not refresh.
Visibility/online/offline behavior described in the design is absent from the
browser adapter. Define elapsed-time freshness separately from transport state,
notify sparse buffer changes and recheck liveness after background suspension.

### F15 — Published latency/coalescing evidence is not measured [P1]

Evidence: `scripts/bench.mjs:147-172`; `README.md:96-107`;
`docs/performance.md:19-38`; `perf/results/run-1794348111878.json`.

p95 latency is literally assigned 12 ms for worker and 18 ms for main.
Coalescing divides deltas by assumed 60 Hz frames; missing metrics fall back to
configured rate. These columns must not be represented as measured results.
Actual long-task observations do not validate the other columns. Retract or
label affected columns immediately; do not rerun the same script as evidence.

### F16 — Benchmark runner does not execute the stated method [P2]

Evidence: `scripts/bench.mjs:7-22,24-85,178-216`;
`docs/performance.md:17-25`.

Only top100 at three rates runs, for 5/15 s, not the documented 30 s full matrix
and 10-minute soak. Existing backend health skips checking frontend readiness;
readiness exhaustion need not throw. Cleanup lacks finally; worker memory is
not covered by page heap. Exact Markdown marker matching can silently skip
regeneration. Collect explicit unsupported values rather than fake zero/flat.

### F17 — Existing tests do not prove stated recovery guarantees [P1]

Evidence: `e2e/recovery.spec.ts:60-61,108-109,129-150,249-277`;
`packages/engine/src/sync/convergence.test.ts:98-158`;
`vitest.config.mjs:3-10,19-23`; `apps/web/src/feed/feed-client.test.ts`.

E2E uses fixed sleeps, never compares client/server digests, and restart can
pass by observing the pre-existing LIVE status. Counter increments cannot prove
absence of corruption. The property test uses one fixed script and manually
bridges all missing events rather than exercising a responsive replay server,
fetch/reconnect failure sequences or memory bounds. Frontend coverage is three
Node tests, not the documented React/worker/component suite.

### F18 — Large-universe rendering and hot-path work need measurement [P2]

Evidence: `market-table.tsx:57-64,126-160`;
`feed-client.ts:290-304`; `docs/ROADMAP.md:74-87`.

Every 10k row/canvas mounts; planned virtualization is absent. Main-thread tape
materialization occurs per delta, not per flush. Inline onSelect functions
invalidate row memo props when the parent rerenders; number formatting is not
cached as specified. Correctness first, then profile before choosing optimizations.

### F19 — Demo semantics/accessibility and outage promises are inaccurate [P2]

Evidence: `market-table.tsx:33,48-50,113-118`; `status-bar.tsx:168-188`;
`docker-compose.yml:12`; `apps/web/src/components/concepts-guide/concepts-guide.tsx`.

Columns labeled 24h actually use session open/high/low. Tiny token prices can
round to zero. Keyboard selection/range labeling/accordion expanded state need
accessible semantics. Compose uses a two-second replay window while controls
promise two- and fifteen-second replay; reconnect overhead alone can expire the
two-second case. The 100k entry cap also shortens coverage at high rates.
Display recovery policy/window honestly; do not promise a mechanism by duration
without checking actual sequence coverage.

### F20 — Documented complexity and completion status overstate implementation [P2]

Evidence: `feed/feed.ts:167-189`; `docs/data-structures.md:9-15`;
`docs/ROADMAP.md:7-17`; README documentation table.

Replay scans the entire ring rather than indexing seq to its starting slot.
Docs describe Map/typed-array structures that are actually arrays/generic rings,
and some K/tape bounds differ. Roadmap marks all gates Done despite missing
virtualization, component tests, convergence E2E and genuine latency metrics.
Retain historical delivery status but attach remediation qualification; do not
rewrite history as if the missing evidence existed.

### F21 — Replay reports live before reaching its advertised head [P1]

Evidence: `sync-engine.ts:259-279,304-307,337-355`. Welcome headSeq is not
retained as a recovery target. Empty pending after the first contiguous replay
delta changes state to live even when later replay frames remain outstanding.
Controlled probe: installed seq 100, replay welcome head 105, receive only 101;
state becomes live at 101 with replays=1. Subsequent replay applications are
undercounted. Track the handshake replay target and keep data non-fresh until
contiguous recovery reaches it. In-band resume currently has no success/target
acknowledgement: define completion and metric provenance explicitly, versioning
any breaking wire change. A counter of applications while recovering is not
necessarily a count of replay-origin events.

## Remediation delivery rules

- Use phases R0-R7 below; these are separate from original feature phases 0-8.
- Every phase starts with failing regression tests for its concrete defects.
- Preserve dependency direction: protocol, then framework-free engine, then apps.
- Never coalesce stream identity/state, only delivery to the renderer.
- Protocol-breaking changes require updated spec, ADR and version negotiation.
- Each phase ends with format, lint, all typechecks, full tests and both builds.
  Relevant browser gates must run against a real server; document blockers.
- Each PR records evidence and unresolved findings. No phase becomes Done merely
  because the happy-path demo loads. No commits/pushes are implied by this plan.

## Phase R0 — Honest baseline and immediate exposure containment

Priority: first. Findings: F01, F15, F17, F20 (containment, not full closure).
Dependencies: none.

Work:

1. Parse explicit boolean strings; default shared-feed test mutation off.
2. Separate local/test Compose overrides from public configuration; bind direct
   debug ports to loopback or remove publication. Public demo may opt into
   bounded per-connection chaos, never global pause/restart controls. Use
   non-root runtime images and document TLS termination at public ingress;
   plaintext internal HTTP is not itself a public TLS configuration.
3. Mark latency/coalescing columns unverified; preserve raw artifacts with a
   provenance warning. Correct roadmap/README claims and pending status.
4. Diagnose Playwright webServer startup timeout and capture actionable logs.
   Ensure fixture ownership/configuration instead of silently reusing servers.

Acceptance:

- Env table tests cover missing, true, false, invalid, 1/0 policy.
- Public HTTP mutation routes absent; WS pause/unpause cannot mutate feeds.
- Public/local/test configurations are documented and tested independently.
- E2E starts reliably from a clean checkout, or a precise external blocker is
  recorded. Unsupported metrics are null/unavailable, never fabricated values.

## Phase R1 — Repair sync state and async ownership

Priority: core correctness. Findings: F03, F04, F06, F12, F21.
Dependencies: R0.

Work:

1. Make snapshot buffering explicit; do not apply pre-install deltas to stale
   quote state. Implement behind-buffer resume/refetch transitions with bounded
   attempts and an injected five-second snapshot deadline.
2. Enforce hard pending bounds. On overflow invalidate obsolete work and take a
   documented bounded recovery path. Throttle retries; one controlled resume
   operation at a time, including loss during replay.
3. Own every timer/fetch/socket callback by session generation. Abort/invalidate
   on stop, cut, close and replacement; ignore late callbacks.
4. Make both clients start/stop idempotent and restartable. Construct Workers
   in start/effect-owned lifecycle, not during render.
5. Track replay target/completion; remain replaying below the advertised head.
   Specify in-band resume completion and honest replay-counter semantics.
6. Honor negotiated heartbeat interval or reject unsupported negotiation;
   separate connection failures from terminal protocol failures.

Acceptance:

- Deferred snapshots with pending [S+2] and [S+1, S+3] recover or terminate
  within the bounded attempt policy; successful but unusable snapshots do not
  reset that budget. Cut/restore during initial sync never resumes without an
  installed baseline.
- Multi-frame replay with a delayed/lost final frame stays non-live below target;
  counters follow the specified semantics, including in-band repair.
- Never-settling snapshot times out; three failed attempts reach defined error.
- Sustained loss/10k input never exceeds the documented pending memory cap and
  never sends an unbounded resume storm.
- stop/cut during fetch/retry leaves no active timers/fetches; stale close and
  stale snapshot cannot alter a new session.
- Strict Mode mount/cleanup/remount and start-stop-start work in both modes;
  unmount returns live Worker/socket/timer counts to baseline.

## Phase R2 — Enforce epoch, identity and numeric contracts

Priority: core correctness. Findings: F05, F07, F08, F11.
Dependencies: R1; resource validation from R3 may land early with R0.

Work:

1. Select restart strategy: close subscribed sockets and re-handshake, or an
   explicitly versioned reset message. Reject late pre-reset frames.
2. Centralize canonical feed parsing for HTTP, WS, hello and URL input.
3. Validate snapshot structure and semantics before state replacement; reject
   wrong feed, invalid index, impossible position and malformed numeric values.
4. Define safe integer/volume encoding. If using decimal strings/BigInt, update
   schema, reducer, digest, snapshots, Worker transport and formatting together.
5. Require explicit protocol version/identity consistency; document compatibility.

Acceptance:

- Restart while live, while replaying and during fetch always changes observed
  epoch, installs new state and converges; old epoch cannot be applied.
- Same `(epoch, seq)` produces equal quote state across server/main/worker.
- Misaligned/wrong-feed snapshots and out-of-range deltas fail safely without
  silently advancing seq. hello URL/body mismatch is rejected before allocation.
- Boundary/long accumulation tests prove selected numeric contract is lossless
  within its stated domain; version-mismatch tests cover breaking changes.

## Phase R3 — Bound backend resources and transport work

Priority: public-deployment gate. Findings: F02, F09, F10, F11, F20 (replay).
Dependencies: R0; share feed parser with R2. Do not wait for UI polish.

Work:

1. Restrict accepted universes/rates/ID length, cap active feeds/connections and
   aggregate rate/memory, reject invalid values before constructing a Feed.
2. Split get/create/acquire/observe semantics. Schedule idle expiry for every
   zero-subscriber feed, including HTTP-only access; read must not disable TTL.
3. Replace per-frame unowned delay timers with bounded queued bytes/items and
   cancellation. Check backpressure at actual send, close slow consumers.
4. Apply chaos only to documented traffic; cap delay/jitter, preserve reproducible
   seeds. Enforce byte maxPayload at transport level and pre-hello policy.
5. Index replay start by sequence if retaining the O(1) lookup claim; remove
   unnecessary synchronous replay queue machinery only after ordering tests.
6. Verify shutdown closes sockets with documented code, releases timers/feeds.

Acceptance:

- Invalid/huge/alias IDs fail with controlled errors, no allocation or runaway tick.
- Fake-time registry tests show HTTP-only feeds and previously active feeds expire.
- Sustained delay/duplicate/replay with slow readers remains within queue bounds;
  close leaves no delayed sends; other connections remain unaffected.
- Real sockets cover exact replay edge oldestSeq-1, expiry/future, 1000-delta
  frame cap, unauthorized origin policy, hello timeout, byte/message rate limits,
  slow-consumer close and graceful process shutdown.

## Phase R4 — Align frontend state, controls and freshness

Priority: reliability/UX. Findings: F13, F14, F19.
Dependencies: R1, R2; use final capabilities from R3.

Work:

1. Clear epoch-owned tapes/sparklines/quote caches on epoch replacement.
2. Cancel outage timers on unmount/client changes. Define desired versus applied
   chaos settings; reset/reapply visibly on reconnect without silent-loop traps.
3. Expose freshness based on engine state plus elapsed event time. Add browser
   visibility/network hints with cleanup and elapsed-time watchdog checks.
4. Notify sparkline-only changes in both modes. Validate URL state before client
   creation; derive symbols reactively, handle browser history deliberately.
5. Rename session statistics, format tiny prices meaningfully, use cached number
   formatters; make row selection/sliders/guide keyboard/screen-reader usable.
6. Make outage presets relative to actual replay capacity or label them as
   illustrative, not guaranteed replay/snapshot outcomes.

Acceptance:

- Component tests cover reconnect/sync/replay stale data, cold-symbol sparkline,
  epoch reset, outage plus rate switch/unmount and chaos reconnect policy.
- No orphan clients after switching rates/modes. UI applied settings match wire.
- Accessible names/expanded state/keyboard selection tested by role and label.
- Same visible state and controls behavior in main/worker modes.

## Phase R5 — Turn tests into evidence, not counters

Priority: release-confidence gate. Findings: F17; regression coverage for R1-R4.
Dependencies: R1-R4. Tests are added throughout; this phase completes breadth.

Work:

1. Build deterministic fake clock/socket/fetch harness that actually answers
   resume, expires replay and controls delayed snapshots/disconnects.
2. Run multiple seeded fault scripts with termination, hard memory bounds,
   monotonic application and exact convergence assertions.
3. Add React component and Worker contract/lifecycle coverage; avoid private
   callbacks as the only test surface.
4. E2E pause a real feed, read server epoch/head/digest, wait for client same
   position, compare actual client digest in both modes through a test-only hook.
5. Replace fixed outage sleeps with head/oldestSeq coverage polling. Restart
   tests must observe new epoch and snapshot before accepting LIVE.
6. Run public-config negative tests plus production-built E2E; retain traces and
   server logs. Assert invariants rather than brittle exact display counts.

Acceptance:

- Each F01-F14 and F21 defect has a regression that fails on the baseline
  implementation.
- Main and Worker recover from short/expired outages, restart and each fault
  mode; digest equality asserted after faults cease and feed is paused.
- No `waitForTimeout` in recovery tests. Clean startup, deterministic seeds,
  multiple repeat runs and CI-head evidence; retries do not hide flakes.

## Phase R6 — Real instrumentation, then measured optimization

Priority: evidence/performance. Findings: F15, F16, F18.
Dependencies: R4, R5; remove false claims immediately in R0.

Work:

1. Define a measurable receive-to-render/paint-proxy boundary using one browser
   clock and sequence-tagged samples. rAF alone is not proof of physical paint;
   label the measurement precisely. Track actual flushed/rendered frames.
2. Measure counter deltas within the observation interval. Warm up separately,
   observe long tasks only in-window, report unsupported heap metrics as null.
3. Repair readiness, child ownership, finally cleanup and robust bounded-markers
   document generation. Preserve raw samples, method, commit, browser/hardware.
4. Execute promised rate/mode/universe matrix, 30-second cells, 10-minute soak;
   report unsupported/failed cells honestly. Account for Worker heap scope.
5. Profile first; virtualize above 500 rows, materialize tapes once per dirty
   flush, stabilize row props and cache formatters where profiling supports it.
   Do not deduplicate or drop trade-state events to meet a rendering target.

Acceptance:

- No literal latency values, configured-throughput substitutes or assumed-frame
  metrics. Fixture instrumentation tests validate percentile/count calculations.
- Raw sample aggregation reproduces published summaries. Soak reports bounds,
  GC context and heap scope; failed budget cells remain visible.
- Compare same hardware/build before/after; 10k table mounts only visible rows
  plus bounded overscan. R5 convergence remains green at every supported rate.
- Evaluate documented budgets (p95 <50 ms at 1k main, replay <=1 s, snapshot
  <=2 s, long tasks and memory) with real results; failures are not auto-waivers.

## Phase R7 — Small structural cleanup and release reconciliation

Priority: maintainability. Findings: remaining F19/F20 and verified duplication.
Dependencies: R0-R6.

Work:

1. Extract shared browser transport/snapshot validation, bounded history helpers
   and top-mover computation where both clients need identical semantics. Keep
   mode-specific scheduling separate; avoid creating a generic event framework.
2. Split WS handshake, connection lifecycle and bounded delivery into focused
   modules only under existing contract tests. Remove unused singleton factory
   or define its ownership/feed-change behavior explicitly.
3. Reconcile docs with actual arrays/rings, K values, complexities, supported
   matrix, session labels, public deployment and real evidence.
4. Update historical roadmap qualifications, acceptance statuses and runbook;
   record explicitly deferred functionality rather than declaring it done.

Acceptance:

- No protocol/observable behavior changes in cleanup-only commits.
- All gates green, production-config smoke/E2E verified, public mutation absent.
- Docs and generated metrics trace to reproducible commands/raw artifacts.
- Each finding has a disposition: fixed with test, explicitly deferred with
  accepted risk/owner, or rejected with counter-evidence. No unexplained closure.

## Implementation order and scope control

Start R0, then R1. Run R2 and R3 as coordinated workstreams once identity and
numeric decisions are agreed. R4 follows those contracts; R5 completes proof;
R6 measures and optimizes; R7 cleans up only after behavior stabilizes.
Backend exposure/resource fixes may be pulled forward, never postponed behind
cosmetic work. No rewrite, no new database, no real exchange integration, no
auth product or infrastructure expansion is required to repair this demo.

Suggested ownership: backend lead (R0/R3), engine lead (R1/R2), frontend lead
(R4/R6), test owner (R5), technical lead (cross-phase contracts/R7).
These are role assignments for planning, not claims that people are assigned.
