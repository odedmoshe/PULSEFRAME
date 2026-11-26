/**
 * The shared harness of the sources tests and `proof:sources` (wave 8 `sources`, integration): synthetic fixtures made by ffmpeg
 * at run time, the LABELLED doubles (doubles.ts: 127.0.0.9 / 127.0.0.10, port 0) with the items the checks use, the real server on
 * port 0 with the doubles' base URLs and the injected test address policy (SourcesDeps.test, never from the environment), and
 * small request helpers. `apps/server/src/sourcesContracts.test.ts`, `apps/server/src/sources/openMode.test.ts` and
 * `packages/evals/src/sources-proof.ts` use this one copy. Never a real service, real media or a real key; the caller deletes `root`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type RunningServer } from '@pulseframe/server';
import { defaultAddressPolicy } from '@pulseframe/server/connectors/fetch.ts';
import type { JobRow } from '@pulseframe/server/store.ts';
import type { Config } from '@pulseframe/server';
import { DOUBLE_PRIVATE_HOST, doublePolicy, startLinkHost, startOpenverseDouble, startPixabayDouble, startWikimediaDouble, type LinkHost, type OpenverseDouble, type PixabayDouble, type WikimediaDouble } from './doubles.ts';

/** A labelled Pixabay key of the double (not a real key). */
export const PX_KEY = 'pxkey-double-7f3a91c2';
/** A labelled contact line (an .invalid address). */
export const CONTACT = 'me@example.invalid';
export const OV_BY = 'a1b2c3d4-0000-4000-8000-000000000001';
export const OV_ND = 'a1b2c3d4-0000-4000-8000-000000000002';
export const OV_NC = 'a1b2c3d4-0000-4000-8000-000000000003';
export const OV_SA_SONG = 'a1b2c3d4-0000-4000-8000-000000000004';
export const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args]);

export type Fixtures = Record<'red.png' | 'blue.png' | 'green.png' | 'yellow.png' | 'small.mp4' | 'big.mp4' | 'big2.mp4' | 'big3.mp4' | 'song.mp3', Buffer>;
/** Synthetic fixtures (colour PNGs, short test-pattern MP4s, a sine MP3), made in `root` and read into memory. */
export function makeFixtures(root: string): Fixtures {
  const f = (n: string) => path.join(root, n);
  for (const [n, c] of [['red.png', 'red'], ['blue.png', 'blue'], ['green.png', 'green'], ['yellow.png', 'yellow']] as const) ff(['-f', 'lavfi', '-i', `color=c=${c}:s=64x64`, '-frames:v', '1', f(n)]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', f('small.mp4')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '2', '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f('big.mp4')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-t', '2', '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f('big2.mp4')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-t', '2', '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f('big3.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=330:r=44100:d=12', '-c:a', 'libmp3lame', '-b:a', '64k', f('song.mp3')]);
  const out = {} as Fixtures;
  for (const n of ['red.png', 'blue.png', 'green.png', 'yellow.png', 'small.mp4', 'big.mp4', 'big2.mp4', 'big3.mp4', 'song.mp3'] as const) out[n] = fs.readFileSync(f(n));
  return out;
}

