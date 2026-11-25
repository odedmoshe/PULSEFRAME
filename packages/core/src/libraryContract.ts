/**
 * The content library on disk (wave 7, library track; .artifacts/wave7/library-decisions.md). The lead's contract between the
 * fetch tool's ledger (tools/library/fetch.mjs, types fetch.d.mts:72-76), the server's catalogue (apps/server/src/library, worker
 * A), the licence duties (libraryDuties.ts, libraryCredits.ts, libraryOps.ts, worker B) and the editor (apps/web/src/editor/library,
 * worker C). Pure types and schemas; the only body here is currentEntries, which IS the rule the tool itself follows.
 *
 * - The ledger is read with a zod mirror that accepts unknown keys and refuses any ledgerVersion but 1 (as fetch.mjs:554 does).
 * - Several entries may name one item (re-fetches). The current one is the LAST APPENDED (fetch.mjs:564 findLast), never the
 *   one with the latest `time`: a hand-edited ledger may disagree with its own times, and the tool's rule wins.
 * - Rows are what the readers make of an entry's tree. A row that cannot be used stays listed with its `unusable` reason.
 */
import { z } from 'zod';
import { LIBRARY_KINDS, CREDIT_PLACEMENTS, RationalTimeSchema, type LibraryKind } from './schema.ts';

