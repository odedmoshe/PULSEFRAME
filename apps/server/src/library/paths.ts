/**
 * Path containment for the content library (wave 7 library track, worker A; library/contract.ts RULES).
 *
 * Every file the server reads from the library folder goes through `openInside`:
 *   1. the ledger path and the path inside the item are checked as text: relative, forward slashes only, no empty, `.` or `..`
 *      segment, no backslash, colon (drive letters, Windows streams), NUL or control character, and on Windows no segment that
 *      ends in a dot or a space (Windows would silently trim it into another name);
 *   2. the item's folder is the root joined with the ledger path; its realpath must lie inside the root's realpath;
 *   3. the file's realpath must lie inside the item folder's realpath (a link inside the folder that stays inside is followed;
 *      one that leads out is refused before anything is opened);
 *   4. the realpath is opened read-only (O_NOFOLLOW where the platform has it), and the open descriptor is checked again: on
 *      Linux through /proc/self/fd, elsewhere by realpath again and by comparing device and inode, so a folder swapped for a link
 *      between the check and the open is caught.
 * A refusal is 409 library_path_escape; nothing is read.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_DIRS } from '@pulseframe/core';
import { ApiError } from '../store.ts';
import { libraryError } from './contract.ts';

const WIN = process.platform === 'win32';
/** The repository this server runs from (a library root may not lie inside it). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The segments of a relative library path, or null when it is not one this server will touch. */
export function safeSegments(rel: string, allowEmpty = false): string[] | null {
  if (typeof rel !== 'string') return null;
  if (rel === '') return allowEmpty ? [] : null;
  if (rel.length > 4096) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\:\u0000-\u001f\u007f]/.test(rel)) return null;
  if (rel.startsWith('/')) return null;
  const segs = rel.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return null;
    if (WIN && /[. ]$/.test(s)) return null;
  }
  return segs;
}

/** True when `child` is `parent` or lies inside it (both absolute, already resolved; Windows compares case-insensitively). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

/** A ledger entry's `path`: safe segments whose first is one of the library's top folders. */
export function entrySegments(entryPath: string): string[] | null {
  const segs = safeSegments(entryPath);
  if (!segs || !(LIBRARY_DIRS as readonly string[]).includes(segs[0]!)) return null;
  return segs;
}

async function realOrNull(p: string): Promise<string | null> {
  try { return await fsp.realpath(p); } catch { return null; }
}

export interface Resolved { real: string; entryReal: string }
/**
 * The realpath of `rel` inside the item at `entryPath` under `rootReal` (rel '' = the item itself, a file item). Throws 409
 * library_path_escape for any path that is not safe or leaves its folder; null when the file does not exist.
 */
export async function resolveInside(rootReal: string, entryPath: string, rel: string): Promise<Resolved | null> {
  const eSegs = entrySegments(entryPath);
  const rSegs = safeSegments(rel, true);
  if (!eSegs || !rSegs) throw libraryError('pathEscape', { reason: 'unsafe path' });
  const entryAbs = path.join(rootReal, ...eSegs);
  const entryReal = await realOrNull(entryAbs);
  if (entryReal === null) {
    // missing; but a dangling link is still a link out (never "missing")
    try { if ((await fsp.lstat(entryAbs)).isSymbolicLink()) throw libraryError('pathEscape', { reason: 'link' }); } catch (e) { if ((e as { code?: string }).code !== 'ENOENT') throw e; }
    return null;
  }
  if (!isInside(rootReal, entryReal)) throw libraryError('pathEscape', { reason: 'item outside the root' });
  const abs = rSegs.length ? path.join(entryReal, ...rSegs) : entryReal;
  const real = rSegs.length ? await realOrNull(abs) : entryReal;
  if (real === null) {
    try { if ((await fsp.lstat(abs)).isSymbolicLink()) throw libraryError('pathEscape', { reason: 'link' }); } catch (e) { if ((e as { code?: string }).code !== 'ENOENT' && (e as { code?: string }).code !== 'ENOTDIR') throw e; }
    return null;
  }
  // a file item (rel '') must be exactly the place the ledger names (no link anywhere on its way); a file in a tree must stay in
  // its item's folder
  const leaves = rSegs.length ? !isInside(entryReal, real) : !samePath(real, path.join(rootReal, ...eSegs));
  if (leaves) throw libraryError('pathEscape', { reason: 'leaves its folder' });
  return { real, entryReal };
}
const samePath = (a: string, b: string) => a === b || (WIN && a.toLowerCase() === b.toLowerCase());

