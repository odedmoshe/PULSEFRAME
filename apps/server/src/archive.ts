/**
 * Portable project archive (SPEC §9, §23): one uncompressed tar file with
 *   manifest.json   format version, app schema version, asset list with content hashes and sizes
 *   project.json    the project document
 *   blobs/<sha256>  every media file the document refers to (and conform originals), named by content hash
 * The tar reader and writer are written here on purpose: only these exact entry names are ever produced or accepted,
 * so an archive cannot place a file anywhere but the blob store, and every blob is verified against its name before use.
 * Not included: operation history (the import starts a new history), derivatives (regenerated), exports, grants.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LUT_MAX_TEXT_LENGTH, LutError, migrateProject, parseCube, validateProject, type ProjectDocument } from '@pulseframe/core';
import { ApiError, type Store } from './store.ts';
import { readerAccess, withoutFamily, type ArchiveFamily } from './peoplePrivacy.ts';
import type { ArchiveLibraryMode } from '@pulseframe/core';
import { libraryError } from './library/contract.ts';

export const ARCHIVE_FORMAT = 'pulseframe-archive/1';

/**
 * A translation's "reviewed" mark is the owner's word that they read it (ADR-0017; only the owner can give it). An archive is
 * a file anyone can write, and the mark inside it was given, if at all, on another computer or by another owner: on import it is
 * cleared (the translation needs review again, its wording is kept), and the import says so in both languages. Owner decision
 * preferred over keeping marks from this data directory's own exports: one rule, nothing to forge.
 */
export const IMPORTED_REVIEW_CLEARED = {
  code: 'translation_review_cleared',
  /** `names` are the translations' names, each already in «», in the order of the project's variants. One translation reads in the singular, several in the plural. */
  he: (names: string[]) => names.length === 1
    ? `סימון «נבדק» של תרגום לא עובר בייבוא ארכיון: הוא ניתן במחשב אחר או בידי מישהו אחר. התרגום ${names[0]} מסומן שוב «תרגום מכונה · לא נבדק», והנוסח שלו נשמר. אפשר לעבור עליו בלוח «תמלול» ולבחור «סמן כנבדק».`
    : `סימון «נבדק» של תרגום לא עובר בייבוא ארכיון: הוא ניתן במחשב אחר או בידי מישהו אחר. התרגומים ${names.join(', ')} מסומנים שוב «תרגום מכונה · לא נבדק», והנוסח שלהם נשמר. אפשר לעבור עליהם בלוח «תמלול» ולבחור «סמן כנבדק».`,
  en: (names: string[]) => names.length === 1
    ? `A translation's "Reviewed" mark does not carry over in an archive import: it was given on another computer or by someone else. The translation ${names[0]} needs review again; its wording is kept. Go through it in the "Transcript" panel and choose "Mark as reviewed".`
    : `A translation's "Reviewed" mark does not carry over in an archive import: it was given on another computer or by someone else. The translations ${names.join(', ')} need review again; their wording is kept. Go through them in the "Transcript" panel and choose "Mark as reviewed".`,
} as const;
export interface ImportNote { code: string; he: string; en: string; variants: { variantId: string; name: string; reviewedBy: string | null; reviewedAt: string | null }[] }
/** Clears every reviewed mark of the document in place; returns what was cleared (empty when nothing was marked). */
export function clearImportedReviews(doc: ProjectDocument): ImportNote['variants'] {
  const cleared: ImportNote['variants'] = [];
  for (const v of Object.values(doc.variants ?? {})) {
    if (v.translation?.review !== 'reviewed') continue;
    const { reviewedBy, reviewedAt, ...rest } = v.translation;
    v.translation = { ...rest, review: 'needed' };
    cleared.push({ variantId: v.id, name: v.name, reviewedBy: reviewedBy ?? null, reviewedAt: reviewedAt ?? null });
  }
  return cleared;
}
const BLOCK = 512;
interface Entry { name: string; size: number }

