import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { MEDIA_REFUSAL_PATTERNS, translateRefusal, dictionaries } from '../../../packages/i18n/src/index.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { logMissingMedia, MISSING_MEDIA_HINT } from './mediaPresence.ts';
import { Presence } from './presence.ts';
import { Store } from './store.ts';

/**
 * A project's stored media file that is missing on disk is an honest state, not a server fault: the editor's content route answers
 * 404 missing_media (it used to log an ENOENT stack and answer 500), and a still and an export refuse the asset with the same code
 * as a blocker, before anything is drawn (ADR-0005: preview, still and export read the asset through one check, mediaPresence.ts).
 * Served in-process (app.fetch); no browser is started: every answer here comes before the render worker would be needed.
 */
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, exporter: Exporter;
let pid = '', assetId = '', blob = '';
const headers = (extra: Record<string, string> = {}) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, ...extra });
const call = async (method: string, p: string, body?: BodyInit | object, extra: Record<string, string> = {}) => {
  const raw = body === undefined || body instanceof Uint8Array ? body : JSON.stringify(body);
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers({ ...(raw !== undefined && !(raw instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...extra }), ...(raw === undefined ? {} : { body: raw as BodyInit }) }));
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, type, body: type.includes('json') ? ((await r.json()) as any) : new Uint8Array(await r.arrayBuffer()) };
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-missing-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  mcp = createMcp(store, auth, exporter, capabilities, presence, governance);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, governance);
  pid = store.createProject({ name: 'missing', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const png = path.join(dir, 'still.png');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x36', '-frames:v', '1', '-y', png]);
  const up = await call('POST', `/projects/${pid}/assets`, new Uint8Array(fs.readFileSync(png)), { 'x-filename': 'still.png', 'content-type': 'application/octet-stream' });
  expect(up.status).toBe(201);
  assetId = up.body.assetId;
  const added = await call('POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId, start: T.frameTime(0, { num: 30, den: 1 }), duration: T.frameTime(30, { num: 30, den: 1 }) } }] });
  expect(added.status).toBe(200);
  blob = store.blobPath(store.getProject(pid).doc.assets[assetId]!.contentHash);
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a stored media file that is missing on disk', () => {
  it('is served while it is there, and nothing is listed missing', async () => {
    const ok = await call('GET', `/projects/${pid}/assets/${assetId}/content`);
    expect([ok.status, ok.type]).toEqual([200, 'image/png']);
    expect((await call('GET', `/projects/${pid}/missing-media`)).body).toEqual({ missing: [] });
  });

  it('answers 404 missing_media with a hint for the content route, whole and by range, and logs one line with the asset id and no stack or path', async () => {
    fs.rmSync(blob);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const whole = await call('GET', `/projects/${pid}/assets/${assetId}/content`);
      expect(whole.status).toBe(404);
      expect(whole.body.error).toEqual({ code: 'missing_media', message: `the stored file of asset ${assetId} is missing`, details: { assetId }, hint: MISSING_MEDIA_HINT });
      const ranged = await call('GET', `/projects/${pid}/assets/${assetId}/content`, undefined, { range: 'bytes=0-99' });
      expect([ranged.status, ranged.body.error.code]).toEqual([404, 'missing_media']);
      expect(error).not.toHaveBeenCalled(); // no stack: this is an expected state, not a fault
      expect(warn).toHaveBeenCalledTimes(1); // a media element asks again and again: one line a minute per asset
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toContain(assetId);
      expect(line).not.toContain(dir);
      expect(line).not.toContain(path.basename(blob));
      expect(line.split('\n')).toHaveLength(1);
    } finally { error.mockRestore(); warn.mockRestore(); }
  });

  it('the editor is told which assets are missing (it marks them instead of drawing them)', async () => {
    expect((await call('GET', `/projects/${pid}/missing-media`)).body).toEqual({ missing: [assetId] });
  });

  it('a still and an export refuse with the same code, missing_media, before anything is drawn; so does the render worker route', async () => {
    const still = await call('GET', `/projects/${pid}/frame?index=0`);
    expect(still.status).toBe(422);
    expect(still.body.error.details.blockers[0]).toMatchObject({ code: 'missing_media', ids: [assetId] });
    expect(still.body.error.hint).toBe(MISSING_MEDIA_HINT);
    const plan = await call('POST', `/projects/${pid}/exports/plan`, {});
    expect(plan.body.blockers.map((b: any) => b.code)).toEqual(['missing_media']);
    const exp = await call('POST', `/projects/${pid}/exports`, {});
    expect(exp.status).toBe(422);
    expect(exp.body.error).toMatchObject({ code: 'render_blocked', details: { blockers: [{ code: 'missing_media', ids: [assetId] }] }, hint: MISSING_MEDIA_HINT });
    const png = await call('POST', `/projects/${pid}/exports`, { format: 'png', frame: 0 });
    expect(png.body.error.details.blockers[0].code).toBe('missing_media');
    // the render page reads assets through its session's route: a file that went away mid-render is the same typed answer
    exporter.sessions.set('tok-missing', { doc: store.getProject(pid).doc } as any);
    try {
      const worker = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1/render/tok-missing/assets/${assetId}`, { headers: { host: `127.0.0.1:${cfg.port}` } }));
      expect([worker.status, ((await worker.json()) as any).error.code]).toEqual([404, 'missing_media']);
    } finally { exporter.sessions.delete('tok-missing'); }
  });

  it('a file of the wrong size counts as missing for every reader, and a file put back is served again', async () => {
    fs.writeFileSync(blob, Buffer.alloc(10));
    expect((await call('GET', `/projects/${pid}/assets/${assetId}/content`)).body.error.code).toBe('missing_media');
    expect((await call('GET', `/projects/${pid}/missing-media`)).body.missing).toEqual([assetId]);
    expect((await call('POST', `/projects/${pid}/exports/plan`, {})).body.blockers[0].code).toBe('missing_media');
    fs.rmSync(blob);
    const png = path.join(dir, 'still.png');
    fs.copyFileSync(png, blob); // the same bytes back (what a restore from backup does)
    expect((await call('GET', `/projects/${pid}/assets/${assetId}/content`)).status).toBe(200);
    expect((await call('GET', `/projects/${pid}/missing-media`)).body.missing).toEqual([]);
  });

  it('the editor words every one of these answers in Hebrew and English: the headline by code, the detail by the refusal table', async () => {
    fs.rmSync(blob);
    const messages = [
      (await call('GET', `/projects/${pid}/assets/${assetId}/content`)).body.error.message,
      (await call('GET', `/projects/${pid}/frame?index=0`)).body.error.message,
      (await call('POST', `/projects/${pid}/exports`, {})).body.error.message,
    ];
    // the export's run-time re-check (a file removed after the job was planned) words its refusal this way (export.ts run)
    messages.push(`source media ${assetId} is no longer available`);
    const matched = new Set<number>();
    for (const m of messages) {
      expect(translateRefusal('he', m), m).toBeTruthy();
      expect(translateRefusal('he', m)!.replace(/\u2068[^\u2069]*\u2069/g, '')).not.toMatch(/[A-Za-z]{4,}/); // Hebrew, not the server's English (the file's own name is isolated)
      MEDIA_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(m.replace(/^export cannot start: /, ''))) matched.add(i); });
    }
    expect(MEDIA_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect((dictionaries.he as Record<string, string>)['error.code.missing_media']).toBe('קובץ המדיה חסר');
    expect((dictionaries.en as Record<string, string>)['error.code.missing_media']).toBe('The media file is missing');
  });

  it('logs the same asset at most once a minute', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(logMissingMedia('ast_x', 'test', 1_000_000)).toBe(true);
      expect(logMissingMedia('ast_x', 'test', 1_030_000)).toBe(false);
      expect(logMissingMedia('ast_y', 'test', 1_030_000)).toBe(true);
      expect(logMissingMedia('ast_x', 'test', 1_061_000)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(3);
    } finally { warn.mockRestore(); }
  });
});
