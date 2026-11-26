/**
 * The safe downloader (connectors/fetch.ts; verify C8) on LABELLED doubles only: `double: link-host` listens on 127.0.0.9 port 0
 * and the injected test policy (doublePolicy) calls exactly that address public. Names are answered by a labelled stand-in
 * resolver (`resolve`, this module's own test seam) so a name can lead to several addresses. No real host is contacted.
 */
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOUBLE_HOST, DOUBLE_PRIVATE_HOST, doublePolicy, startLinkHost, type LinkHost } from '../../../../packages/evals/src/doubles/sources/doubles.ts';
import { classifyAddress, contentTypeVerdict, defaultAddressPolicy, FetchRefusal, normaliseAddress, readCapped, safeOpen, sniffMedia } from './fetch.ts';

const policy = doublePolicy(defaultAddressPolicy); // labelled: 127.0.0.9 public, 127.0.0.10 private, the rest the default
let host: LinkHost;
let priv: LinkHost;
beforeAll(async () => { host = await startLinkHost(); priv = await startLinkHost(DOUBLE_PRIVATE_HOST); });
afterAll(async () => { await host.close(); await priv.close(); });
const refusal = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof FetchRefusal ? e.code : `other: ${e}`; } };
/** labelled stand-in resolver: a name answered with the given addresses */
const names = (m: Record<string, string[]>) => async (h: string) => (m[h] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('addresses (C8)', () => {
  it('normalises IPv4-mapped, IPv4-compatible and NAT64 IPv6 to IPv4; strips brackets and zones', () => {
    expect(normaliseAddress('::ffff:127.0.0.1')).toEqual({ address: '127.0.0.1', family: 4 });
    expect(normaliseAddress('[::ffff:7f00:1]')).toEqual({ address: '127.0.0.1', family: 4 });
    expect(normaliseAddress('0:0:0:0:0:ffff:a9fe:a9fe')).toEqual({ address: '169.254.169.254', family: 4 });
    expect(normaliseAddress('64:ff9b::7f00:1')).toEqual({ address: '127.0.0.1', family: 4 });
    expect(normaliseAddress('fe80::1%eth0')).toEqual({ address: 'fe80:0:0:0:0:0:0:1', family: 6 });
    expect(normaliseAddress('example.com')).toBeNull();
  });
  it('the DEFAULT policy refuses loopback, unspecified, link-local, multicast and this machine\'s own addresses; home networks are private', () => {
    const v = (a: string) => classifyAddress(defaultAddressPolicy, a).verdict;
    for (const a of ['127.0.0.1', '127.0.0.9', '::1', '::ffff:127.0.0.1', '0.0.0.0', '::', '169.254.169.254', 'fe80::1', '224.0.0.1', 'ff02::1', '255.255.255.255']) expect({ a, v: v(a) }).toEqual({ a, v: 'refuse' });
    for (const a of ['192.168.1.20', '10.0.0.5', '172.16.3.4', 'fd12:3456::1', '100.64.0.1']) expect({ a, v: v(a) }).toEqual({ a, v: 'private' });
    for (const a of ['93.184.216.34', '2606:4700::1111']) expect({ a, v: v(a) }).toEqual({ a, v: 'public' });
    const own = Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal).map((i) => i!.address);
    for (const a of own) expect({ a, v: v(a) }).toEqual({ a, v: 'refuse' });
  });
  it('the default policy (nothing injected) refuses a link to 127.0.0.1 before connecting', async () => {
    const url = host.put('/a.png', { bytes: Buffer.from('x') }).replace(DOUBLE_HOST, '127.0.0.1');
    const before = host.seen.length;
    expect(await refusal(safeOpen(url, { userAgent: 'PULSEFRAME-Studio' }))).toBe('link_address_refused');
    expect(await refusal(safeOpen(host.url + '/a.png', { userAgent: 'PULSEFRAME-Studio' }))).toBe('link_address_refused'); // 127.0.0.9 too
    expect(host.seen.length).toBe(before);
  });
});

