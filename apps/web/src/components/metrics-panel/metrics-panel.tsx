'use client';

import type { FeedClient } from '../../feed/feed-client';
import { useSyncMetrics } from '../../state/market-store';

export interface MetricsPanelProps {
  client: FeedClient;
  fps?: number;
}

export function MetricsPanel({ client, fps = 60 }: MetricsPanelProps) {
  const metrics = useSyncMetrics(client);

  const items = [
    {
      label: 'FPS',
      value: `${fps} fps`,
      color:
        fps >= 55
          ? 'text-brand-up'
          : fps >= 30
            ? 'text-amber-400'
            : 'text-brand-down',
    },
    { label: 'Deltas in', value: metrics.deltasIn.toLocaleString() },
    { label: 'Duplicates', value: metrics.duplicates.toLocaleString() },
    { label: 'Gaps', value: metrics.gaps.toLocaleString() },
    { label: 'Resumes', value: metrics.resumes.toLocaleString() },
    { label: 'Replayed', value: metrics.replays.toLocaleString() },
    { label: 'Snapshots', value: metrics.snapshots.toLocaleString() },
    { label: 'Reconnects', value: metrics.reconnects.toLocaleString() },
    { label: 'Pending buffer', value: metrics.pendingSize.toString() },
    { label: 'Seq', value: metrics.lastSeq.toLocaleString() },
  ];

  return (
    <div className='rounded-lg border border-brand-border bg-brand-card p-4'>
      <div className='mb-3 text-xs font-bold uppercase tracking-wider text-brand-muted'>
        Sync Engine Metrics
      </div>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5'>
        {items.map((item) => (
          <div
            key={item.label}
            className='rounded-md border border-brand-border-subtle bg-brand-card-inner px-2.5 py-2'
          >
            <div className='text-[11px] text-brand-muted'>{item.label}</div>
            <div
              data-testid={`metric-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={`mt-0.5 text-sm font-bold tabular-nums ${item.color ?? 'text-brand-fg'}`}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
