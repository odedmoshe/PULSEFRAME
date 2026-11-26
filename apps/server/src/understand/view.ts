/**
 * The read side of «מה יש בקליפ» (wave 8 `understand`; contract.ts UnderstandView). LEAD PRE-PASS: signatures; BUILDER W1 (opus)
 * owns this file and writes the bodies over core understand.ts (shotsPage, notesPage, notesFor, searchNotes) and notesDb.ts getNotes:
 * - which notes apply to an asset: core notesFor (own pointer or the nearest time-preserving source's), read with getNotes by
 *   (content hash, pointer.producer) and checked against pointer.data (a digest that differs = not found, never shown);
 * - every answer passes its core shape; 404 asset_not_found / 409 no_picture / 400 invalid_cursor from UNDERSTAND_API;
 * - notes are given to every credential (decision 6): no actsAsOwner here.
 * Until W1 builds it every function answers 501 understand_not_built.
 */
import type Database from 'better-sqlite3';
import type { FootageNotesData, ProjectDocument } from '@pulseframe/core';
import { understandError, type UnderstandView } from './contract.ts';

/** The view over this database. */
export function createUnderstandView(_db: Database.Database): UnderstandView {
  return {
    shots: () => { throw understandError('notBuilt'); },
    notes: () => { throw understandError('notBuilt'); },
  };
}
/**
 * The notes of the document's picture assets, by asset id (the search section «לפי מה שתואר», search/answer.ts W1; search/runtime.ts
 * passes it in PictureContext.notes). Only notes a pointer names and whose digest matches. W1.
 */
export function notesMapFor(_db: Database.Database, _doc: ProjectDocument): ReadonlyMap<string, FootageNotesData> {
  throw understandError('notBuilt');
}