describe('requests through the lookup hook', () => {
  it('a name whose lookup answers several addresses is refused when ANY is refused (all: true arrays checked whole)', async () => {
    const url = host.put('/b.png', { bytes: Buffer.from('x') }).replace(DOUBLE_HOST, 'two.example.invalid');
    expect(await refusal(safeOpen(url, { userAgent: 'u', policy, resolve: names({ 'two.example.invalid': [DOUBLE_HOST, '127.0.0.1'] }) }))).toBe('link_address_refused');
    expect(await refusal(safeOpen(url, { userAgent: 'u', policy, resolve: names({ 'two.example.invalid': ['::1', DOUBLE_HOST] }) }))).toBe('link_address_refused');
    const ok = await safeOpen(url, { userAgent: 'u', policy, resolve: names({ 'two.example.invalid': [DOUBLE_HOST] }) });
    expect(ok.status).toBe(200);
    ok.body.resume();
  });
  it('literal links: [::ffff:127.0.0.1], 169.254.169.254 and the machine\'s own address are refused; a home-network one answers with link_private_network', async () => {
    for (const h of ['[::ffff:127.0.0.1]', '169.254.169.254', '[::1]']) expect(await refusal(safeOpen(`http://${h}:${host.port}/a.png`, { userAgent: 'u', policy }))).toBe('link_address_refused');
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
    if (lan) expect(await refusal(safeOpen(`http://${lan.address}:${host.port}/a.png`, { userAgent: 'u', policy }))).toBe('link_address_refused');
    const u = priv.put('/n.png', { bytes: Buffer.from('x') });
    const r = await safeOpen(u, { userAgent: 'u', policy });
    expect([r.status, [...r.warnings]]).toEqual([200, ['link_private_network']]);
    r.body.resume();
  });
  it('a public link redirecting to loopback is refused at the hop; at most 5 redirects are followed', async () => {
    const target = host.put('/t.png', { bytes: Buffer.from('x') });
    host.put('/r-loop', { bytes: Buffer.alloc(0), redirectTo: target.replace(DOUBLE_HOST, '127.0.0.1') });
    expect(await refusal(safeOpen(`${host.url}/r-loop`, { userAgent: 'u', policy }))).toBe('link_address_refused');
    for (let i = 0; i < 7; i++) host.put(`/hop${i}`, { bytes: Buffer.alloc(0), redirectTo: `${host.url}/hop${i + 1}` });
    host.put('/hop7', { bytes: Buffer.from('end'), contentType: 'image/png' });
    expect(await refusal(safeOpen(`${host.url}/hop0`, { userAgent: 'u', policy }))).toBe('too_many_redirects');
    const fine = await safeOpen(`${host.url}/hop2`, { userAgent: 'u', policy });
    expect(fine.status).toBe(200);
    fine.body.resume();
  });
  it('an API call is bound to its hosts at every hop; the User-Agent is the caller\'s; no cookie or referer is ever sent', async () => {
    host.put('/api-off', { bytes: Buffer.alloc(0), redirectTo: `${priv.url}/n.png` });
    expect(await refusal(safeOpen(`${host.url}/api-off`, { userAgent: 'u', policy, allowHosts: [DOUBLE_HOST] }))).toBe('host_not_allowed');
    const n = host.seen.length;
    const r = await safeOpen(host.put('/h.png', { bytes: Buffer.from('x') }), { userAgent: 'PULSEFRAME-Studio', policy, headers: { cookie: 'a=b', referer: 'http://x', 'User-Agent': 'other' } });
    r.body.resume();
    const s = host.seen[n]!;
    expect([s.headers['user-agent'], s.headers.cookie, s.headers.referer]).toEqual(['PULSEFRAME-Studio', undefined, undefined]);
  });
  it('the idle timer ends a stalled body with stalled', async () => {
    const r = await safeOpen(host.put('/stall', { bytes: Buffer.alloc(1000, 1), stallAfterBytes: 10 }), { userAgent: 'u', policy, idleTimeoutMs: 300 });
    expect(await refusal(readCapped(r.body, 1 << 20))).toBe('stalled');
  });
});

describe('media checks', () => {
  it('magic bytes name pictures, sounds and videos; HTML is none', () => {
    expect(sniffMedia(Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom')]))).toBe('video');
    expect(sniffMedia(Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypM4A ')]))).toBe('audio');
    expect(sniffMedia(Buffer.from([0x89, ...Buffer.from('PNG\r\n\u001a\n')]))).toBe('image');
    expect(sniffMedia(Buffer.from('ID3\u0004'))).toBe('audio');
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(sniffMedia(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video');
    expect(sniffMedia(Buffer.from('<!doctype html><html>'))).toBeNull();
  });
  it('Content-Type verdicts', () => {
    expect(['video/mp4', 'audio/mpeg; x=1', 'image/png', 'application/octet-stream', '', 'text/html; charset=utf-8', 'image/svg+xml', 'application/json'].map((t) => contentTypeVerdict(t)))
      .toEqual(['media', 'media', 'media', 'neutral', 'neutral', 'not-media', 'not-media', 'not-media']);
  });
});