// ---------- the ledger (tools/library/fetch.d.mts LedgerEntry) ----------
export const LEDGER_KINDS = ['file', 'archive', 'npm', 'git'] as const;
export const LedgerLicenceSchema = z.looseObject({ spdx: z.string().optional(), custom: z.string().optional(), url: z.string(), readOn: z.string(), quote: z.string() });
export const LedgerEntrySchema = z.looseObject({
  item: z.string().min(1), source: z.string().min(1), sourceTitle: z.string(), manifest: z.string(), manifestSha256: z.string(),
  kind: z.enum(LEDGER_KINDS), identity: z.string(), url: z.string(),
  /** The item's destination under the library root, forward slashes (fetch.mjs checkDest). */
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(), pinned: z.boolean(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(), downloadBytes: z.number().int().nonnegative().optional(), files: z.number().int().nonnegative().optional(),
  treeSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(), integrity: z.string().optional(), version: z.string().optional(), commit: z.string().optional(),
  licence: LedgerLicenceSchema, credit: z.string().nullable(), flags: z.record(z.string(), z.boolean()),
  warnings: z.array(z.string()).optional(), time: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const LedgerSchema = z.looseObject({
  ledgerVersion: z.literal(1),
  /** Each entry is validated on its own by the catalogue: a bad entry is counted and named, never fatal (LibraryStatus.problems). */
  entries: z.array(z.unknown()),
  licenceTexts: z.array(z.looseObject({ source: z.string(), url: z.string(), sha256: z.string().optional(), file: z.string().optional() })).default([]),
});
export type Ledger = z.infer<typeof LedgerSchema>;
/** The ledger's place under the library root (fetch.mjs META). */
export const LEDGER_PATH = '_manifests/ledger.json';
/** The library's top folders (fetch.mjs LIB_DIRS); only music, sounds and visual hold listed kinds. */
export const LIBRARY_DIRS = ['music', 'sounds', 'visual', 'models', 'instruments'] as const;

/**
 * The current entry of every item: the last one appended for that item id (fetch.mjs:564 `findLast`), in the order the items
 * first appear. Entries that are not objects with a string `item` are skipped here (the catalogue reports them as problems).
 */
export function currentEntries<E extends { item: string }>(entries: readonly E[]): E[] {
  const last = new Map<string, E>();
  const order: string[] = [];
  for (const e of entries) { if (!last.has(e.item)) order.push(e.item); last.set(e.item, e); }
  return order.map((id) => last.get(id)!);
}

// ---------- the catalogue ----------
/** Why a listed row cannot be used. Shown with the row; `use` answers 409 library_item_unusable with it. */
export const LIBRARY_UNUSABLE = ['licence_unknown', 'licence_share_alike', 'licence_no_derivatives', 'credit_missing', 'credit_unresolved', 'animated', 'needs_svg_rasteriser'] as const;
export type LibraryUnusable = (typeof LIBRARY_UNUSABLE)[number];
/** The readers of this build, chosen by source id (apps/server/src/library/readers). Entries of any other source are counted «לא נקרא». */
export const LIBRARY_READERS = ['generic-audio', 'incompetech', 'fluent-emoji', 'noto-emoji', 'iconify', 'cldr', 'generic-image'] as const;
export type LibraryReader = (typeof LIBRARY_READERS)[number];
/** Bumped whenever a reader changes what it makes: the index is rebuilt when the ledger hash or this number differs. */
export const LIBRARY_READERS_VERSION = 2; // 2: the index keeps the genre and mood facets (GET /library/facets)

/** One catalogue row, as GET /library/items answers it. `key` is percent-encoded in a route path. */
export interface LibraryRow {
  /** `${entry.item}/${relative path}` or `${entry.item}/${relative path}#${member}`. */
  key: string;
  /** The ledger item id. */
  entry: string;
  sourceId: string;
  kind: LibraryKind;
  title: string;
  author?: string;
  /** The id the core licence table knows (an exact SPDX id, or `custom:<sourceId>`), or the raw id when unknown. */
  licenceId: string;
  credit?: { text: string; placement: (typeof CREDIT_PLACEMENTS)[number] };
  /** What the duties say (libraryDuties.ts licenceDuties): computed at index time, never taken from the ledger alone. */
  duties: { credit: boolean; nonCommercial: boolean; shareable: boolean };
  badges: { people?: true; aiGenerated?: true; trademark?: true };
  /** The publisher's figures, for display and filtering only (never stored in a project as a measurement). */
  meta: { durationSeconds?: number; bpm?: number; key?: string; genre: string[]; mood: string[]; instruments: string[]; tags: string[]; unicode?: string; width?: number; height?: number; animated?: boolean };
  bytes: number;
  unusable?: LibraryUnusable;
}

/** The setup state of the library, in order of what is missing first. */
export const LIBRARY_STATES = ['not_configured', 'root_missing', 'ledger_missing', 'ledger_invalid', 'indexing', 'ready'] as const;
export type LibraryState = (typeof LIBRARY_STATES)[number];
export interface LibraryStatus {
  state: LibraryState;
  /** The folder; only in the answer to the owner's own session (it may hold a user name). */
  root?: string;
  /** Rows by kind (ready, or the previous index while indexing). */
  counts: Partial<Record<LibraryKind, number>>;
  /** Ledger entries counted but not listed: instruments, models, fonts, maps, transitions, and sources without a reader. */
  notListed: { dir: string; entries: number }[];
  /** Rows not usable, by reason. */
  unusable: Partial<Record<LibraryUnusable, number>>;
  /** Bad ledger entries (first 20), with the reason; the rest of the ledger is still read. */
  problems: { item: string | null; reason: string }[];
  /** While indexing: rows read so far. */
  progress?: { rows: number; entriesDone: number; entriesTotal: number };
  /** ISO time the current index was built, or null. */
  indexedAt: string | null;
  /** Always null this wave: the ledger records no `--verify` time, so the status says «לא אומת מאז ההורדה». */
  verifiedAt: null;
  /** Whether this machine's ffmpeg can rasterise SVG (elements.ts canRasteriseSvg). */
  svgRasteriser: boolean;
}

// ---------- request bodies and queries (REST and MCP share them) ----------
export const LibraryRootBodySchema = z.object({ root: z.string().min(1).max(1024).nullable().describe('An absolute folder that holds _manifests/ledger.json, outside the data directory and the repository; null clears it') }).strict();
export const LIBRARY_PAGE_MAX = 200;
export const LibraryItemsQuerySchema = z.object({
  kind: z.enum(LIBRARY_KINDS).optional(),
  q: z.string().max(200).optional(),
  genre: z.string().max(64).optional(), mood: z.string().max(64).optional(),
  bpmMin: z.coerce.number().int().min(1).max(400).optional(), bpmMax: z.coerce.number().int().min(1).max(400).optional(),
  durMin: z.coerce.number().min(0).max(36000).optional(), durMax: z.coerce.number().min(0).max(36000).optional(),
  /** 'none' = only rows that need no credit. */
  credit: z.enum(['any', 'none']).optional(),
  /** 'allowed' = only rows the duties allow for commercial use. */
  commercial: z.enum(['any', 'allowed']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIBRARY_PAGE_MAX).optional(),
}).strict();
export type LibraryItemsQuery = z.infer<typeof LibraryItemsQuerySchema>;
export interface LibraryItemsPage { rows: LibraryRow[]; next: string | null; total: number }
export const LibraryUseBodySchema = z.object({
  key: z.string().min(1).max(400),
  start: RationalTimeSchema.optional().describe('Place it at this frame-aligned time (omit to only add the file to the project library)'),
  duration: RationalTimeSchema.optional(),
  trackId: z.string().optional(),
  /** One-colour icons only: the colour that replaces currentColor. */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  /** SVG items only: the long side of the PNG, 64..2048 (default 512). */
  longSide: z.number().int().min(64).max(2048).optional(),
}).strict();
export type LibraryUseBody = z.infer<typeof LibraryUseBodySchema>;
export interface LibraryUseResult { assetId: string; revision: number; deduplicated: boolean; recordAttached: boolean; jobId: string; placed: Record<string, unknown> | null; proposal?: unknown }
export const CreditsQuerySchema = z.object({ sequenceId: z.string().optional(), lang: z.enum(['he', 'en']).optional() }).strict();

/** GET /projects/:id/archive?library=…: «ארכיון לשיתוף» leaves restricted library files out, «ארכיון לעצמי» keeps all (owner only). */
export const ARCHIVE_LIBRARY_MODES = ['strip', 'keep'] as const;
export type ArchiveLibraryMode = (typeof ARCHIVE_LIBRARY_MODES)[number];

/** GET /library/facets?kind=…: the genres and moods the catalogue holds (the source's own words), each with its row count, most first. */
export const LibraryFacetsQuerySchema = z.object({ kind: z.enum(LIBRARY_KINDS).optional() }).strict();
export interface LibraryFacet { value: string; count: number }
export interface LibraryFacets { genre: LibraryFacet[]; mood: LibraryFacet[] }
/** At most this many values of each facet are answered. */
export const LIBRARY_FACETS_MAX = 100;
