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
    <div className='mt-4'>
      <div className='mb-2 text-xs font-semibold uppercase tracking-wider text-brand-muted'>
        Top Movers (500ms Heap)
      </div>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5'>
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
              className='flex cursor-pointer flex-col gap-1 rounded-md border border-brand-border bg-brand-card p-3 text-left transition hover:border-brand-border-subtle hover:bg-brand-card-hover'
            >
              <div className='flex items-center justify-between'>
                <span className='text-sm font-bold text-brand-fg'>
                  {m.symbol.symbol}
                </span>
                <span
                  className={`text-xs font-bold tabular-nums ${
                    isUp ? 'text-brand-up' : 'text-brand-down'
                  }`}
                >
                  {isUp ? '+' : ''}
                  {m.changePct.toFixed(2)}%
                </span>
              </div>
              <div className='text-xs text-brand-muted tabular-nums'>
                ${priceFormatted}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
