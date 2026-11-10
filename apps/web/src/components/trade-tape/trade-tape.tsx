'use client';

import type { FeedClient } from '../../feed/feed-client';
import { useSymbolTrades } from '../../state/market-store';

export interface TradeTapeProps {
  client: FeedClient;
  symbolIndex: number;
  symbolName: string;
}

export function TradeTape({ client, symbolIndex, symbolName }: TradeTapeProps) {
  const trades = useSymbolTrades(client, symbolIndex);
  // Display newest first
  const reversedTrades = [...trades].reverse();

  return (
    <div
      style={{
        background: '#161b26',
        border: '1px solid #2a3142',
        borderRadius: '8px',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '340px',
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
          Trade Tape ({symbolName})
        </span>
        <span style={{ fontSize: '0.75rem', color: '#8a93a6' }}>
          {trades.length} prints (ring of 200)
        </span>
      </div>

      <div
        style={{
          overflowY: 'auto',
          flex: 1,
          fontFamily: 'monospace',
          fontSize: '0.75rem',
        }}
      >
        {reversedTrades.length === 0 ? (
          <div
            style={{ color: '#8a93a6', padding: '1rem 0', textAlign: 'center' }}
          >
            Awaiting trade prints...
          </div>
        ) : (
          reversedTrades.slice(0, 50).map((t) => {
            const [seq, _idx, price, size, side, ts] = t;
            const isBuy = side === 0;
            const priceUsd = (price / 1000000).toFixed(4);
            const sizeTokens = (size / 10000).toFixed(2);
            const timeStr = new Date(ts).toISOString().slice(11, 23);

            return (
              <div
                key={seq}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '0.2rem 0',
                  borderBottom: '1px solid #1f2638',
                }}
              >
                <span style={{ color: '#8a93a6' }}>#{seq}</span>
                <span
                  style={{
                    color: isBuy ? '#16c784' : '#ea3943',
                    fontWeight: 600,
                  }}
                >
                  ${priceUsd}
                </span>
                <span>{sizeTokens}</span>
                <span style={{ color: '#8a93a6' }}>{timeStr}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
