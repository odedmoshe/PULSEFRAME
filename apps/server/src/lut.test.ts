import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { LUT_MAX_TEXT_LENGTH, identityLut, lutStrip, lutUsers, serializeCube } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { importArchive, planArchive, writeArchive } from './archive.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { ingestUpload } from './ingest.ts';
import { ApiError, Store } from './store.ts';

let dir: string;
let store: Store;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const upload = (bytes: Buffer | ReadableStream<Uint8Array>, name: string, into = store) => ingestUpload(into, Buffer.isBuffer(bytes) ? (Readable.toWeb(Readable.from([bytes])) as any) : bytes, name, 'test', 1 << 30);
const refusal = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('expected a refusal'); };
const blobs = (s = store) => fs.readdirSync(s.blobDir).sort();
const temps = (s = store) => fs.readdirSync(s.tmpDir);
const cube = (size = 5, title: string | null = 'Warm film') => Buffer.from(serializeCube({ ...identityLut(size), title }), 'utf8');
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: { origin: 'fixture' as const, importedAt: 'x', importedBy: 'x' } };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lut-'));
  store = new Store(path.join(dir, 'data'));
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('ingest of .cube colour tables', () => {
  it('a valid .cube is accepted as an asset of kind lut with its size and title; the stored blob is the uploaded file', async () => {
    const bytes = cube(5);
    const a = await upload(bytes, 'Warm Film.cube');
    expect(a).toMatchObject({ kind: 'lut', container: 'cube', mimeType: 'text/plain', duration: T.ZERO, name: 'Warm Film.cube', byteSize: bytes.length, lut: { size: 5, title: 'Warm film' }, provenance: { origin: 'upload', importedBy: 'test' } });
    expect(a.contentHash).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    expect(a.video ?? a.audio ?? a.image ?? a.conform).toBeUndefined();
    expect(fs.readFileSync(store.blobPath(a.contentHash)).equals(bytes)).toBe(true);
    expect(temps()).toEqual([]);
    // what every render context makes of those bytes
    expect(lutStrip(fs.readFileSync(store.blobPath(a.contentHash), 'utf8'))).toMatchObject({ size: 5, width: 25, height: 5 });
  });
  it('the extension is matched without regard to case; a table without a title has title null; a very long title is cut to what the document allows', async () => {
    const upper = await upload(cube(3, null), 'LOOK.CUBE');
    expect(upper).toMatchObject({ kind: 'lut', lut: { size: 3, title: null } });
    const long = await upload(cube(2, 'x'.repeat(400)), 'long.cube');
    expect(long.lut!.title).toHaveLength(256);
  });
  it('junk named .cube, a 1D table, a truncated table and a file over the cap are each refused with a typed error and leave no blob and no temporary file', async () => {
    const before = blobs();
    const junk = await refusal(upload(Buffer.alloc(5000, 7), 'junk.cube'));
    expect([junk.status, junk.code]).toEqual([415, 'unsupported_media']);
    expect(junk.details).toMatchObject({ lut: { code: 'malformed', line: 1 } });
    expect(junk.message).toMatch(/colour table/);
    const oneD = await refusal(upload(Buffer.from('TITLE "curve"\nLUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1\n'), 'curve.cube'));
    expect([oneD.status, oneD.code]).toEqual([415, 'unsupported_media']);
    expect(oneD.details).toMatchObject({ lut: { code: 'unsupported', line: 2 } });
    expect(oneD.hint).toMatch(/3D/);
    const short = await refusal(upload(cube(4).subarray(0, 300), 'short.cube'));
    expect(short.details).toMatchObject({ lut: { code: 'malformed' } });
    const big = await refusal(upload(Buffer.from('LUT_3D_SIZE 66\n'), 'big.cube'));
    expect(big.details).toMatchObject({ lut: { code: 'too_large', line: 1 } });
    // real media bytes under a .cube name are not handed to the media reader either
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    expect((await refusal(upload(png, 'picture.cube'))).code).toBe('unsupported_media');
    // over the cap: cut off while streaming, long before the generic 1 GiB limit of this call
    const line = Buffer.from(`# ${'x'.repeat(1021)}\n`); // 1024 bytes
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(c) { if (sent > LUT_MAX_TEXT_LENGTH + (1 << 20)) c.close(); else { sent += line.length; c.enqueue(line); } } });
    const over = await refusal(upload(endless, 'huge.cube'));
    expect([over.status, over.code]).toEqual([413, 'upload_too_large']);
    expect(over.details).toMatchObject({ maxBytes: LUT_MAX_TEXT_LENGTH });
    expect(sent).toBeLessThan(LUT_MAX_TEXT_LENGTH + (1 << 20)); // not read to its end
    expect(blobs()).toEqual(before);
    expect(temps()).toEqual([]);
  }, 60_000);
  it('a refusal quotes at most a few characters of the file: megabytes of text on one line do not come back in the error', async () => {
    const before = blobs();
    const echo = Buffer.from(`LUT_3D_SIZE 2\n0 0 0\n${'SECRETISH'.repeat(400_000)}\n`);
    const e = await refusal(upload(echo, 'echo.cube'));
    expect([e.status, e.code]).toEqual([415, 'unsupported_media']);
    expect(e.details).toMatchObject({ lut: { code: 'malformed', line: 3 } });
    expect(e.message.length).toBeLessThan(300);
    expect(JSON.stringify({ message: e.message, details: e.details, hint: e.hint }).length).toBeLessThan(600);
    // the same for a word in the header, a number and a title
    for (const text of [`${'K'.repeat(2_000_000)} 1\n`, `LUT_3D_SIZE 2\n0 0 ${'1'.repeat(2_000_000)}\n`, `TITLE ${'t'.repeat(2_000_000)}\nLUT_3D_SIZE 2\n0 0 0\n`]) {
      expect((await refusal(upload(Buffer.from(text), 'echo.cube'))).message.length).toBeLessThan(300);
    }
    expect(blobs()).toEqual(before);
    expect(temps()).toEqual([]);
  });
  it('a name longer than the document allows that ends in .cube is still read as a table (never by the media reader) and keeps its extension', async () => {
    const bytes = cube(2, null);
    for (const name of [`${'n'.repeat(251)}.cube`, `${'n'.repeat(252)}.cube`, `${'n'.repeat(600)}.CUBE`, `C:\\grades\\${'d'.repeat(270)}\\look.cube`]) {
      const a = await upload(bytes, name);
      expect(a).toMatchObject({ kind: 'lut', lut: { size: 2, title: null } });
      expect(a.name.length).toBeLessThanOrEqual(256);
      expect(a.name).toMatch(/\.cube$/i);
      expect(a.name.startsWith(name.slice(0, 251))).toBe(true);
    }
    // and a long name over junk is refused by the table reader, with its typed details
    const e = await refusal(upload(Buffer.alloc(100, 7), `${'j'.repeat(400)}.cube`));
    expect(e.details).toMatchObject({ lut: { code: 'malformed', line: 1 } });
    expect(temps()).toEqual([]);
  });
  it('a .cube text under another name is not taken for a table (the name chooses the reader, as documented)', async () => {
    const e = await refusal(upload(cube(3), 'table.txt'));
    expect(e.code).toBe('unsupported_media');
    expect(e.details).not.toHaveProperty('lut');
  });
});

