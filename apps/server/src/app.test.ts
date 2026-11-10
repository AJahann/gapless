import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /api/health', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('reports ok with the protocol version', async () => {
    app = await buildApp({ clientOrigins: ['http://localhost:3000'] });
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', protocolVersion: 1 });
  });
});
