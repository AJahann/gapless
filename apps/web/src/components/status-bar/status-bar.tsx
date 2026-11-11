'use client';

import type { SyncState } from '@gapless/engine';
import { useState } from 'react';
import type { FeedClient } from '../../feed/feed-client';
import { useSyncState } from '../../state/market-store';

export interface StatusBarProps {
  client: FeedClient;
  feedId: string;
  currentRate?: number;
  onRateChange?: (rate: number) => void;
  fps?: number;
}

const RATE_OPTIONS = [100, 500, 1000, 5000, 10000];

export function StatusBar({
  client,
  feedId,
  currentRate = 100,
  onRateChange,
  fps = 60,
}: StatusBarProps) {
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

  const stateColors: Record<
    SyncState,
    { bg: string; dot: string; glow: string }
  > = {
    live: {
      bg: 'text-brand-up',
      dot: 'bg-brand-up',
      glow: 'shadow-[0_0_8px_#16c784]',
    },
    replaying: {
      bg: 'text-amber-400',
      dot: 'bg-amber-400',
      glow: 'shadow-[0_0_8px_#f59e0b]',
    },
    syncing: {
      bg: 'text-blue-400',
      dot: 'bg-blue-400',
      glow: 'shadow-[0_0_8px_#3b82f6]',
    },
    connecting: {
      bg: 'text-purple-400',
      dot: 'bg-purple-400',
      glow: 'shadow-[0_0_8px_#8b5cf6]',
    },
    idle: {
      bg: 'text-gray-400',
      dot: 'bg-gray-400',
      glow: 'shadow-[0_0_8px_#9ca3af]',
    },
    offline: {
      bg: 'text-brand-down',
      dot: 'bg-brand-down',
      glow: 'shadow-[0_0_8px_#ea3943]',
    },
    error: {
      bg: 'text-red-500',
      dot: 'bg-red-500',
      glow: 'shadow-[0_0_8px_#ef4444]',
    },
  };

  const currentStatusStyle = stateColors[state] ?? stateColors.idle;

  const fpsColor =
    fps >= 55
      ? 'text-brand-up border-brand-up/30 bg-emerald-950/40'
      : fps >= 30
        ? 'text-amber-400 border-amber-400/30 bg-amber-950/40'
        : 'text-brand-down border-brand-down/30 bg-rose-950/40';

  return (
    <div className='flex flex-wrap items-center justify-between gap-4 rounded-lg border border-brand-border bg-brand-card p-3.5 shadow-sm'>
      <div className='flex items-center gap-3'>
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${currentStatusStyle.dot} ${currentStatusStyle.glow}`}
        />
        <span
          data-testid='status-pill'
          className='text-sm font-bold tracking-wider text-brand-fg'
        >
          {state.toUpperCase()}
        </span>
        <span className='border-l border-brand-border pl-3 text-xs text-brand-muted'>
          {feedId}
        </span>

        {/* Live FPS Badge */}
        <span
          data-testid='status-fps'
          className={`rounded border px-2 py-0.5 text-xs font-semibold tabular-nums ${fpsColor}`}
        >
          {fps} FPS
        </span>
      </div>

      {/* Speed / Updates per second Pills */}
      <div className='flex items-center gap-1.5'>
        <span className='mr-1 text-xs text-brand-muted font-medium'>Rate:</span>
        {RATE_OPTIONS.map((r) => {
          const isSelected = r === currentRate;
          const label = r >= 1000 ? `${r / 1000}k/s` : `${r}/s`;
          return (
            <button
              key={r}
              type='button'
              onClick={() => onRateChange?.(r)}
              className={`rounded px-2 py-0.5 text-xs font-semibold transition cursor-pointer ${
                isSelected
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-brand-border-subtle text-brand-muted hover:bg-brand-card-hover hover:text-brand-fg'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Outage Presets & Cut Button */}
      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          onClick={handleToggleCut}
          className={`cursor-pointer rounded px-3 py-1 text-xs font-semibold text-white transition ${
            isCut
              ? 'bg-brand-up hover:bg-emerald-600'
              : 'bg-brand-down hover:bg-red-600'
          }`}
        >
          {isCut ? '▶ Restore Connection' : '✕ Cut Connection'}
        </button>

        <span className='text-xs text-brand-muted'>Outage presets:</span>
        <button
          type='button'
          onClick={() => triggerOutagePreset(2)}
          className='cursor-pointer rounded border border-brand-border bg-brand-border-subtle px-2 py-1 text-xs text-brand-fg transition hover:bg-brand-card-hover'
        >
          Cut 2s (replay)
        </button>
        <button
          type='button'
          onClick={() => triggerOutagePreset(15)}
          className='cursor-pointer rounded border border-brand-border bg-brand-border-subtle px-2 py-1 text-xs text-brand-fg transition hover:bg-brand-card-hover'
        >
          Cut 15s (replay)
        </button>
        <button
          type='button'
          onClick={() => triggerOutagePreset(45)}
          className='cursor-pointer rounded border border-brand-border bg-brand-border-subtle px-2 py-1 text-xs text-brand-fg transition hover:bg-brand-card-hover'
        >
          Cut 45s (snapshot)
        </button>
      </div>
    </div>
  );
}
