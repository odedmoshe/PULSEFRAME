/**
 * Server side of the life line (ADR-0021): reading capture dates again from the stored originals, and "on this day".
 * Files are made here with ffmpeg and a hand-built EXIF segment. The first group needs nothing but this server's own code;
 * the groups marked "core" run once the core bodies of the life line are built (LIFE_OPS_BUILT, set by the core worker):
 * they commit attach_asset_capture and call onThisDay, which until then refuse or throw "not built".
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { LIFE_OPS_BUILT, creativeProjection, type Asset, type Capture } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { withExif } from './captureMeta.fixtures.ts';
import type { CaptureContext } from './captureMeta.ts';
import { ingestUpload } from './ingest.ts';
import { MAX_CAPTURE_READS, MAX_ON_THIS_DAY, onThisDayFor, planCaptureReads, readMissingCaptures } from './lifeline.ts';
import { ApiError, Store } from './store.ts';

const cx: CaptureContext = { homeZone: 'Asia/Jerusalem', now: new Date('2026-11-17T10:00:00Z') };
const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const agent: Principal = { actor: 'agent:test', kind: 'agent', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
/** A library file that exists only as a record (no stored bytes): enough where nothing is read from it. */
const record = (n: number, capture?: Capture): Omit<Asset, 'id'> => ({ kind: 'video', name: `clip-${n}.mp4`, contentHash: `sha256:${n.toString(16).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(2, 1), video: { width: 64, height: 64, frameRate: R, codec: 'h264', rotation: 0, frameCount: 60 }, provenance: prov, ...(capture ? { capture } : {}) });

let dir: string, store: Store, plain: string, picture: Buffer;
const fileOf = (name: string, meta: string[] = [], extra: string[] = []) => { const out = path.join(dir, name); ff(['-i', plain, '-c', 'copy', ...extra, ...meta.flatMap((m) => ['-metadata', m]), out]); return out; };
/** Stores a file's bytes as an upload would, and adds it to the library WITHOUT the date the import read: a library from before the life line. */
async function addUndated(pid: string, file: string, name = path.basename(file)): Promise<{ assetId: string; read: Capture | undefined }> {
  const { capture, ...asset } = await ingestUpload(store, Readable.toWeb(fs.createReadStream(file)) as any, name, 'test', 1 << 30, cx);
  const r = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
  return { assetId: r.results[0]!.output!.assetId as string, read: capture };
}
const addRecords = (pid: string, assets: Omit<Asset, 'id'>[]) => store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: assets.map((asset) => ({ op: 'import_asset', args: { asset } })) }).results.map((r) => r.output!.assetId as string);
const project = (name = 'life') => store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lifeline-'));
  store = new Store(path.join(dir, 'data'));
  plain = path.join(dir, 'plain.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30', '-t', '0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bitexact', '-map_metadata', '-1', plain]);
  ff(['-f', 'lavfi', '-i', 'color=c=0x336699:size=64x48', '-frames:v', '1', path.join(dir, 'picture.jpg')]);
  picture = fs.readFileSync(path.join(dir, 'picture.jpg'));
}, 60_000);
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('re-reading capture dates: what is looked at and what is found (nothing is committed here)', () => {
  it('reads the stored original of each undated picture, video and sound a person brought in, in library order', async () => {
    const pid = project();
    const winter = await addUndated(pid, fileOf('winter.mp4', ['creation_time=2024-12-25T15:30:00Z']));
    const none = await addUndated(pid, fileOf('holiday.mp4', ['title=a day out']));
    const photo = path.join(dir, 'photo.jpg');
    fs.writeFileSync(photo, withExif(picture, { date: '2019:07:04 08:00:00', offset: '+03:00' }));
    const jpeg = await addUndated(pid, photo);
    const sound = path.join(dir, 'PTT-20230101-WA0002.wav');
    ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-c:a', 'pcm_s16le', sound]);
    const voice = await addUndated(pid, sound);
    const before = store.getProject(pid);
    const plan = await planCaptureReads(store, pid, cx);
    expect(plan.read).toBe(4);
    expect(plan.found).toEqual([
      { assetId: winter.assetId, capture: { at: '2024-12-25T17:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' } },
      { assetId: jpeg.assetId, capture: { at: '2019-07-04T08:00:00', utcOffsetMinutes: 180, source: 'exif' } },
      { assetId: voice.assetId, capture: { at: '2023-01-01', utcOffsetMinutes: null, source: 'filename', circa: true } },
    ]);
    // exactly what the import itself reads from the same bytes
    expect(plan.found.map((f) => f.capture)).toEqual([winter.read, jpeg.read, voice.read]);
    expect(none.read).toBeUndefined();
    // planning commits nothing
    expect(store.getProject(pid)).toEqual(before);
  }, 60_000);
  it('a conformed file is read from its kept original (the copy that is edited carries no date)', async () => {
    const pid = project();
    const rotated = path.join(dir, 'rotated.mp4');
    ff(['-display_rotation', '90', '-i', plain, '-c', 'copy', '-metadata', 'creation_time=2024-07-01T15:30:00Z', rotated]);
    const a = await addUndated(pid, rotated);
    const asset = store.getProject(pid).doc.assets[a.assetId]!;
    expect(asset.conform?.reasons).toEqual(['rotation']);
    expect(asset.capture).toBeUndefined();
    expect((await planCaptureReads(store, pid, cx)).found).toEqual([{ assetId: a.assetId, capture: { at: '2024-07-01T18:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' } }]);
  }, 60_000);
  it('leaves out files that have a date, colour tables, and files the project made itself (they show the date of their source)', async () => {
    const pid = project();
    const dated = fileOf('dated.mp4', ['creation_time=2024-12-25T15:30:00Z']);
    const stored = await ingestUpload(store, Readable.toWeb(fs.createReadStream(dated)) as any, 'dated.mp4', 'test', 1 << 30, cx);
    const { capture: _c, ...bare } = stored;
    const cube = path.join(dir, 'look.cube');
    fs.writeFileSync(cube, `LUT_3D_SIZE 2\n${Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n')}\n`);
    const lut = await ingestUpload(store, Readable.toWeb(fs.createReadStream(cube)) as any, 'IMG_20240315_181500.cube', 'test', 1 << 30, cx);
    expect(lut.capture).toBeUndefined(); // a colour table has no capture date, whatever its name
    const ids = addRecords(pid, [
      stored,                                                                                                            // has the date its import read
      lut,
      { ...bare, name: 'made.mp4', contentHash: `sha256:${'a'.repeat(64)}`, provenance: { ...prov, origin: 'generated' } }, // same bytes would give a date, but it is not a file a person brought
      { ...bare, name: 'copy.mp4', contentHash: `sha256:${'b'.repeat(64)}`, provenance: { ...prov, origin: 'derived' } },
    ]);
    expect(ids).toHaveLength(4);
    expect(await planCaptureReads(store, pid, cx)).toEqual({ read: 0, found: [] });
  }, 60_000);
  it('a file whose stored bytes are missing is a file without a date, whatever its name says; nothing throws', async () => {
    const pid = project();
    addRecords(pid, [record(1), { ...record(2), name: 'VID_20240315_181500.mp4' }]);
    expect(await planCaptureReads(store, pid, cx)).toEqual({ read: 2, found: [] });
    await expect(planCaptureReads(store, 'prj_none', cx)).rejects.toMatchObject({ status: 404, code: 'project_not_found' });
  });
  it(`at most ${MAX_CAPTURE_READS} files a call; files that gave no date are not read again, so a larger library is worked through call by call`, async () => {
    const pid = project();
    const n = MAX_CAPTURE_READS + 120;
    addRecords(pid, Array.from({ length: n }, (_, i) => record(1000 + i)));
    expect((await planCaptureReads(store, pid, cx)).read).toBe(MAX_CAPTURE_READS);
    expect((await planCaptureReads(store, pid, cx)).read).toBe(120);
    expect((await planCaptureReads(store, pid, cx)).read).toBe(0);
    // what was learnt belongs to this store's files: another store looks for itself
    const other = new Store(path.join(dir, 'other'));
    try {
      const p2 = other.createProject({ name: 'other' }).doc.id;
      other.commit({ projectId: p2, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: record(1000) } }] });
      expect((await planCaptureReads(other, p2, cx)).read).toBe(1);
    } finally { other.close(); }
  }, 60_000);
  it('with nothing to attach, re-reading commits nothing: the revision stays and no transaction is written', async () => {
    const pid = project();
    addRecords(pid, [record(5000), record(5001)]);
    const before = store.getProject(pid).revision;
    expect(await readMissingCaptures(store, agent, pid, cx)).toEqual({ read: 2, dated: 0, revision: before });
    expect(await readMissingCaptures(store, agent, pid, cx)).toEqual({ read: 0, dated: 0, revision: before });
    expect(store.eventsSince(pid, before)).toEqual([]);
    const empty = project('empty');
    expect(await readMissingCaptures(store, owner, empty, cx)).toEqual({ read: 0, dated: 0, revision: 0 });
  });
  it('"on this day" is refused for anything but the owner\'s own session, before a project is read', () => {
    for (const p of [agent, { ...agent, scopes: ['observe'] as Principal['scopes'] }]) {
      let thrown: unknown;
      try { onThisDayFor(store, p, '2026-12-25'); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ApiError);
      expect(thrown).toMatchObject({ status: 403, code: 'owner_required' });
    }
  });
});

