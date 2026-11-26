import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { IMPORTED_REVIEW_CLEARED, importArchive, planArchive, writeArchive } from './archive.ts';
import { ApiError, Store } from './store.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
function world() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-arc-'));
  dirs.push(d);
  return new Store(d);
}
/** A project with two "media files" (arbitrary bytes are enough: the archive treats media as opaque blobs). */
function seeded(store: Store) {
  const pid = store.createProject({ name: 'פרויקט ארכיון' }).doc.id;
  const mk = (seed: number, size: number) => {
    const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + seed) & 0xff));
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const tmp = path.join(store.tmpDir, `seed${seed}`);
    fs.writeFileSync(tmp, bytes);
    store.putBlob(hash, tmp, size, 'video/mp4');
    return { hash, size };
  };
  const a = mk(1, 5000), b = mk(2, 700);
  const asset = (x: { hash: string; size: number }, name: string) => ({ kind: 'video' as const, name, contentHash: x.hash, byteSize: x.size, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 120 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' } });
  const r = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: asset(a, 'a.mp4') } }, { op: 'import_asset', args: { asset: asset(b, 'b.mp4') } }] });
  const [idA, idB] = r.results.map((x) => x.output!.assetId as string);
  store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId: idA, start: f(0) } }, { op: 'add_clip', args: { assetId: idB, start: f(120) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } }, { op: 'add_variant', args: { profileId: 'square-1x1' } }] });
  return { pid, blobs: [a, b] };
}
async function toFile(store: Store, pid: string, name = 'out.tar') {
  const plan = planArchive(store, pid);
  const chunks: Buffer[] = [];
  for await (const c of writeArchive(plan)) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const file = path.join(store.tmpDir, name);
  fs.writeFileSync(file, buf);
  return { file, buf, plan };
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${e}`; } return 'ok'; };

describe('project archive', () => {
  it('round trip into a different store: same document (new id), media present and byte-identical, fresh history', async () => {
    const src = world(), dst = world();
    const { pid, blobs } = seeded(src);
    const { file, buf, plan } = await toFile(src, pid);
    expect(buf.length).toBe(plan.bytes); // the announced Content-Length is exact
    expect(buf.length % 512).toBe(0);
    const again = await toFile(src, pid, 'again.tar');
    expect(again.buf.equals(buf)).toBe(true); // deterministic
    const copy = path.join(dst.tmpDir, 'in.tar');
    fs.copyFileSync(file, copy);
    const r = importArchive(dst, copy);
    const before = src.getProject(pid).doc;
    expect(r.doc.id).not.toBe(before.id);
    expect({ ...r.doc, id: before.id }).toEqual(before);
    expect([r.revision, r.blobsAdded, r.blobsAlreadyPresent]).toEqual([0, 2, 0]);
    for (const b of blobs) expect(fs.readFileSync(dst.blobPath(b.hash)).equals(fs.readFileSync(src.blobPath(b.hash)))).toBe(true);
    // importing the same archive again reuses the media and makes another project
    fs.copyFileSync(file, copy);
    const r2 = importArchive(dst, copy);
    expect([r2.blobsAdded, r2.blobsAlreadyPresent]).toEqual([0, 2]);
    expect(dst.listProjects()).toHaveLength(2);
    // the imported project is a normal project: it accepts edits and undo
    const edited = dst.commit({ projectId: r.doc.id, actor: 'user:local', ops: [{ op: 'rename_project', args: { name: 'x' } }] });
    expect(edited.revision).toBe(1);
  });
  it('a translation marked reviewed arrives needing review again, with a note in Hebrew and English; its wording is kept and the owner can mark it here', async () => {
    const src = world(), dst = world();
    const { pid } = seeded(src);
    // a voice recording (arbitrary bytes: the archive treats media as opaque)
    const bytes = Buffer.from('a voice recording stand-in');
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    fs.writeFileSync(path.join(src.tmpDir, 'voice'), bytes);
    src.putBlob(hash, path.join(src.tmpDir, 'voice'), bytes.length, 'audio/wav');
    const voice = { kind: 'audio' as const, name: 'voice.wav', contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(4, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' } };
    const assetId = src.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: voice } }] }).results[0]!.output!.assetId as string;
    src.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'set_transcript', args: { assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(2, 1), text: 'שלום לכולם' }] } }] });
    const seg = src.getProject(pid).doc.transcripts[assetId]!.segments[0]!.id;
    const sha = createHash('sha256').update('שלום לכולם').digest('hex');
    const translate = (name: string, to: string, text: string) => src.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name, language: to, translation: { from: 'he', to, engine: 'fixture', model: 'none', createdAt: '2026-11-20T00:00:00Z', createdBy: 'test', sources: { [seg]: sha } }, phraseText: { [seg]: text }, cueText: {} } }] }).results[0]!.output!.variantId as string;
    const en = translate('English', 'en', 'Hello everyone'), fr = translate('Français', 'fr', 'Bonjour à tous');
    src.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'review_translation', args: { variantId: en, review: 'reviewed', at: '2026-11-21T10:00:00Z' } }] });
    expect(src.getProject(pid).doc.variants[en]!.translation).toMatchObject({ review: 'reviewed', reviewedBy: 'user:local' });
    const { file } = await toFile(src, pid);
    const copy = path.join(dst.tmpDir, 'in.tar');
    fs.copyFileSync(file, copy);
    const r = importArchive(dst, copy);
    const tl = dst.getProject(r.doc.id).doc.variants[en]!.translation!;
    expect(tl.review).toBe('needed');
    expect(tl).not.toHaveProperty('reviewedBy');
    expect(tl).not.toHaveProperty('reviewedAt');
    expect(dst.getProject(r.doc.id).doc.variants[en]!.phraseText).toEqual({ [seg]: 'Hello everyone' }); // the wording is kept
    expect(dst.getProject(r.doc.id).doc.variants[fr]!.translation!.review).toBe('needed'); // was never reviewed: unchanged
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ code: 'translation_review_cleared', variants: [{ variantId: en, name: 'English', reviewedBy: 'user:local', reviewedAt: '2026-11-21T10:00:00Z' }] });
    // exactly one translation was cleared: the note says «the translation», not «the translations», in both languages
    expect(r.notes[0]!.he).toMatch(/«נבדק».*התרגום «English» מסומן שוב.*והנוסח שלו נשמר.*עבור עליו.*«סמן כנבדק»/);
    expect(r.notes[0]!.he).not.toMatch(/התרגומים|מסומנים|שלהם|עליהם/);
    expect(r.notes[0]!.en).toMatch(/"Reviewed" mark.*The translation «English» needs review again; its wording is kept\. Go through it in.*"Mark as reviewed"/);
    expect(r.notes[0]!.en).not.toMatch(/translations|their wording|through them/);
    // the source project keeps its own mark: exporting changes nothing
    expect(src.getProject(pid).doc.variants[en]!.translation!.review).toBe('reviewed');
    // the owner of this computer marks it again in the imported project
    dst.commit({ projectId: r.doc.id, actor: 'user:local', allowInternal: true, ops: [{ op: 'review_translation', args: { variantId: en, review: 'reviewed' } }] });
    expect(dst.getProject(r.doc.id).doc.variants[en]!.translation).toMatchObject({ review: 'reviewed', reviewedBy: 'user:local' });
    // a hand-written archive claiming a reviewer is cleared the same way (the mark is never taken from a file)
    const forged = path.join(dst.tmpDir, 'forged.tar');
    fs.copyFileSync(file, forged);
    const r2 = importArchive(dst, forged);
    expect(dst.getProject(r2.doc.id).doc.variants[en]!.translation!.review).toBe('needed');
    // two reviewed translations: the plural, with both names in the order of the variants
    src.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'review_translation', args: { variantId: fr, review: 'reviewed', at: '2026-11-21T10:05:00Z' } }] });
    const { file: twoFile } = await toFile(src, pid, 'two.tar');
    fs.copyFileSync(twoFile, path.join(dst.tmpDir, 'two.tar'));
    const r3 = importArchive(dst, path.join(dst.tmpDir, 'two.tar'));
    expect(r3.notes[0]!.variants.map((v) => v.name)).toEqual(['English', 'Français']);
    expect(r3.notes[0]!.he).toMatch(/התרגומים «English», «Français» מסומנים שוב.*והנוסח שלהם נשמר.*לעבור עליהם/);
    expect(r3.notes[0]!.en).toMatch(/The translations «English», «Français» need review again; their wording is kept\. Go through them in/);
    // an archive with no reviewed translation carries no note
    const plain = world();
    const p2 = seeded(plain);
    const { file: plainFile } = await toFile(plain, p2.pid, 'plain.tar');
    fs.copyFileSync(plainFile, path.join(dst.tmpDir, 'plain.tar'));
    expect(importArchive(dst, path.join(dst.tmpDir, 'plain.tar')).notes).toEqual([]);
  });
  it('refuses damaged or hostile archives without adding anything', async () => {
    const src = world();
    const { pid } = seeded(src);
    const { buf } = await toFile(src, pid);
    const attempt = (mutate: (b: Buffer) => Buffer) => {
      const dst = world();
      const file = path.join(dst.tmpDir, 'bad.tar');
      fs.writeFileSync(file, mutate(Buffer.from(buf)));
      const result = code(() => importArchive(dst, file));
      return { result, projects: dst.listProjects().length, blobs: fs.readdirSync(path.join(dst.dataDir, 'blobs')).length, tmpLeft: fs.readdirSync(dst.tmpDir).filter((n) => n.startsWith('arc_')).length };
    };
    const clean = { projects: 0, blobs: 0, tmpLeft: 0 };
    // flip one byte inside the last media file
    expect(attempt((b) => { b[b.length - 1024 - 300] = b[b.length - 1024 - 300]! ^ 0xff; return b; })).toEqual({ result: '422:invalid_archive', ...clean });
    // rename an entry so it would escape the blob directory
    const rename = (b: Buffer, from: string, to: string) => { const i = b.indexOf(from); b.fill(0, i, i + 100); b.write(to, i, 'utf8'); let sum = 0; b.fill(' ', i + 148, i + 156); for (let k = i; k < i + 512; k++) sum += b[k]!; b.write(sum.toString(8).padStart(6, '0') + '\0 ', i + 148); return b; };
    expect(attempt((b) => rename(b, 'blobs/', '../../etc/passwd'))).toEqual({ result: '422:invalid_archive', ...clean });
    expect(attempt((b) => rename(b, 'project.json', 'project.jsox'))).toEqual({ result: '422:invalid_archive', ...clean });
    // truncated file, and something that is not a tar at all
    expect(attempt((b) => b.subarray(0, b.length - 3000))).toEqual({ result: '422:invalid_archive', ...clean });
    expect(attempt(() => Buffer.from('this is not an archive'.repeat(100)))).toEqual({ result: '422:invalid_archive', ...clean });
  });
  it('a media copy that fails half-way (disk full) leaves no temporary file behind, and nothing is added', async () => {
    const src = world();
    const { pid } = seeded(src);
    const { buf } = await toFile(src, pid);
    const dst = world();
    const file = path.join(dst.tmpDir, 'in.tar');
    fs.writeFileSync(file, buf);
    // importArchive is synchronous, so while the stand-in is installed nothing else writes through fs.writeSync in this thread.
    const real = fs.writeSync;
    let calls = 0;
    const spy = vi.spyOn(fs, 'writeSync').mockImplementation(((...a: Parameters<typeof fs.writeSync>) => {
      if (++calls === 2) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); // the second media file
      return (real as (...x: unknown[]) => number)(...a);
    }) as typeof fs.writeSync);
    let thrown: unknown;
    try { importArchive(dst, file); } catch (e) { thrown = e; } finally { spy.mockRestore(); }
    expect((thrown as { code?: string }).code).toBe('ENOSPC');
    expect(calls).toBe(2);
    expect(fs.readdirSync(dst.tmpDir).filter((n) => n.startsWith('arc_'))).toEqual([]); // used to keep the half-written copy
    expect([dst.listProjects().length, fs.readdirSync(path.join(dst.dataDir, 'blobs')).length]).toEqual([0, 0]);
  });
  it('a project whose media is missing from the store cannot be archived (it would not be restorable)', () => {
    const src = world();
    const { pid, blobs } = seeded(src);
    fs.rmSync(src.blobPath(blobs[0]!.hash));
    expect(code(() => planArchive(src, pid))).toBe('409:missing_media');
  });
});

describe('the import note\'s number', () => {
  it('reads in the singular for one translation and the plural for several, in Hebrew and English', () => {
    expect(IMPORTED_REVIEW_CLEARED.he(['«English»'])).toContain('התרגום «English» מסומן שוב «תרגום מכונה · לא נבדק», והנוסח שלו נשמר. אפשר לעבור עליו בלוח «תמלול»');
    expect(IMPORTED_REVIEW_CLEARED.he(['«English»', '«Français»'])).toContain('התרגומים «English», «Français» מסומנים שוב «תרגום מכונה · לא נבדק», והנוסח שלהם נשמר. אפשר לעבור עליהם בלוח «תמלול»');
    expect(IMPORTED_REVIEW_CLEARED.en(['«English»'])).toContain('The translation «English» needs review again; its wording is kept. Go through it in the "Transcript" panel');
    expect(IMPORTED_REVIEW_CLEARED.en(['«English»', '«Français»', '«Deutsch»'])).toContain('The translations «English», «Français», «Deutsch» need review again; their wording is kept. Go through them in the "Transcript" panel');
  });
});
