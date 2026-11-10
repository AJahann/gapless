import type { Delta, Quote, SymbolInfo } from '@gapless/protocol';
import { createPrng } from './prng';

/**
 * Top 100 cryptocurrency token fixture with fixed-point prices (scale 1e6).
 * Spec: docs/ROADMAP.md Phase 1.
 */
interface FixtureDefinition {
  symbol: string;
  name: string;
  basePriceUsd: number;
}

const FIXTURES_RAW: FixtureDefinition[] = [
  { symbol: 'BTC', name: 'Bitcoin', basePriceUsd: 67450.0 },
  { symbol: 'ETH', name: 'Ethereum', basePriceUsd: 3520.5 },
  { symbol: 'SOL', name: 'Solana', basePriceUsd: 178.25 },
  { symbol: 'BNB', name: 'BNB', basePriceUsd: 595.1 },
  { symbol: 'XRP', name: 'XRP', basePriceUsd: 0.584 },
  { symbol: 'DOGE', name: 'Dogecoin', basePriceUsd: 0.142 },
  { symbol: 'ADA', name: 'Cardano', basePriceUsd: 0.468 },
  { symbol: 'AVAX', name: 'Avalanche', basePriceUsd: 28.9 },
  { symbol: 'SUI', name: 'Sui', basePriceUsd: 2.15 },
  { symbol: 'LINK', name: 'Chainlink', basePriceUsd: 11.85 },
  { symbol: 'SHIB', name: 'Shiba Inu', basePriceUsd: 0.000018 },
  { symbol: 'NEAR', name: 'NEAR Protocol', basePriceUsd: 4.85 },
  { symbol: 'DOT', name: 'Polkadot', basePriceUsd: 4.25 },
  { symbol: 'LTC', name: 'Litecoin', basePriceUsd: 72.3 },
  { symbol: 'PEPE', name: 'Pepe', basePriceUsd: 0.0000095 },
  { symbol: 'UNI', name: 'Uniswap', basePriceUsd: 7.95 },
  { symbol: 'APT', name: 'Aptos', basePriceUsd: 9.4 },
  { symbol: 'ICP', name: 'Internet Computer', basePriceUsd: 8.1 },
  { symbol: 'POL', name: 'Polygon Ecosystem Token', basePriceUsd: 0.385 },
  { symbol: 'FET', name: 'Artificial Superintelligence', basePriceUsd: 1.35 },
  { symbol: 'RENDER', name: 'Render', basePriceUsd: 5.6 },
  { symbol: 'XLM', name: 'Stellar', basePriceUsd: 0.098 },
  { symbol: 'AAVE', name: 'Aave', basePriceUsd: 154.2 },
  { symbol: 'TAO', name: 'Bittensor', basePriceUsd: 540.0 },
  { symbol: 'KAS', name: 'Kaspa', basePriceUsd: 0.13 },
  { symbol: 'ETC', name: 'Ethereum Classic', basePriceUsd: 19.4 },
  { symbol: 'MON', name: 'Monad Test', basePriceUsd: 14.2 },
  { symbol: 'STX', name: 'Stacks', basePriceUsd: 1.75 },
  { symbol: 'IMX', name: 'Immutable', basePriceUsd: 1.45 },
  { symbol: 'INJ', name: 'Injective', basePriceUsd: 21.3 },
  { symbol: 'FIL', name: 'Filecoin', basePriceUsd: 3.65 },
  { symbol: 'TIA', name: 'Celestia', basePriceUsd: 5.25 },
  { symbol: 'OP', name: 'Optimism', basePriceUsd: 1.62 },
  { symbol: 'ARB', name: 'Arbitrum', basePriceUsd: 0.54 },
  { symbol: 'VET', name: 'VeChain', basePriceUsd: 0.023 },
  { symbol: 'OM', name: 'MANTRA', basePriceUsd: 1.42 },
  { symbol: 'WIF', name: 'dogwifhat', basePriceUsd: 2.35 },
  { symbol: 'RUNE', name: 'THORChain', basePriceUsd: 5.1 },
  { symbol: 'MKR', name: 'Maker', basePriceUsd: 1250.0 },
  { symbol: 'SEI', name: 'Sei', basePriceUsd: 0.42 },
  { symbol: 'HBAR', name: 'Hedera', basePriceUsd: 0.052 },
  { symbol: 'ALGO', name: 'Algorand', basePriceUsd: 0.125 },
  { symbol: 'ATOM', name: 'Cosmos', basePriceUsd: 4.45 },
  { symbol: 'BONK', name: 'Bonk', basePriceUsd: 0.000022 },
  { symbol: 'FTM', name: 'Fantom', basePriceUsd: 0.71 },
  { symbol: 'FLOKI', name: 'FLOKI', basePriceUsd: 0.00014 },
  { symbol: 'GRT', name: 'The Graph', basePriceUsd: 0.165 },
  { symbol: 'THETA', name: 'Theta Network', basePriceUsd: 1.25 },
  { symbol: 'JUP', name: 'Jupiter', basePriceUsd: 0.98 },
  { symbol: 'BEAM', name: 'Beam', basePriceUsd: 0.017 },
  { symbol: 'AR', name: 'Arweave', basePriceUsd: 18.2 },
  { symbol: 'LDO', name: 'Lido DAO', basePriceUsd: 1.15 },
  { symbol: 'POPCAT', name: 'Popcat', basePriceUsd: 1.45 },
  { symbol: 'ONDO', name: 'Ondo', basePriceUsd: 0.74 },
  { symbol: 'ENA', name: 'Ethena', basePriceUsd: 0.38 },
  { symbol: 'FLOW', name: 'Flow', basePriceUsd: 0.56 },
  { symbol: 'PYTH', name: 'Pyth Network', basePriceUsd: 0.34 },
  { symbol: 'GALA', name: 'GALA', basePriceUsd: 0.022 },
  { symbol: 'DYDX', name: 'dYdX', basePriceUsd: 1.05 },
  { symbol: 'QNT', name: 'Quant', basePriceUsd: 74.2 },
  { symbol: 'EGLD', name: 'MultiversX', basePriceUsd: 26.5 },
  { symbol: 'JASMY', name: 'JasmyCoin', basePriceUsd: 0.019 },
  { symbol: 'BSV', name: 'Bitcoin SV', basePriceUsd: 48.0 },
  { symbol: 'EOS', name: 'EOS', basePriceUsd: 0.48 },
  { symbol: 'STRK', name: 'Starknet', basePriceUsd: 0.39 },
  { symbol: 'SAND', name: 'The Sandbox', basePriceUsd: 0.26 },
  { symbol: 'NEO', name: 'NEO', basePriceUsd: 9.85 },
  { symbol: 'BLUR', name: 'Blur', basePriceUsd: 0.25 },
  { symbol: 'WLD', name: 'Worldcoin', basePriceUsd: 2.15 },
  { symbol: 'MANA', name: 'Decentraland', basePriceUsd: 0.29 },
  { symbol: 'AXS', name: 'Axie Infinity', basePriceUsd: 4.8 },
  { symbol: 'CHZ', name: 'Chiliz', basePriceUsd: 0.071 },
  { symbol: 'CRV', name: 'Curve DAO', basePriceUsd: 0.27 },
  { symbol: 'MINA', name: 'Mina', basePriceUsd: 0.54 },
  { symbol: 'XTZ', name: 'Tezos', basePriceUsd: 0.68 },
  { symbol: 'CORE', name: 'Core', basePriceUsd: 0.98 },
  { symbol: 'IOTA', name: 'IOTA', basePriceUsd: 0.12 },
  { symbol: 'KLAY', name: 'Kaia', basePriceUsd: 0.13 },
  { symbol: 'KAVA', name: 'Kava', basePriceUsd: 0.32 },
  { symbol: 'RON', name: 'Ronin', basePriceUsd: 1.55 },
  { symbol: 'SNX', name: 'Synthetix', basePriceUsd: 1.45 },
  { symbol: 'CFX', name: 'Conflux', basePriceUsd: 0.15 },
  { symbol: 'PENDLE', name: 'Pendle', basePriceUsd: 4.4 },
  { symbol: 'ZEC', name: 'Zcash', basePriceUsd: 34.5 },
  { symbol: 'FTT', name: 'FTX Token', basePriceUsd: 1.95 },
  { symbol: 'CAKE', name: 'PancakeSwap', basePriceUsd: 1.82 },
  { symbol: 'ORDI', name: 'ORDI', basePriceUsd: 34.2 },
  { symbol: 'APE', name: 'ApeCoin', basePriceUsd: 1.12 },
  { symbol: 'ROSE', name: 'Oasis', basePriceUsd: 0.072 },
  { symbol: 'AIOZ', name: 'AIOZ Network', basePriceUsd: 0.52 },
  { symbol: 'NEXO', name: 'NEXO', basePriceUsd: 1.02 },
  { symbol: 'SUPER', name: 'SuperVerse', basePriceUsd: 1.25 },
  { symbol: 'RAY', name: 'Raydium', basePriceUsd: 3.1 },
  { symbol: 'AKT', name: 'Akash Network', basePriceUsd: 2.75 },
  { symbol: '1INCH', name: '1inch Network', basePriceUsd: 0.28 },
  { symbol: 'WOO', name: 'WOO', basePriceUsd: 0.19 },
  { symbol: 'HOT', name: 'Holo', basePriceUsd: 0.0018 },
  { symbol: 'COMP', name: 'Compound', basePriceUsd: 46.5 },
  { symbol: 'SAFE', name: 'Safe', basePriceUsd: 1.1 },
  { symbol: 'OSMO', name: 'Osmosis', basePriceUsd: 0.42 },
];

