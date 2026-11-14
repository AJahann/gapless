'use client';

import type { SymbolInfo } from '@gapless/protocol';
import { memo, useCallback, useState } from 'react';
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

const fmtPrice = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const fmtUsd = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtVolume = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  maximumFractionDigits: 0,
});

const fmtInt = new Intl.NumberFormat('en-US');

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 580;
const OVERSCAN = 10;

function checkIsStale(state: string): boolean {
  return (
    state === 'offline' ||
    state === 'error' ||
    state === 'syncing' ||
    state === 'replaying'
  );
}

function computeVirtualBounds(total: number, scrollTop: number) {
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    total,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
  );
  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * ROW_HEIGHT,
    paddingBottom: (total - endIndex) * ROW_HEIGHT,
  };
}

export function MarketTable({
  client,
  selectedSymbolIndex,
  onSelectSymbol,
}: MarketTableProps) {
  const symbols = useAllSymbols(client);
  const syncState = useSyncState(client);
  const [scrollTop, setScrollTop] = useState(0);

  const isStale = checkIsStale(syncState);
  const isVirtual = symbols.length > 500;

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (isVirtual) {
        setScrollTop(e.currentTarget.scrollTop);
      }
    },
    [isVirtual],
  );

  const handleSelect = useCallback(
    (index: number) => {
      onSelectSymbol(index);
    },
    [onSelectSymbol],
  );

  const bounds = isVirtual
    ? computeVirtualBounds(symbols.length, scrollTop)
    : {
        startIndex: 0,
        endIndex: symbols.length,
        paddingTop: 0,
        paddingBottom: 0,
      };

  const visibleSymbols = isVirtual
    ? symbols.slice(bounds.startIndex, bounds.endIndex)
    : symbols;

  return (
    <div className='overflow-hidden rounded-lg border border-brand-border bg-brand-card shadow-sm'>
      <div className='flex items-center justify-between border-b border-brand-border px-4 py-3'>
        <span className='text-xs font-bold uppercase tracking-wider text-brand-muted'>
          Top {symbols.length > 500 ? '10k' : '100'} Assets ({symbols.length}{' '}
          live)
        </span>
        {isStale && (
          <span className='rounded border border-rose-900/50 bg-rose-950/60 px-2 py-0.5 text-xs font-semibold text-brand-down'>
            {syncState === 'offline'
              ? 'STALE (Disconnected)'
              : 'STALE (Recovering)'}
          </span>
        )}
      </div>

      <div
        onScroll={isVirtual ? handleScroll : undefined}
        className='max-h-[580px] overflow-x-auto overflow-y-auto'
      >
        <table className='w-full border-collapse text-left text-xs'>
          <thead>
            <tr className='sticky top-0 z-10 border-b border-brand-border bg-brand-card text-[11px] font-semibold text-brand-muted'>
              <th className='px-4 py-2.5'>Asset</th>
              <th className='px-4 py-2.5 text-right'>Price</th>
              <th
                className='px-4 py-2.5 text-right'
                title='Percentage change relative to session opening baseline'
              >
                Session %
              </th>
              <th
                className='px-4 py-2.5 text-right'
                title='Highest price observed in current stream session'
              >
                Session High
              </th>
              <th
                className='px-4 py-2.5 text-right'
                title='Lowest price observed in current stream session'
              >
                Session Low
              </th>
              <th className='px-4 py-2.5 text-right'>Volume</th>
              <th className='px-4 py-2.5 text-right'>Trades</th>
              <th className='px-4 py-2.5 text-center'>History (1Hz)</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-brand-border-subtle'>
            {bounds.paddingTop > 0 && (
              <tr aria-hidden='true'>
                <td
                  colSpan={8}
                  aria-label='scroll-spacer'
                  style={{
                    height: `${bounds.paddingTop}px`,
                    padding: 0,
                    border: 'none',
                  }}
                />
              </tr>
            )}
            {visibleSymbols.map((sym) => (
              <MarketTableRow
                key={sym.symbol}
                client={client}
                symbol={sym}
                isSelected={sym.index === selectedSymbolIndex}
                onSelect={handleSelect}
              />
            ))}
            {bounds.paddingBottom > 0 && (
              <tr aria-hidden='true'>
                <td
                  colSpan={8}
                  aria-label='scroll-spacer'
                  style={{
                    height: `${bounds.paddingBottom}px`,
                    padding: 0,
                    border: 'none',
                  }}
                />
              </tr>
            )}
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
  onSelect: (index: number) => void;
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
      <tr className='border-b border-brand-border-subtle'>
        <td className='px-4 py-2.5'>
          <strong className='text-brand-fg'>{symbol.symbol}</strong>{' '}
          <span className='text-brand-muted'>{symbol.name}</span>
        </td>
        <td colSpan={7} className='px-4 py-2.5 text-center text-brand-muted'>
          Loading...
        </td>
      </tr>
    );
  }

  const priceUsd = quote.price / 1000000;
  const highUsd = quote.high / 1000000;
  const lowUsd = quote.low / 1000000;
  const volumeUsd = Number(quote.volume) / 10000000000; // price (1e6) * size (1e4) = 1e10

  const changePct =
    quote.open > 0 ? ((quote.price - quote.open) / quote.open) * 100 : 0;
  const isUp = changePct >= 0;

  return (
    <tr
      tabIndex={0}
      aria-selected={isSelected}
      onClick={() => onSelect(symbol.index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(symbol.index);
        }
      }}
      className={`cursor-pointer border-b border-brand-border-subtle transition hover:bg-brand-card-hover focus:outline-none focus:ring-1 focus:ring-brand-accent ${
        isSelected ? 'bg-brand-card-hover' : 'bg-transparent'
      }`}
    >
      <td className='whitespace-nowrap px-4 py-2.5'>
        <strong className='mr-1.5 font-bold text-brand-fg'>
          {symbol.symbol}
        </strong>
        <span className='text-[11px] text-brand-muted'>{symbol.name}</span>
      </td>

      <td className='px-4 py-2.5 text-right font-semibold tabular-nums text-brand-fg'>
        $
        {priceUsd < 0.01 && priceUsd > 0
          ? priceUsd.toPrecision(4)
          : fmtPrice.format(priceUsd)}
      </td>

      <td
        className={`px-4 py-2.5 text-right font-bold tabular-nums ${
          isUp ? 'text-brand-up' : 'text-brand-down'
        }`}
      >
        {isUp ? '+' : ''}
        {changePct.toFixed(2)}%
      </td>

      <td className='px-4 py-2.5 text-right tabular-nums text-brand-muted'>
        ${fmtUsd.format(highUsd)}
      </td>

      <td className='px-4 py-2.5 text-right tabular-nums text-brand-muted'>
        ${fmtUsd.format(lowUsd)}
      </td>

      <td className='px-4 py-2.5 text-right tabular-nums text-brand-muted'>
        ${fmtVolume.format(volumeUsd)}
      </td>

      <td className='px-4 py-2.5 text-right tabular-nums text-brand-muted'>
        {fmtInt.format(quote.trades)}
      </td>

      <td className='px-4 py-1.5 text-center'>
        <div className='flex justify-center'>
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
