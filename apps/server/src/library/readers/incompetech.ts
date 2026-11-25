/**
 * incompetech: pieces.json (a file item) gives each track's title, length, tempo, genre, feel and instruments, matched by file
 * name; every mp3 file item is a row. The ledger's credit is the publisher's text whose first word `Title` stands for the track
 * title (audio-01 manifest note): it is replaced by the pieces.json title; a track without its pieces.json row is unusable
 * (credit_unresolved). The publisher's figures are for display and filtering only.
 */
import { MAX_METADATA_BYTES } from '../contract.ts';
import { audioRow } from './genericAudio.ts';
import { baseOf, cut, extOf, list, walk, type Piece, type Reader } from './types.ts';

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
/** "m:ss", "h:mm:ss" or seconds. */
export function lengthSeconds(v: unknown): number | undefined {
  if (typeof v === 'string' && /^\d{1,3}(:\d{1,2}){1,2}$/.test(v.trim())) return v.trim().split(':').reduce((a, x) => a * 60 + Number(x), 0) || undefined;
  return num(v);
}
export function parsePieces(text: string): Map<string, Piece> {
  const out = new Map<string, Piece>();
  let data: unknown;
  try { data = JSON.parse(text); } catch { return out; }
  const arr = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data as object).find(Array.isArray) ?? Object.values(data as object) : [];
  for (const p of arr as unknown[]) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const filename = cut(o.filename, 300), title = cut(o.title, 200);
    if (!filename || !title) continue;
    const bpm = num(o.bpm);
    const lengthS = lengthSeconds(o.length);
    out.set(filename, { title, ...(lengthS ? { lengthSeconds: lengthS } : {}), ...(bpm && bpm <= 400 ? { bpm } : {}), genre: list(o.genre), mood: list(o.feel ?? o.mood), instruments: list(o.instruments) });
  }
  return out;
}
export const incompetech: Reader = {
  id: 'incompetech',
  async collect(ctx) {
    const e = ctx.entry;
    if (e.kind !== 'file' || baseOf(e.path) !== 'pieces.json') return;
    const b = await ctx.read('', MAX_METADATA_BYTES);
    if (!b) return ctx.problem(`${e.item}: pieces.json could not be read`);
    for (const [k, v] of parsePieces(b.toString('utf8'))) ctx.shared.pieces.set(k, v);
  },
  async rows(ctx, emit) {
    const e = ctx.entry;
    const one = async (rel: string, name: string, bytes: number, mtimeMs: number | null) => {
      const row = audioRow(ctx, rel, name, bytes, mtimeMs);
      const piece = ctx.shared.pieces.get(name);
      const credit = e.credit ?? null;
      if (piece) {
        row.title = piece.title;
        row.meta = { ...(piece.lengthSeconds ? { durationSeconds: piece.lengthSeconds } : {}), ...(piece.bpm ? { bpm: piece.bpm } : {}), genre: piece.genre, mood: piece.mood, instruments: piece.instruments, tags: [] };
        if (credit !== null && /^Title\b/.test(credit)) row.credit = piece.title + credit.slice('Title'.length);
      } else if (credit !== null && /^Title\b/.test(credit)) row.creditUnresolved = true;
      row.author = 'Kevin MacLeod';
      await emit(row);
    };
    if (e.kind === 'file') {
      if (extOf(e.path) === 'mp3') await one('', baseOf(e.path), e.bytes, null);
      return;
    }
    await walk(ctx, '', async (rel, name) => {
      if (extOf(name) !== 'mp3') return;
      const st = await ctx.stat(rel);
      if (st) await one(rel, name, st.size, st.mtimeMs);
    });
  },
};
