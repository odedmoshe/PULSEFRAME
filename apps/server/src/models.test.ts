import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelStore } from './models.ts';
import { ApiError } from './store.ts';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-models-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const bytes = Buffer.alloc(300_000, 0).map((_, i) => (i * 31 + 7) & 255) as Buffer;
const sha = createHash('sha256').update(bytes).digest('hex');
const model = (over = {}) => ({ role: 'm', path: 'background_removal/test.safetensors', publisher: 'p', revision: 'r', sha256: sha, bytes: bytes.length, license: 'MIT', licenseEvidence: 'e', commercialUse: 'allowed' as const, gated: false, source: 'https://models.example/test.safetensors', ...over });
/** In-memory "host": honours Range, can truncate the body, can redirect. Counts requests. */
function host(opts: { data?: Buffer; cutAfter?: number; redirectTo?: string } = {}) {
  const calls: { url: string; range: string | null }[] = [];
  const f = (async (input: any, init: any = {}) => {
    const url = String(input);
    const range = (init.headers?.range as string) ?? null;
    calls.push({ url, range });
    if (opts.redirectTo && !url.startsWith(opts.redirectTo)) return new Response(null, { status: 302, headers: { location: opts.redirectTo } });
    const data = opts.data ?? bytes;
    const start = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    let body = data.subarray(start);
    if (opts.cutAfter !== undefined) body = body.subarray(0, opts.cutAfter);
    return new Response(new Uint8Array(body), { status: range ? 206 : 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ApiError ? e.code : String(e)));

describe('model integrity (FFG-04)', () => {
  it('a present file is ready only with the exact size and digest', async () => {
    const dir = tmp();
    const s = new ModelStore(dir, ['models.example']);
    expect((await s.status(model())).state).toBe('missing');
    fs.mkdirSync(path.join(dir, 'background_removal'));
    const f = path.join(dir, 'background_removal/test.safetensors');
    fs.writeFileSync(f, bytes.subarray(0, 1000));
    expect(await s.status(model())).toMatchObject({ state: 'corrupt', missingBytes: bytes.length }); // partial file, nonzero size: not ready
    const flipped = Buffer.from(bytes); flipped[12345] = flipped[12345]! ^ 1;
    fs.writeFileSync(f, flipped);
    expect((await s.status(model())).state).toBe('corrupt'); // right size, one bit wrong
    fs.writeFileSync(f, bytes);
    expect(await s.status(model())).toMatchObject({ state: 'ready', missingBytes: 0 });
    expect((await s.status(model({ sha256: null }))).state).toBe('unresolved');
    expect((await new ModelStore(null, []).status(model())).state).toBe('unverifiable');
  });
  it('downloads, resumes an interrupted transfer with a Range request, and verifies before publishing the file', async () => {
    const dir = tmp();
    const cut = host({ cutAfter: 100_000 });
    const s1 = new ModelStore(dir, ['models.example'], cut.f);
    expect(await code(s1.download(model(), () => {}))).toBe('model_download_incomplete');
    expect(await s1.status(model())).toMatchObject({ state: 'partial-download', presentBytes: 100_000, missingBytes: 200_000 });
    expect(fs.existsSync(path.join(dir, 'background_removal/test.safetensors'))).toBe(false);
    const full = host();
    const progress: number[] = [];
    const s2 = new ModelStore(dir, ['models.example'], full.f);
    expect((await s2.download(model(), (g) => progress.push(g))).state).toBe('ready');
    expect(full.calls[0]!.range).toBe('bytes=100000-');
    expect(progress.at(-1)).toBe(bytes.length);
    expect(fs.readFileSync(path.join(dir, 'background_removal/test.safetensors')).equals(bytes)).toBe(true);
    await s2.download(model(), () => {});
    expect(full.calls.length).toBe(1); // already ready: no second download
  });
  it('wrong bytes are discarded and never become ready; a corrupt existing file is replaced', async () => {
    const dir = tmp();
    const bad = Buffer.from(bytes); bad[5] = bad[5]! ^ 255;
    const s = new ModelStore(dir, ['models.example'], host({ data: bad }).f);
    expect(await code(s.download(model(), () => {}))).toBe('model_digest_mismatch');
    expect(fs.readdirSync(path.join(dir, 'background_removal'))).toEqual([]);
    fs.writeFileSync(path.join(dir, 'background_removal/test.safetensors'), bad);
    expect((await new ModelStore(dir, ['models.example'], host().f).download(model(), () => {})).state).toBe('ready');
  });
  it('refuses hosts outside the allow-list, including redirect targets, plain http and path escapes', async () => {
    const dir = tmp();
    expect(await code(new ModelStore(dir, ['other.example'], host().f).download(model(), () => {}))).toBe('model_host_not_allowed');
    expect(await code(new ModelStore(dir, ['models.example'], host({ redirectTo: 'https://evil.example/x' }).f).download(model(), () => {}))).toBe('model_host_not_allowed');
    expect((await new ModelStore(dir, ['models.example', '.cdn.example'], host({ redirectTo: 'https://a.cdn.example/x' }).f).download(model(), () => {})).state).toBe('ready');
    expect(await code(new ModelStore(tmp(), ['models.example'], host().f).download(model({ source: 'http://models.example/t' }), () => {}))).toBe('model_host_not_allowed');
    expect(await code(new ModelStore(tmp(), ['models.example'], host().f).status(model({ path: '../../etc/x' })))).toBe('bad_model_path');
  });
});
