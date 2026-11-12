import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedRegistry } from './registry';

describe('FeedRegistry (F02, F09 resource & lifecycle tests)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('F09: HTTP-only feed access schedules idle timer and expires after TTL', () => {
    const registry = new FeedRegistry({ feedIdleTtlSec: 10 });
    const feed = registry.getFeed('top100@100');
    expect(registry.hasFeed('top100@100')).toBe(true);

    // Reading feed state via HTTP again must NOT defeat idle expiry (F09)
    const sameFeed = registry.getFeed('top100@100');
    expect(sameFeed).toBe(feed);

    // Advance 9.9 seconds -> still present
    vi.advanceTimersByTime(9900);
    expect(registry.hasFeed('top100@100')).toBe(true);

    // Advance past TTL (10 seconds) -> expired and stopped
    vi.advanceTimersByTime(200);
    expect(registry.hasFeed('top100@100')).toBe(false);
  });

  it('F09: subscriber join cancels idle expiry; subscriber left re-arms idle timer', () => {
    const registry = new FeedRegistry({ feedIdleTtlSec: 10 });
    const feed = registry.getFeed('top100@100');

    // Subscriber joins
    const unsub = feed.subscribe(() => {});
    registry.onSubscriberJoined('top100@100');

    // Advance 20 seconds -> active subscriber prevents idle expiry
    vi.advanceTimersByTime(20000);
    expect(registry.hasFeed('top100@100')).toBe(true);

    // Subscriber leaves
    unsub();
    registry.onSubscriberLeft('top100@100');

    // Advance 5 seconds -> still within TTL
    vi.advanceTimersByTime(5000);
    expect(registry.hasFeed('top100@100')).toBe(true);

    // Advance remaining 5.1 seconds -> expires
    vi.advanceTimersByTime(5100);
    expect(registry.hasFeed('top100@100')).toBe(false);
  });

  it('F02: enforces maxActiveFeeds by evicting idle feeds', () => {
    const registry = new FeedRegistry({
      maxActiveFeeds: 2,
      feedIdleTtlSec: 60,
    });
    registry.getFeed('top100@100');
    registry.getFeed('top100@500');

    expect(registry.hasFeed('top100@100')).toBe(true);
    expect(registry.hasFeed('top100@500')).toBe(true);

    // Requesting a third feed evicts oldest idle feed
    registry.getFeed('top10k@100');
    expect(registry.hasFeed('top10k@100')).toBe(true);
    // Either top100@100 was evicted
    expect(registry.listFeeds()).toHaveLength(2);
  });
});
