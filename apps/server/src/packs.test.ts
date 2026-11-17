/**
 * The Hanukkah and birthday packs on the server (ADR-0022), through the real routes on in-house fixtures:
 * - every one of the eight pack templates (the seven new ones and tpl.birthday) plans, applies as ONE transaction, undoes to
 *   the exact previous document and redoes to the applied one (document hashes compared), with every pack field given;
 * - a matrix over media counts 1, 3, 8 and 12, the three tempos and 24, 25 and 30 frames a second: each plan either lists a
 *   blocker or applies, and an apply after a clean plan never fails;
 * - the sounds the packs name exist in this server's list of built-in sounds;
 * - all 50 elements rasterise through the server's own path and cover between 2 and 90 percent of their box, each its own picture;
 * - built-in music is asked for by every template: the plan is clean, and the apply either works (undo exact) or says honestly
 *   that the synthesiser is not built (501 music_not_built) and commits nothing. Nothing here depends on the synthesiser.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { creativeProjection, ELEMENTS, findTemplate, PACKS, type ProjectDocument } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { elementPreview } from './elements.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { SFX } from './sfx.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

const exec = promisify(execFile);
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, ownerCookie = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const rest = async (method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers: { host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const picture = (k: string) => ({ op: 'import_asset', args: { asset: { kind: 'image', name: `${k}.png`, contentHash: `sha256:${k.repeat(64).slice(0, 64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 1080, height: 1920, codec: 'png', hasAlpha: false }, provenance: prov } } });
const video = (k: string, seconds: number, fps: number) => ({ op: 'import_asset', args: { asset: { kind: 'video', name: `${k}.mp4`, contentHash: `sha256:${k.repeat(64).slice(0, 64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1), video: { width: 1080, height: 1920, frameRate: { num: fps, den: 1 }, codec: 'h264', rotation: 0, frameCount: seconds * fps }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov } } });

/** A project at 1080x1920 with six pictures and two videos, as the editor would hold after an import. */
function project(fps: number): { pid: string; media: string[] } {
  const pid = store.createProject({ name: `packs ${fps}`, width: 1080, height: 1920, frameRate: { num: fps, den: 1 } }).doc.id;
  const ops = [...['a', 'b', 'c', 'd', 'e', 'f'].map(picture), video('1', 20, fps), video('2', 12, fps)];
  const r = store.commit({ projectId: pid, actor: 'test', allowInternal: true, label: 'fixtures', ops });
  const ids = r.results.map((x) => (x.output as { assetId: string }).assetId);
  return { pid, media: [ids[6]!, ids[0]!, ids[1]!, ids[7]!, ids[2]!, ids[3]!, ids[4]!, ids[5]!] };
}
const mediaOf = (m: string[], n: number) => Array.from({ length: n }, (_, i) => m[i % m.length]!);
const hash = (doc: ProjectDocument) => createHash('sha256').update(JSON.stringify(doc)).digest('hex');
/** The document as the store holds it, without the revision counters that every transaction (an undo too) moves on. */
const whole = (pid: string) => { const d = JSON.parse(JSON.stringify(store.wholeProject(pid).doc)) as Record<string, unknown>; delete d.revision; return d as unknown as ProjectDocument; };
const FIELDS = { name: 'נועה', name2: 'דניאל', age: '7', night: '3', place: 'הגינה של סבא', when: 'שישי בארבע', date: '2026-12-06' };