describe.runIf(LIFE_OPS_BUILT)('re-reading capture dates: one undoable transaction (core)', () => {
  it('attaches the dates it read in one transaction of internal operations by the caller; undo takes them off again, redo puts them back', async () => {
    const pid = project();
    const winter = await addUndated(pid, fileOf('w2.mp4', ['creation_time=2024-12-25T15:30:00Z']));
    const apple = await addUndated(pid, fileOf('a2.mov', ['com.apple.quicktime.creationdate=2024-07-01T18:30:00+0300'], ['-movflags', 'use_metadata_tags']));
    const none = await addUndated(pid, fileOf('n2.mp4', ['title=nothing']));
    const before = store.getProject(pid);
    const r = await readMissingCaptures(store, agent, pid, cx);
    expect(r).toEqual({ read: 3, dated: 2, revision: before.revision + 1 });
    const after = store.getProject(pid);
    expect(after.doc.assets[winter.assetId]!.capture).toEqual({ at: '2024-12-25T17:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' });
    expect(after.doc.assets[apple.assetId]!.capture).toEqual({ at: '2024-07-01T18:30:00', utcOffsetMinutes: 180, source: 'container' });
    expect(after.doc.assets[none.assetId]!.capture).toBeUndefined();
    const events = store.eventsSince(pid, before.revision);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: 'agent:test', ops: ['attach_asset_capture'], label: 'Read capture dates from the files' });
    expect(store.replay(pid).doc).toEqual(after.doc);
    // the caller's own undo and redo, exact
    store.undo(pid, 'agent:test', 'undo');
    expect(creativeProjection(store.getProject(pid).doc)).toEqual(creativeProjection(before.doc));
    expect(store.getProject(pid).doc.assets[winter.assetId]!.capture).toBeUndefined();
    store.undo(pid, 'agent:test', 'redo');
    expect(creativeProjection(store.getProject(pid).doc)).toEqual(creativeProjection(after.doc));
    // a second call finds nothing left to do
    const again = await readMissingCaptures(store, agent, pid, cx);
    expect(again).toEqual({ read: 0, dated: 0, revision: store.getProject(pid).revision });
  }, 60_000);
  it('never over a date set by hand: such a file is not read at all, and a date read while a person was setting one is not attached over it', async () => {
    const pid = project();
    const a = await addUndated(pid, fileOf('h1.mp4', ['creation_time=2024-12-25T15:30:00Z']));
    const b = await addUndated(pid, fileOf('h2.mp4', ['creation_time=2024-07-01T15:30:00Z']));
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'set_asset_capture', args: { assetId: a.assetId, capture: { at: '2020-02-02T12:00:00' } } }] });
    const manual = store.getProject(pid).doc.assets[a.assetId]!.capture!;
    expect(manual).toMatchObject({ at: '2020-02-02T12:00:00', source: 'manual' });
    // (1) the file with a date is not looked at
    const plan = await planCaptureReads(store, pid, cx);
    expect(plan.found.map((f) => f.assetId)).toEqual([b.assetId]);
    // (2) the date for b is read, then a person sets b by hand before the attach: the hand-set date stays
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'set_asset_capture', args: { assetId: b.assetId, capture: { at: '2021-03-03' } } }] });
    const late = store.commit({ projectId: pid, actor: 'agent:test', allowInternal: true, ops: plan.found.map((f) => ({ op: 'attach_asset_capture', args: f })) });
    expect(late.results[0]!.output).toMatchObject({ attached: false });
    expect(store.getProject(pid).doc.assets[b.assetId]!.capture).toMatchObject({ at: '2021-03-03', source: 'manual' });
    expect(store.getProject(pid).doc.assets[a.assetId]!.capture).toEqual(manual);
    // (3) and the route's own body leaves both alone
    const rev = store.getProject(pid).revision;
    expect(await readMissingCaptures(store, agent, pid, cx)).toEqual({ read: 0, dated: 0, revision: rev });
  }, 60_000);
  it('a file removed while the dates were being read does not cost the others their dates', async () => {
    const pid = project();
    const keep = await addUndated(pid, fileOf('k1.mp4', ['creation_time=2024-12-25T15:30:00Z']));
    const gone = await addUndated(pid, fileOf('g1.mp4', ['creation_time=2024-07-01T15:30:00Z']));
    // the removal lands while the files are being read (the read awaits ffprobe; this commit is synchronous)
    const reading = readMissingCaptures(store, owner, pid, cx);
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: gone.assetId } }] });
    const r = await reading;
    expect(r.dated).toBe(1);
    expect(store.getProject(pid).doc.assets[keep.assetId]!.capture?.at).toBe('2024-12-25T17:30:00');
    expect(store.getProject(pid).doc.assets[gone.assetId]).toBeUndefined();
  }, 60_000);
});

