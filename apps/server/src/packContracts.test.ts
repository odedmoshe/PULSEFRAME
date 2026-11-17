/**
 * The server-side contracts of the content packs and built-in music that the lead pre-pass owns (ADR-0022):
 * - the beats of built-in music are known from its recipe, so measuring them is refused (409 known_by_construction) unless
 *   asked for with overwrite, and nothing changes;
 * - a template asked for built-in music while the synthesiser is not built answers 501 music_not_built honestly and commits
 *   nothing (W3's music.ts replaces that answer with the track; this test then becomes its "nothing committed on refusal"
 *   half, see the todo);
 * (Their Hebrew wording is held in packages/evals/src/packs-wording.test.ts.)
 * Nothing here pins the stub: the 501 case is the honest answer of a missing feature, and it is listed as todo for W3.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { knownGridOf, MUSIC_GENERATOR, MUSIC_METHOD, musicLayout, musicProvenanceParams } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>;
let pid = '', ownerCookie = '', musicId = '';
const R = { num: 30, den: 1 };
const base = () => `http://127.0.0.1:${cfg.port}`;
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers: ownerHeaders(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pack-contracts-'));
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
  pid = store.createProject({ name: 'packs', width: 1080, height: 1920, frameRate: R }).doc.id;
  // a built-in track as the server would add it (the record only: nothing reads its bytes before measuring)
  const layout = musicLayout('music.festive', 8);
  const asset = { kind: 'audio' as const, name: 'festive.wav', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 44 + 4 * layout.totalFrames, container: 'wav', mimeType: 'audio/wav', duration: layout.duration, audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { ...prov, origin: 'generated' as const, procedural: { id: 'music.festive', version: 1, generator: MUSIC_GENERATOR, params: musicProvenanceParams(layout, 1) } } };
  const r = store.commit({ projectId: pid, actor: 'test', allowInternal: true, label: 'music', ops: [{ op: 'add_builtin_music', args: { asset, grid: knownGridOf(layout, 1, '2026-11-17T00:00:00Z') } }] });
  musicId = (r.results[0]!.output as { assetId: string }).assetId;
  const pictures = ['a', 'b', 'c'].map((k) => ({ op: 'import_asset', args: { asset: { kind: 'image', name: `${k}.png`, contentHash: `sha256:${k.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 1080, height: 1920, codec: 'png', hasAlpha: false }, provenance: prov } } }));
  store.commit({ projectId: pid, actor: 'test', allowInternal: true, label: 'pictures', ops: pictures });
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('built-in music on the server (ADR-0022)', () => {
  it('measuring the beats of built-in music is refused with 409 known_by_construction, worded in Hebrew; beats and sections stay', async () => {
    const before = store.getProject(pid);
    const r = await rest('POST', `/projects/${pid}/assets/${musicId}/analyze`, { kind: 'beats' });
    expect([r.status, r.body.error.code]).toEqual([409, 'known_by_construction']);
    const after = store.getProject(pid);
    expect(after.revision).toBe(before.revision);
    expect(after.doc.analyses[musicId]!.beats!.origin.method).toBe(MUSIC_METHOD);
    expect(after.doc.analyses[musicId]).toEqual(before.doc.analyses[musicId]);
  });
  it('a template plan asks for the track by style, bars and seed; applying it while the synthesiser is not built answers 501 and commits nothing', async () => {
    const media = Object.values(store.getProject(pid).doc.assets).filter((a) => a.kind === 'image').map((a) => a.id);
    const plan = await rest('POST', `/projects/${pid}/templates/tpl.photo-dump/plan`, { params: { media, builtinMusic: { styleId: 'music.festive', seed: 3 } } });
    expect(plan.status).toBe(200);
    expect(plan.body.notices).toBeInstanceOf(Array);
    expect(plan.body.basis[0]).toContain('known from its recipe');
    const before = store.getProject(pid).revision;
    const applied = await rest('POST', `/projects/${pid}/templates/tpl.photo-dump/apply`, { params: { media, builtinMusic: { styleId: 'music.festive', seed: 3 } } });
    if (applied.status === 501) {
      expect(applied.body.error.code).toBe('music_not_built');
    } else expect(applied.status).toBe(200); // once W3's synthesiser is in
    if (applied.status !== 200) expect(store.getProject(pid).revision).toBe(before);
  });
  it('both music sources at once are refused before anything is made', async () => {
    const media = Object.values(store.getProject(pid).doc.assets).filter((a) => a.kind === 'image').map((a) => a.id);
    const r = await rest('POST', `/projects/${pid}/templates/tpl.photo-dump/plan`, { params: { media, musicAssetId: musicId, builtinMusic: { styleId: 'music.festive' } } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('choose a music file or built-in music, not both');
  });
  it.todo('W3: applying a template with built-in music adds the track with its known grid in the same transaction; one undo removes asset, analysis and clips');
  it.todo('W3: overwrite=true measures the built-in track anyway (P9 calls the detector on the blob directly and commits nothing)');
});
