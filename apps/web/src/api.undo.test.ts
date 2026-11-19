import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';

/** The Copilot receipt's undo must name the agent's transaction: an empty body makes the server reverse the CALLER's newest edit instead. */
describe('api.undo', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ revision: 3, committed: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', f);
    return f;
  };
  it('sends the transaction id when one is named', async () => {
    const f = stub();
    await api.undo('p1', 'undo', 'tx_agent');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/projects/p1/undo');
    expect(JSON.parse(String(init.body))).toEqual({ transactionId: 'tx_agent' });
  });
  it('keeps the empty body for the ordinary undo', async () => {
    const f = stub();
    await api.undo('p1', 'undo');
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({});
  });
});