describe.runIf(LIFE_OPS_BUILT)('"on this day" across the owner\'s projects (core)', () => {
  // A store of its own: the card reads every project of the store.
  let own: Store;
  const at = (wall: string, extra: Partial<Capture> = {}): Capture => ({ at: wall, utcOffsetMinutes: null, source: 'manual', ...extra });
  beforeAll(() => { own = new Store(path.join(dir, 'on-this-day')); });
  afterAll(() => own.close());
  const add = (pid: string, assets: Omit<Asset, 'id'>[]) => own.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: assets.map((asset) => ({ op: 'import_asset', args: { asset } })) }).results.map((r) => r.output!.assetId as string);

  it('lists files taken on this day of earlier years, from every project, by the Gregorian date and by the Hebrew date', () => {
    const trip = own.createProject({ name: 'טיול' }).doc.id, home = own.createProject({ name: 'Home' }).doc.id;
    // 5 December 2026 is 25 Kislev 5787, the first day of Hanukkah. 25 Kislev 5785 was 26 December 2024; 25 Kislev 5784 was 8 December 2023.
    const [sameDay, , hebrew] = add(trip, [
      { ...record(1, at('2023-12-05T10:00:00')), name: 'park.mp4' },          // Gregorian match, 3 years ago
      { ...record(2, at('2024-11-05T10:00:00')), name: 'other-month.mp4' },   // neither
      { ...record(3, at('2024-12-26T10:00:00')), name: 'candles.mp4' },       // Hebrew match (daytime, so the Hebrew day is certain), 2 Hebrew years ago
    ]);
    const [estimate] = add(home, [
      { ...record(4, at('2021-12-05', { source: 'filename', circa: true })), name: 'IMG-20211205-WA0001.jpg' }, // Gregorian match by day only, an estimate
      { ...record(5, at('2026-12-05T09:00:00')), name: 'today.mp4' },         // today itself is not "an earlier year"
      { ...record(6), name: 'undated.mp4' },
    ]);
    const items = onThisDayFor(own, owner, '2026-12-05');
    const byAsset = new Map(items.map((i) => [i.assetId, i]));
    expect(new Set(items.map((i) => i.assetId))).toEqual(new Set([sameDay, hebrew, estimate]));
    expect(byAsset.get(sameDay!)).toMatchObject({ projectId: trip, projectName: 'טיול', assetName: 'park.mp4', wall: '2023-12-05T10:00:00', circa: false, yearsAgo: 3, match: 'gregorian' });
    expect(byAsset.get(estimate!)).toMatchObject({ projectId: home, projectName: 'Home', wall: '2021-12-05', circa: true, yearsAgo: 5, match: 'gregorian' });
    expect(byAsset.get(hebrew!)).toMatchObject({ projectId: trip, wall: '2024-12-26T10:00:00', yearsAgo: 2, match: 'hebrew', hebrewDate: 'כ״ה בכסלו תשפ״ה' });
    // newest first
    expect(items.map((i) => i.wall)).toEqual([...items.map((i) => i.wall)].sort().reverse());
    // nothing about another day
    expect(onThisDayFor(own, owner, '2026-08-19').filter((i) => [sameDay, hebrew, estimate].includes(i.assetId))).toEqual([]);
  });
  it(`answers at most ${MAX_ON_THIS_DAY} items, the newest`, () => {
    const many = own.createProject({ name: 'Many' }).doc.id;
    add(many, Array.from({ length: 25 }, (_, i) => ({ ...record(100 + i, at(`${1996 + i}-03-15T12:00:00`)), name: `y${1996 + i}.mp4` })));
    const items = onThisDayFor(own, owner, '2026-03-15');
    expect(items).toHaveLength(MAX_ON_THIS_DAY);
    expect(items.map((i) => i.wall.slice(0, 4))).toEqual(Array.from({ length: MAX_ON_THIS_DAY }, (_, i) => String(2020 - i)));
    expect(items.every((i) => i.match === 'gregorian' && i.yearsAgo === 2026 - Number(i.wall.slice(0, 4)))).toBe(true);
  });
  it('Adar: a day of Adar in a common year also brings back that day of Adar II of a leap year (Purim to Purim)', () => {
    const purim = own.createProject({ name: 'Purim' }).doc.id;
    // Purim (14 Adar) was 24 March 2024 in the leap year 5784 (Adar II) and is 3 March 2026 in the common year 5786.
    const [leap] = add(purim, [{ ...record(200, at('2024-03-24T11:00:00')), name: 'costumes.mp4' }]);
    const item = onThisDayFor(own, owner, '2026-03-03').find((i) => i.assetId === leap);
    expect(item).toMatchObject({ match: 'hebrew', yearsAgo: 2, wall: '2024-03-24T11:00:00' });
    expect(item!.hebrewDate).toMatch(/^י״ד באדר ב׳ תשפ״ד$/);
  });
});
