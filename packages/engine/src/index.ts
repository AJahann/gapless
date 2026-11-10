/**
 * Framework-free core: data structures (ring buffer, top-K heap, backoff),
 * the shared quote reducer, PRNG, and the client sync engine.
 * Must not import React, Next, Fastify, DOM globals or Node built-ins.
 * Spec: docs/sync-algorithm.md. Filled in Phases 1 and 3.
 */

export * from './backoff';
export * from './prng';
export * from './ring-buffer';
export * from './sync/clock';
export * from './sync/sync-engine';
export * from './sync/types';
export * from './top-k';
export * from './universe';
export { PROTOCOL_VERSION } from '@gapless/protocol';