describe('a colour table in a project', () => {
  async function project() {
    const pid = store.createProject({ name: 'lut' }).doc.id;
    const vid = store.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: video } }] }).results[0]!.output!.assetId as string;
    const clipId = store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(60) } }] }).results[0]!.output!.clipId as string;
    const asset = await upload(cube(7, `table ${pid}`), 'look.cube');
    const imported = store.commit({ projectId: pid, actor: 'u', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    return { pid, clipId, asset, lutId: imported.results[0]!.output!.assetId as string, importTx: imported.transactionId! };
  }
  it('undoing the import while an effect uses the table is refused as a conflict and the project stays valid; after the effect is gone the undo works', async () => {
    const { pid, clipId, lutId, importTx } = await project();
    const applied = store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'apply_lut', args: { clipId, assetId: lutId } }] });
    const e = (() => { try { store.undo(pid, 'u', 'undo', importTx); } catch (x) { return x as ApiError; } throw new Error('expected a conflict'); })();
    expect([e.status, e.code]).toEqual([409, 'undo_conflict']);
    const doc = store.getProject(pid).doc;
    expect(doc.assets[lutId]?.kind).toBe('lut');
    expect(lutUsers(doc, lutId)).toEqual([clipId]);
    store.undo(pid, 'u', 'undo', applied.transactionId!);
    store.undo(pid, 'u', 'undo', importTx);
    expect(store.getProject(pid).doc.assets[lutId]).toBeUndefined();
    expect(store.replay(pid).doc).toEqual(store.getProject(pid).doc);
  });
  it('no derivatives are queued for a table', async () => {
    const { asset } = await project();
    const d = new Derivatives(store);
    expect(d.ensure({ id: 'ast_x', ...asset })).toEqual([]);
    expect(d.list(asset.contentHash)).toEqual([]);
  });
  it('export planning counts a table used by an enabled effect in the exported range as source material, and blocks when its bytes are gone', async () => {
    const { pid, clipId, asset, lutId } = await project();
    const exporter = new Exporter(store, null as any, () => '', path.join(dir, 'no-web-dist'));
    const plan = () => { const p = store.getProject(pid); return exporter.plan(p.doc, p.revision, { format: 'png', frame: 0 }); };
    expect(plan().manifest.assets.map((a) => a.id)).not.toContain(lutId); // in the library but not used
    const fx = store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'apply_lut', args: { clipId, assetId: lutId } }] }).results[0]!.output!.effectId as string;
    const used = plan();
    expect(used.manifest.assets.find((a) => a.id === lutId)).toEqual({ id: lutId, contentHash: asset.contentHash, byteSize: asset.byteSize, kind: 'lut', clips: 1 });
    expect(used.manifest.effects.map((x) => x.type)).toContain('color.lut');
    expect(used.blockers.filter((b) => b.ids.includes(lutId))).toEqual([]);
    // bypassed: not needed
    store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'update_effect', args: { clipId, effectId: fx, enabled: false } }] });
    expect(plan().manifest.assets.map((a) => a.id)).not.toContain(lutId);
    store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'update_effect', args: { clipId, effectId: fx, enabled: true } }] });
    // the bytes disappear: a blocker before any job starts
    const file = store.blobPath(asset.contentHash);
    const kept = fs.readFileSync(file);
    fs.rmSync(file);
    try {
      expect(plan().blockers.filter((b) => b.code === 'missing_media' && b.ids.includes(lutId))).toHaveLength(1);
    } finally { fs.writeFileSync(file, kept); }
  });
  it('export planning counts the table (and the file) of a clip that is only drawn as the outgoing picture of the next clip\'s transition', async () => {
    const { pid, clipId, asset, lutId } = await project(); // clip A: frames 0..60
    const vid = (store.getProject(pid).doc.sequences.seq_main!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) as any).assetId as string;
    // a second file for clip B, so that A's file is in a plan only when A itself is drawn
    const vidB = store.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...video, name: 'b.mp4', contentHash: `sha256:${'b'.repeat(64)}` } } }] }).results[0]!.output!.assetId as string;
    const clipB = store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_clip', args: { assetId: vidB, start: f(60), duration: f(60) } }] }).results[0]!.output!.clipId as string;
    store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'set_transition', args: { clipId: clipB, type: 'dissolve', frames: 10 } }, { op: 'apply_lut', args: { clipId, assetId: lutId } }] });
    const exporter = new Exporter(store, null as any, () => '', path.join(dir, 'no-web-dist'));
    const doc = () => store.getProject(pid).doc;
    const plan = (options: unknown) => { const p = store.getProject(pid); return exporter.plan(p.doc, p.revision, options); };
    const ids = (options: unknown) => plan(options).manifest.assets.map((a) => a.id).sort();
    // what the evaluator draws there: A, with its colour table effect, as the outgoing layer
    const at62 = evaluate(doc(), f(62)).layers;
    expect(at62.map((l) => [(l as any).clipId, (l as any).transition?.role])).toEqual([[clipId, 'out'], [clipB, 'in']]);
    expect((at62[0] as any).effects.map((e: any) => [e.type, e.params.lut])).toEqual([['color.lut', lutId]]);
    expect(ids({ format: 'png', frame: 62 })).toEqual([vid, vidB, lutId].sort());
    expect(ids({ range: { startFrame: 60, endFrame: 120 } })).toEqual([vid, vidB, lutId].sort());
    expect(plan({ format: 'png', frame: 62 }).manifest.effects.map((x) => x.type)).toContain('color.lut');
    // every frame around the cut: whatever the evaluator draws is in the plan of that frame; after the transition A is not
    for (let frame = 55; frame < 75; frame++) {
      const drawn = new Set<string>();
      for (const l of evaluate(doc(), f(frame)).layers) { if ('assetId' in l) drawn.add(l.assetId); for (const e of (l as any).effects ?? []) if (e.type === 'color.lut' && e.params.lut) drawn.add(e.params.lut); }
      expect(ids({ format: 'png', frame }), `frame ${frame}`).toEqual([...drawn].sort());
    }
    expect(ids({ format: 'png', frame: 70 })).toEqual([vidB]);
    expect(ids({ range: { startFrame: 70, endFrame: 120 } })).toEqual([vidB]);
    // the table's bytes are gone: a blocker up front for a still inside the transition and for a range that starts at the cut
    const file = store.blobPath(asset.contentHash);
    const kept = fs.readFileSync(file);
    fs.rmSync(file);
    try {
      for (const options of [{ format: 'png', frame: 62 }, { range: { startFrame: 60, endFrame: 120 } }]) expect(plan(options).blockers.filter((b) => b.code === 'missing_media' && b.ids.includes(lutId))).toHaveLength(1);
      expect(plan({ format: 'png', frame: 70 }).blockers.filter((b) => b.ids.includes(lutId))).toEqual([]);
    } finally { fs.writeFileSync(file, kept); }
  });
  it('an archive carries the table and its bytes, and the imported project still has the effect pointing at it', async () => {
    // its own project: the archive needs stored bytes for every asset, so the video here gets a (one-byte) blob
    const vtmp = path.join(store.tmpDir, 'v');
    fs.writeFileSync(vtmp, Buffer.from('v'));
    const vHash = `sha256:${createHash('sha256').update(Buffer.from('v')).digest('hex')}`;
    store.putBlob(vHash, vtmp, 1, 'video/mp4');
    const asset = await upload(cube(7, 'archived'), 'look.cube');
    const pid = store.createProject({ name: 'to archive' }).doc.id;
    const ids = store.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...video, contentHash: vHash } } }, { op: 'import_asset', args: { asset } }] }).results.map((r) => r.output!.assetId as string);
    const clipId = store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_clip', args: { assetId: ids[0], start: f(0), duration: f(60) } }] }).results[0]!.output!.clipId as string;
    store.commit({ projectId: pid, actor: 'u', ops: [{ op: 'apply_lut', args: { clipId, assetId: ids[1], intensity: 0.5 } }] });
    const chunks: Buffer[] = [];
    for await (const c of writeArchive(planArchive(store, pid))) chunks.push(c);
    const other = new Store(path.join(dir, 'other'));
    try {
      const file = path.join(other.tmpDir, 'in.tar');
      fs.writeFileSync(file, Buffer.concat(chunks));
      const r = importArchive(other, file);
      const table = Object.values(r.doc.assets).find((a) => a.kind === 'lut')!;
      expect(table).toMatchObject({ kind: 'lut', lut: { size: 7, title: 'archived' }, contentHash: asset.contentHash });
      expect(fs.readFileSync(other.blobPath(table.contentHash)).equals(fs.readFileSync(store.blobPath(asset.contentHash)))).toBe(true);
      expect(lutUsers(r.doc, table.id)).toHaveLength(1);
    } finally { other.close(); }
  });
  it('an archive cannot bring in a colour table that was never read as one: bytes that do not parse, a file over the cap, a 1D table or a description that does not match are refused and add nothing', async () => {
    // Stands for a hand-written archive: a library entry of kind lut over whatever bytes, which the upload route would have refused.
    const forged = async (bytes: Buffer, over: Record<string, unknown> = {}) => {
      const tmp = path.join(store.tmpDir, 'forged');
      fs.writeFileSync(tmp, bytes);
      const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      store.putBlob(contentHash, tmp, bytes.length, 'text/plain');
      const pid = store.createProject({ name: 'forged' }).doc.id;
      store.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'lut', name: 'forged.cube', contentHash, byteSize: bytes.length, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 33, title: null }, provenance: video.provenance, ...over } } }] });
      const chunks: Buffer[] = [];
      for await (const c of writeArchive(planArchive(store, pid))) chunks.push(c);
      return Buffer.concat(chunks);
    };
    const other = new Store(path.join(dir, 'forged-into'));
    try {
      const file = path.join(dir, 'forged.tar');
      const attempt = async (bytes: Buffer, over?: Record<string, unknown>) => {
        fs.writeFileSync(file, await forged(bytes, over));
        try { importArchive(other, file); } catch (e) { if (e instanceof ApiError) return e; throw e; }
        throw new Error('expected the archive to be refused');
      };
      const html = await attempt(Buffer.from(`<html><script>alert(1)</script>${'x'.repeat(5000)}`), { mimeType: 'text/html' });
      expect([html.status, html.code]).toEqual([422, 'invalid_archive']);
      expect(html.message).toMatch(/colour table "forged\.cube" is not a readable 3D \.cube table/);
      expect(html.details).toMatchObject({ lut: { code: 'malformed', line: 1 } });
      const huge = await attempt(Buffer.concat([Buffer.from('<html><script>'), Buffer.alloc(LUT_MAX_TEXT_LENGTH + 4096, 0x20)]));
      expect(huge.code).toBe('invalid_archive');
      expect(huge.details).toMatchObject({ maxBytes: LUT_MAX_TEXT_LENGTH });
      const oneD = await attempt(Buffer.from('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n'));
      expect(oneD.details).toMatchObject({ lut: { code: 'unsupported' } });
      // a real table, described as another size, or as something a browser might run
      const wrongSize = await attempt(cube(5));
      expect(wrongSize.message).toMatch(/does not match its description/);
      expect(wrongSize.details).toMatchObject({ declared: { size: 33 }, found: { size: 5 } });
      expect((await attempt(cube(5), { lut: { size: 5, title: null }, mimeType: 'text/html' })).message).toMatch(/does not match its description/);
      expect((await attempt(cube(5), { lut: undefined })).message).toMatch(/does not match its description/);
      expect(other.listProjects()).toEqual([]);
      expect(blobs(other)).toEqual([]);
      expect(temps(other)).toEqual([]);
      // the same table, truthfully described, is accepted
      fs.writeFileSync(file, await forged(cube(5), { lut: { size: 5, title: 'Warm film' } }));
      expect(Object.values(importArchive(other, file).doc.assets)[0]).toMatchObject({ kind: 'lut', lut: { size: 5 } });
    } finally { other.close(); }
  }, 60_000);
});
