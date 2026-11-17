import { describe, expect, it } from 'vitest';
import { providerAfter, recheckProvider } from './aiTools.recheck.ts';

const notConfigured = { provider: { configured: false, reason: 'PF_COMFYUI_URL is not set', readiness: null }, capabilities: [] };
const unreachable = { provider: { configured: true, reason: null, readiness: { reachable: false } }, capabilities: [] };
const ready = { provider: { configured: true, reason: null, readiness: { reachable: true } }, capabilities: [{ id: 'x' }] };

describe('check again in the AI tools panel', () => {
  it('a failed check keeps what the panel shows: the provider state is not cleared', async () => {
    const boom = new Error('Failed to fetch');
    const r = await recheckProvider<typeof notConfigured>(() => Promise.reject(boom));
    expect(r).toEqual({ ok: false, error: boom });
    expect(providerAfter(notConfigured, r)).toBe(notConfigured); // the same object: setup steps, message and button stay
    expect(providerAfter(notConfigured, r)).not.toBeNull();
  });
  it('a check that throws before any request is also a failed check, not a crash', async () => {
    const r = await recheckProvider<typeof notConfigured>(async () => { throw new Error('authentication required'); });
    expect(r.ok).toBe(false);
  });
  it('an answered check replaces the provider state and says whether the provider is connected', async () => {
    const still = await recheckProvider(async () => unreachable);
    expect(still).toEqual({ ok: true, provider: unreachable, connected: false });
    expect(providerAfter(notConfigured as typeof unreachable | typeof notConfigured, still)).toBe(unreachable);
    const none = await recheckProvider(async () => notConfigured);
    expect(none.ok && none.connected).toBe(false);
    const ok = await recheckProvider(async () => ready);
    expect(ok).toEqual({ ok: true, provider: ready, connected: true });
  });
});
