import type { Delta, Snapshot } from '@gapless/protocol';
import { describe, expect, it } from 'vitest';
import { MainThreadFeedClient } from './feed-client';

describe(MainThreadFeedClient, () => {
  it('initializes in idle or connecting state', () => {
    const client = new MainThreadFeedClient({ feedId: 'top100@100' });
    expect(client.getState()).toBe('idle');
    expect(client.getSymbols()).toEqual([]);
  });

  it('manages trade tape ring buffers up to 200 items', () => {
    const client = new MainThreadFeedClient({ feedId: 'top100@100' });
    const clientAny = client as unknown as {
      onDeltaApplied: (delta: Delta) => void;
    };

    // Push 250 trade deltas for symbol index 0
    for (let i = 1; i <= 250; i += 1) {
      const delta: Delta = [i, 0, 68000000000 + i, 10000, 0, 1710000000000 + i];
      clientAny.onDeltaApplied(delta);
    }

    const trades = client.getTrades(0);
    // Bounded to 200 items
    expect(trades).toHaveLength(200);
    // Oldest is 51, newest is 250
    expect(trades[0]![0]).toBe(51);
    expect(trades[199]![0]).toBe(250);
  });

  it('coalesces dirty symbol notifications with rAF/timer', async () => {
    const client = new MainThreadFeedClient({ feedId: 'top100@100' });
    const clientAny = client as unknown as {
      onSnapshotApplied: (snapshot: Snapshot) => void;
      onDeltaApplied: (delta: Delta) => void;
    };

    const snapshot: Snapshot = {
      feed: 'top100@100',
      epoch: 'epoch-1',
      seq: 10,
      symbols: [
        { symbol: 'BTC', name: 'Bitcoin', index: 0 },
        { symbol: 'ETH', name: 'Ethereum', index: 1 },
      ],
      quotes: [
        {
          price: 67000000000,
          open: 67000000000,
          high: 67000000000,
          low: 67000000000,
          volume: '0',
          trades: 0,
          lastSeq: 10,
          lastTs: 0,
        },
        {
          price: 3500000000,
          open: 3500000000,
          high: 3500000000,
          low: 3500000000,
          volume: '0',
          trades: 0,
          lastSeq: 10,
          lastTs: 0,
        },
      ],
    };

    clientAny.onSnapshotApplied(snapshot);

    let btcNotificationCount = 0;
    client.subscribeSymbol(0, () => {
      btcNotificationCount += 1;
    });

    // Send 50 rapid deltas for BTC in the same frame
    for (let i = 11; i <= 60; i += 1) {
      clientAny.onDeltaApplied([
        i,
        0,
        67000000000 + i,
        10000,
        0,
        1710000000000,
      ]);
    }

    // Immediately after: listener hasn't run 50 times
    expect(btcNotificationCount).toBe(0);

    // Wait for coalesce flush
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Coalesced into 1 flush!
    expect(btcNotificationCount).toBe(1);
  });

  it('supports idempotent start and restartable lifecycle', () => {
    const client = new MainThreadFeedClient({ feedId: 'top100@100' });
    // First start
    client.start();
    expect(client.getState()).toBe('connecting');
    // Repeated start is idempotent
    client.start();
    expect(client.getState()).toBe('connecting');
    // Stop cleans up to idle
    client.stop();
    expect(client.getState()).toBe('idle');
    // Second stop is idempotent
    client.stop();
    expect(client.getState()).toBe('idle');
    // Restartable: start after stop transitions to connecting again
    client.start();
    expect(client.getState()).toBe('connecting');
    client.stop();
  });

  it('F13: clears epoch-owned trade tapes and sparklines on epoch change', () => {
    const client = new MainThreadFeedClient({ feedId: 'top100@100' });
    const clientAny = client as unknown as {
      onSnapshotApplied: (snapshot: Snapshot) => void;
      onDeltaApplied: (delta: Delta) => void;
    };

    const snap1: Snapshot = {
      feed: 'top100@100',
      epoch: 'epoch-1',
      seq: 10,
      symbols: [{ symbol: 'BTC', name: 'Bitcoin', index: 0 }],
      quotes: [
        {
          price: 67000000000,
          open: 67000000000,
          high: 67000000000,
          low: 67000000000,
          volume: '0',
          trades: 0,
          lastSeq: 10,
          lastTs: 0,
        },
      ],
    };

    clientAny.onSnapshotApplied(snap1);

    // Apply a trade delta in epoch-1
    clientAny.onDeltaApplied([11, 0, 67500000000, 10000, 0, 1710000000000]);
    expect(client.getTrades(0)).toHaveLength(1);

    // Now snap2 arrives with a new epoch (epoch-2)
    const snap2: Snapshot = {
      feed: 'top100@100',
      epoch: 'epoch-2',
      seq: 0,
      symbols: [{ symbol: 'BTC', name: 'Bitcoin', index: 0 }],
      quotes: [
        {
          price: 68000000000,
          open: 68000000000,
          high: 68000000000,
          low: 68000000000,
          volume: '0',
          trades: 0,
          lastSeq: 0,
          lastTs: 0,
        },
      ],
    };

    clientAny.onSnapshotApplied(snap2);

    // Trade tape from old epoch must be wiped clean!
    expect(client.getTrades(0)).toHaveLength(0);
  });

  it('F14: sparkline sampler notifies symbol subscribers for cold symbols', async () => {
    const client = new MainThreadFeedClient({ feedId: 'top100@100' });
    const clientAny = client as unknown as {
      onSnapshotApplied: (snapshot: Snapshot) => void;
    };

    clientAny.onSnapshotApplied({
      feed: 'top100@100',
      epoch: 'epoch-1',
      seq: 10,
      symbols: [{ symbol: 'BTC', name: 'Bitcoin', index: 0 }],
      quotes: [
        {
          price: 67000000000,
          open: 67000000000,
          high: 67000000000,
          low: 67000000000,
          volume: '0',
          trades: 0,
          lastSeq: 10,
          lastTs: 0,
        },
      ],
    });

    let btcNotificationCount = 0;
    client.subscribeSymbol(0, () => {
      btcNotificationCount += 1;
    });

    // Start client which starts 1Hz sparkline sampler
    client.start();

    // Wait 1.1s for sparkline timer to sample
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(btcNotificationCount).toBeGreaterThanOrEqual(1);
    expect(client.getSparkline(0).length).toBeGreaterThanOrEqual(1);

    client.stop();
  });
});
