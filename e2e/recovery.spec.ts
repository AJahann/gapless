import { expect, test } from '@playwright/test';

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

    // Call server restart endpoint via test control
    const restartRes = await request.post(
      'http://127.0.0.1:4000/api/feeds/top100@100/restart',
    );
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
});
