import type { SyncMetrics, SyncState } from '@gapless/engine';
import type { Delta, Quote, SymbolInfo } from '@gapless/protocol';
import { useSyncExternalStore } from 'react';
import { type FeedClient, MainThreadFeedClient } from '../feed/feed-client';

let globalClient: FeedClient | null = null;

export function getOrCreateFeedClient(feedId = 'top100@100'): FeedClient {
  if (!globalClient) {
    globalClient = new MainThreadFeedClient({ feedId });
  }
  return globalClient;
}

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
    () => client.getMetrics(),
  );
}

export function useSymbolQuote(
  client: FeedClient,
  index: number,
): Quote | undefined {
  return useSyncExternalStore(
    (cb) => client.subscribeSymbol(index, cb),
    () => client.getQuote(index),
    () => client.getQuote(index),
  );
}

export function useAllSymbols(client: FeedClient): SymbolInfo[] {
  return useSyncExternalStore(
    (cb) => client.subscribeAllQuotes(cb),
    () => client.getSymbols(),
    () => client.getSymbols(),
  );
}

export function useTopMovers(client: FeedClient) {
  return useSyncExternalStore(
    (cb) => client.subscribeTopMovers(cb),
    () => client.getTopGainers(),
    () => [],
  );
}

export function useSymbolTrades(client: FeedClient, index: number): Delta[] {
  return useSyncExternalStore(
    (cb) => client.subscribeSymbol(index, cb),
    () => client.getTrades(index),
    () => [],
  );
}

export function useSymbolSparkline(
  client: FeedClient,
  index: number,
): number[] {
  return useSyncExternalStore(
    (cb) => client.subscribeSymbol(index, cb),
    () => client.getSparkline(index),
    () => [],
  );
}