export const TOP100_SYMBOLS: readonly SymbolInfo[] = FIXTURES_RAW.map(
  (f, index) => ({
    symbol: f.symbol,
    name: f.name,
    index,
  }),
);

export function createInitialQuote(basePriceUsd: number): Quote {
  // scale 1e6 fixed point
  const fixedPrice = Math.round(basePriceUsd * 1_000_000);
  return {
    price: fixedPrice,
    open: fixedPrice,
    high: fixedPrice,
    low: fixedPrice,
    volume: 0,
    trades: 0,
    lastSeq: 0,
    lastTs: 0,
  };
}

export function createTop100Universe(): {
  symbols: SymbolInfo[];
  quotes: Quote[];
} {
  const symbols = FIXTURES_RAW.map((f, index) => ({
    symbol: f.symbol,
    name: f.name,
    index,
  }));
  const quotes = FIXTURES_RAW.map((f) => createInitialQuote(f.basePriceUsd));
  return { symbols, quotes };
}

export function generateSyntheticUniverse(
  count: number,
  seed = 42,
): {
  symbols: SymbolInfo[];
  quotes: Quote[];
} {
  const prng = createPrng(seed);
  const symbols: SymbolInfo[] = [];
  const quotes: Quote[] = [];

  for (let i = 0; i < count; i += 1) {
    // If within top 100 fixture, use real name/price; otherwise generate
    if (i < FIXTURES_RAW.length) {
      const fix = FIXTURES_RAW[i]!;
      symbols.push({ symbol: fix.symbol, name: fix.name, index: i });
      quotes.push(createInitialQuote(fix.basePriceUsd));
    } else {
      const symNum = String(i).padStart(5, '0');
      const symbol = `SYM${symNum}`;
      const name = `Asset ${symNum}`;
      // Log-uniform base price between $0.01 and $10,000
      const logPrice = prng.nextFloat(Math.log(0.01), Math.log(10000));
      const basePriceUsd = Math.exp(logPrice);
      symbols.push({ symbol, name, index: i });
      quotes.push(createInitialQuote(basePriceUsd));
    }
  }

  return { symbols, quotes };
}

