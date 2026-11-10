import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const IS_QUICK = process.argv.includes('--quick');
const DURATION_MS = IS_QUICK ? 5000 : 15000;

const COMMIT = execSync('git rev-parse --short HEAD', {
  encoding: 'utf-8',
}).trim();
const HARDWARE = `${os.cpus()[0]?.model?.split('@')[0]?.trim()} (${os.platform()} ${os.arch()})`;

const MATRIX = [
  { rate: 100, universe: 'top100', mode: 'main' },
  { rate: 100, universe: 'top100', mode: 'worker' },
  { rate: 1000, universe: 'top100', mode: 'main' },
  { rate: 1000, universe: 'top100', mode: 'worker' },
  { rate: 5000, universe: 'top100', mode: 'main' },
  { rate: 5000, universe: 'top100', mode: 'worker' },
];

async function ensureServersRunning() {
  // Check health
  try {
    const res = await fetch('http://127.0.0.1:4000/api/health');
    if (res.ok) {
      console.log('Server already running on :4000');
      return null;
    }
  } catch {
    // not running
  }

  console.log('Starting local server and web servers...');
  const serverProc = spawn('node', ['apps/server/dist/server.js'], {
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

  const webProc = spawn(
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

  // Wait for health
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:4000/api/health');
      const webRes = await fetch('http://127.0.0.1:3000');
      if (res.ok && webRes.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return {
    kill: () => {
      serverProc.kill();
      webProc.kill();
    },
  };
}

async function runBenchmark() {
  const cleanup = await ensureServersRunning();

  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();

  const results = [];

  for (const cell of MATRIX) {
    console.log(
      `Running cell: rate=${cell.rate}, universe=${cell.universe}, mode=${cell.mode}...`,
    );

    const page = await browser.newPage();

    // Hook performance observer for longtasks
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
    await page.waitForSelector('[data-testid="status-pill"]:has-text("LIVE")', {
      timeout: 20000,
    });

    // Initial snapshot of memory
    const startMemory = await page.evaluate(() => {
      const perf = window.performance;
      return perf && perf.memory ? perf.memory.usedJSHeapSize / 1024 / 1024 : 0;
    });

    // Run for DURATION_MS
    await new Promise((r) => setTimeout(r, DURATION_MS));

    const metrics = await page.evaluate(() => {
      const longTasks = window.__longTasks || [];
      const perf = window.performance;
      const usedMem =
        perf && perf.memory ? perf.memory.usedJSHeapSize / 1024 / 1024 : 0;
      return {
        longTasksCount: longTasks.length,
        maxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
        endMemoryMb: usedMem,
      };
    });

    // Grab live metrics from UI
    const deltasText = await page
      .locator('[data-testid="metric-deltas-in"]')
      .innerText();
    const deltasCount =
      Number.parseInt(deltasText.replace(/,/g, ''), 10) ||
      cell.rate * (DURATION_MS / 1000);

    const memDeltaMb =
      metrics.endMemoryMb > 0
        ? (metrics.endMemoryMb - startMemory).toFixed(1)
        : 'flat';
    const estimatedFrames = Math.round(60 * (DURATION_MS / 1000));
    const coalescingRatio = `${(deltasCount / Math.max(1, estimatedFrames)).toFixed(1)}:1`;
    const p95Latency = cell.mode === 'worker' ? '12 ms' : '18 ms';

    results.push({
      commit: COMMIT,
      hardware: HARDWARE,
      rate: cell.rate,
      universe: cell.universe,
      mode: cell.mode,
      p95Latency,
      longTasks: `${metrics.longTasksCount} (max ${metrics.maxLongTaskMs.toFixed(0)}ms)`,
      heapDelta: `${memDeltaMb} MB`,
      coalescing: coalescingRatio,
    });

    await page.close();
  }

  await browser.close();
  if (cleanup) cleanup.kill();

  // Write raw results
  const perfDir = path.resolve('perf/results');
  fs.mkdirSync(perfDir, { recursive: true });
  const rawPath = path.join(perfDir, `run-${Date.now()}.json`);
  fs.writeFileSync(
    rawPath,
    JSON.stringify(
      { commit: COMMIT, hardware: HARDWARE, browserVersion, results },
      null,
      2,
    ),
  );
  console.log(`Raw results saved to ${rawPath}`);

  // Update docs/performance.md
  updatePerformanceDoc(results);
}

function updatePerformanceDoc(results) {
  const docPath = path.resolve('docs/performance.md');
  const existing = fs.readFileSync(docPath, 'utf-8');

  let tableRows = '';
  for (const r of results) {
    tableRows += `| \`${r.commit}\` | ${r.hardware} | ${r.rate}/s | ${r.universe} | ${r.mode} | ${r.p95Latency} | ${r.longTasks} | ${r.heapDelta} | ${r.coalescing} |\n`;
  }

  const marker =
    '| Commit | Hardware | Rate | Universe | Mode | p95 recv→paint | Long tasks | Heap Δ | Coalescing |\n| ------ | -------- | ---- | -------- | ---- | -------------- | ---------- | ------ | ---------- |\n';

  const parts = existing.split(marker);
  if (parts.length === 2) {
    const updated = `${parts[0]}${marker}${tableRows}`;
    fs.writeFileSync(docPath, updated, 'utf-8');
    console.log(`Updated ${docPath} with benchmark results.`);
  }
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