function header(e: Entry): Buffer {
  const b = Buffer.alloc(BLOCK);
  b.write(e.name, 0, 100, 'utf8');
  b.write('0000644\0', 100); b.write('0000000\0', 108); b.write('0000000\0', 116);
  b.write(e.size.toString(8).padStart(11, '0') + '\0', 124);
  b.write('00000000000\0', 136); // fixed mtime: the same project always archives to the same bytes
  b.write('        ', 148);
  b.write('0', 156);
  b.write('ustar\0', 257); b.write('00', 263);
  let sum = 0;
  for (const x of b) sum += x;
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}
const pad = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

/** Hashes of every blob the document needs: edited media and, for conformed assets, the untouched original. */
export function archiveBlobs(doc: ProjectDocument): string[] {
  const out = new Set<string>();
  for (const a of Object.values(doc.assets)) { out.add(a.contentHash); if (a.conform) out.add(a.conform.originalContentHash); }
  return [...out].sort();
}

/**
 * What an archive of the project holds. People (ADR-0021, people section; peoplePrivacy.ts rule 4):
 * - family 'keep' (the default): the document as the caller may read it. For the owner that is everything, people included;
 *   for a credential without the people scope it is the document without birth dates (the store answers so).
 * - family 'omit', «בלי פרטי משפחה»: no people at all, their fields made plain text (withoutFamily). The owner's choice; a
 *   credential without the people scope may ask for it too, and it is then made from what that credential may read.
 * The manifest says which it is, so an import can tell the owner.
 */
export function planArchive(store: Store, projectId: string, opts: { family?: ArchiveFamily; library?: ArchiveLibraryMode } = {}) {
  const read = store.getProject(projectId), revision = read.revision;
  // Wave 7 library track (worker B; core libraryCredits.ts archiveLibraryPlan): without `library`, a project holding restricted
  // library files is refused with archive_needs_library_choice; 'strip' leaves them out and lists them in the manifest; 'keep'
  // (owner only, checked by the route) keeps everything with mode 'keep'. A project without library files is archived byte for
  // byte as before either way. Until worker B builds it, asking for either mode answers 501 library_not_built.
  if (opts.library) throw libraryError('notBuilt');
  const family: ArchiveFamily = opts.family ?? 'keep';
  const doc = family === 'omit' ? withoutFamily(read.doc).doc : read.doc;
  // what the archive says about the people in it: none, names only (made for a credential that reads no birth dates), or all
  const people = !doc.people || Object.keys(doc.people).length === 0 ? 'none' : readerAccess() === 'full' ? 'full' : 'names';
  const blobs = archiveBlobs(doc).map((hash) => {
    const file = store.blobPath(hash);
    if (!fs.existsSync(file)) throw new ApiError(409, 'missing_media', `media ${hash} is referenced by the project but missing from the store`, { hash });
    return { hash, size: fs.statSync(file).size, file };
  });
  const manifest = Buffer.from(JSON.stringify({ format: ARCHIVE_FORMAT, schemaVersion: doc.schemaVersion, projectName: doc.name, exportedRevision: revision, blobs: blobs.map(({ hash, size }) => ({ hash, size })), ...(people === 'none' && family === 'keep' ? {} : { people, family }), note: 'History, derivatives, exports and credentials are not part of an archive.' }, null, 2));
  const project = Buffer.from(JSON.stringify(doc));
  const bytes = [manifest.length, project.length, ...blobs.map((b) => b.size)].reduce((n, s) => n + BLOCK + s + pad(s), 0) + 2 * BLOCK;
  return { doc, manifest, project, blobs, bytes };
}

