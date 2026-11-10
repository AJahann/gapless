'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { ChaosPanel } from '../components/chaos-panel/chaos-panel';
import { MarketTable } from '../components/market-table/market-table';
import { MetricsPanel } from '../components/metrics-panel/metrics-panel';
import { StatusBar } from '../components/status-bar/status-bar';
import { TopMovers } from '../components/top-movers/top-movers';
import { TradeTape } from '../components/trade-tape/trade-tape';
import { MainThreadFeedClient } from '../feed/feed-client';

function DashboardContent() {
  const [universe, setUniverse] = useState('top100');
  const [rate, setRate] = useState(100);
  const [selectedSymbolIndex, setSelectedSymbolIndex] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const u = params.get('universe');
      const r = params.get('rate');
      if (u) setUniverse(u);
      if (r) setRate(Number(r) || 100);
    }
  }, []);

  const feedId = `${universe}@${rate}`;

  const client = useMemo(() => {
    return new MainThreadFeedClient({ feedId });
  }, [feedId]);

  useEffect(() => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderBottom: '1px solid #1f2638',
          paddingBottom: '0.75rem',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            gapless
          </h1>
          <p
            style={{
              margin: '0.2rem 0 0',
              color: '#8a93a6',
              fontSize: '0.85rem',
            }}
          >
            Sequenced deltas, gap detection, replay and snapshot recovery under
            chaos.
          </p>
        </div>
      </header>

      <StatusBar client={client} feedId={feedId} />
      <TopMovers client={client} onSelectSymbol={setSelectedSymbolIndex} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        <MarketTable
          client={client}
          selectedSymbolIndex={selectedSymbolIndex}
          onSelectSymbol={setSelectedSymbolIndex}
        />

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
        >
          <TradeTape
            client={client}
            symbolIndex={selectedSymbolIndex}
            symbolName={selectedSymbol.symbol}
          />
          <MetricsPanel client={client} />
          <ChaosPanel client={client} />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className='shell'>
      <Suspense
        fallback={<div style={{ padding: '2rem' }}>Loading market...</div>}
      >
        <DashboardContent />
      </Suspense>
    </main>
  );
}
