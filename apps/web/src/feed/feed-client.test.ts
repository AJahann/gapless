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
});