export interface Doubles { host: LinkHost; nas: LinkHost; ov: OpenverseDouble; px: PixabayDouble; wm: WikimediaDouble; close(): Promise<void> }
/** The labelled doubles with the items the checks name (a CC BY, a CC BY-ND, a CC BY-NC photo and a CC BY-SA song on Openverse; one Pixabay video; one Commons photo). */
export async function startDoubles(fx: Fixtures): Promise<Doubles> {
  const host = await startLinkHost();
  const nas = await startLinkHost(DOUBLE_PRIVATE_HOST);
  const ov = await startOpenverseDouble([
    { id: OV_BY, media: 'images', title: 'Red cat', creator: 'Ann Author', license: 'by', license_version: '4.0', fileUrl: host.put('/ov/red.png', { bytes: fx['red.png'], contentType: 'image/png' }), thumbnail: host.put('/ov/red-thumb.png', { bytes: fx['red.png'], contentType: 'image/png' }), filetype: 'png', width: 64, height: 64, category: 'photograph' },
    { id: OV_ND, media: 'images', title: 'Blue cat', creator: 'Bo', license: 'by-nd', license_version: '4.0', fileUrl: host.put('/ov/blue.png', { bytes: fx['blue.png'], contentType: 'image/png' }), filetype: 'png' },
    { id: OV_NC, media: 'images', title: 'Yellow cat', creator: 'Cy', license: 'by-nc', license_version: '4.0', fileUrl: host.put('/ov/yellow.png', { bytes: fx['yellow.png'], contentType: 'image/png' }), filetype: 'png' },
    { id: OV_SA_SONG, media: 'audio', title: 'Long song', creator: 'Dee', license: 'by-sa', license_version: '4.0', fileUrl: host.put('/ov/song.mp3', { bytes: fx['song.mp3'], contentType: 'audio/mpeg' }), filetype: 'mp3', duration: 12_000, category: 'music' },
  ]);
  const px = await startPixabayDouble(PX_KEY, [
    { id: 4242, type: 'film', tags: 'sunrise, sea', user: 'Monika', fileUrl: host.put('/px/sunrise.mp4', { bytes: fx['small.mp4'], contentType: 'video/mp4' }), previewUrl: host.put('/px/sunrise.jpg', { bytes: fx['green.png'], contentType: 'image/png' }), size: fx['small.mp4'].length, duration: 2 },
  ]);
  const wm = await startWikimediaDouble([
    { pageid: 777, title: 'File:Green field.png', fileUrl: host.put('/wm/green.png', { bytes: fx['green.png'], contentType: 'image/png' }), mime: 'image/png', mediatype: 'BITMAP', width: 64, height: 64, size: fx['green.png'].length,
      extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ann">Ann</a>' }, AttributionRequired: { value: 'true' } } },
  ]);
  return { host, nas, ov, px, wm, close: async () => { for (const d of [ov, px, wm, host, nas]) await d.close(); } };
}

/** A labelled free-space stand-in a test lowers to provoke download_disk_full. */
export const freeSpace = { bytes: 100 * 1024 ** 3 as number | null };
/** The real server on port 0, reaching the doubles through the injected test seam only. */
export async function bootSources(dataDir: string, d: Pick<Doubles, 'ov' | 'px' | 'wm'>, over: Partial<Config> = {}): Promise<RunningServer> {
  return startServer({ port: 0, dataDir, importReserveBytes: 1024 ** 2, speechPython: null, voicePython: null, backupDir: null, ...over }, {
    sourcesTest: { addressPolicy: doublePolicy(defaultAddressPolicy), baseUrls: { openverse: d.ov.url, pixabay: d.px.url, wikimedia: d.wm.url } }, // labelled doubles
    sourcesOptions: { freeBytes: () => freeSpace.bytes, timeouts: { headerMs: 3000, idleMs: 1500 } }, // labelled free-space stand-in; short timers
  });
}

export type Who = 'owner' | 'agent' | 'observer' | { bearer: string };
export interface Answer { status: number; body: any; headers: Headers; raw: Buffer }
/** Request helpers bound to one running server (the owner through a session cookie, others with their bearer token). */
export function client(get: () => RunningServer) {
  let cookie = '', cookieOf: RunningServer | null = null;
  const ownerCookie = () => {
    const s = get();
    if (cookieOf !== s) { cookie = s.auth.issueSession(new Request(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner } })).split(';')[0]!; cookieOf = s; }
    return cookie;
  };
  const headersOf = (who: Who): Record<string, string> => {
    const s = get();
    if (who === 'owner') return { origin: s.url, cookie: ownerCookie() };
    return { authorization: `Bearer ${typeof who === 'object' ? who.bearer : who === 'agent' ? s.auth.tokens.agent : s.auth.tokens.observer}` };
  };
  async function api(who: Who, method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<Answer> {
    const s = get();
    const r = await fetch(`${s.url}${p}`, { method, headers: { ...headersOf(who), connection: 'close', ...extra, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const raw = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, headers: r.headers, raw, body: ct.includes('json') ? JSON.parse(raw.toString('utf8')) : null };
  }
  /** One MCP JSON-RPC call; answers the parsed message (SSE or JSON framing). */
  async function rpc(who: Who, method: string, params: unknown): Promise<any> {
    const s = get();
    const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { ...headersOf(who), 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const t = await r.text();
    return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : t);
  }
  /** The JSON an MCP tool answered (its first text part), or the error text. */
  const toolJson = (m: any): any => { const t = m?.result?.content?.[0]?.text ?? ''; try { return JSON.parse(t); } catch { return { text: t }; } };
  async function finished(jobId: string, ms = 60_000): Promise<JobRow> {
    const t = Date.now();
    for (;;) {
      const j = get().store.getJob(jobId);
      if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j;
      if (Date.now() - t > ms) throw new Error(`job ${jobId} still ${j.status} ${j.stage}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return { api, rpc, toolJson, finished };
}
export async function until(f: () => boolean, ms = 20_000): Promise<void> { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); } }
/** The src_/up_/imp_ temp files of a data folder. */
export const tmpFiles = (dataDir: string): string[] => { try { return fs.readdirSync(path.join(dataDir, 'tmp')).filter((f) => /^(src|up|imp)_/.test(f)); } catch { return []; } };
/** Every file of a data folder that contains `needle` (the key store itself excepted). */
export function filesContaining(dataDir: string, needle: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (!f.includes(`${path.sep}connectors${path.sep}keys${path.sep}`) && fs.statSync(f).size < 64 * 1024 ** 2 && fs.readFileSync(f).includes(needle)) out.push(path.relative(dataDir, f)); } };
  walk(dataDir);
  return out;
}
