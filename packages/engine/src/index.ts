/**
 * Framework-free core: data structures (ring buffer, top-K heap, backoff),
 * the shared quote reducer, and the client sync engine.
 * Must not import React, Next, Fastify, DOM globals or Node built-ins.
 * Spec: docs/sync-algorithm.md. Filled in Phases 1 and 3.
 */
export { PROTOCOL_VERSION } from '@gapless/protocol';
