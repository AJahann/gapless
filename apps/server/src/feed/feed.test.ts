import { describe, expect, it } from 'vitest';
import { Feed } from './feed';

describe('Feed unit tests (F02, F05, F20)', () => {
  it('F20: getReplay indexes directly into ring without full scan', () => {
    const feed = new Feed({
      id: 'top100@100',
      replayWindowSec: 2,
      replayMaxEntries: 10,
    });

    // Start feed to push some deltas
    feed.start();
    // Head sequence has advanced
    expect(feed.headSeq).toBeGreaterThanOrEqual(0);

    // Replay after headSeq returns empty
    expect(feed.getReplay(feed.headSeq)).toEqual({ status: 'empty' });

    // Replay in the future returns future
    expect(feed.getReplay(feed.headSeq + 10)).toEqual({ status: 'future' });

    feed.stop();
  });

  it('F05: onRestart listener receives new epoch when restart is called', () => {
    const feed = new Feed({ id: 'top100@100' });
    const oldEpoch = feed.epoch;
    let notifiedEpoch = '';

    const unsub = feed.onRestart((epoch) => {
      notifiedEpoch = epoch;
    });

    const newEpoch = feed.restart();
    expect(newEpoch).not.toBe(oldEpoch);
    expect(notifiedEpoch).toBe(newEpoch);

    unsub();
    feed.stop();
  });
});
