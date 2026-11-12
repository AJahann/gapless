import { describe, expect, it } from 'vitest';
import {
  type ChaosMessage,
  type Delta,
  type DeltasMessage,
  type ErrorMessage,
  type HeartbeatMessage,
  type HelloMessage,
  PROTOCOL_VERSION,
  type PauseMessage,
  type Quote,
  type ReplayUnavailableMessage,
  type ResumeMessage,
  type Snapshot,
  type UnpauseMessage,
  type WelcomeMessage,
  clientMessageSchema,
  decodeClientMessage,
  decodeServerMessage,
  deltaSchema,
  encodeClientMessage,
  encodeServerMessage,
  parseFeedId,
  quoteSchema,
  snapshotSchema,
} from './index';

describe('protocol wire constants and delta schema', () => {
  it('pins wire version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('validates a valid delta tuple', () => {
    const delta: Delta = [101, 0, 67000000000, 15000, 0, 1710000000000];
    const parsed = deltaSchema.parse(delta);
    expect(parsed).toEqual(delta);
  });

  it('rejects invalid side in delta', () => {
    const fn = () =>
      deltaSchema.parse([101, 0, 67000000000, 15000, 2, 1710000000000]);
    expect(fn).toThrow(/invalid/i);
  });

  it('rejects non-positive seq in delta', () => {
    const fn = () =>
      deltaSchema.parse([0, 0, 67000000000, 15000, 1, 1710000000000]);
    expect(fn).toThrow(/>0|too_small/i);
  });
});

