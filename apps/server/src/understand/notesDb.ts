/**
 * Where footage notes live (wave 8 `understand`; verify C12, C13, D6). LEAD PRE-PASS, complete: the two tables in the MAIN database
 * (so the online SQLite backup holds them: notes are small and a cloud model's are costly to rebuild) and their reads and writes.
 * BUILDER W2 owns this file after the pre-pass (it may add queries; the table shapes and the functions below are the contract W1 reads).
 *
 *   footage_notes       one COMPLETE notes file per (content hash, producer): the composed FootageNotesData as JSON text, its digest
 *                       ('sha256:' + sha256 of the text: the document pointer's `data`), counts and the model. Several producers per
 *                       file coexist (a cloud run is never overwritten by a local one).
 *   footage_note_spans  the resume scratch: one validated span per (content hash, producer, key frames) — keyed by the KEY FRAMES, not
 *                       the span index (C12), so a span whose frames did not change after re-spanning is reused, never paid twice.
 *
 * Nothing here is shown to anyone without passing FootageNotesDataSchema / NoteSpanSchema again on the way out.
 */
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { FootageNotesDataSchema, NoteSpanSchema, type FootageNotesData, type NoteSpan } from '@pulseframe/core';

export const NOTES_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS footage_notes (
    asset_hash TEXT NOT NULL, producer TEXT NOT NULL, json TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL,
    spans INTEGER NOT NULL, described INTEGER NOT NULL, failed INTEGER NOT NULL, model TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (asset_hash, producer));
  CREATE TABLE IF NOT EXISTS footage_note_spans (
    asset_hash TEXT NOT NULL, producer TEXT NOT NULL, keys TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (asset_hash, producer, keys));
`;
const ready = new WeakSet<Database.Database>();
/** Creates the two tables once per connection (idempotent). Every function below calls it. */
export function ensureNotesTables(db: Database.Database): void {
  if (ready.has(db)) return;
  db.exec(NOTES_TABLES_SQL);
  ready.add(db);
}
const now = () => new Date().toISOString();
/** The digest the document pointer carries for a stored notes text. */
export const notesDigest = (json: string): string => `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
/** The key of a scratch row: the span's key frames, ascending, joined by ','. */
export const spanKey = (keys: readonly number[]): string => [...keys].sort((a, b) => a - b).join(',');

/** Store a complete notes file (validated first; a file that fails its schema throws and nothing is written). Returns its digest. */
export function putNotes(db: Database.Database, data: FootageNotesData): { digest: string; bytes: number } {
  ensureNotesTables(db);
  const parsed = FootageNotesDataSchema.parse(data);
  const json = JSON.stringify(parsed);
  const digest = notesDigest(json);
  const described = parsed.spans.filter((s) => s.state === 'described').length;
  db.prepare('INSERT INTO footage_notes (asset_hash, producer, json, digest, bytes, spans, described, failed, model, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_hash, producer) DO UPDATE SET json = excluded.json, digest = excluded.digest, bytes = excluded.bytes, spans = excluded.spans, described = excluded.described, failed = excluded.failed, model = excluded.model, updated_at = excluded.updated_at')
    .run(parsed.contentHash, parsed.producer.id, json, digest, Buffer.byteLength(json), parsed.spans.length, described, parsed.spans.length - described, parsed.producer.model, now());
  return { digest, bytes: Buffer.byteLength(json) };
}
/** A complete notes file, or null. `digest` lets a reader check it is the one a pointer names (pointer.data). */
export function getNotes(db: Database.Database, contentHash: string, producer: string): { data: FootageNotesData; digest: string } | null {
  ensureNotesTables(db);
  const r = db.prepare('SELECT json, digest FROM footage_notes WHERE asset_hash = ? AND producer = ?').get(contentHash, producer) as { json: string; digest: string } | undefined;
  if (!r) return null;
  const parsed = FootageNotesDataSchema.safeParse(JSON.parse(r.json));
  return parsed.success ? { data: parsed.data, digest: r.digest } : null;
}
/** The producers that have a complete file for this content hash (counts and model, no text). */
export function notesRows(db: Database.Database, contentHash: string): { producer: string; model: string; spans: number; described: number; failed: number; digest: string; updatedAt: string }[] {
  ensureNotesTables(db);
  return db.prepare('SELECT producer, model, spans, described, failed, digest, updated_at AS updatedAt FROM footage_notes WHERE asset_hash = ? ORDER BY updated_at').all(contentHash) as never;
}
/** Write one validated span to the resume scratch at once (C12). */
export function putSpan(db: Database.Database, contentHash: string, producer: string, span: NoteSpan): void {
  ensureNotesTables(db);
  const s = NoteSpanSchema.parse(span);
  db.prepare('INSERT INTO footage_note_spans (asset_hash, producer, keys, json, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(asset_hash, producer, keys) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
    .run(contentHash, producer, spanKey(s.keys), JSON.stringify(s), now());
}
/** The scratch spans of a file and producer, by spanKey (rows that no longer parse are left out). */
export function getSpans(db: Database.Database, contentHash: string, producer: string): Map<string, NoteSpan> {
  ensureNotesTables(db);
  const out = new Map<string, NoteSpan>();
  for (const r of db.prepare('SELECT keys, json FROM footage_note_spans WHERE asset_hash = ? AND producer = ?').iterate(contentHash, producer) as Iterable<{ keys: string; json: string }>) {
    const p = NoteSpanSchema.safeParse(JSON.parse(r.json));
    if (p.success) out.set(r.keys, p.data);
  }
  return out;
}
