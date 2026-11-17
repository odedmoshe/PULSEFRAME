/**
 * The server-side contracts of the life line (ADR-0021) that the lead pre-pass owns: the home time zone setting, the two
 * routes with their guards, and the wiring of the field issues into the export plan and the preflight report.
 * Every fixture here is one where the finished feature must answer the same as today (a field with nothing to take a date
 * from; a stamp over an undated file), so nothing pins a placeholder. What W2 builds is listed as todo.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { LIFE_OPS_BUILT, creativeProjection, type Asset, type Capture, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { PLACE_PHOTO, PLACE_VIDEO, placeLeak, withExif } from './captureMeta.fixtures.ts';
import { DEFAULT_HOME_ZONE, loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { ingestUpload } from './ingest.ts';
import { createMcp } from './mcp.ts';
import { preflight } from './preflight.ts';
import { FIELD_ISSUE_CODES, fieldIssues, isFieldIssueCode } from './preflight.fields.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, exporter: Exporter, derivatives: Derivatives;
let pid = '', ownerCookie = '';
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const base = () => `http://127.0.0.1:${cfg.port}`;
const bearer = (token: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, headers: Record<string, string>, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-life-contracts-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, presence, governance, speech);
  derivatives = new Derivatives(store);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, governance, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = store.createProject({ name: 'life', width: 640, height: 360, frameRate: R }).doc.id;
});
afterAll(async () => { await derivatives.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('life line: the home time zone (PF_HOME_TZ)', () => {
  it('defaults to Asia/Jerusalem, takes an IANA name, and refuses to start with a name this machine does not know', () => {
    expect(DEFAULT_HOME_ZONE).toBe('Asia/Jerusalem');
    expect(loadConfig({}).homeZone).toBe('Asia/Jerusalem');
    expect(loadConfig({ PF_HOME_TZ: '' }).homeZone).toBe('Asia/Jerusalem');
    expect(loadConfig({ PF_HOME_TZ: 'Europe/London' }).homeZone).toBe('Europe/London');
    expect(() => loadConfig({ PF_HOME_TZ: 'Mars/Olympus' })).toThrow(/PF_HOME_TZ=Mars\/Olympus refused/);
  });
});

describe('life line: route guards', () => {
  it('"on this day" reads across every project, so it answers the owner\'s own session only', async () => {
    for (const token of [auth.tokens.agent, auth.tokens.observer]) {
      const r = await rest('GET', '/on-this-day?date=2024-12-25', bearer(token));
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('owner_required');
    }
    const none = await app.fetch(new Request(`${base()}/api/v1/on-this-day?date=2024-12-25`, { headers: { host: `127.0.0.1:${cfg.port}` } }));
    expect(none.status).toBe(401);
  });
  it('"on this day" wants a real day written YYYY-MM-DD and refuses anything else before reading a project', async () => {
    for (const q of ['', '?date=', '?date=2024-02-30', '?date=2024-12-25T10:00:00', '?date=25.12.2024', '?date=1850-01-01', '?date=today']) {
      const r = await rest('GET', `/on-this-day${q}`, ownerHeaders());
      expect(r.status, q).toBe(400);
      expect(r.body.error.code, q).toBe('invalid_request');
    }
  });
  it('re-reading capture dates is an edit of the project: an observer is refused, and an unknown project is not found', async () => {
    const observer = await rest('POST', `/projects/${pid}/captures/read`, bearer(auth.tokens.observer));
    expect(observer.status).toBe(403);
    expect(observer.body.error.code).toBe('insufficient_scope');
    const unknown = await rest('POST', '/projects/prj_none/captures/read', bearer(auth.tokens.agent));
    expect(unknown.status).toBe(404);
    expect(store.getProject(pid).revision).toBe(0);
  });
  // W2's part, through the routes (the bodies themselves are tested in lifeline.test.ts and captureMeta.test.ts). The two that
  // need the core bodies of the life line (onThisDay, attach_asset_capture) run once those are built (LIFE_OPS_BUILT).
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
  const captureCx = { homeZone: 'Asia/Jerusalem', now: new Date('2026-11-17T10:00:00Z') };
  const record = (n: number, capture?: Capture): Omit<Asset, 'id'> => ({ kind: 'video', name: `clip-${n}.mp4`, contentHash: `sha256:${n.toString(16).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(2, 1), video: { width: 64, height: 64, frameRate: R, codec: 'h264', rotation: 0, frameCount: 60 }, provenance: { origin: 'fixture', importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' }, ...(capture ? { capture } : {}) });
  it.runIf(LIFE_OPS_BUILT)('"on this day" lists the owner\'s files taken on this date in earlier years, by the Gregorian and the Hebrew date, at most 12', async () => {
    const at = (wall: string): Capture => ({ at: wall, utcOffsetMinutes: null, source: 'manual' });
    const id = store.createProject({ name: 'זיכרונות', width: 640, height: 360, frameRate: R }).doc.id;
    // 5 December 2026 is 25 Kislev 5787; 26 December 2024 was 25 Kislev 5785 (the Hebrew match); 5 December 2023 is the Gregorian match
    const added = store.commit({ projectId: id, actor: 'user:local', allowInternal: true, ops: [record(701, at('2023-12-05T10:00:00')), record(702, at('2024-12-26T10:00:00')), record(703, at('2024-08-08T10:00:00')), ...Array.from({ length: 14 }, (_, i) => record(710 + i, at(`${2000 + i}-12-05T09:00:00`)))].map((asset) => ({ op: 'import_asset', args: { asset } })) });
    const [gregorian, hebrew, neither] = added.results.map((x) => x.output!.assetId as string);
    const r = await rest('GET', '/on-this-day?date=2026-12-05', ownerHeaders());
    expect(r.status).toBe(200);
    const items = r.body.items as { assetId: string; projectId: string; projectName: string; wall: string; yearsAgo: number; match: string; hebrewDate: string | null; circa: boolean }[];
    expect(items).toHaveLength(12); // 16 files match; the newest 12 are answered
    expect(items.find((i) => i.assetId === gregorian)).toMatchObject({ projectId: id, projectName: 'זיכרונות', wall: '2023-12-05T10:00:00', yearsAgo: 3, match: 'gregorian', circa: false });
    expect(items.find((i) => i.assetId === hebrew)).toMatchObject({ wall: '2024-12-26T10:00:00', yearsAgo: 2, match: 'hebrew', hebrewDate: 'כ״ה בכסלו תשפ״ה' });
    expect(items.some((i) => i.assetId === neither)).toBe(false);
    expect(items.map((i) => i.wall)).toEqual([...items.map((i) => i.wall)].sort().reverse()); // newest first
    expect((await rest('GET', '/on-this-day?date=2026-08-19', ownerHeaders())).body.items.filter((i: { projectId: string }) => i.projectId === id)).toEqual([]);
  });
  it.runIf(LIFE_OPS_BUILT)('re-reading attaches dates read from the stored originals in one transaction, never over a date set by hand, and can be undone', async () => {
    const id = store.createProject({ name: 'old library', width: 640, height: 360, frameRate: R }).doc.id;
    const plain = path.join(dir, 'reread-plain.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30', '-t', '0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bitexact', '-map_metadata', '-1', plain]);
    /** A file as a library from before the life line holds it: its bytes stored, no date on it. */
    const addUndated = async (name: string, creationTime: string) => {
      const file = path.join(dir, name);
      ff(['-i', plain, '-c', 'copy', '-metadata', `creation_time=${creationTime}`, file]);
      const { capture: _read, ...asset } = await ingestUpload(store, Readable.toWeb(fs.createReadStream(file)) as any, name, 'test', 1 << 30, captureCx);
      return store.commit({ projectId: id, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
    };
    const winter = await addUndated('reread-winter.mp4', '2024-12-25T15:30:00Z'), summer = await addUndated('reread-summer.mp4', '2024-07-01T15:30:00Z'), byHand = await addUndated('reread-hand.mp4', '2023-03-03T09:00:00Z');
    store.commit({ projectId: id, actor: 'user:local', ops: [{ op: 'set_asset_capture', args: { assetId: byHand, capture: { at: '2019-05-05T12:00:00' } } }] });
    const before = store.getProject(id);
    const r = await rest('POST', `/projects/${id}/captures/read`, bearer(auth.tokens.agent));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ read: 2, dated: 2, revision: before.revision + 1 }); // the file dated by hand is not even looked at
    const after = store.getProject(id);
    expect(after.doc.assets[winter]!.capture).toEqual({ at: '2024-12-25T17:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: cfg.homeZone });
    expect(after.doc.assets[summer]!.capture).toMatchObject({ at: '2024-07-01T18:30:00', source: 'container' });
    expect(after.doc.assets[byHand]!.capture).toEqual(before.doc.assets[byHand]!.capture);
    expect(after.doc.assets[byHand]!.capture).toMatchObject({ at: '2019-05-05T12:00:00', source: 'manual' });
    const events = store.eventsSince(id, before.revision);
    expect(events.map((e) => e.ops)).toEqual([['attach_asset_capture']]); // one transaction
    expect(store.replay(id).doc).toEqual(after.doc);
    // the caller's own undo takes exactly those dates off again
    const undo = await rest('POST', `/projects/${id}/undo`, bearer(auth.tokens.agent), {});
    expect(undo.status).toBe(200);
    expect(creativeProjection(store.getProject(id).doc)).toEqual(creativeProjection(before.doc));
    const redo = await rest('POST', `/projects/${id}/redo`, bearer(auth.tokens.agent), {});
    expect(redo.status).toBe(200);
    expect(creativeProjection(store.getProject(id).doc)).toEqual(creativeProjection(after.doc));
    // nothing left to read: no empty transaction
    const again = await rest('POST', `/projects/${id}/captures/read`, bearer(auth.tokens.agent));
    expect(again.body).toEqual({ read: 0, dated: 0, revision: store.getProject(id).revision });
  }, 60_000);
  it('an upload gets the capture date read from its original bytes before any conform, and no location is read or stored', async () => {
    const id = store.createProject({ name: 'uploads', width: 640, height: 360, frameRate: R }).doc.id;
    // (1) through the route: a photo whose EXIF holds the date, its offset and a GPS block
    const jpg = path.join(dir, 'upload-plain.jpg');
    ff(['-f', 'lavfi', '-i', 'color=c=0x336699:size=64x48', '-frames:v', '1', jpg]);
    const photo = withExif(fs.readFileSync(jpg), { date: '2024:07:01 18:30:00', offset: '+03:00', gps: true });
    expect(photo.includes(Buffer.from([0x25, 0x88]))).toBe(true); // the GPS pointer is really in the file
    const up = await app.fetch(new Request(`${base()}/api/v1/projects/${id}/assets`, { method: 'POST', headers: { host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'x-filename': encodeURIComponent('תמונה.jpg') }, body: new Uint8Array(photo) }));
    expect(up.status).toBe(201);
    const body = (await up.json()) as { assetId: string; asset: Asset };
    expect(body.asset.capture).toEqual({ at: '2024-07-01T18:30:00', utcOffsetMinutes: 180, source: 'exif' });
    // (2) the import itself, on a file that must be conformed: the date comes from the original, which the copy does not carry
    const plain = path.join(dir, 'upload-plain.mp4'), rotated = path.join(dir, 'upload-rotated.mov');
    ff(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30', '-t', '0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bitexact', '-map_metadata', '-1', plain]);
    ff(['-display_rotation', '90', '-i', plain, '-c', 'copy', '-movflags', 'use_metadata_tags', '-metadata', 'com.apple.quicktime.creationdate=2024-12-25T17:30:00+0200', '-metadata', 'com.apple.quicktime.location.ISO6709=+32.0853+034.7818+040.000/', '-metadata', 'location=+32.0853+034.7818/', rotated]);
    const asset = await ingestUpload(store, Readable.toWeb(fs.createReadStream(rotated)) as any, 'upload-rotated.mov', 'agent:test', 1 << 30, captureCx);
    expect(asset.conform?.reasons).toEqual(['rotation']);
    expect(asset.capture).toEqual({ at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' });
    store.commit({ projectId: id, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    // nothing about the place anywhere in the project, its summary or its history
    const project = await rest('GET', `/projects/${id}`, bearer(auth.tokens.observer));
    const history = await rest('GET', `/projects/${id}/history?since=0`, bearer(auth.tokens.observer));
    expect(placeLeak(project.body, history.body, store.replay(id).doc)).toBeNull();
    expect(Object.values(project.body.project.assets as Record<string, Asset>).map((a) => Object.keys(a.capture ?? {}).sort())).toEqual([['at', 'source', 'utcOffsetMinutes'], ['at', 'source', 'utcOffsetMinutes']]);
  }, 60_000);
  it('the two files of proof:lifeline that say where they were taken, uploaded under the proof\'s own names: dated, and no place in the project, its history or its summary', async () => {
    // what check 1b of the proof does, with the same fixtures, names and search (captureMeta.fixtures.ts), through the same three routes
    const id = store.createProject({ name: '1 capture dates', width: 640, height: 360, frameRate: R }).doc.id;
    const plain = path.join(dir, 'place-plain.mp4'), video = path.join(dir, PLACE_VIDEO.name), jpg = path.join(dir, 'place-plain.jpg');
    ff(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30', '-t', '0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bitexact', '-map_metadata', '-1', plain]);
    ff(['-i', plain, '-c', 'copy', '-movflags', 'use_metadata_tags', ...PLACE_VIDEO.tags.flatMap((m) => ['-metadata', m]), video]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x336699:size=64x48', '-frames:v', '1', jpg]);
    const photo = withExif(fs.readFileSync(jpg), PLACE_PHOTO.exif);
    // the files really say where: the search finds the place in what ffprobe reads, and the GPS pointer is in the picture
    expect(placeLeak(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', video]).toString()))).not.toBeNull();
    expect(photo.includes(Buffer.from([0x25, 0x88]))).toBe(true);
    const upload = async (name: string, bytes: Buffer) => {
      const r = await app.fetch(new Request(`${base()}/api/v1/projects/${id}/assets`, { method: 'POST', headers: { host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'x-filename': encodeURIComponent(name) }, body: new Uint8Array(bytes) }));
      expect(r.status, name).toBe(201);
      return ((await r.json()) as { asset: Asset }).asset;
    };
    const place = await upload(PLACE_VIDEO.name, fs.readFileSync(video));
    const gps = await upload(PLACE_PHOTO.name, photo);
    expect(place.capture).toEqual({ at: PLACE_VIDEO.at, utcOffsetMinutes: 180, source: 'container' });
    expect(gps.capture).toEqual({ at: PLACE_PHOTO.at, utcOffsetMinutes: 180, source: 'exif' });
    const agent = bearer(auth.tokens.agent);
    const project = await rest('GET', `/projects/${id}`, agent), history = await rest('GET', `/projects/${id}/history?since=0`, agent), summary = await rest('GET', `/projects/${id}/summary`, agent);
    expect([project.status, history.status, summary.status]).toEqual([200, 200, 200]);
    // the names are in all three answers (so the search looked at the place a name would have tripped it) and nothing else is found
    for (const body of [project.body, history.body, summary.body]) expect(JSON.stringify(body)).toContain(PLACE_PHOTO.name);
    expect(placeLeak(project.body.project, history.body, summary.body)).toBeNull();
  }, 60_000);
});

describe('life line: field issues in the export plan and the preflight', () => {
  /** A title with a field and nothing under it to take a date from (no picture clip, no dated file anywhere), and a clip of an undated file with a capture-sourced stamp. */
  function fixture(): { doc: ProjectDocument; revision: number; titleId: string; clipId: string } {
    const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
    const video = { kind: 'video' as const, name: 'undated.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };
    const id = store.createProject({ name: 'fields', width: 640, height: 360, frameRate: R }).doc.id;
    const imp = store.commit({ projectId: id, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: video } }] });
    const r = store.commit({ projectId: id, actor: 'user:local', ops: [
      { op: 'add_text', args: { text: 'צולם ב־{date}', start: f(120), duration: f(30) } },
      { op: 'add_clip', args: { assetId: imp.results[0]!.output!.assetId as string, start: f(0), duration: f(60) } },
    ] });
    const titleId = r.results[0]!.output!.clipId as string, clipId = r.results[1]!.output!.clipId as string;
    store.commit({ projectId: id, actor: 'user:local', ops: [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture' } } }] });
    const p = store.getProject(id);
    // the title is given its `fields` mark directly: the operation that sets it (set_text_fields) is W1's
    const doc = structuredClone(p.doc);
    for (const t of doc.sequences[doc.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === titleId && c.type === 'text') c.fields = true;
    return { doc, revision: p.revision, titleId, clipId };
  }
  it('a field without data stops an export of moving picture, and never a still or sound alone', () => {
    const { doc, revision, titleId, clipId } = fixture();
    for (const format of ['mp4-h264-aac', 'webm-vp9-opus', 'gif'] as const) {
      const plan = exporter.plan(doc, revision, { format });
      expect(plan.blockers.filter((b) => isFieldIssueCode(b.code)), format).toEqual([expect.objectContaining({ code: 'field_no_data', ids: expect.arrayContaining([titleId]) })]);
      expect(plan.warnings.filter((b) => isFieldIssueCode(b.code)), format).toEqual([expect.objectContaining({ code: 'stamp_no_date', ids: [clipId] })]);
    }
    for (const options of [{ format: 'png', frame: 125 }, { format: 'wav' }] as const) {
      const plan = exporter.plan(doc, revision, options);
      expect([...plan.blockers, ...plan.warnings].filter((b) => isFieldIssueCode(b.code)), options.format).toEqual([]);
    }
    // a range that does not reach the title is not stopped by it
    const early = exporter.plan(doc, revision, { range: { startFrame: 0, endFrame: 60 } });
    expect(early.blockers.filter((b) => isFieldIssueCode(b.code))).toEqual([]);
    expect(early.warnings.filter((b) => isFieldIssueCode(b.code)).map((b) => b.code)).toEqual(['stamp_no_date']);
    const late = exporter.plan(doc, revision, { range: { startFrame: 100, endFrame: 150 } });
    expect(late.blockers.filter((b) => isFieldIssueCode(b.code)).map((b) => b.code)).toEqual(['field_no_data']);
    expect(late.warnings.filter((b) => isFieldIssueCode(b.code))).toEqual([]);
  });
  it('the preflight lists each of those issues once, with the frames where it holds', () => {
    const { doc, revision, titleId, clipId } = fixture();
    const report = preflight(exporter, doc, revision);
    const life = report.issues.filter((i) => isFieldIssueCode(i.code)).sort((x, y) => (x.code < y.code ? -1 : 1)); // their order is not part of the contract
    expect(life.map((i) => [i.code, i.severity])).toEqual([['field_no_data', 'blocker'], ['stamp_no_date', 'warning']]);
    expect(life[0]).toMatchObject({ ids: expect.arrayContaining([titleId]), range: { startFrame: 120, endFrame: 150 } });
    expect(life[1]).toMatchObject({ ids: [clipId], range: { startFrame: 0, endFrame: 60 } });
    expect(report.ok).toBe(false);
    expect(report.scope).toMatch(/title fields without data/);
    expect(fieldIssues(doc).map((i) => i.code).sort()).toEqual(['field_no_data', 'stamp_no_date']);
  });
  it('a project without fields or capture-sourced stamps has no such issue, and its plan is what it was', () => {
    const p = store.getProject(pid);
    expect(fieldIssues(p.doc)).toEqual([]);
    const { doc, revision } = fixture();
    const plain = structuredClone(doc);
    for (const t of plain.sequences[plain.mainSequenceId]!.tracks) for (const c of t.clips) { if (c.type === 'text') delete c.fields; if (c.type !== 'caption') delete c.effects; }
    expect([...exporter.plan(plain, revision, {}).blockers, ...exporter.plan(plain, revision, {}).warnings].filter((b) => isFieldIssueCode(b.code))).toEqual([]);
    expect(FIELD_ISSUE_CODES).toEqual(['field_no_data', 'field_sunset_undecided', 'capture_estimated', 'stamp_no_date']);
  });
  // W2's part, through the routes (preflight.fields.test.ts tests the issues themselves). These need real dates resolved by the
  // core bodies of the life line, so they run once those are built (LIFE_OPS_BUILT).
  describe.runIf(LIFE_OPS_BUILT)('with dated files, through REST', () => {
    const agent = () => bearer(auth.tokens.agent);
    const lifeIssuesOf = async (id: string) => ((await rest('GET', `/projects/${id}/preflight`, agent())).body.issues as { code: string; severity: string; ids: string[]; range?: { startFrame: number; endFrame: number } }[]).filter((i) => isFieldIssueCode(i.code)).map(({ code, severity, ids, range }) => ({ code, severity, ids, range }));
    const lifeBlockers = async (id: string) => ((await rest('POST', `/projects/${id}/exports/plan`, agent(), { format: 'mp4-h264-aac' })).body.blockers as { code: string }[]).filter((b) => isFieldIssueCode(b.code)).map((b) => b.code);
    const ops = async (id: string, list: unknown[]) => { const r = await rest('POST', `/projects/${id}/operations`, agent(), { ops: list }); expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200); return r.body.results as { output?: Record<string, unknown> }[]; };
    const textAt = (id: string, titleId: string, frame: number) => { const l = evaluate(store.getProject(id).doc, f(frame)).layers.find((x) => x.kind === 'text' && x.clipId === titleId); return l && l.kind === 'text' ? l.text : undefined; };
    const file = (n: number, capture?: Capture): Omit<Asset, 'id'> => ({ kind: 'video', name: `f${n}.mp4`, contentHash: `sha256:${n.toString(16).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: { origin: 'fixture', importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' }, ...(capture ? { capture } : {}) });
    /** A project whose library holds these files, each on the video track for 60 frames, one after the other. */
    async function timeline(...assets: Omit<Asset, 'id'>[]) {
      const id = store.createProject({ name: 'fields via REST', width: 640, height: 360, frameRate: R }).doc.id;
      const assetIds = store.commit({ projectId: id, actor: 'user:local', allowInternal: true, ops: assets.map((asset) => ({ op: 'import_asset', args: { asset } })) }).results.map((x) => x.output!.assetId as string);
      const clips = await ops(id, assetIds.map((assetId, i) => ({ op: 'add_clip', args: { assetId, start: f(i * 60), duration: f(60), withLinkedAudio: false } })));
      return { id, assetIds, clipIds: clips.map((c) => c.output!.clipId as string) };
    }
    /** A title with fields, as the editor commits it: the text and the switch in one transaction. */
    const fieldTitle = async (id: string, text: string, start: number, frames: number) => {
      const titleId = (await ops(id, [{ op: 'add_text', args: { text, start: f(start), duration: f(frames) } }]))[0]!.output!.clipId as string;
      await ops(id, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]);
      return titleId;
    };

    it('an undated clip under a title with a field, with a dated clip later on the same track: empty text and field_no_data with the frame range', async () => {
      const t = await timeline(file(801), file(802, { at: '2024-05-05T10:00:00', utcOffsetMinutes: 180, source: 'container' }));
      const titleId = await fieldTitle(t.id, 'צולם ב־{date}', 0, 60);
      expect(textAt(t.id, titleId, 30)).toBe('צולם ב־'); // not the date of the clip that follows
      expect(await lifeIssuesOf(t.id)).toEqual([{ code: 'field_no_data', severity: 'blocker', ids: [titleId, t.clipIds[0]], range: { startFrame: 0, endFrame: 60 } }]);
      expect(await lifeBlockers(t.id)).toEqual(['field_no_data']);
      // moved over the dated clip, the same title has its words and the export is not stopped
      await ops(t.id, [{ op: 'move_clip', args: { clipId: titleId, start: f(60) } }]);
      expect(textAt(t.id, titleId, 90)).toBe('צולם ב־5 במאי 2024');
      expect(await lifeIssuesOf(t.id)).toEqual([]);
      expect(await lifeBlockers(t.id)).toEqual([]);
    });
    it('an evening clip with {hebrewDate}: field_sunset_undecided, cleared by update_event afterSunset', async () => {
      const t = await timeline(file(811, { at: '2024-12-25T18:00:00', utcOffsetMinutes: 120, source: 'container' }));
      const titleId = await fieldTitle(t.id, '{hebrewDate}', 0, 60);
      const eventId = (await ops(t.id, [{ op: 'add_event', args: { assetIds: t.assetIds } }]))[0]!.output!.eventId as string;
      expect(textAt(t.id, titleId, 30)).toBe('');
      expect(await lifeIssuesOf(t.id)).toEqual([{ code: 'field_sunset_undecided', severity: 'blocker', ids: [titleId, eventId], range: { startFrame: 0, endFrame: 60 } }]);
      expect(await lifeBlockers(t.id)).toEqual(['field_sunset_undecided']);
      await ops(t.id, [{ op: 'update_event', args: { eventId, afterSunset: true } }]);
      expect(textAt(t.id, titleId, 30)).toBe('כ״ה בכסלו תשפ״ה');
      expect(await lifeIssuesOf(t.id)).toEqual([]);
      expect(await lifeBlockers(t.id)).toEqual([]);
      // undo of the answer brings the question back
      expect((await rest('POST', `/projects/${t.id}/undo`, agent(), {})).status).toBe(200);
      expect(await lifeBlockers(t.id)).toEqual(['field_sunset_undecided']);
    });
    it('a field that takes its date from a file-name estimate: note capture_estimated', async () => {
      const t = await timeline(file(821, { at: '2024-03-15', utcOffsetMinutes: null, source: 'filename', circa: true }));
      const titleId = await fieldTitle(t.id, '{date}', 0, 60);
      expect(textAt(t.id, titleId, 30)).toBe('15 במרץ 2024');
      expect(await lifeIssuesOf(t.id)).toEqual([{ code: 'capture_estimated', severity: 'note', ids: [titleId, t.assetIds[0]], range: { startFrame: 0, endFrame: 60 } }]);
      expect(await lifeBlockers(t.id)).toEqual([]);
      const report = (await rest('GET', `/projects/${t.id}/preflight`, agent())).body;
      expect(report.issues.filter((i: { severity: string }) => i.severity === 'blocker').map((i: { code: string }) => i.code).filter(isFieldIssueCode)).toEqual([]);
    });
  });
});
