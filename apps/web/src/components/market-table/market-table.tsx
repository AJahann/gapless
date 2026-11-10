'use client';

import type { SymbolInfo } from '@gapless/protocol';
import { memo } from 'react';
import type { FeedClient } from '../../feed/feed-client';
import {
  useAllSymbols,
  useSymbolQuote,
  useSymbolSparkline,
  useSyncState,
} from '../../state/market-store';
import { SparklineCanvas } from '../sparkline/sparkline-canvas';

export interface MarketTableProps {
  client: FeedClient;
  selectedSymbolIndex: number;
  onSelectSymbol: (index: number) => void;
}

export function MarketTable({
  client,
  selectedSymbolIndex,
  onSelectSymbol,
}: MarketTableProps) {
  const symbols = useAllSymbols(client);
  const syncState = useSyncState(client);
  const isStale = syncState === 'offline' || syncState === 'error';

  return (
    <div
      style={{
        background: '#161b26',
        border: '1px solid #2a3142',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.85rem 1rem',
          borderBottom: '1px solid #2a3142',
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
          Top 100 Assets ({symbols.length} live)
        </span>
        {isStale && (
          <span
            style={{
              background: '#391c22',
              color: '#ea3943',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            STALE (Disconnected)
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '580px' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            textAlign: 'left',
            fontSize: '0.85rem',
          }}
        >
          <thead>
            <tr
              style={{
                color: '#8a93a6',
                borderBottom: '1px solid #2a3142',
                fontSize: '0.75rem',
                position: 'sticky',
                top: 0,
                background: '#161b26',
                zIndex: 1,
              }}
            >
              <th style={{ padding: '0.6rem 1rem' }}>Asset</th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                Price
              </th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                24h %
              </th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                24h High
              </th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                24h Low
              </th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                Volume
              </th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                Trades
              </th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'center' }}>
                History (1Hz)
              </th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((sym) => (
              <MarketTableRow
                key={sym.symbol}
                client={client}
                symbol={sym}
                isSelected={sym.index === selectedSymbolIndex}
                onSelect={() => onSelectSymbol(sym.index)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RowProps {
  client: FeedClient;
  symbol: SymbolInfo;
  isSelected: boolean;
  onSelect: () => void;
}

const MarketTableRow = memo(function MarketTableRow({
  client,
  symbol,
  isSelected,
  onSelect,
}: RowProps) {
  const quote = useSymbolQuote(client, symbol.index);
  const sparkline = useSymbolSparkline(client, symbol.index);

  if (!quote) {
    return (
      <tr style={{ borderBottom: '1px solid #1f2638' }}>
        <td style={{ padding: '0.6rem 1rem' }}>
          <strong>{symbol.symbol}</strong>{' '}
          <span style={{ color: '#8a93a6' }}>{symbol.name}</span>
        </td>
        <td
          colSpan={7}
          style={{
            padding: '0.6rem 1rem',
            color: '#8a93a6',
            textAlign: 'center',
          }}
        >
          Loading...
        </td>
      </tr>
    );
  }

  const priceUsd = quote.price / 1000000;
  const highUsd = quote.high / 1000000;
  const lowUsd = quote.low / 1000000;
  const volumeUsd = quote.volume / 10000000000; // price (1e6) * size (1e4) = 1e10

  const changePct =
    quote.open > 0 ? ((quote.price - quote.open) / quote.open) * 100 : 0;
  const isUp = changePct >= 0;

  return (
    <tr
      onClick={onSelect}
      style={{
        borderBottom: '1px solid #1f2638',
        backgroundColor: isSelected ? '#1f2638' : 'transparent',
        cursor: 'pointer',
        transition: 'background-color 0.15s',
      }}
    >
      <td style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}>
        <strong style={{ marginRight: '0.4rem' }}>{symbol.symbol}</strong>
        <span style={{ color: '#8a93a6', fontSize: '0.8rem' }}>
          {symbol.name}
        </span>
      </td>

      <td
        style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 600 }}
      >
        $
        {priceUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })}
      </td>

      <td
        style={{
          padding: '0.6rem 1rem',
          textAlign: 'right',
          fontWeight: 600,
          color: isUp ? '#16c784' : '#ea3943',
        }}
      >
        {isUp ? '+' : ''}
        {changePct.toFixed(2)}%
      </td>

      <td
        style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#8a93a6' }}
      >
        $
        {highUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </td>

      <td
        style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#8a93a6' }}
      >
        $
        {lowUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </td>

      <td
        style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#8a93a6' }}
      >
        ${volumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </td>

      <td
        style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#8a93a6' }}
      >
        {quote.trades.toLocaleString()}
      </td>

      <td style={{ padding: '0.4rem 1rem', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <SparklineCanvas
            data={sparkline}
            width={90}
            height={24}
            color={isUp ? '#16c784' : '#ea3943'}
          />
        </div>
      </td>
    </tr>
  );
});
