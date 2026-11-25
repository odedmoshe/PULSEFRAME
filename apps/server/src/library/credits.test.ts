/**
 * Licence duties on the server (wave 7 library track, worker B): the credits route's module, the archive options «ארכיון לשיתוף» /
 * «ארכיון לעצמי», the export warnings and job output, and preflight's fix. Library files are committed as the server commits them
 * (use_library_item, internal); their bytes are arbitrary (the archive treats media as opaque blobs).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, collectCredits, type LibraryRecord, type ProjectDocument } from '@pulseframe/core';
import type { RenderHost } from '@pulseframe/renderer';
import { importArchive, LIBRARY_FILES_OMITTED, planArchive, writeArchive } from '../archive.ts';
import { Exporter, exportLicence, libraryExportWarnings } from '../export.ts';
import { preflight } from '../preflight.ts';
import { ApiError, Store } from '../store.ts';
import type { Principal } from '../auth.ts';
import { creditsFor } from './credits.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
function world() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-libb-')); dirs.push(d); return new Store(d); }
const owner = { kind: 'user' } as unknown as Principal;
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${String(e)}`; } return 'ok'; };
const record = (over: Partial<LibraryRecord>): LibraryRecord => ({ itemId: 's/x', sourceId: 's', kind: 'music', title: 'X', sourceSha256: 'a'.repeat(64), ledger: { item: 's' }, licence: { id: 'CC0-1.0' }, flags: {}, ...over });

function blob(store: Store, seed: number, size: number) {
  // distinct, non-periodic bytes per seed, so "these bytes are nowhere in the archive" can be checked
  const bytes = Buffer.concat(Array.from({ length: Math.ceil(size / 32) }, (_, i) => createHash('sha256').update(`${seed}/${i}`).digest())).subarray(0, size);
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(store.tmpDir, `b${seed}`);
  fs.writeFileSync(tmp, bytes);
  store.putBlob(hash, tmp, size, 'audio/wav');
  return { hash, size };
}
/** A project with a plain file, a CC0 track, a CC BY track (credit on screen) and an NC sound (disk-only), all on the timeline. */
function seeded(store: Store, withLibrary = true) {
  const pid = store.createProject({ name: 'קרדיטים' }).doc.id;
  const audio = (b: { hash: string; size: number }, name: string, library?: LibraryRecord) => ({ kind: 'audio' as const, name, contentHash: b.hash, byteSize: b.size, container: 'wav', mimeType: 'audio/wav', duration: T.rt(4, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: (library ? 'upload' : 'fixture') as 'upload', importedAt: '2026-11-25T00:00:00Z', importedBy: 'test', ...(library ? { library } : {}) } });
  const plain = blob(store, 1, 3000);
  const ids: string[] = [store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: audio(plain, 'plain.wav') } }] }).results[0]!.output!.assetId as string];
  const lib: { b: { hash: string; size: number }; r: LibraryRecord }[] = withLibrary ? [
    { b: blob(store, 2, 2000), r: record({ itemId: 's/zero', title: 'Zero' }) },
    { b: blob(store, 3, 1500), r: record({ itemId: 's/song', title: 'Song', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Song Kevin MacLeod (incompetech.com)', placement: 'on_screen' } }) },
    { b: blob(store, 4, 1000), r: record({ itemId: 's/bird', kind: 'sound', title: 'Bird', licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'Bird by Rec', placement: 'description' }, flags: { nonCommercial: true, diskOnly: true } }) },
  ] : [];
  for (const { b, r } of lib) ids.push(store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'use_library_item', args: { asset: audio(b, `${r.title}.wav`, r) } }] }).results[0]!.output!.assetId as string);
  store.commit({ projectId: pid, actor: 'user:local', ops: ids.map((assetId, i) => ({ op: 'add_clip', args: { assetId, start: f(i * 30), duration: f(30) } })) });
  return { pid, ids, nc: lib[2]?.b ?? null };
}
async function tar(plan: ReturnType<typeof planArchive>) { const chunks: Buffer[] = []; for await (const c of writeArchive(plan)) chunks.push(c); return Buffer.concat(chunks); }