const TEMPLATE_IDS = PACKS.flatMap((p) => [...p.templates.map((t) => t.id), ...p.templateIds]);
let fixtures: Record<number, { pid: string; media: string[] }> = {};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-packs-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 22, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, presence, governance, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, governance, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  fixtures = { 24: project(24), 25: project(25), 30: project(30) };
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('the eight pack templates', () => {
  it('are the seven new ones and tpl.birthday', () => {
    expect(TEMPLATE_IDS).toEqual(['tpl.hanukkah-candles', 'tpl.hanukkah-eight-nights', 'tpl.hanukkah-party', 'tpl.hanukkah-greeting', 'tpl.birthday-age', 'tpl.birthday-cake', 'tpl.birthday-invite', 'tpl.birthday']);
    for (const id of TEMPLATE_IDS) expect(findTemplate(id), id).toBeDefined();
  });
  it('are listed by the gallery with their pack, the fields their titles hold and their music suggestion', async () => {
    const r = await rest('GET', '/templates');
    expect(r.status).toBe(200);
    const by = new Map((r.body.templates as any[]).map((t) => [t.id, t]));
    expect(by.get('tpl.hanukkah-candles')).toMatchObject({ pack: 'pack.hanukkah', builtinMusic: 'music.calm', liveFields: true });
    expect(by.get('tpl.hanukkah-candles').fields).toContain('night');
    expect(by.get('tpl.birthday-invite').fields).toEqual(['name', 'place', 'when']);
    expect(by.get('tpl.birthday').pack).toBeNull();
  });

  for (const id of TEMPLATE_IDS) {
    it(`${id}: plan changes nothing; apply is ONE transaction; undo gives the exact previous document; redo the applied one`, async () => {
      const { pid, media } = project(30);
      const before = whole(pid), beforeHash = hash(before), revision = store.getProject(pid).revision;
      const params = { media: mediaOf(media, 6), lang: 'he', fields: FIELDS };
      const plan = await rest('POST', `/projects/${pid}/templates/${id}/plan`, { params });
      expect(plan.status).toBe(200);
      expect(plan.body.blocking).toEqual([]);
      expect(plan.body.operations).toBeGreaterThan(0);
      expect(store.getProject(pid).revision).toBe(revision);
      expect(hash(whole(pid))).toBe(beforeHash);

      const applied = await rest('POST', `/projects/${pid}/templates/${id}/apply`, { params });
      expect(applied.status, JSON.stringify(applied.body).slice(0, 300)).toBe(200);
      expect(applied.body.revision).toBe(revision + 1);
      expect(store.getProject(pid).revision).toBe(revision + 1);
      const afterDoc = whole(pid), afterHash = hash(afterDoc);
      expect(afterHash).not.toBe(beforeHash);
      const titles = Object.values(store.getProject(pid).doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).filter((c) => c.type === 'text');
      expect(titles.length).toBeGreaterThan(0);
      for (const t of titles) if (t.type === 'text') expect(t.text, id).not.toMatch(/\{(name|name2|age|night|place|when)\}/);

      const undo = await rest('POST', `/projects/${pid}/undo`, {});
      expect(undo.status).toBe(200);
      expect(creativeProjection(store.getProject(pid).doc)).toBe(creativeProjection(before));
      expect(hash(whole(pid)), 'document hash after undo equals the hash before apply').toBe(beforeHash);
      const redo = await rest('POST', `/projects/${pid}/redo`, {});
      expect(redo.status).toBe(200);
      expect(hash(whole(pid)), 'document hash after redo equals the applied one').toBe(afterHash);
    }, 60_000);
  }

  it('the pack fields write literal words: the candle of the night is the one asked for, and a field left out gives the fallback words', async () => {
    const { pid, media } = project(30);
    await rest('POST', `/projects/${pid}/templates/tpl.hanukkah-candles/apply`, { params: { media: mediaOf(media, 3), lang: 'he', fields: { night: '5' } } });
    const words = () => Object.values(store.getProject(pid).doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).flatMap((c) => (c.type === 'text' ? [c.text] : []));
    expect(words()).toContain('נר 5 של חנוכה');
    expect(words()).toContain('המשפחה שלנו');
    const plan = await rest('POST', `/projects/${pid}/templates/tpl.hanukkah-candles/plan`, { params: { media: mediaOf(media, 3), lang: 'en', fields: { date: '2026-12-06' } } });
    expect(plan.body.notices.map((n: any) => n.code)).toContain('field_missing');
  });
});

