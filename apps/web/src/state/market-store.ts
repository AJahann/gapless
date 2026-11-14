import type { SyncMetrics, SyncState } from '@gapless/engine';
import type { Delta, Quote, SymbolInfo } from '@gapless/protocol';
import { useSyncExternalStore } from 'react';
import type { FeedClient } from '../feed/feed-client';

const EMPTY_ARRAY: never[] = [];

const INITIAL_METRICS: SyncMetrics = {
  deltasIn: 0,
  duplicates: 0,
  gaps: 0,
  resumes: 0,
  replays: 0,
  snapshots: 0,
  reconnects: 0,
  pendingSize: 0,
  lastSeq: 0,
  epoch: '',
  state: 'connecting',
  lastEventAt: 0,
};

export function useSyncState(client: FeedClient): SyncState {
  return useSyncExternalStore(
    (cb) => client.subscribeState(cb),
    () => client.getState(),
    () => 'connecting',
  );
}

export function useSyncMetrics(client: FeedClient): SyncMetrics {
  return useSyncExternalStore(
    (cb) => client.subscribeMetrics(cb),
    () => client.getMetrics(),
    () => INITIAL_METRICS,
  );
}

export function useSymbolQuote(
  client: FeedClient,
  index: number,
): Quote | undefined {
  return useSyncExternalStore(
    (cb) => client.subscribeSymbol(index, cb),
    () => client.getQuote(index),
    () => undefined,
  );
}

export function useAllSymbols(client: FeedClient): SymbolInfo[] {
  return useSyncExternalStore(
    (cb) => client.subscribeAllQuotes(cb),
    () => client.getSymbols(),
    () => EMPTY_ARRAY,
  );
}

export function useTopMovers(client: FeedClient) {
  return useSyncExternalStore(
    (cb) => client.subscribeTopMovers(cb),
    () => client.getTopGainers(),
    () => EMPTY_ARRAY,
  );
}

export function useSymbolTrades(client: FeedClient, index: number): Delta[] {
  return useSyncExternalStore(
    (cb) => client.subscribeSymbol(index, cb),
    () => client.getTrades(index),
    () => EMPTY_ARRAY,
  );
}

export function useSymbolSparkline(
  client: FeedClient,
  index: number,
): number[] {
  return useSyncExternalStore(
    (cb) => client.subscribeSymbol(index, cb),
    () => client.getSparkline(index),
    () => EMPTY_ARRAY,
  );
}
