# gapless

Simulated real-time market dashboard. Top-100 tokens, live price ticks, and
**Cut connection** button. The point is not the prices — it is what happens when
the stream is unreliable: sequence gaps, duplicates, replay, snapshot recovery,
and a UI that stays responsive at 100–10,000 updates/sec.

All market data is simulated. No exchange connection, no real money, no API keys.

---

## Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │            Fastify Backend (:4000)           │
                       │  - Zipf & GBM Simulated Feed Generator       │
                       │  - Strictly monotonic (epoch, seq) assignment│
                       │  - Synchronous atomic snapshot endpoint      │
                       │  - Bounded replay RingBuffer<Delta>          │
                       │  - Per-connection chaos stage                │
                       └───────────────────┬──────────────────────────┘
                                           │
                        /ws/feeds/:id (WebSocket)   /api/feeds/:id/* (HTTP)
                                           │
                       ┌───────────────────▼──────────────────────────┐
                       │            Caddy Reverse Proxy (:80)         │
                       │  /api/*, /ws/* → server:4000                 │
                       │  /*            → web:3000                    │
                       └───────────────────┬──────────────────────────┘
                                           │
                       ┌───────────────────▼──────────────────────────┐
                       │             Next.js 16 Web Client            │
                       │  - Zero-dependency SyncEngine state machine   │
                       │  - Main-thread / Web Worker modes            │
                       │  - requestAnimationFrame coalesced renderer  │
                       │  - Top-5 movers min-heap (O(n log k))        │
                       │  - Canvas sparklines (1 Hz ring buffer)      │
                       │  - Raw trade tape (bounded ring of 200)      │
                       └──────────────────────────────────────────────┘
```

---

## Live Demo Walkthrough

1. **Clean Stream**: Load the dashboard. 100 assets stream live ticks, with connection status `LIVE` and monotonically increasing sequence numbers.
2. **Short Outage Replay**: Click **Cut 2s (replay)**. The connection is severed, UI marks state as `OFFLINE` with a `STALE` badge. Upon reconnection, the client detects the gap and sends an in-band resume. The server replays the missed window: `Replayed` counter increments, and `Snapshots` remains 0.
3. **Long Outage Snapshot**: Click **Cut 45s (snapshot)**. Outage exceeds the server's replay buffer window. Upon reconnection, server responds with `replay_unavailable: expired`. Client seamlessly fetches a synchronous atomic snapshot over HTTP, catches up any interleaved buffered live deltas, and converges to `LIVE` (`Snapshots` increments by 1).
4. **Chaos Injection**: Adjust **Drop**, **Duplicate**, **Reorder**, **Jitter**, or **Silent socket** in the Chaos Panel. The client sync engine transparently de-duplicates, sorts out-of-order packets via its bounded reorder window, requests in-band resumes, and watchdog-reconnects when silent.
5. **Throughput & FPS Controls**: Switch updates per second on the fly (`100/s`, `500/s`, `1k/s`, `5k/s`, `10k/s`) and monitor real-time rendering smoothness via the rolling rAF FPS badge.
6. **Main vs Worker Mode**: Switch between main-thread rendering (`?mode=main`) and Web Worker background synchronization (`?mode=worker`) to offload transport parsing and state machine updates.
7. **Concepts Guide**: Expand interactive accordion cards at the footer detailing `seq`, `epoch`, `gap`, `replay`, `snapshot`, and `chaos` distributed stream mechanics.

---

## Quickstart

### Local development

```sh
corepack enable
pnpm install
cp .env.example .env

# Run both backend server (:4000) and Next.js web (:3000)
pnpm dev

# Verification checks (Biome format + Oxlint + Typecheck + Unit tests)
pnpm check

# Production build
pnpm build

# Real-browser Playwright E2E recovery test suite (11 scenarios)
pnpm test:e2e

# Or against running Docker containers
TARGET_URL=http://127.0.0.1:80 pnpm test:e2e

# Run performance benchmarks
node scripts/bench.mjs --quick
```

### Docker deployment

```sh
# Public production mode (isolated internal backend, Caddy ingress on :80/:443)
docker compose up --build -d

# Local dev/test mode (loopback ports :4000 and :3000, test controls enabled)
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

Visit `http://localhost`. See [docs/deployment.md](docs/deployment.md) for TLS termination and configuration details.

---

## Measured Performance

Benchmarks measured via headless Chromium runner (`scripts/bench.mjs`) on an Intel Core i7-13620H host.

> **Provenance Notice**: Columns marked `[unverified]` were placeholder constants/estimates in baseline `59612ac` (see [TECH-LEAD-REVIEW.md](docs/TECH-LEAD-REVIEW.md) F15). Real browser receive-to-paint instrumentation and true frame coalescing metrics will be measured in remediation Phase R6.

| Commit    | Hardware                                         | Rate   | Universe | Mode   | p95 recv→paint [unverified] | Long tasks   | Heap Δ | Coalescing [unverified] |
| --------- | ------------------------------------------------ | ------ | -------- | ------ | --------------------------- | ------------ | ------ | ----------------------- |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 100/s  | top100   | main   | N/A (unverified)            | 5 (max 93ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 100/s  | top100   | worker | N/A (unverified)            | 2 (max 66ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 1000/s | top100   | main   | N/A (unverified)            | 2 (max 62ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 1000/s | top100   | worker | N/A (unverified)            | 2 (max 64ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 5000/s | top100   | main   | N/A (unverified)            | 8 (max 76ms) | 0.0 MB | N/A (unverified)        |
| `59612ac` | 13th Gen Intel(R) Core(TM) i7-13620H (win32 x64) | 5000/s | top100   | worker | N/A (unverified)            | 6 (max 66ms) | 0.0 MB | N/A (unverified)        |

---

## Documentation

| Document                                             | Description                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| [docs/TECH-LEAD-REVIEW.md](docs/TECH-LEAD-REVIEW.md) | Technical review, audit findings (F01–F21), and remediation roadmap (R0–R7)  |
| [docs/deployment.md](docs/deployment.md)             | Production vs local Docker configuration, non-root images, TLS termination   |
| [docs/protocol.md](docs/protocol.md)                 | Wire protocol v1 specification, sequence identity, fixed-point math          |
| [docs/sync-algorithm.md](docs/sync-algorithm.md)     | Client sync engine state machine, delta gate, resume and snapshot recovery   |
| [docs/data-structures.md](docs/data-structures.md)   | Algorithmic choices, Big-O complexities, RingBuffer and TopK heap benchmarks |
| [docs/testing.md](docs/testing.md)                   | Testing matrix and the convergence invariant property test                   |
| [docs/performance.md](docs/performance.md)           | Detailed benchmark protocols and performance measurement tables              |
| [docs/ROADMAP.md](docs/ROADMAP.md)                   | Implementation roadmap and acceptance criteria across phases 0–7             |
| [docs/decisions/](docs/decisions/)                   | Architectural Decision Records (ADRs 0001–0004)                              |

---

## License

MIT