describe('quote and snapshot schemas', () => {
  it('validates a snapshot with quotes and symbols', () => {
    const quote: Quote = {
      price: 67000000000,
      open: 66000000000,
      high: 67500000000,
      low: 65500000000,
      volume: '1234567890',
      trades: 4321,
      lastSeq: 4999,
      lastTs: 1710000000000,
    };
    expect(quoteSchema.parse(quote)).toEqual(quote);

    const snapshot: Snapshot = {
      feed: 'top100@100',
      epoch: 'epoch-1',
      seq: 5000,
      symbols: [{ symbol: 'BTC', name: 'Bitcoin', index: 0 }],
      quotes: [quote],
    };
    expect(snapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('F07: rejects snapshot with misaligned symbols and quotes count', () => {
    const quote: Quote = {
      price: 67000000000,
      open: 66000000000,
      high: 67500000000,
      low: 65500000000,
      volume: '1234567890',
      trades: 4321,
      lastSeq: 4999,
      lastTs: 1710000000000,
    };
    const badSnapshot = {
      feed: 'top100@100',
      epoch: 'epoch-1',
      seq: 5000,
      symbols: [
        { symbol: 'BTC', name: 'Bitcoin', index: 0 },
        { symbol: 'ETH', name: 'Ethereum', index: 1 },
      ],
      quotes: [quote], // only 1 quote for 2 symbols
    };
    expect(() => snapshotSchema.parse(badSnapshot)).toThrow(
      /snapshot symbols and quotes count mismatch/i,
    );
  });

  it('F07: rejects snapshot with non-contiguous symbol indices', () => {
    const quote: Quote = {
      price: 67000000000,
      open: 66000000000,
      high: 67500000000,
      low: 65500000000,
      volume: '0',
      trades: 0,
      lastSeq: 0,
      lastTs: 0,
    };
    const badSnapshot = {
      feed: 'top100@100',
      epoch: 'epoch-1',
      seq: 0,
      symbols: [{ symbol: 'BTC', name: 'Bitcoin', index: 5 }], // index 5 at slot 0
      quotes: [quote],
    };
    expect(() => snapshotSchema.parse(badSnapshot)).toThrow(
      /snapshot symbol indices must be contiguous/i,
    );
  });

  it('F11: validates canonical feed ID and rejects arbitrary IDs or rates', () => {
    const parsed = parseFeedId('top100@500');
    expect(parsed).toEqual({ universe: 'top100', rate: 500 });
    expect(parseFeedId('top10k@1000')).toEqual({
      universe: 'top10k',
      rate: 1000,
    });

    expect(() => parseFeedId('unknown@100')).toThrow(/invalid feed id/i);
    expect(() => parseFeedId('top100@-10')).toThrow(/invalid/i);
    expect(() => parseFeedId('top100@0')).toThrow(/invalid/i);
    expect(() => parseFeedId('top100@9999999')).toThrow(/invalid feed id/i);
    expect(() => parseFeedId('malformed')).toThrow(/invalid/i);
  });
});

describe('client messages wire round-trip', () => {
  it('encodes and decodes hello message', () => {
    const hello: HelloMessage = {
      type: 'hello',
      v: PROTOCOL_VERSION,
      feed: 'top100@100',
      resume: { epoch: 'epoch-1', seq: 1234 },
    };
    const json = encodeClientMessage(hello);
    expect(decodeClientMessage(json)).toEqual(hello);
  });

  it('rejects unknown keys on hello message', () => {
    const payload = {
      type: 'hello',
      v: 1,
      feed: 'top100@100',
      unknownKey: 'forbidden',
    };
    const fn = () => decodeClientMessage(payload);
    expect(fn).toThrow(/unknown|unrecognized_keys/i);
  });

  it('encodes, decodes, and rejects extra keys on resume message', () => {
    const resume: ResumeMessage = {
      type: 'resume',
      epoch: 'epoch-1',
      seq: 1234,
    };
    const json = encodeClientMessage(resume);
    expect(decodeClientMessage(json)).toEqual(resume);

    const fn = () => clientMessageSchema.parse({ ...resume, extra: true });
    expect(fn).toThrow(/unrecognized_keys/i);
  });

  it('encodes, decodes, and rejects extra keys on chaos message', () => {
    const chaos: ChaosMessage = {
      type: 'chaos',
      drop: 0.05,
      duplicate: 0.02,
      reorder: 0.05,
      delayMs: 10,
      jitterMs: 5,
      silent: false,
    };
    const json = encodeClientMessage(chaos);
    expect(decodeClientMessage(json)).toEqual(chaos);

    const fn = () => clientMessageSchema.parse({ ...chaos, extra: true });
    expect(fn).toThrow(/unrecognized_keys/i);
  });

  it('encodes and decodes pause/unpause messages', () => {
    const pause: PauseMessage = { type: 'pause' };
    const unpause: UnpauseMessage = { type: 'unpause' };
    expect(decodeClientMessage(encodeClientMessage(pause))).toEqual(pause);
    expect(decodeClientMessage(encodeClientMessage(unpause))).toEqual(unpause);
  });
});

describe('server messages wire round-trip', () => {
  it('encodes and decodes welcome message', () => {
    const welcome: WelcomeMessage = {
      type: 'welcome',
      feed: 'top100@100',
      epoch: 'epoch-1',
      headSeq: 5000,
      oldestSeq: 2001,
      heartbeatMs: 1000,
      mode: 'replay',
    };
    const json = encodeServerMessage(welcome);
    expect(decodeServerMessage(json)).toEqual(welcome);
  });

  it('encodes and decodes deltas message', () => {
    const deltas: DeltasMessage = {
      type: 'deltas',
      items: [[100, 0, 67000000000, 10000, 0, 1710000000000]],
    };
    const json = encodeServerMessage(deltas);
    expect(decodeServerMessage(json)).toEqual(deltas);
  });

  it('encodes and decodes heartbeat message', () => {
    const heartbeat: HeartbeatMessage = {
      type: 'heartbeat',
      headSeq: 5010,
    };
    const json = encodeServerMessage(heartbeat);
    expect(decodeServerMessage(json)).toEqual(heartbeat);
  });

  it('encodes and decodes replay_unavailable message', () => {
    const replayUnavail: ReplayUnavailableMessage = {
      type: 'replay_unavailable',
      reason: 'expired',
      epoch: 'epoch-1',
      headSeq: 5000,
      oldestSeq: 2001,
    };
    const json = encodeServerMessage(replayUnavail);
    expect(decodeServerMessage(json)).toEqual(replayUnavail);
  });

  it('encodes and decodes error message', () => {
    const err: ErrorMessage = {
      type: 'error',
      code: 'BAD_REQUEST',
      message: 'invalid request',
    };
    const json = encodeServerMessage(err);
    expect(decodeServerMessage(json)).toEqual(err);
  });
});
