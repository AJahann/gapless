import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const IS_QUICK = process.argv.includes('--quick');
const IS_SOAK = process.argv.includes('--soak');
const IS_FULL = process.argv.includes('--full');

const WARMUP_MS = IS_QUICK ? 2000 : 5000;
const DURATION_MS = IS_SOAK
  ? 600000
  : IS_FULL
    ? 30000
    : IS_QUICK
      ? 5000
      : 15000;

const COMMIT = execSync('git rev-parse --short HEAD', {
  encoding: 'utf-8',
}).trim();
const HARDWARE = `${os.cpus()[0]?.model?.split('@')[0]?.trim()} (${os.platform()} ${os.arch()})`;

const MATRIX = IS_SOAK
  ? [{ rate: 1000, universe: 'top100', mode: 'worker' }]
  : IS_QUICK
    ? [
        { rate: 100, universe: 'top100', mode: 'main' },
        { rate: 100, universe: 'top100', mode: 'worker' },
        { rate: 1000, universe: 'top100', mode: 'main' },
        { rate: 1000, universe: 'top100', mode: 'worker' },
      ]
    : [
        { rate: 100, universe: 'top100', mode: 'main' },
        { rate: 100, universe: 'top100', mode: 'worker' },
        { rate: 1000, universe: 'top100', mode: 'main' },
        { rate: 1000, universe: 'top100', mode: 'worker' },
        { rate: 5000, universe: 'top100', mode: 'main' },
        { rate: 5000, universe: 'top100', mode: 'worker' },
        { rate: 100, universe: 'top10k', mode: 'main' },
        { rate: 100, universe: 'top10k', mode: 'worker' },
        { rate: 1000, universe: 'top10k', mode: 'main' },
        { rate: 1000, universe: 'top10k', mode: 'worker' },
      ];

