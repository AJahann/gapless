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
    <div className='overflow-hidden rounded-lg border border-brand-border bg-brand-card shadow-sm'>
      <div className='flex items-center justify-between border-b border-brand-border px-4 py-3'>
        <span className='text-xs font-bold uppercase tracking-wider text-brand-muted'>
          Top 100 Assets ({symbols.length} live)
        </span>
        {isStale && (
          <span className='rounded bg-rose-950/60 px-2 py-0.5 text-xs font-semibold text-brand-down border border-rose-900/50'>
            STALE (Disconnected)
          </span>
        )}
      </div>

      <div className='max-h-[580px] overflow-x-auto overflow-y-auto'>
        <table className='w-full border-collapse text-left text-xs'>
          <thead>
            <tr className='sticky top-0 z-10 border-b border-brand-border bg-brand-card text-[11px] font-semibold text-brand-muted'>
              <th className='px-4 py-2.5'>Asset</th>
              <th className='px-4 py-2.5 text-right'>Price</th>
              <th className='px-4 py-2.5 text-right'>24h %</th>
              <th className='px-4 py-2.5 text-right'>24h High</th>
              <th className='px-4 py-2.5 text-right'>24h Low</th>
              <th className='px-4 py-2.5 text-right'>Volume</th>
              <th className='px-4 py-2.5 text-right'>Trades</th>
              <th className='px-4 py-2.5 text-center'>History (1Hz)</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-brand-border-subtle'>
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
      onClick={onSelect}
      className={`cursor-pointer border-b border-brand-border-subtle transition hover:bg-brand-card-hover ${
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
        {priceUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })}
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
        $
        {highUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </td>

      <td className='px-4 py-2.5 text-right tabular-nums text-brand-muted'>
        $
        {lowUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </td>

      <td className='px-4 py-2.5 text-right tabular-nums text-brand-muted'>
        ${volumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </td>

      <td className='px-4 py-2.5 text-right tabular-nums text-brand-muted'>
        {quote.trades.toLocaleString()}
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
