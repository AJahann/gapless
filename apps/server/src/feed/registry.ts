import { Feed } from './feed';

export interface FeedRegistryOptions {
  replayWindowSec?: number;
  replayMaxEntries?: number;
  feedIdleTtlSec?: number;
  maxActiveFeeds?: number;
}

export class FeedRegistry {
  private readonly feeds = new Map<string, Feed>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private readonly replayWindowSec: number;
  private readonly replayMaxEntries: number;
  private readonly feedIdleTtlSec: number;
  private readonly maxActiveFeeds: number;

  constructor(options?: FeedRegistryOptions) {
    this.replayWindowSec = options?.replayWindowSec ?? 30;
    this.replayMaxEntries = options?.replayMaxEntries ?? 100000;
    this.feedIdleTtlSec = options?.feedIdleTtlSec ?? 300;
    this.maxActiveFeeds = options?.maxActiveFeeds ?? 100;
  }

  getFeed(id: string): Feed {
    let feed = this.feeds.get(id);
    if (!feed) {
      if (this.feeds.size >= this.maxActiveFeeds) {
        // Evict oldest idle feed to protect server resources (F02)
        let evicted = false;
        const oldestIdleEntry = this.idleTimers.entries().next().value;
        if (oldestIdleEntry) {
          const [idleId, timer] = oldestIdleEntry;
          clearTimeout(timer);
          this.idleTimers.delete(idleId);
          const f = this.feeds.get(idleId);
          f?.stop();
          this.feeds.delete(idleId);
          evicted = true;
        }
        if (!evicted) {
          throw new Error('Maximum active feeds limit exceeded');
        }
      }

      feed = new Feed({
        id,
        replayWindowSec: this.replayWindowSec,
        replayMaxEntries: this.replayMaxEntries,
      });
      this.feeds.set(id, feed);
      // HTTP-only or fresh feed has 0 subscribers -> schedule idle expiry (F09)
      this.scheduleIdleTimer(id);
    }

    return feed;
  }

  hasFeed(id: string): boolean {
    return this.feeds.has(id);
  }

  listFeeds(): {
    id: string;
    universe: string;
    rate: number;
    subscribers: number;
    headSeq: number;
  }[] {
    const list = [];
    for (const [id, feed] of this.feeds.entries()) {
      list.push({
        id,
        universe: feed.universeName,
        rate: feed.rate,
        subscribers: feed.subscriberCount,
        headSeq: feed.headSeq,
      });
    }
    return list;
  }

  onSubscriberJoined(feedId: string): void {
    const timer = this.idleTimers.get(feedId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(feedId);
    }
  }

  onSubscriberLeft(feedId: string): void {
    const feed = this.feeds.get(feedId);
    if (!feed || feed.subscriberCount > 0) return;

    this.scheduleIdleTimer(feedId);
  }

  private scheduleIdleTimer(feedId: string): void {
    if (this.idleTimers.has(feedId)) return;

    const timer = setTimeout(() => {
      this.idleTimers.delete(feedId);
      const currentFeed = this.feeds.get(feedId);
      if (currentFeed && currentFeed.subscriberCount === 0) {
        currentFeed.stop();
        this.feeds.delete(feedId);
      }
    }, this.feedIdleTtlSec * 1000);

    this.idleTimers.set(feedId, timer);
  }

  closeAll(): void {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    for (const feed of this.feeds.values()) {
      feed.stop();
    }
    this.feeds.clear();
  }
}
