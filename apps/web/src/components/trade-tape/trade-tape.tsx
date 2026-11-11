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
    <div className='flex max-h-[340px] flex-col rounded-lg border border-brand-border bg-brand-card p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <span className='text-xs font-bold uppercase tracking-wider text-brand-muted'>
          Trade Tape ({symbolName})
        </span>
        <span className='text-[11px] text-brand-muted'>
          {trades.length} prints (ring of 200)
        </span>
      </div>

      <div className='flex-1 overflow-y-auto font-mono text-xs'>
        {reversedTrades.length === 0 ? (
          <div className='py-4 text-center text-xs text-brand-muted'>
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
                className='flex items-center justify-between border-b border-brand-border-subtle py-1 text-[11px]'
              >
                <span className='text-brand-muted'>#{seq}</span>
                <span
                  className={`font-semibold tabular-nums ${
                    isBuy ? 'text-brand-up' : 'text-brand-down'
                  }`}
                >
                  ${priceUsd}
                </span>
                <span className='tabular-nums text-brand-fg'>{sizeTokens}</span>
                <span className='text-[10px] text-brand-muted'>{timeStr}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
