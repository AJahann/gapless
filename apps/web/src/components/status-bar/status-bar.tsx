'use client';

import type { SyncState } from '@gapless/engine';
import { useState } from 'react';
import type { FeedClient } from '../../feed/feed-client';
import { useSyncState } from '../../state/market-store';

export interface StatusBarProps {
  client: FeedClient;
  feedId: string;
}

export function StatusBar({ client, feedId }: StatusBarProps) {
  const state = useSyncState(client);
  const [activeOutageTimer, setActiveOutageTimer] = useState<number | null>(
    null,
  );

  const isCut = state === 'offline';

  function handleToggleCut() {
    if (activeOutageTimer !== null) {
      window.clearTimeout(activeOutageTimer);
      setActiveOutageTimer(null);
    }
    if (isCut) {
      client.restore();
    } else {
      client.cut();
    }
  }

  function triggerOutagePreset(durationSec: number) {
    if (activeOutageTimer !== null) {
      window.clearTimeout(activeOutageTimer);
    }
    client.cut();
    const timer = window.setTimeout(() => {
      client.restore();
      setActiveOutageTimer(null);
    }, durationSec * 1000);
    setActiveOutageTimer(timer);
  }

  const stateColors: Record<SyncState, string> = {
    live: '#16c784',
    replaying: '#f59e0b',
    syncing: '#3b82f6',
    connecting: '#8b5cf6',
    idle: '#6b7280',
    offline: '#ea3943',
    error: '#ef4444',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
        padding: '0.85rem 1.25rem',
        background: '#161b26',
        borderRadius: '8px',
        border: '1px solid #2a3142',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span
          style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: stateColors[state] ?? '#6b7280',
            boxShadow: `0 0 8px ${stateColors[state] ?? '#6b7280'}`,
          }}
        />
        <span
          data-testid='status-pill'
          style={{ fontWeight: 600, letterSpacing: '0.05em' }}
        >
          {state.toUpperCase()}
        </span>
        <span
          style={{
            color: '#8a93a6',
            fontSize: '0.9rem',
            borderLeft: '1px solid #2a3142',
            paddingLeft: '0.75rem',
          }}
        >
          {feedId}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          type='button'
          onClick={handleToggleCut}
          style={{
            backgroundColor: isCut ? '#16c784' : '#ea3943',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            padding: '0.45rem 0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {isCut ? '▶ Restore Connection' : '✕ Cut Connection'}
        </button>

        <span
          style={{
            color: '#8a93a6',
            fontSize: '0.85rem',
            marginLeft: '0.5rem',
          }}
        >
          Outage presets:
        </span>
        <button
          type='button'
          onClick={() => triggerOutagePreset(2)}
          style={presetButtonStyle}
        >
          Cut 2s (replay)
        </button>
        <button
          type='button'
          onClick={() => triggerOutagePreset(15)}
          style={presetButtonStyle}
        >
          Cut 15s (replay)
        </button>
        <button
          type='button'
          onClick={() => triggerOutagePreset(45)}
          style={presetButtonStyle}
        >
          Cut 45s (snapshot)
        </button>
      </div>
    </div>
  );
}

const presetButtonStyle: React.CSSProperties = {
  backgroundColor: '#1f2638',
  color: '#e6e9ef',
  border: '1px solid #2a3142',
  borderRadius: '4px',
  padding: '0.35rem 0.65rem',
  fontSize: '0.8rem',
  cursor: 'pointer',
};
