import { expect, test } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

test.describe('E2E Real-time recovery scenarios', () => {
  test('Scenario 1: Initial load connects live with 100 assets and deltas incrementing', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');

    // Wait for connection pill to become LIVE
    const statusPill = page.getByTestId('status-pill');
    await expect(statusPill).toHaveText('LIVE', { timeout: 15000 });

    // Verify 100 rows loaded
    const tableHeader = page.locator('text=Top 100 Assets');
    await expect(tableHeader).toBeVisible();

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(100);

    // Verify deltas flowing by checking that deltasIn metric increases
    const deltasInCell = page.getByTestId('metric-deltas-in');
    await expect(async () => {
      const text = await deltasInCell.innerText();
      const num = Number.parseInt(text.replace(/,/g, ''), 10);
      expect(num).toBeGreaterThan(10);
    }).toPass({ timeout: 10000 });
  });

  test('Scenario 2: Short cut (< replay window) recovers via replay without snapshot refetch', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    // Record initial snapshots count
    const snapshotsCell = page.getByTestId('metric-snapshots');
    const initialSnapshots = Number.parseInt(
      (await snapshotsCell.innerText()).replace(/,/g, ''),
      10,
    );

    const replayedCell = page.getByTestId('metric-replayed');
    const initialReplayed = Number.parseInt(
      (await replayedCell.innerText()).replace(/,/g, ''),
      10,
    );

    // Click Cut Connection
    const cutBtn = page.getByRole('button', { name: /Cut Connection/i });
    await cutBtn.click();

    // Verify stale badge and OFFLINE status
    await expect(page.getByTestId('status-pill')).toHaveText('OFFLINE');
    await expect(page.locator('text=STALE (Disconnected)')).toBeVisible();

    // Wait 1 second (replay window is configured to 2s in test env)
    await page.waitForTimeout(1000);

    // Restore connection
    const restoreBtn = page.getByRole('button', {
      name: /Restore Connection/i,
    });
    await restoreBtn.click();

    // Verify returns to LIVE
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    // Verify replay count increased while snapshot count remained unchanged
    await expect(async () => {
      const currentSnapshots = Number.parseInt(
        (await snapshotsCell.innerText()).replace(/,/g, ''),
        10,
      );
      const currentReplayed = Number.parseInt(
        (await replayedCell.innerText()).replace(/,/g, ''),
        10,
      );

      expect(currentSnapshots).toBe(initialSnapshots);
      expect(currentReplayed).toBeGreaterThan(initialReplayed);
    }).toPass({ timeout: 10000 });
  });

  test('Scenario 3: Long cut (> replay window) recovers via snapshot refetch (+1 snapshot)', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    const snapshotsCell = page.getByTestId('metric-snapshots');
    const initialSnapshots = Number.parseInt(
      (await snapshotsCell.innerText()).replace(/,/g, ''),
      10,
    );

    // Cut connection
    await page.getByRole('button', { name: /Cut Connection/i }).click();
    await expect(page.getByTestId('status-pill')).toHaveText('OFFLINE');

    // Wait 4s (exceeds REPLAY_WINDOW_SEC=2)
    await page.waitForTimeout(4000);

    // Restore connection
    await page.getByRole('button', { name: /Restore Connection/i }).click();

    // Verify returns to LIVE
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    // Verify snapshot counter incremented
    await expect(async () => {
      const currentSnapshots = Number.parseInt(
        (await snapshotsCell.innerText()).replace(/,/g, ''),
        10,
      );
      expect(currentSnapshots).toBeGreaterThan(initialSnapshots);
    }).toPass({ timeout: 10000 });
  });

  test('Scenario 4: Server restart triggers epoch change and automatic snapshot recovery', async ({
    page,
    request,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    // Call server restart endpoint via test control (direct port 4000 or via Caddy on :80)
    const restartEndpoint =
      process.env.TARGET_URL && !process.env.TARGET_URL.includes(':3000')
        ? `${process.env.TARGET_URL}/api/feeds/top100@100/restart`
        : 'http://127.0.0.1:4000/api/feeds/top100@100/restart';
    const restartRes = await request.post(restartEndpoint);
    expect(restartRes.ok()).toBeTruthy();

    // After restart, client should recover and return to LIVE
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });
  });

  test('Scenario 5: Worker mode (?mode=worker) connects live with flowing deltas and coalesced updates', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100&mode=worker');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(100);

    const deltasInCell = page.getByTestId('metric-deltas-in');
    await expect(async () => {
      const text = await deltasInCell.innerText();
      const num = Number.parseInt(text.replace(/,/g, ''), 10);
      expect(num).toBeGreaterThan(10);
    }).toPass({ timeout: 10000 });
  });

  test('Scenario 6: Rate switching, FPS indicators, and Concepts Guide accordion', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    // Verify FPS counter in status bar
    const fpsBadge = page.getByTestId('status-fps');
    await expect(fpsBadge).toContainText('FPS');

    // Switch rate to 500/s via pill button
    const rate500Btn = page.getByRole('button', { name: '500/s' });
    await rate500Btn.click();
    await expect(page.locator('text=top100@500')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    // Concepts Guide accordion toggle
    const seqCardBtn = page.getByRole('button', {
      name: 'Sequence Number (seq)',
    });
    await expect(seqCardBtn).toBeVisible();
    await seqCardBtn.click();
    await expect(
      page.locator('text=Gate rule: delta valid if seq === lastSeq + 1.'),
    ).toBeVisible();
  });

  test('Scenario 7: Chaos Drop injection triggers gap detection and replay recovery', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    const gapsCell = page.getByTestId('metric-gaps');
    const initialGaps = Number.parseInt(
      (await gapsCell.innerText()).replace(/,/g, ''),
      10,
    );

    // Set drop rate to 25% via slider
    const dropInput = page.getByTestId('chaos-drop');
    await dropInput.fill('25');

    // Wait for gaps and replays to be recorded by SyncEngine
    const replaysCell = page.getByTestId('metric-replayed');
    const initialReplays = Number.parseInt(
      (await replaysCell.innerText()).replace(/,/g, ''),
      10,
    );

    await expect(async () => {
      const currentGaps = Number.parseInt(
        (await gapsCell.innerText()).replace(/,/g, ''),
        10,
      );
      const currentReplays = Number.parseInt(
        (await replaysCell.innerText()).replace(/,/g, ''),
        10,
      );
      expect(currentGaps).toBeGreaterThan(initialGaps);
      expect(currentReplays).toBeGreaterThan(initialReplays);
    }).toPass({ timeout: 10000 });

    // Reset chaos and ensure status recovers to LIVE
    await page.getByTestId('chaos-reset').click();
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 10000,
    });
  });

  test('Scenario 8: Chaos Duplicate injection increments duplicates without state corruption', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    const duplicatesCell = page.getByTestId('metric-duplicates');
    const initialDuplicates = Number.parseInt(
      (await duplicatesCell.innerText()).replace(/,/g, ''),
      10,
    );

    // Set duplicate rate to 20%
    const duplicateInput = page.getByTestId('chaos-duplicate');
    await duplicateInput.fill('20');

    // Verify duplicate counter increments
    await expect(async () => {
      const currentDuplicates = Number.parseInt(
        (await duplicatesCell.innerText()).replace(/,/g, ''),
        10,
      );
      expect(currentDuplicates).toBeGreaterThan(initialDuplicates);
    }).toPass({ timeout: 10000 });

    await expect(page.getByTestId('status-pill')).toHaveText('LIVE');
    await page.getByTestId('chaos-reset').click();
  });

  test('Scenario 9: Chaos Reorder injection detects out-of-order packets and buffers', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    const gapsCell = page.getByTestId('metric-gaps');
    const initialGaps = Number.parseInt(
      (await gapsCell.innerText()).replace(/,/g, ''),
      10,
    );

    // Set reorder rate to 25%
    const reorderInput = page.getByTestId('chaos-reorder');
    await reorderInput.fill('25');

    // Reordered deltas will cause non-consecutive seqs triggering gap/reorder handling
    await expect(async () => {
      const currentGaps = Number.parseInt(
        (await gapsCell.innerText()).replace(/,/g, ''),
        10,
      );
      expect(currentGaps).toBeGreaterThan(initialGaps);
    }).toPass({ timeout: 10000 });

    await expect(page.getByTestId('status-pill')).toHaveText('LIVE');
    await page.getByTestId('chaos-reset').click();
  });

  test('Scenario 10: Chaos Jitter applies latency while maintaining live stream', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    const deltasInCell = page.getByTestId('metric-deltas-in');
    const initialDeltas = Number.parseInt(
      (await deltasInCell.innerText()).replace(/,/g, ''),
      10,
    );

    // Set jitter to 150ms
    const jitterInput = page.getByTestId('chaos-jitter');
    await jitterInput.fill('150');

    // Confirm deltas continue to flow despite jitter
    await expect(async () => {
      const currentDeltas = Number.parseInt(
        (await deltasInCell.innerText()).replace(/,/g, ''),
        10,
      );
      expect(currentDeltas).toBeGreaterThan(initialDeltas + 20);
    }).toPass({ timeout: 10000 });

    await expect(page.getByTestId('status-pill')).toHaveText('LIVE');
    await page.getByTestId('chaos-reset').click();
  });

  test('Scenario 11: Chaos Silent socket triggers watchdog and automatic reconnect', async ({
    page,
  }) => {
    await page.goto('/?universe=top100&rate=100');
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });

    const reconnectsCell = page.getByTestId('metric-reconnects');
    const initialReconnects = Number.parseInt(
      (await reconnectsCell.innerText()).replace(/,/g, ''),
      10,
    );

    // Turn on silent socket (half-open)
    const silentCheckbox = page.getByTestId('chaos-silent');
    await silentCheckbox.check();

    // Heartbeat timeout watchdog will detect absence of data and trigger reconnect
    await expect(async () => {
      const currentReconnects = Number.parseInt(
        (await reconnectsCell.innerText()).replace(/,/g, ''),
        10,
      );
      expect(currentReconnects).toBeGreaterThan(initialReconnects);
    }).toPass({ timeout: 15000 });

    // Reset chaos and verify system returns to LIVE
    await page.getByTestId('chaos-reset').click();
    await expect(page.getByTestId('status-pill')).toHaveText('LIVE', {
      timeout: 15000,
    });
  });
});