export interface OpenedFile { fd: fs.promises.FileHandle; real: string; stat: fs.Stats }
/**
 * Opens a library file for reading after resolveInside proved it lies inside its folder, and checks the open descriptor again.
 * Throws 409 library_path_escape (nothing read), 404 library_item_missing when it is not there or is not a regular file.
 */
export async function openInside(rootReal: string, entryPath: string, rel: string): Promise<OpenedFile> {
  const r = await resolveInside(rootReal, entryPath, rel);
  if (!r) throw libraryError('itemMissing', { reason: 'file not on disk' });
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd: fs.promises.FileHandle;
  try { fd = await fsp.open(r.real, flags); } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ELOOP') throw libraryError('pathEscape', { reason: 'link' });
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') throw libraryError('itemMissing', { reason: 'file not on disk' });
    throw e;
  }
  try {
    const stat = await fd.stat();
    if (!stat.isFile()) throw libraryError('itemMissing', { reason: 'not a file' });
    let now: string | null = null;
    if (process.platform === 'linux') {
      try { now = await fsp.readlink(`/proc/self/fd/${fd.fd}`); } catch { now = null; }
    }
    if (now === null) {
      now = await realOrNull(r.real);
      const again = now ? await fsp.stat(now).catch(() => null) : null;
      if (!again || again.ino !== stat.ino || again.dev !== stat.dev) throw libraryError('pathEscape', { reason: 'changed while opening' });
    }
    if (!now || !samePath(now, r.real)) throw libraryError('pathEscape', { reason: 'changed while opening' });
    return { fd, real: r.real, stat };
  } catch (e) {
    await fd.close();
    throw e;
  }
}