async function ensureServersRunning() {
  let serverRunning = false;
  let webRunning = false;

  try {
    const sRes = await fetch('http://127.0.0.1:4000/api/health');
    serverRunning = sRes.ok;
  } catch {}

  try {
    const wRes = await fetch('http://127.0.0.1:3000');
    webRunning = wRes.ok;
  } catch {}

  if (serverRunning && webRunning) {
    console.log('Servers already running on :4000 and :3000');
    return null;
  }

  let serverProc = null;
  let webProc = null;

  if (!serverRunning) {
    console.log('Starting Fastify backend server on :4000...');
    serverProc = spawn('node', ['apps/server/dist/server.js'], {
      env: {
        ...process.env,
        PORT: '4000',
        HOST: '127.0.0.1',
        CLIENT_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
        REPLAY_WINDOW_SEC: '30',
        CHAOS_ENABLED: 'true',
        TEST_CONTROL: 'true',
      },
      stdio: 'ignore',
    });
  }

  if (!webRunning) {
    console.log('Starting Next.js web frontend on :3000...');
    webProc = spawn(
      'node',
      [
        'apps/web/node_modules/next/dist/bin/next',
        'dev',
        'apps/web',
        '--port',
        '3000',
      ],
      {
        env: {
          ...process.env,
          PORT: '3000',
          HOSTNAME: '127.0.0.1',
        },
        stdio: 'ignore',
      },
    );
  }

  // Poll until both ready
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const sRes = await fetch('http://127.0.0.1:4000/api/health');
      const wRes = await fetch('http://127.0.0.1:3000');
      if (sRes.ok && wRes.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  return {
    kill: () => {
      if (serverProc) serverProc.kill();
      if (webProc) webProc.kill();
    },
  };
}

async function runBenchmark() {
  const cleanup = await ensureServersRunning();

  try {
    const browser = await chromium.launch({ headless: true });
    const browserVersion = browser.version();
    const results = [];

    try {
      for (const cell of MATRIX) {
        console.log(
          `Running cell: rate=${cell.rate}, universe=${cell.universe}, mode=${cell.mode}...`,
        );

        const page = await browser.newPage();

        // Hook PerformanceObserver for long tasks
        await page.addInitScript(() => {
          window.__longTasks = [];
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__longTasks.push(entry.duration);
            }
          });
          try {
            observer.observe({ entryTypes: ['longtask'] });
          } catch {
            // unsupported in some contexts
          }
        });

        const url = `http://127.0.0.1:3000/?universe=${cell.universe}&rate=${cell.rate}&mode=${cell.mode}`;
        await page.goto(url);

        // Wait until LIVE
        await page.waitForSelector(
          '[data-testid="status-pill"]:has-text("LIVE")',
          {
            timeout: 25000,
          },
        );

        // Warm up phase
        console.log(`  Warming up for ${WARMUP_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, WARMUP_MS));

        // Clear long tasks buffer before measurement window (F16)
        await page.evaluate(() => {
          window.__longTasks = [];
        });

        // Sample starting counters at T0
        const startSnapshot = await page.evaluate(() => {
          const client = window.__gapless_client;
          const perf = window.performance;
          const heapBytes =
            perf && perf.memory ? perf.memory.usedJSHeapSize : null;
          return {
            deltasIn: client?.getMetrics().deltasIn ?? 0,
            renderedFrames: client?.getPerformanceMetrics().renderedFrames ?? 0,
            heapBytes,
          };
        });

        // Run for DURATION_MS observation window
        console.log(`  Measuring for ${DURATION_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, DURATION_MS));

        // Sample ending counters at T1
        const endSnapshot = await page.evaluate(() => {
          const client = window.__gapless_client;
          const perf = window.performance;
          const heapBytes =
            perf && perf.memory ? perf.memory.usedJSHeapSize : null;
          const longTasks = window.__longTasks || [];
          const perfMetrics = client?.getPerformanceMetrics() ?? {
            renderedFrames: 0,
            p95RecvToPaintMs: null,
            sampleCount: 0,
          };
          return {
            deltasIn: client?.getMetrics().deltasIn ?? 0,
            renderedFrames: perfMetrics.renderedFrames,
            p95RecvToPaintMs: perfMetrics.p95RecvToPaintMs,
            longTasksCount: longTasks.length,
            maxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
            heapBytes,
          };
        });

        const deltasInWindow = Math.max(
          0,
          endSnapshot.deltasIn - startSnapshot.deltasIn,
        );
        const framesInWindow = Math.max(
          0,
          endSnapshot.renderedFrames - startSnapshot.renderedFrames,
        );

        const p95Latency =
          endSnapshot.p95RecvToPaintMs !== null
            ? `${endSnapshot.p95RecvToPaintMs.toFixed(1)} ms`
            : 'N/A';

        const coalescingRatio =
          framesInWindow > 0
            ? `${(deltasInWindow / framesInWindow).toFixed(1)}x`
            : '1.0x';

        const heapDelta =
          startSnapshot.heapBytes !== null && endSnapshot.heapBytes !== null
            ? `${((endSnapshot.heapBytes - startSnapshot.heapBytes) / (1024 * 1024)).toFixed(1)} MB`
            : 'unsupported (null)';

        results.push({
          commit: COMMIT,
          hardware: HARDWARE,
          rate: cell.rate,
          universe: cell.universe,
          mode: cell.mode,
          p95Latency,
          longTasks: `${endSnapshot.longTasksCount} (max ${endSnapshot.maxLongTaskMs.toFixed(0)}ms)`,
          heapDelta: `${heapDelta}${cell.mode === 'worker' ? ' (main)' : ''}`,
          coalescing: coalescingRatio,
          raw: {
            deltasInWindow,
            framesInWindow,
            p95RecvToPaintMs: endSnapshot.p95RecvToPaintMs,
            startHeapBytes: startSnapshot.heapBytes,
            endHeapBytes: endSnapshot.heapBytes,
            longTasksCount: endSnapshot.longTasksCount,
            maxLongTaskMs: endSnapshot.maxLongTaskMs,
          },
        });

        await page.close();
      }
    } finally {
      await browser.close();
    }

    // Write raw results
    const perfDir = path.resolve('perf/results');
    fs.mkdirSync(perfDir, { recursive: true });
    const rawPath = path.join(perfDir, `run-${Date.now()}.json`);
    fs.writeFileSync(
      rawPath,
      JSON.stringify(
        {
          commit: COMMIT,
          hardware: HARDWARE,
          browserVersion,
          warmupMs: WARMUP_MS,
          durationMs: DURATION_MS,
          results,
        },
        null,
        2,
      ),
    );
    console.log(`Raw results saved to ${rawPath}`);

    // Update docs/performance.md and README.md
    updateDocTables(results);
  } finally {
    if (cleanup) {
      cleanup.kill();
    }
  }
}

function updateDocTables(results) {
  let tableRows = '';
  for (const r of results) {
    tableRows += `| \`${r.commit}\` | ${r.hardware} | ${r.rate}/s | ${r.universe} | ${r.mode} | ${r.p95Latency} | ${r.longTasks} | ${r.heapDelta} | ${r.coalescing} |\n`;
  }

  const tableHeader =
    '| Commit | Hardware | Rate | Universe | Mode | p95 recv→paint | Long tasks | Heap Δ | Coalescing |\n| ------ | -------- | ---- | -------- | ---- | -------------- | ---------- | ------ | ---------- |\n';

  const newTableBlock = `<!-- BENCHMARK_RESULTS_START -->\n${tableHeader}${tableRows}<!-- BENCHMARK_RESULTS_END -->`;

  for (const docFile of ['docs/performance.md', 'README.md']) {
    const docPath = path.resolve(docFile);
    if (!fs.existsSync(docPath)) continue;
    const content = fs.readFileSync(docPath, 'utf-8');
    const startIdx = content.indexOf('<!-- BENCHMARK_RESULTS_START -->');
    const endIdx = content.indexOf('<!-- BENCHMARK_RESULTS_END -->');
    if (startIdx !== -1 && endIdx !== -1) {
      const updated =
        content.slice(0, startIdx) +
        newTableBlock +
        content.slice(endIdx + '<!-- BENCHMARK_RESULTS_END -->'.length);
      fs.writeFileSync(docPath, updated, 'utf-8');
      console.log(`Updated ${docFile} with verified benchmark table.`);
    }
  }
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