/**
 * Shared quote reducer used by server feed generator and client sync engine.
 * Exact same implementation ensures convergence invariant.
 * Spec: docs/sync-algorithm.md.
 */
export function applyDelta(quote: Quote, delta: Delta): Quote {
  const [seq, _symbolIndex, price, size, _side, ts] = delta;
  const volumeDelta = price * size;

  return {
    price,
    open: quote.open,
    high: price > quote.high ? price : quote.high,
    low: price < quote.low ? price : quote.low,
    volume: quote.volume + volumeDelta,
    trades: quote.trades + 1,
    lastSeq: seq,
    lastTs: ts,
  };
}

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Canonical 64-bit digest over quotes in index order.
 * Pure JS arithmetic with zero Node built-in dependencies.
 * Spec: docs/testing.md.
 */
export function computeDigest(quotes: Iterable<Quote>): string {
  let hash = FNV_OFFSET_64;
  for (const q of quotes) {
    const fields = [
      BigInt(q.price),
      BigInt(q.open),
      BigInt(q.high),
      BigInt(q.low),
      BigInt(q.volume),
      BigInt(q.trades),
      BigInt(q.lastSeq),
      BigInt(q.lastTs),
    ];
    for (const f of fields) {
      let v = f;
      for (let b = 0; b < 8; b++) {
        const byte = Number(v & 0xffn);
        hash = ((hash ^ BigInt(byte)) * FNV_PRIME_64) & MASK_64;
        v >>= 8n;
      }
    }
  }
  return hash.toString(16).padStart(16, '0');
}