/** Reads a whole small file inside the library (at most `max` bytes, else null). Same checks as openInside. */
export async function readInside(rootReal: string, entryPath: string, rel: string, max: number): Promise<{ bytes: Buffer; stat: fs.Stats } | null> {
  const f = await openInside(rootReal, entryPath, rel);
  try {
    if (f.stat.size > max) return null;
    const buf = Buffer.alloc(f.stat.size);
    let off = 0;
    while (off < buf.length) {
      const { bytesRead } = await f.fd.read(buf, off, buf.length - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return { bytes: buf.subarray(0, off), stat: f.stat };
  } finally {
    await f.fd.close();
  }
}

/** One directory's entries inside an item (names and types; links reported as links), after the same containment check. */
export async function listInside(rootReal: string, entryPath: string, rel: string): Promise<fs.Dirent[] | null> {
  const r = await resolveInside(rootReal, entryPath, rel);
  if (!r) return null;
  try { return await fsp.readdir(r.real, { withFileTypes: true }); } catch { return null; }
}

/** The stat of a file inside an item (following a link only when it stays inside), or null when missing or refused. */
export async function statInside(rootReal: string, entryPath: string, rel: string): Promise<fs.Stats | null> {
  try {
    const r = await resolveInside(rootReal, entryPath, rel);
    if (!r) return null;
    const s = await fsp.stat(r.real);
    return s;
  } catch {
    return null;
  }
}

// ---------- integrity at use (library/contract.ts: hash and size checks) ----------
/** What use needs to know about a catalogue row's file (library/index.ts IndexedRow). */
export interface UseTarget {
  entry: { item: string; path: string; kind: string; sha256?: string; bytes: number };
  rel: string;
  bytes: number;
  mtimeMs: number | null;
}
const isFileItem = (t: UseTarget) => t.rel === '';
/**
 * Opens the file of a row and checks it is the file the ledger and the index know, before any byte is used: a file item's size
 * must equal its ledger bytes (its sha256 is checked over the bytes read: verifyDigest), a file in a tree its indexed size and
 * mtime. 409 library_hash_mismatch / library_changed_since_index; nothing read.
 */
export async function openChecked(rootReal: string, t: UseTarget): Promise<OpenedFile> {
  const f = await openInside(rootReal, t.entry.path, t.rel);
  try {
    if (isFileItem(t)) {
      if (!t.entry.sha256) throw libraryError('hashMismatch', { reason: 'the ledger has no sha256 for this file' });
      if (f.stat.size !== t.entry.bytes) throw libraryError('hashMismatch', { reason: 'size', ledgerBytes: t.entry.bytes, bytes: f.stat.size });
    } else if (f.stat.size !== t.bytes || f.stat.mtimeMs !== t.mtimeMs) {
      throw libraryError('changedSinceIndex', { indexedBytes: t.bytes, bytes: f.stat.size });
    }
    return f;
  } catch (e) {
    await f.fd.close();
    throw e;
  }
}
/** After the bytes were read: a file item's sha256 must equal the ledger's; a tree file must still have its size and mtime. */
export async function verifyAfterRead(f: OpenedFile, t: UseTarget, sha256hex: string, bytesRead: number): Promise<void> {
  if (isFileItem(t)) {
    if (bytesRead !== t.entry.bytes || sha256hex !== t.entry.sha256) throw libraryError('hashMismatch', { ledgerSha256: t.entry.sha256, sha256: sha256hex });
    return;
  }
  const now = await f.fd.stat();
  if (bytesRead !== t.bytes || now.size !== t.bytes || now.mtimeMs !== t.mtimeMs) throw libraryError('changedSinceIndex', { indexedBytes: t.bytes, bytes: bytesRead });
}
/** Reads a whole checked file (at most `max` bytes; larger answers 413 as an upload would). */
export async function readChecked(rootReal: string, t: UseTarget, max: number): Promise<{ bytes: Buffer; sha256: string }> {
  const f = await openChecked(rootReal, t);
  try {
    if (f.stat.size > max) throw new ApiError(413, 'upload_too_large', `this library file is larger than ${max} bytes`, { maxBytes: max });
    const buf = Buffer.alloc(f.stat.size);
    let off = 0;
    while (off < buf.length) { const { bytesRead } = await f.fd.read(buf, off, buf.length - off, off); if (!bytesRead) break; off += bytesRead; }
    const bytes = buf.subarray(0, off);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await verifyAfterRead(f, t, sha256, off);
    return { bytes, sha256 };
  } finally {
    await f.fd.close();
  }
}
/** Copies a checked file into `dest` (mode 0600), hashing it; checked again after the copy. On any refusal `dest` is removed. */
export async function copyChecked(rootReal: string, t: UseTarget, dest: string, max: number): Promise<{ sha256: string; bytes: number }> {
  const f = await openChecked(rootReal, t);
  try {
    if (f.stat.size > max) throw new ApiError(413, 'upload_too_large', `this library file is larger than ${max} bytes`, { maxBytes: max });
    const hash = createHash('sha256');
    const out = await fsp.open(dest, 'wx', 0o600);
    let off = 0;
    try {
      const buf = Buffer.alloc(1 << 20);
      for (;;) {
        const { bytesRead } = await f.fd.read(buf, 0, buf.length, off);
        if (!bytesRead) break;
        off += bytesRead;
        if (off > max) throw new ApiError(413, 'upload_too_large', `this library file is larger than ${max} bytes`, { maxBytes: max });
        hash.update(buf.subarray(0, bytesRead));
        await out.write(buf.subarray(0, bytesRead));
      }
    } finally {
      await out.close();
    }
    const sha256 = hash.digest('hex');
    await verifyAfterRead(f, t, sha256, off);
    return { sha256, bytes: off };
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  } finally {
    await f.fd.close();
  }
}
/**
 * A checked file's sha256, remembered per (file, device, inode, size, mtime) for this process: the audition route checks a file
 * item's ledger hash once, not on every range request.
 */
const digests = new Map<string, string>();
export async function checkedDigest(f: OpenedFile, t: UseTarget): Promise<void> {
  if (!isFileItem(t)) return; // size and mtime were checked by openChecked
  const k = `${f.real}|${f.stat.dev}|${f.stat.ino}|${f.stat.size}|${f.stat.mtimeMs}`;
  let hex = digests.get(k);
  if (!hex) {
    const hash = createHash('sha256');
    const buf = Buffer.alloc(1 << 20);
    let off = 0;
    for (;;) { const { bytesRead } = await f.fd.read(buf, 0, buf.length, off); if (!bytesRead) break; off += bytesRead; hash.update(buf.subarray(0, bytesRead)); }
    hex = hash.digest('hex');
    if (off !== t.entry.bytes || hex !== t.entry.sha256) throw libraryError('hashMismatch', { ledgerSha256: t.entry.sha256, sha256: hex });
    if (digests.size > 4096) digests.clear();
    digests.set(k, hex);
  }
  if (hex !== t.entry.sha256) throw libraryError('hashMismatch', { ledgerSha256: t.entry.sha256, sha256: hex });
}
