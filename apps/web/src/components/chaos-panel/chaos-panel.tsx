'use client';

import { useState } from 'react';
import type { FeedClient } from '../../feed/feed-client';

export interface ChaosPanelProps {
  client: FeedClient;
}

export function ChaosPanel({ client }: ChaosPanelProps) {
  const [drop, setDrop] = useState(0);
  const [duplicate, setDuplicate] = useState(0);
  const [reorder, setReorder] = useState(0);
  const [delayMs, setDelayMs] = useState(0);
  const [jitterMs, setJitterMs] = useState(0);
  const [silent, setSilent] = useState(false);

  function applyChaos(updates: {
    drop?: number;
    duplicate?: number;
    reorder?: number;
    delayMs?: number;
    jitterMs?: number;
    silent?: boolean;
  }) {
    client.setChaos({
      drop: updates.drop !== undefined ? updates.drop / 100 : drop / 100,
      duplicate:
        updates.duplicate !== undefined
          ? updates.duplicate / 100
          : duplicate / 100,
      reorder:
        updates.reorder !== undefined ? updates.reorder / 100 : reorder / 100,
      delayMs: updates.delayMs !== undefined ? updates.delayMs : delayMs,
      jitterMs: updates.jitterMs !== undefined ? updates.jitterMs : jitterMs,
      silent: updates.silent !== undefined ? updates.silent : silent,
    });
  }

  function handleReset() {
    setDrop(0);
    setDuplicate(0);
    setReorder(0);
    setDelayMs(0);
    setJitterMs(0);
    setSilent(false);
    client.setChaos({
      drop: 0,
      duplicate: 0,
      reorder: 0,
      delayMs: 0,
      jitterMs: 0,
      silent: false,
    });
  }

  return (
    <div className='rounded-lg border border-brand-border bg-brand-card p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <span className='text-xs font-bold uppercase tracking-wider text-brand-muted'>
          Chaos Injection (Per-Connection)
        </span>
        <button
          type='button'
          data-testid='chaos-reset'
          onClick={handleReset}
          className='cursor-pointer rounded border border-brand-border bg-transparent px-2 py-0.5 text-[11px] text-brand-muted transition hover:bg-brand-card-hover hover:text-brand-fg'
        >
          Reset All
        </button>
      </div>

      <div className='grid grid-cols-2 gap-4 text-xs sm:grid-cols-3'>
        <div>
          <div className='mb-1 flex justify-between'>
            <span className='text-brand-muted'>Drop:</span>
            <span className='font-semibold text-brand-fg'>{drop}%</span>
          </div>
          <input
            type='range'
            data-testid='chaos-drop'
            min={0}
            max={50}
            value={drop}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDrop(val);
              applyChaos({ drop: val });
            }}
            className='w-full accent-rose-500'
          />
        </div>

        <div>
          <div className='mb-1 flex justify-between'>
            <span className='text-brand-muted'>Duplicate:</span>
            <span className='font-semibold text-brand-fg'>{duplicate}%</span>
          </div>
          <input
            type='range'
            data-testid='chaos-duplicate'
            min={0}
            max={30}
            value={duplicate}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDuplicate(val);
              applyChaos({ duplicate: val });
            }}
            className='w-full accent-amber-500'
          />
        </div>

        <div>
          <div className='mb-1 flex justify-between'>
            <span className='text-brand-muted'>Reorder:</span>
            <span className='font-semibold text-brand-fg'>{reorder}%</span>
          </div>
          <input
            type='range'
            data-testid='chaos-reorder'
            min={0}
            max={30}
            value={reorder}
            onChange={(e) => {
              const val = Number(e.target.value);
              setReorder(val);
              applyChaos({ reorder: val });
            }}
            className='w-full accent-purple-500'
          />
        </div>

        <div>
          <div className='mb-1 flex justify-between'>
            <span className='text-brand-muted'>Jitter:</span>
            <span className='font-semibold text-brand-fg'>{jitterMs}ms</span>
          </div>
          <input
            type='range'
            data-testid='chaos-jitter'
            min={0}
            max={300}
            step={10}
            value={jitterMs}
            onChange={(e) => {
              const val = Number(e.target.value);
              setJitterMs(val);
              applyChaos({ jitterMs: val });
            }}
            className='w-full accent-blue-500'
          />
        </div>

        <div className='flex items-center'>
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='checkbox'
              data-testid='chaos-silent'
              checked={silent}
              onChange={(e) => {
                const val = e.target.checked;
                setSilent(val);
                applyChaos({ silent: val });
              }}
              className='accent-brand-down'
            />
            <span
              className={`text-xs ${
                silent ? 'font-bold text-brand-down' : 'text-brand-muted'
              }`}
            >
              Silent socket (half-open)
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