/** The archive as a stream of chunks (constant memory). */
export async function* writeArchive(plan: ReturnType<typeof planArchive>): AsyncGenerator<Buffer> {
  for (const [name, data] of [['manifest.json', plan.manifest], ['project.json', plan.project]] as const) { yield header({ name, size: data.length }); yield data; if (pad(data.length)) yield Buffer.alloc(pad(data.length)); }
  for (const b of plan.blobs) {
    yield header({ name: `blobs/${b.hash.replace(/^sha256:/, '')}`, size: b.size });
    for await (const chunk of fs.createReadStream(b.file, { highWaterMark: 1 << 20 })) yield chunk as Buffer;
    if (pad(b.size)) yield Buffer.alloc(pad(b.size));
  }
  yield Buffer.alloc(2 * BLOCK);
}

const bad = (message: string, details: Record<string, unknown> = {}) => new ApiError(422, 'invalid_archive', message, details);

/**
 * Import an archive file as a NEW project. Everything is checked before anything is added: entry names, sizes, every blob's
 * SHA-256 against its name, the manifest against the contents, and the document against the current schema and validator.
 */
export function importArchive(store: Store, file: string): { doc: ProjectDocument; revision: number; blobsAdded: number; blobsAlreadyPresent: number; notes: ImportNote[] } {
  const fd = fs.openSync(file, 'r');
  const total = fs.fstatSync(fd).size;
  const staged: { hash: string; tmp: string; size: number }[] = [];
  let manifest: any = null, project: any = null;
  try {
    const head = Buffer.alloc(BLOCK);
    let pos = 0, entries = 0;
    for (;;) {
      if (pos + BLOCK > total) throw bad('the archive ends unexpectedly');
      fs.readSync(fd, head, 0, BLOCK, pos);
      pos += BLOCK;
      if (head.every((x) => x === 0)) break;
      if (++entries > 20000) throw bad('too many entries');
      const name = head.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
      const size = parseInt(head.subarray(124, 136).toString('ascii').replace(/[\0 ]/g, ''), 8);
      const type = String.fromCharCode(head[156]!);
      if (head.subarray(257, 262).toString('ascii') !== 'ustar' || !Number.isFinite(size) || size < 0 || pos + size > total) throw bad('not a PULSEFRAME archive (bad header)');
      if (type !== '0' && type !== '\0') throw bad(`entry "${name}" is not a plain file`, { name });
      const blob = /^blobs\/([0-9a-f]{64})$/.exec(name);
      if (name === 'manifest.json' || name === 'project.json') {
        if (size > 64 << 20) throw bad(`${name} is too large`);
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, pos);
        try { if (name === 'manifest.json') manifest = JSON.parse(buf.toString('utf8')); else project = JSON.parse(buf.toString('utf8')); } catch { throw bad(`${name} is not valid JSON`); }
      } else if (blob) {
        const tmp = path.join(store.tmpDir, `arc_${randomBytes(8).toString('hex')}`);
        const out = fs.openSync(tmp, 'w', 0o600);
        // Listed as staged before the first byte is written, so a copy that fails half-way (disk full, a read error) is removed
        // with the others below instead of being left behind in the temporary folder.
        staged.push({ hash: `sha256:${blob[1]}`, tmp, size });
        const hash = createHash('sha256');
        const buf = Buffer.alloc(1 << 20);
        try {
          for (let done = 0; done < size; ) { const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - done), pos + done); if (n <= 0) throw bad('the archive ends unexpectedly'); hash.update(buf.subarray(0, n)); fs.writeSync(out, buf, 0, n); done += n; }
        } finally { fs.closeSync(out); }
        if (hash.digest('hex') !== blob[1]) throw bad(`media ${blob[1]!.slice(0, 12)}… does not match its content hash; the archive is damaged or was altered`, { name });
      } else throw bad(`unexpected entry "${name.slice(0, 80)}"`, { name });
      pos += size + pad(size);
    }
    if (!manifest || !project) throw bad('manifest.json or project.json is missing');
    if (manifest.format !== ARCHIVE_FORMAT) throw bad(`unsupported archive format "${String(manifest.format).slice(0, 40)}"`, { expected: ARCHIVE_FORMAT });
    let doc: ProjectDocument;
    try { doc = migrateProject(project); } catch (e: any) { throw bad(`the project document cannot be read by this version: ${String(e?.message ?? e).slice(0, 200)}`); }
    const issues = validateProject(doc);
    if (issues.length) throw bad('the project document is not valid', { issues: issues.slice(0, 10) });
    const have = new Map(staged.map((s) => [s.hash, s]));
    const listed = new Map<string, number>((manifest.blobs ?? []).map((b: any) => [b.hash, b.size]));
    for (const hash of archiveBlobs(doc)) {
      const s = have.get(hash);
      if (!s) throw bad(`media ${hash.slice(7, 19)}… used by the project is not in the archive`, { hash });
      if (listed.get(hash) !== s.size) throw bad(`media ${hash.slice(7, 19)}… does not match the manifest`, { hash });
    }
    // A colour table (asset of kind 'lut') is text that every render context reads whole and parses. An upload is only accepted
    // as one after it parsed and within the parser's size limit (ingestUpload); the same holds for one that arrives in an archive,
    // checked here on the archive's own bytes, so no file can become a colour table without having been read as one.
    for (const a of Object.values(doc.assets)) {
      if (a.kind !== 'lut') continue;
      const label = `colour table "${a.name.slice(0, 60)}"`;
      const s = have.get(a.contentHash)!;
      if (s.size > LUT_MAX_TEXT_LENGTH) throw bad(`${label} is larger than a .cube file may be (${LUT_MAX_TEXT_LENGTH} bytes)`, { assetId: a.id, byteSize: s.size, maxBytes: LUT_MAX_TEXT_LENGTH });
      let table;
      try { table = parseCube(fs.readFileSync(s.tmp, 'utf8')); } catch (e) {
        if (!(e instanceof LutError)) throw e;
        throw bad(`${label} is not a readable 3D .cube table${e.line ? ` (line ${e.line})` : ''}: ${e.message.slice(0, 200)}`, { assetId: a.id, lut: { code: e.code, line: e.line } });
      }
      if (a.lut?.size !== table.size || a.byteSize !== s.size || a.mimeType !== 'text/plain' || a.container !== 'cube') throw bad(`${label} does not match its description in the project document`, { assetId: a.id, declared: { size: a.lut?.size ?? null, byteSize: a.byteSize, mimeType: a.mimeType.slice(0, 80), container: a.container.slice(0, 40) }, found: { size: table.size, byteSize: s.size, mimeType: 'text/plain', container: 'cube' } });
    }
    // Reviewed marks are the owner's on this computer, never the archive's (IMPORTED_REVIEW_CLEARED).
    const cleared = clearImportedReviews(doc);
    const names = cleared.map((v) => `«${v.name}»`);
    const notes: ImportNote[] = cleared.length ? [{ code: IMPORTED_REVIEW_CLEARED.code, he: IMPORTED_REVIEW_CLEARED.he(names), en: IMPORTED_REVIEW_CLEARED.en(names), variants: cleared }] : [];
    // All checks passed: add blobs (content-addressed, so existing ones are simply reused) and create the project.
    let added = 0, present = 0;
    const mimeOf = new Map(Object.values(doc.assets).map((a) => [a.contentHash, a.mimeType]));
    for (const s of staged) {
      if (fs.existsSync(store.blobPath(s.hash))) present++; else added++;
      store.putBlob(s.hash, s.tmp, s.size, mimeOf.get(s.hash) ?? 'application/octet-stream');
    }
    staged.length = 0;
    return { ...store.importProject(doc), blobsAdded: added, blobsAlreadyPresent: present, notes };
  } finally {
    fs.closeSync(fd);
    for (const s of staged) fs.rmSync(s.tmp, { force: true });
  }
}
