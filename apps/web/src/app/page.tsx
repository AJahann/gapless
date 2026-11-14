'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { ChaosPanel } from '../components/chaos-panel/chaos-panel';
import { ConceptsGuide } from '../components/concepts-guide/concepts-guide';
import { MarketTable } from '../components/market-table/market-table';
import { MetricsPanel } from '../components/metrics-panel/metrics-panel';
import { StatusBar } from '../components/status-bar/status-bar';
import { TopMovers } from '../components/top-movers/top-movers';
import { TradeTape } from '../components/trade-tape/trade-tape';
import { type FeedClient, MainThreadFeedClient } from '../feed/feed-client';
import { WorkerFeedClient } from '../feed/worker-feed-client';
import { useFps } from '../hooks/use-fps';

function DashboardContent() {
  const [universe, setUniverse] = useState('top100');
  const [rate, setRate] = useState(100);
  const [mode, setMode] = useState<'main' | 'worker'>('main');
  const [selectedSymbolIndex, setSelectedSymbolIndex] = useState(0);

  const fps = useFps();

  useEffect(() => {
    const parseUrlParams = () => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const u = params.get('universe');
        const r = params.get('rate');
        const m = params.get('mode');
        if (u === 'top100' || u === 'top10k') setUniverse(u);
        if (r) {
          const rateNum = Number.parseInt(r, 10);
          if (
            Number.isSafeInteger(rateNum) &&
            rateNum >= 1 &&
            rateNum <= 10000
          ) {
            setRate(rateNum);
          }
        }
        if (m === 'worker' || m === 'main') setMode(m);
      }
    };

    parseUrlParams();
    window.addEventListener('popstate', parseUrlParams);
    return () => window.removeEventListener('popstate', parseUrlParams);
  }, []);

  const handleRateChange = (newRate: number) => {
    setRate(newRate);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('rate', String(newRate));
      window.history.replaceState({}, '', url.toString());
    }
  };

  const feedId = `${universe}@${rate}`;

  const client: FeedClient = useMemo(() => {
    if (mode === 'worker') {
      return new WorkerFeedClient({ feedId });
    }
    return new MainThreadFeedClient({ feedId });
  }, [feedId, mode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (
        window as unknown as { __gapless_client?: FeedClient }
      ).__gapless_client = client;
    }
    client.start();
    return () => {
      client.stop();
    };
  }, [client]);

  const symbols = client.getSymbols();
  const selectedSymbol = symbols[selectedSymbolIndex] ?? {
    symbol: 'BTC',
    name: 'Bitcoin',
    index: 0,
  };

  return (
    <div className='flex flex-col gap-5'>
      <header className='flex flex-wrap items-baseline justify-between border-b border-brand-border-subtle pb-3'>
        <div>
          <h1 className='text-2xl font-black tracking-tight text-brand-fg'>
            gapless
          </h1>
          <p className='mt-0.5 text-xs text-brand-muted'>
            Sequenced deltas, gap detection, replay and snapshot recovery under
            chaos.
          </p>
        </div>
      </header>

      <StatusBar
        client={client}
        feedId={feedId}
        currentRate={rate}
        onRateChange={handleRateChange}
        fps={fps}
      />
      <TopMovers client={client} onSelectSymbol={setSelectedSymbolIndex} />

      <div className='grid grid-cols-1 items-start gap-5 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <MarketTable
            client={client}
            selectedSymbolIndex={selectedSymbolIndex}
            onSelectSymbol={setSelectedSymbolIndex}
          />
        </div>

        <div className='flex flex-col gap-5'>
          <TradeTape
            client={client}
            symbolIndex={selectedSymbolIndex}
            symbolName={selectedSymbol.symbol}
          />
          <MetricsPanel client={client} fps={fps} />
          <ChaosPanel client={client} />
        </div>
      </div>

      <ConceptsGuide />
    </div>
  );
}

export default function HomePage() {
  return (
    <main className='mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8'>
      <Suspense
        fallback={
          <div className='p-8 text-sm text-brand-muted'>Loading market...</div>
        }
      >
        <DashboardContent />
      </Suspense>
    </main>
  );
}