describe('plan and apply over media counts, tempos and frame rates', () => {
  for (const id of TEMPLATE_IDS) {
    it(`${id}: every plan is clean or lists its blocker, and an apply after a clean plan never fails (undone each time)`, async () => {
      let applied = 0, clean = 0, blocked = 0;
      for (const fps of [24, 25, 30]) {
        const { pid, media } = fixtures[fps]!;
        for (const count of [1, 3, 8, 12]) for (const tempo of ['normal', 'half', 'double'] as const) {
          const params = { media: mediaOf(media, count), lang: count % 2 ? 'he' : 'en', tempo, fields: FIELDS };
          const plan = await rest('POST', `/projects/${pid}/templates/${id}/plan`, { params });
          expect(plan.status, `${id} ${fps}fps ${count} ${tempo}`).toBe(200);
          if (plan.body.blocking.length) { blocked++; expect(plan.body.blocking[0].message, 'a blocker says what it is').toBeTruthy(); continue; }
          clean++;
          // one apply on each corner of the matrix, to keep the run short; the pure planner has been checked by the plan above
          if ((fps === 24 && count === 12 && tempo === 'double') || (fps === 25 && count === 3 && tempo === 'half') || (fps === 30 && count === 1 && tempo === 'normal') || (fps === 30 && count === 8 && tempo === 'normal')) {
            const before = hash(whole(pid));
            const r = await rest('POST', `/projects/${pid}/templates/${id}/apply`, { params });
            expect(r.status, `apply after a clean plan: ${id} ${fps}fps ${count} ${tempo}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
            applied++;
            expect((await rest('POST', `/projects/${pid}/undo`, {})).status).toBe(200);
            expect(hash(whole(pid))).toBe(before);
          }
        }
      }
      expect(clean + blocked).toBe(36);
      expect(applied).toBeGreaterThanOrEqual(1);
    }, 120_000);
  }
});

describe('built-in music (the synthesiser is another worker\'s: nothing here depends on it)', () => {
  for (const id of TEMPLATE_IDS) {
    it(`${id}: asking for its music style plans cleanly; the apply works with an exact undo, or says 501 music_not_built and commits nothing`, async () => {
      const { pid, media } = fixtures[30]!;
      const style = findTemplate(id)!.music.builtin ?? 'music.birthday';
      const params = { media: mediaOf(media, 6), musicAssetId: null, builtinMusic: { styleId: style, seed: 2 }, fields: FIELDS };
      const plan = await rest('POST', `/projects/${pid}/templates/${id}/plan`, { params });
      expect(plan.status).toBe(200);
      expect(plan.body.blocking).toEqual([]);
      const before = hash(whole(pid)), revision = store.getProject(pid).revision;
      const r = await rest('POST', `/projects/${pid}/templates/${id}/apply`, { params });
      if (r.status === 501) { expect(r.body.error.code).toBe('music_not_built'); expect(store.getProject(pid).revision).toBe(revision); expect(hash(whole(pid))).toBe(before); return; }
      expect(r.status).toBe(200);
      expect(store.getProject(pid).revision).toBe(revision + 1);
      expect((await rest('POST', `/projects/${pid}/undo`, {})).status).toBe(200);
      expect(hash(whole(pid))).toBe(before);
    }, 60_000);
  }
});

describe('sounds', () => {
  it('every built-in sound the packs and their templates name exists in the server\'s list', () => {
    const known = new Set(SFX.map((s) => s.id));
    const named = PACKS.flatMap((p) => [...p.sfxIds, ...p.templates.flatMap((t) => t.sfx.map((s) => s.sfxId))]);
    expect(named.length).toBeGreaterThan(8);
    expect(named.filter((id) => !known.has(id))).toEqual([]);
  });
});

describe('the 50 elements', () => {
  it('rasterise through the server\'s own path with alpha, each covering between 2 and 90 percent of its box, and no two alike', async () => {
    const ids = ELEMENTS.filter((e) => e.category === 'holiday' || e.category === 'party').map((e) => e.id);
    expect(ids).toHaveLength(50);
    const queue = [...ids], bad: string[] = [], seen = new Map<string, string>();
    const tmp = fs.mkdtempSync(path.join(dir, 'el-'));
    const worker = async (n: number) => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          const png = await elementPreview(store.tmpDir, id, { longSide: 256 });
          const f = path.join(tmp, `${n}.png`);
          fs.writeFileSync(f, png);
          const { stdout } = await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 });
          const raw = stdout as unknown as Buffer;
          let visible = 0, transparent = 0;
          for (let i = 3; i < raw.length; i += 4) { if (raw[i]! > 8) visible++; if (raw[i] === 0) transparent++; }
          const share = visible / (raw.length / 4);
          if (!(share >= 0.02 && share <= 0.9)) bad.push(`${id}: covers ${(share * 100).toFixed(1)} percent`);
          if (transparent === 0) bad.push(`${id}: no transparent pixel`);
          const key = createHash('sha256').update(png).digest('hex');
          if (seen.has(key)) bad.push(`${id} is the same picture as ${seen.get(key)}`);
          seen.set(key, id);
        } catch (e) { bad.push(`${id}: ${String((e as Error).message).slice(0, 120)}`); }
      }
    };
    await Promise.all([worker(0), worker(1), worker(2), worker(3)]);
    expect(bad).toEqual([]);
    expect(seen.size).toBe(50);
  }, 180_000);
});
