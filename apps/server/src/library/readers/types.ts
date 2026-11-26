/**
 * What a reader is (wave 7 library track, worker A). A reader turns one ledger entry's files into catalogue rows. It reads only
 * through its ReaderCtx, whose every call goes through paths.ts containment (nothing outside the entry's folder is listed, stated
 * or read), with the size caps of library/contract.ts. Readers never decide a licence: they may name a row's own licence (an icon
 * set's) and credit text; the index asks core licenceDuties what that licence means.
 */
import type { LedgerEntry, LibraryKind, LibraryReader, LibraryRow } from '@pulseframe/core';

export interface DirItem { name: string; type: 'file' | 'dir' }
export interface FileStat { size: number; mtimeMs: number }
export interface ReaderCtx {
  entry: LedgerEntry;
  /** Directory entries inside the item ('' = the item's folder). Links that stay inside are reported as what they lead to; links out are left out. */
  list(rel: string): Promise<DirItem[] | null>;
  stat(rel: string): Promise<FileStat | null>;
  /** Whole file, or null when missing, refused or larger than `max`. */
  read(rel: string, max: number): Promise<Buffer | null>;
  /** The first bytes of a file (null when missing or refused). */
  head(rel: string, n: number): Promise<Buffer | null>;
  shared: SharedData;
  /** A problem worth showing in the status (first 20 kept). */
  problem(reason: string): void;
  cancelled(): boolean;
}
export interface Piece { title: string; lengthSeconds?: number; bpm?: number; genre: string[]; mood: string[]; instruments: string[] }
export interface CldrWords { he: string[]; en: string[]; ttsHe?: string; ttsEn?: string }
export interface SharedData {
  /** CLDR annotations by code-point key (lower-case hex joined by '_', without FE0F). */
  cldr: Map<string, CldrWords>;
  /** Incompetech pieces.json by file name. */
  pieces: Map<string, Piece>;
}
export interface ReaderRow {
  /** Path inside the item ('' = the item itself, a file item). */
  rel: string;
  /** An icon inside a set file. */
  member?: string;
  kind: LibraryKind;
  title: string;
  author?: string;
  /** The row's own licence when it differs from the entry's (an icon set's). */
  licence?: { spdx?: string; custom?: string; url?: string };
  /** The row's own credit text (undefined = the entry's; null = none). */
  credit?: string | null;
  /** The credit names something the reader could not fill in (an Incompetech track without its pieces.json row). */
  creditUnresolved?: true;
  meta: LibraryRow['meta'];
  /** Extra search words (keywords, CLDR words, set names). */
  words: string[];
  bytes: number;
  /** null for a file item (checked by its ledger sha256 at use, not by its time). */
  mtimeMs: number | null;
  /** Lower-case extension: what the file is. */
  format: string;
  animated?: true;
}
export interface Reader {
  id: LibraryReader;
  /** First pass over every entry: gather what other entries' rows need (CLDR words, pieces.json). */
  collect?(ctx: ReaderCtx): Promise<void>;
  rows?(ctx: ReaderCtx, emit: (row: ReaderRow) => Promise<void>): Promise<void>;
}

export const extOf = (name: string): string => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(name); return m ? m[1]!.toLowerCase() : ''; };
export const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
export const stemOf = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
/** A readable title from a file name: separators to spaces, camelCase split. */
export const titleFromName = (name: string): string => stemOf(name).replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().slice(0, 200);
export const cut = (s: unknown, n = 200): string => (typeof s === 'string' ? s : '').trim().slice(0, n);
export const list = (s: unknown): string[] => (Array.isArray(s) ? s : typeof s === 'string' ? s.split(/[,;|]/) : []).map((x) => cut(x, 64)).filter(Boolean).slice(0, 32);

/** Recursive walk of an item's files (depth ≤ 12, at most `max` files), in name order so the index is deterministic. */
export async function walk(ctx: ReaderCtx, rel: string, onFile: (rel: string, name: string) => Promise<void>, max = 250_000): Promise<void> {
  let seen = 0;
  const go = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || ctx.cancelled()) return;
    const items = await ctx.list(dir);
    if (!items) return;
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const it of items) {
      if (ctx.cancelled()) return;
      const r = dir ? `${dir}/${it.name}` : it.name;
      if (it.name.startsWith('.')) continue; // .git and other hidden folders and files
      if (it.type === 'dir') await go(r, depth + 1);
      else {
        if (++seen > max) { ctx.problem(`${ctx.entry.item}: more than ${max} files; the rest were not read`); return; }
        await onFile(r, it.name);
      }
    }
  };
  await go(rel, 0);
}

/** Width, height and whether a PNG is animated (an acTL chunk before the first IDAT), from its first bytes. */
export function pngInfo(b: Buffer): { width: number; height: number; animated: boolean } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  let animated = false;
  for (let o = 8; o + 8 <= b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8);
    if (type === 'acTL') { animated = true; break; }
    if (type === 'IDAT') break;
    o += 12 + len;
  }
  return { width, height, animated };
}
/** Whether a GIF holds more than one picture (counted from its first bytes; a long GIF is treated as animated). */
export function gifAnimated(b: Buffer): boolean {
  if (b.toString('latin1', 0, 3) !== 'GIF') return false;
  return b.includes(Buffer.from('NETSCAPE2.0', 'latin1')) || b.indexOf(0x2c, 13) !== b.lastIndexOf(0x2c);
}
/** Code-point key: lower-case hex joined by '_', without the variation selector FE0F. */
export const cpKey = (points: number[]): string => points.filter((p) => p !== 0xfe0f).map((p) => p.toString(16)).join('_');
export const cpKeyOfText = (s: string): string => cpKey([...s].map((c) => c.codePointAt(0)!));
