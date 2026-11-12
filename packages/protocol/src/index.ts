import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const CLOSE_CODES = {
  SLOW_CONSUMER: 4000,
  PROTOCOL_VIOLATION: 4001,
  UNAUTHORIZED_ORIGIN: 4002,
  HELLO_TIMEOUT: 4003,
  EPOCH_RESET: 4004,
  SERVER_SHUTDOWN: 1001,
} as const;

export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

export const SUPPORTED_UNIVERSES = ['top100', 'top10k'] as const;
export type SupportedUniverse = (typeof SUPPORTED_UNIVERSES)[number];

export const feedIdSchema = z
  .string()
  .regex(/^[0-9a-z]+@\d+$/i)
  .refine(
    (val) => {
      const [universe, rateStr] = val.split('@');
      if (!universe || !rateStr) return false;
      if (!SUPPORTED_UNIVERSES.includes(universe as SupportedUniverse)) {
        return false;
      }
      const rate = Number.parseInt(rateStr, 10);
      return Number.isSafeInteger(rate) && rate >= 1 && rate <= 10000;
    },
    {
      message:
        'Invalid feed ID: expected <universe>@<rate> with universe top100|top10k and rate 1-10000',
    },
  );

export function parseFeedId(feedId: string): {
  universe: SupportedUniverse;
  rate: number;
} {
  feedIdSchema.parse(feedId);
  const [universe, rateStr] = feedId.split('@');
  return {
    universe: universe as SupportedUniverse,
    rate: Number.parseInt(rateStr!, 10),
  };
}

// Delta tuple: [seq, symbolIndex, price, size, side, ts]
// side: 0 = buy, 1 = sell
export const deltaSchema = z.tuple([
  z
    .number()
    .int()
    .positive()
    .refine((n) => Number.isSafeInteger(n), 'seq must be a safe integer'),
  z
    .number()
    .int()
    .nonnegative()
    .refine(
      (n) => Number.isSafeInteger(n),
      'symbolIndex must be a safe integer',
    ),
  z
    .number()
    .int()
    .positive()
    .refine(
      (n) => Number.isSafeInteger(n),
      'price must be a safe positive integer',
    ),
  z
    .number()
    .int()
    .nonnegative()
    .refine((n) => Number.isSafeInteger(n), 'size must be a safe integer'),
  z.union([z.literal(0), z.literal(1)]),
  z
    .number()
    .int()
    .nonnegative()
    .refine((n) => Number.isSafeInteger(n), 'ts must be a safe integer'),
]);
export type Delta = z.infer<typeof deltaSchema>;

export const symbolInfoSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  index: z.number().int().nonnegative(),
});
export type SymbolInfo = z.infer<typeof symbolInfoSchema>;

export const quoteSchema = z.object({
  price: z
    .number()
    .int()
    .positive()
    .refine((n) => Number.isSafeInteger(n)),
  open: z
    .number()
    .int()
    .positive()
    .refine((n) => Number.isSafeInteger(n)),
  high: z
    .number()
    .int()
    .positive()
    .refine((n) => Number.isSafeInteger(n)),
  low: z
    .number()
    .int()
    .positive()
    .refine((n) => Number.isSafeInteger(n)),
  volume: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
    .transform((v) => String(v)),
  trades: z
    .number()
    .int()
    .nonnegative()
    .refine((n) => Number.isSafeInteger(n)),
  lastSeq: z
    .number()
    .int()
    .nonnegative()
    .refine((n) => Number.isSafeInteger(n)),
  lastTs: z
    .number()
    .int()
    .nonnegative()
    .refine((n) => Number.isSafeInteger(n)),
});
export type Quote = z.infer<typeof quoteSchema>;

export const snapshotSchema = z
  .object({
    feed: z.string().min(1),
    epoch: z.string().min(1),
    seq: z
      .number()
      .int()
      .nonnegative()
      .refine((n) => Number.isSafeInteger(n)),
    symbols: z.array(symbolInfoSchema),
    quotes: z.array(quoteSchema),
  })
  .refine(
    (snap) => snap.symbols.length === snap.quotes.length,
    'Snapshot symbols and quotes count mismatch',
  )
  .refine((snap) => {
    for (let i = 0; i < snap.symbols.length; i++) {
      if (snap.symbols[i]?.index !== i) {
        return false;
      }
    }
    return true;
  }, 'Snapshot symbol indices must be contiguous starting from 0');
export type Snapshot = z.infer<typeof snapshotSchema>;