describe('credits (GET …/credits, MCP get_credits)', () => {
  it('answers core collectCredits for the main sequence in he (default) and en; an unknown sequence is 404', () => {
    const store = world();
    const { pid } = seeded(store);
    const doc = store.getProject(pid).doc;
    const he = creditsFor(store, owner, pid, {});
    expect(he.descriptionText).toBe(collectCredits(doc).descriptionText('he'));
    expect(he.lines.map((l) => l.text)).toEqual(['Song Kevin MacLeod (incompetech.com)', 'Bird by Rec']);
    expect(he.nonCommercial.map((n) => n.title)).toEqual(['Bird']);
    expect(he.onScreenMissing.map((l) => l.title)).toEqual(['Song']);
    expect(creditsFor(store, owner, pid, { lang: 'en' }).descriptionText).toBe(collectCredits(doc).descriptionText('en'));
    expect(code(() => creditsFor(store, owner, pid, { sequenceId: 'seq_none' }))).toBe('404:not_found');
    expect(code(() => creditsFor(store, owner, 'prj_none', {}))).toMatch(/^404:/);
  });
});

describe('archive: a restricted library file never leaves in a shared archive', () => {
  it('no choice → 409 naming the files and both choices; strip leaves out exactly its bytes and lists them; keep holds everything', async () => {
    const src = world();
    const { pid, nc } = seeded(src);
    let err: unknown;
    try { planArchive(src, pid); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect({ status: (err as ApiError).status, code: (err as ApiError).code }).toEqual({ status: 409, code: 'archive_needs_library_choice' });
    expect((err as ApiError).details).toMatchObject({ files: [{ title: 'Bird', licenceId: 'CC-BY-NC-4.0' }], choices: ['strip', 'keep'] });
    // every archive option without a library choice is refused alike (the people option too)
    expect(code(() => planArchive(src, pid, { family: 'omit' }))).toBe('409:archive_needs_library_choice');
    for (const family of ['keep', 'omit'] as const) {
      const strip = planArchive(src, pid, { library: 'strip', family });
      const buf = await tar(strip);
      expect(strip.blobs.map((b) => b.hash)).not.toContain(nc!.hash);
      expect(buf.includes(Buffer.from(`blobs/${nc!.hash.slice(7)}`))).toBe(false);
      // the bytes themselves are nowhere in the file
      expect(buf.includes(fs.readFileSync(src.blobPath(nc!.hash)))).toBe(false);
      const m = JSON.parse(strip.manifest.toString('utf8'));
      expect(m.library).toMatchObject({ mode: 'strip', omitted: [{ hash: nc!.hash, title: 'Bird', licenceId: 'CC-BY-NC-4.0' }], notices: [{ title: 'Bird', licenceId: 'CC-BY-NC-4.0', credit: 'Bird by Rec', url: null }] });
      expect(buf.length).toBe(strip.bytes);
    }
    const keep = planArchive(src, pid, { library: 'keep' });
    expect(keep.blobs.map((b) => b.hash)).toContain(nc!.hash);
    expect(JSON.parse(keep.manifest.toString('utf8')).library.mode).toBe('keep');
    expect(keep.library).toBe('keep');
  });
  it('a shared archive imports elsewhere with the left-out file in missing media and a note in he and en; a forged omission is refused', async () => {
    const src = world(), dst = world();
    const { pid, nc } = seeded(src);
    const file = path.join(dst.tmpDir, 'shared.tar');
    fs.writeFileSync(file, await tar(planArchive(src, pid, { library: 'strip' })));
    const r = importArchive(dst, file);
    expect(fs.existsSync(dst.blobPath(nc!.hash))).toBe(false);
    expect(Object.values(r.doc.assets).some((a) => a.contentHash === nc!.hash)).toBe(true);
    const note = r.notes.find((n) => n.code === LIBRARY_FILES_OMITTED.code)!;
    expect(note).toMatchObject({ he: LIBRARY_FILES_OMITTED.he(1), en: LIBRARY_FILES_OMITTED.en(1), library: [{ hash: nc!.hash, title: 'Bird' }] });
    expect(note.he).toMatch(/[֐-׿]/);
    // an archive that omits a file the document does NOT restrict is damaged, as before
    const other = world();
    const { pid: p2 } = seeded(other);
    const plan = planArchive(other, p2, { library: 'strip' });
    const doc = JSON.parse(plan.project.toString('utf8')) as ProjectDocument;
    const plain = Object.values(doc.assets).find((a) => !a.provenance.library)!;
    const m = JSON.parse(plan.manifest.toString('utf8'));
    m.library.omitted.push({ hash: plain.contentHash, assetId: plain.id, itemId: 'x', title: 'x', licenceId: 'CC0-1.0' });
    m.blobs = m.blobs.filter((b: { hash: string }) => b.hash !== plain.contentHash);
    const forged = { ...plan, manifest: Buffer.from(JSON.stringify(m)), blobs: plan.blobs.filter((b) => b.hash !== plain.contentHash) };
    forged.bytes = 0;
    const ff = path.join(dst.tmpDir, 'forged.tar');
    fs.writeFileSync(ff, await tar(forged));
    expect(code(() => importArchive(dst, ff))).toBe('422:invalid_archive');
  });
  it('a project without restricted library content gives the same bytes with library=strip, library=keep and without the parameter', async () => {
    const store = world();
    const { pid } = seeded(store, false);
    const plain = await tar(planArchive(store, pid));
    expect((await tar(planArchive(store, pid, { library: 'strip' }))).equals(plain)).toBe(true);
    expect((await tar(planArchive(store, pid, { library: 'keep' }))).equals(plain)).toBe(true);
    expect(planArchive(store, pid).library).toBeNull();
  });
});

describe('export: the credit lines, the non-commercial warning, the job output', () => {
  it('plan warns (never blocks); preflight lists notes and the credits-card fix, and the fix clears it', () => {
    const store = world();
    const { pid } = seeded(store);
    const exporter = new Exporter(store, {} as RenderHost, () => 'http://127.0.0.1:1/render', path.join(store.tmpDir, 'no-web'));
    const doc = store.getProject(pid).doc;
    const plan = exporter.plan(doc, 1, { format: 'wav' });
    expect(plan.blockers.map((b) => b.code)).not.toEqual(expect.arrayContaining(['non_commercial_content', 'credit_not_on_screen']));
    expect(plan.warnings.filter((w) => w.code.match(/commercial|credit|people/)).map((w) => w.code)).toEqual(['non_commercial_content', 'credits_for_description', 'credit_not_on_screen']);
    const pf = preflight(exporter, doc, 1).issues;
    expect(pf.find((i) => i.code === 'credits_for_description')?.severity).toBe('note');
    expect(pf.find((i) => i.code === 'non_commercial_content')?.severity).toBe('warning');
    const miss = pf.find((i) => i.code === 'credit_not_on_screen')!;
    expect(miss.fix?.ops).toEqual([{ op: 'add_credits_card', args: {} }]);
    const fixed = applyTransaction(doc, miss.fix!.ops, { idSeed: 'fx_', actor: 'test' }).doc;
    expect(preflight(exporter, fixed, 2).issues.map((i) => i.code)).not.toContain('credit_not_on_screen');
    expect(libraryExportWarnings(fixed).map((w) => w.code)).toEqual(['non_commercial_content', 'credits_for_description']);
  });
  it('a courtesy credit (CC0 with a credit text) and a description credit never raise credit_not_on_screen; a CC0 courtesy line raises nothing', () => {
    const store = world();
    const pid = store.createProject({ name: 'courtesy' }).doc.id;
    const b = blob(store, 9, 1200);
    const asset = (library: LibraryRecord) => ({ kind: 'audio' as const, name: 'c.wav', contentHash: b.hash, byteSize: b.size, container: 'wav', mimeType: 'audio/wav', duration: T.rt(4, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test', library } });
    const id = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'use_library_item', args: { asset: asset(record({ title: 'Kind', credit: { text: 'Thanks to Kind Person', placement: 'on_screen' } })) } }] }).results[0]!.output!.assetId as string;
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId: id, start: f(0), duration: f(30) } }] });
    const doc = store.getProject(pid).doc;
    expect(collectCredits(doc).lines.map((l) => l.text)).toEqual(['Thanks to Kind Person']);
    expect(libraryExportWarnings(doc)).toEqual([]);
    // the same file under CC BY with its credit in the description: the reminder only
    store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'use_library_item', args: { asset: asset(record({ title: 'Kind', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Kind by Person', placement: 'description' } })) } }] });
    expect(libraryExportWarnings(store.getProject(pid).doc).map((w) => w.code)).toEqual(['credits_for_description']);
  });
  it('the job output\'s licence is the snapshot\'s credits, its description text the core one in Hebrew', () => {
    const store = world();
    const { pid } = seeded(store);
    const doc = store.getProject(pid).doc;
    const lic = exportLicence(doc)!;
    expect(lic.credits.descriptionText).toBe(collectCredits(doc).descriptionText('he'));
    expect(lic.nonCommercial.map((n) => n.title)).toEqual(['Bird']);
    expect(exportLicence(store.getProject(seeded(store, false).pid).doc)).toBeNull();
  });
});
