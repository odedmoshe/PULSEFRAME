/**
 * What the server fetches for a page (wave 8 motioncode, W1; decision 5 and "the editor's own port stays unreachable from the page"):
 * internet addresses only. A loopback, private or link-local address, or a name that resolves to one, is never fetched by the server
 * (the page's own request is aborted like any other). Found by proof:made G3.3–G3.5: the page named http://127.0.0.1:<port>/… and the
 * server's fetch-once reached the listener.
 */
import { describe, expect, it } from 'vitest';
import { fetchOnce, isPublicIp, publicAddresses } from './libs.ts';

describe('made fetch-once: internet addresses only', () => {
  it('knows loopback, private, link-local and shared ranges (v4 and v6)', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) expect(isPublicIp(ip), ip).toBe(false);
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPublicIp(ip), ip).toBe(true);
  });
  it('drops local names and addresses, and names that resolve to them', async () => {
    const lookup = async (host: string) => (host === 'evil.example' ? ['127.0.0.1'] : ['93.184.216.34']);
    const r = await publicAddresses(['http://127.0.0.1:8787/api/v1/projects', 'http://localhost:9/x', 'http://pf-probe.localhost:1/', 'http://[::1]:80/', 'https://evil.example/a.png', 'https://pictures.example/a.png', 'http://10.0.0.5/b.png', 'ftp://pictures.example/c'], lookup);
    expect(r).toEqual({ fetch: ['https://pictures.example/a.png'], skipped: ['http://127.0.0.1:8787/api/v1/projects', 'http://localhost:9/x', 'http://pf-probe.localhost:1/', 'http://[::1]:80/', 'https://evil.example/a.png', 'http://10.0.0.5/b.png', 'ftp://pictures.example/c'] });
  });
  it('never follows a redirect to a local address', async () => {
    const calls: string[] = [];
    const f = (async (url: string) => { calls.push(url); return url.includes('pictures') ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8787/secret' } }) : new Response('x'); }) as unknown as typeof fetch;
    await expect(fetchOnce(['https://pictures.example/a.png'], { fetch: f, lookup: async () => ['93.184.216.34'] })).rejects.toThrow(/local|private/);
    expect(calls).toEqual(['https://pictures.example/a.png']);
  });
});
