'use client';

import type { FeedClient } from '../../feed/feed-client';
import { useSyncMetrics } from '../../state/market-store';

export interface MetricsPanelProps {
  client: FeedClient;
}

export function MetricsPanel({ client }: MetricsPanelProps) {
  const metrics = useSyncMetrics(client);

  const items = [
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
    <div
      style={{
        background: '#161b26',
        border: '1px solid #2a3142',
        borderRadius: '8px',
        padding: '1rem',
      }}
    >
      <div
        style={{
          fontSize: '0.85rem',
          fontWeight: 700,
          color: '#8a93a6',
          textTransform: 'uppercase',
          marginBottom: '0.75rem',
          letterSpacing: '0.05em',
        }}
      >
        Sync Engine Metrics
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))',
          gap: '0.5rem',
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              background: '#0d111a',
              padding: '0.5rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid #1f2638',
            }}
          >
            <div style={{ color: '#8a93a6', fontSize: '0.75rem' }}>
              {item.label}
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: '0.95rem',
                marginTop: '0.2rem',
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
