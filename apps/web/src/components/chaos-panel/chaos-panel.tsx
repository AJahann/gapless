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
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <span
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#8a93a6',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Chaos Injection (Per-Connection)
        </span>
        <button
          type='button'
          onClick={handleReset}
          style={{
            background: 'transparent',
            border: '1px solid #2a3142',
            color: '#8a93a6',
            borderRadius: '4px',
            fontSize: '0.75rem',
            padding: '0.2rem 0.5rem',
            cursor: 'pointer',
          }}
        >
          Reset All
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '1rem',
          fontSize: '0.8rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Drop:</span>
            <span style={{ fontWeight: 600 }}>{drop}%</span>
          </div>
          <input
            type='range'
            min={0}
            max={50}
            value={drop}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDrop(val);
              applyChaos({ drop: val });
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Duplicate:</span>
            <span style={{ fontWeight: 600 }}>{duplicate}%</span>
          </div>
          <input
            type='range'
            min={0}
            max={30}
            value={duplicate}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDuplicate(val);
              applyChaos({ duplicate: val });
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Reorder:</span>
            <span style={{ fontWeight: 600 }}>{reorder}%</span>
          </div>
          <input
            type='range'
            min={0}
            max={30}
            value={reorder}
            onChange={(e) => {
              const val = Number(e.target.value);
              setReorder(val);
              applyChaos({ reorder: val });
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Jitter:</span>
            <span style={{ fontWeight: 600 }}>{jitterMs}ms</span>
          </div>
          <input
            type='range'
            min={0}
            max={300}
            step={10}
            value={jitterMs}
            onChange={(e) => {
              const val = Number(e.target.value);
              setJitterMs(val);
              applyChaos({ jitterMs: val });
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              cursor: 'pointer',
            }}
          >
            <input
              type='checkbox'
              checked={silent}
              onChange={(e) => {
                const val = e.target.checked;
                setSilent(val);
                applyChaos({ silent: val });
              }}
            />
            <span
              style={{
                color: silent ? '#ea3943' : 'inherit',
                fontWeight: silent ? 600 : 400,
              }}
            >
              Silent socket
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