// Client -> Server messages (.strict() to reject unknown keys)

export const helloResumeSchema = z
  .object({
    epoch: z.string().min(1),
    seq: z.number().int().nonnegative(),
  })
  .strict();
export type HelloResume = z.infer<typeof helloResumeSchema>;

export const helloMessageSchema = z
  .object({
    type: z.literal('hello'),
    v: z.number().int().default(PROTOCOL_VERSION),
    feed: z.string().min(1),
    resume: helloResumeSchema.optional(),
  })
  .strict();
export type HelloMessage = z.infer<typeof helloMessageSchema>;

export const resumeMessageSchema = z
  .object({
    type: z.literal('resume'),
    epoch: z.string().min(1),
    seq: z.number().int().nonnegative(),
  })
  .strict();
export type ResumeMessage = z.infer<typeof resumeMessageSchema>;

export const chaosMessageSchema = z
  .object({
    type: z.literal('chaos'),
    drop: z.number().min(0).max(1).optional(),
    duplicate: z.number().min(0).max(1).optional(),
    reorder: z.number().min(0).max(1).optional(),
    delayMs: z.number().int().nonnegative().optional(),
    jitterMs: z.number().int().nonnegative().optional(),
    silent: z.boolean().optional(),
  })
  .strict();
export type ChaosMessage = z.infer<typeof chaosMessageSchema>;

export const pauseMessageSchema = z
  .object({
    type: z.literal('pause'),
  })
  .strict();
export type PauseMessage = z.infer<typeof pauseMessageSchema>;

export const unpauseMessageSchema = z
  .object({
    type: z.literal('unpause'),
  })
  .strict();
export type UnpauseMessage = z.infer<typeof unpauseMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  helloMessageSchema,
  resumeMessageSchema,
  chaosMessageSchema,
  pauseMessageSchema,
  unpauseMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// Server -> Client messages

export const welcomeMessageSchema = z.object({
  type: z.literal('welcome'),
  feed: z.string().min(1),
  epoch: z.string().min(1),
  headSeq: z.number().int().nonnegative(),
  oldestSeq: z.number().int().nonnegative(),
  heartbeatMs: z.number().int().positive(),
  mode: z.enum(['replay', 'live', 'snapshot']),
});
export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;

export const deltasMessageSchema = z.object({
  type: z.literal('deltas'),
  items: z.array(deltaSchema),
});
export type DeltasMessage = z.infer<typeof deltasMessageSchema>;

export const heartbeatMessageSchema = z.object({
  type: z.literal('heartbeat'),
  headSeq: z.number().int().nonnegative(),
});
export type HeartbeatMessage = z.infer<typeof heartbeatMessageSchema>;

export const replayUnavailableMessageSchema = z.object({
  type: z.literal('replay_unavailable'),
  reason: z.enum(['stale_epoch', 'expired', 'future']),
  epoch: z.string().min(1),
  headSeq: z.number().int().nonnegative(),
  oldestSeq: z.number().int().nonnegative(),
});
export type ReplayUnavailableMessage = z.infer<
  typeof replayUnavailableMessageSchema
>;

export const errorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string().min(1),
  message: z.string(),
});
export type ErrorMessage = z.infer<typeof errorMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  welcomeMessageSchema,
  deltasMessageSchema,
  heartbeatMessageSchema,
  replayUnavailableMessageSchema,
  errorMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// Frame serialization helpers

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

function parsePayload(raw: unknown): unknown {
  if (typeof raw === 'string') {
    return JSON.parse(raw);
  }
  return raw;
}

export function decodeClientMessage(raw: unknown): ClientMessage {
  const payload = parsePayload(raw);
  return clientMessageSchema.parse(payload);
}

export function decodeServerMessage(raw: unknown): ServerMessage {
  const payload = parsePayload(raw);
  return serverMessageSchema.parse(payload);
}

export function safeDecodeClientMessage(raw: unknown) {
  try {
    const payload = parsePayload(raw);
    return clientMessageSchema.safeParse(payload);
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function safeDecodeServerMessage(raw: unknown) {
  try {
    const payload = parsePayload(raw);
    return serverMessageSchema.safeParse(payload);
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function decodeSnapshot(raw: unknown): Snapshot {
  const payload = parsePayload(raw);
  return snapshotSchema.parse(payload);
}

export function safeDecodeSnapshot(raw: unknown) {
  try {
    const payload = parsePayload(raw);
    return snapshotSchema.safeParse(payload);
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
