'use client';

import type { FeedClient } from '../../feed/feed-client';
import { useTopMovers } from '../../state/market-store';

export interface TopMoversProps {
  client: FeedClient;
  onSelectSymbol?: (index: number) => void;
}

export function TopMovers({ client, onSelectSymbol }: TopMoversProps) {
  const movers = useTopMovers(client);

  if (movers.length === 0) {
    return null;
  }

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div
        style={{
          fontSize: '0.85rem',
          fontWeight: 600,
          color: '#8a93a6',
          textTransform: 'uppercase',
          marginBottom: '0.5rem',
          letterSpacing: '0.05em',
        }}
      >
        Top Movers (500ms Heap)
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {movers.map((m) => {
          const isUp = m.changePct >= 0;
          const priceFormatted = (m.quote.price / 1000000).toLocaleString(
            undefined,
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 4,
            },
          );

          return (
            <button
              type='button'
              key={m.symbol.symbol}
              onClick={() => onSelectSymbol?.(m.symbol.index)}
              style={{
                background: '#161b26',
                border: '1px solid #2a3142',
                borderRadius: '6px',
                padding: '0.75rem 1rem',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                color: 'inherit',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 700 }}>{m.symbol.symbol}</span>
                <span
                  style={{
                    color: isUp ? '#16c784' : '#ea3943',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                  }}
                >
                  {isUp ? '+' : ''}
                  {m.changePct.toFixed(2)}%
                </span>
              </div>
              <div style={{ fontSize: '0.9rem', color: '#8a93a6' }}>
                ${priceFormatted}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
