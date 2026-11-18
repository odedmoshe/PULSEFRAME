/**
 * Pure logic of the import cards and the folder import (ADR-0023), unit-tested without a browser (imports.logic.test.ts).
 *
 * LEAD STUB (wave 5 pre-pass): the signatures are the contract; W3 writes the bodies (plan §7 with the verifier's corrections).
 * Until then every function refuses.
 * - planFolderImport: media extensions only, hidden and system files skipped (a name or a folder starting with '.', Thumbs.db,
 *   desktop.ini, __MACOSX), natural sort by path, at most FOLDER_IMPORT_CAP files; the counts of what was skipped and why.
 * - collectDropped: webkitGetAsEntry, and readEntries called until it returns an empty batch (it yields at most 100 a call).
 *   Tested with fakes only (a fake directory of 250 entries), which the test says.
 * - cardText: the card's chip and sub-text from importCardState (core) and the strings modules.
 * - Placement: one file after another, in the order dropped; a failed file is skipped and the next one goes where it would have.
 *   Keyed by Map, never by a plain object (an id may name an Object.prototype member).
 */
import type { ImportJobView } from '@pulseframe/core';
import type { LocalImport } from './imports.ts';

const notBuilt = (what: string): never => { throw new Error(`${what} is not built yet (import cards, ADR-0023, W3)`); };

/** A dropped folder is imported up to this many files at once. */
export const FOLDER_IMPORT_CAP = 500;
/** A file the folder walk found, with its path inside the dropped folder ('a/b/IMG_1.jpg'). */
export interface PickedFile { name: string; relativePath: string; size: number }
export interface FolderPlan<F extends PickedFile> { files: F[]; skipped: { notMedia: number; hidden: number; tooMany: number } }
export function planFolderImport<F extends PickedFile>(files: F[]): FolderPlan<F> { return notBuilt(`planFolderImport(${files.length})`); }

/** The parts of the File and Directory Entries API the walk uses (fakes implement these in the test). */
export interface FsEntryLike { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?(ok: (f: File) => void, fail: (e: unknown) => void): void; createReader?(): { readEntries(ok: (batch: FsEntryLike[]) => void, fail: (e: unknown) => void): void } }
export interface DroppedItemLike { kind: string; webkitGetAsEntry(): FsEntryLike | null; getAsFile(): File | null }
/** Every file of a drop (folders walked), with its path inside the dropped folder. */
export function collectDropped(items: ArrayLike<DroppedItemLike>): Promise<{ file: File; relativePath: string }[]> { return Promise.reject(new Error(`collectDropped(${items.length}) is not built yet (import cards, ADR-0023, W3)`)); }

/** What a card says: its chip and, when there is one, the line under it. */
export function cardText(item: { kind: 'job'; view: ImportJobView } | { kind: 'local'; local: LocalImport }, lang: 'he' | 'en'): { chip: string; detail: string | null } { return notBuilt(`cardText(${item.kind}, ${lang})`); }

/** Where the files of one timeline drop go: in the order dropped, each after the previous clip. */
export interface PlacementState { order: string[]; finished: Map<string, string | null>; nextIndex: number; at: { frame: number; trackId: string | null } | null; placing: boolean }
export type PlacementEvent = { kind: 'finished'; localId: string; assetId: string | null } | { kind: 'placed'; nextFrame: number | null };
export function startPlacement(order: string[], at: { frame: number; trackId: string | null }): PlacementState { return notBuilt(`startPlacement(${order.length}, ${at.frame})`); }
/** The next state, and the file to place now (null = nothing to place yet, or the chain is done). */
export function placementStep(s: PlacementState, ev: PlacementEvent): { state: PlacementState; place: { localId: string; assetId: string; frame: number; trackId: string | null } | null } { return notBuilt(`placementStep(${s.order.length}, ${ev.kind})`); }
