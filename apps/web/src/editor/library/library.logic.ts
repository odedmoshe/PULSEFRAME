/**
 * The logic of the library panels (wave 7 library track), apart from React: the query a filter set makes, the buckets of the
 * tempo and length chips, what a row shows, the state a status answer puts the panel in, the use body, the badges of a project
 * file, the credit lines of an export job's output and the archive choice. Components stay thin; everything here is pure.
 * The server's answers are the contract types of core (libraryContract.ts, libraryCredits.ts); a refusal is worded by the shared
 * tables (packages/i18n), never composed here.
 */
import type { Asset, ArchiveLibraryMode, LibraryItemsQuery, LibraryKind, LibraryRow, LibraryStatus, LibraryUseBody, LibraryUnusable } from '@pulseframe/core';
import { dictionaries, type Lang } from '@pulseframe/i18n';

/** The kinds each drawer lists, in the order of its kind switch. */
export const AUDIO_KINDS: readonly LibraryKind[] = ['music', 'sound', 'loop'];
export const VISUAL_KINDS: readonly LibraryKind[] = ['sticker', 'icon', 'illustration', 'texture', 'backdrop', 'video'];
export const isAudioKind = (k: LibraryKind): boolean => AUDIO_KINDS.includes(k);
export const PAGE_SIZE = 40;
export const OWNER_ACTOR = 'user:local';
/** The owner's own session is the only one that sets the folder, scans again and archives «לעצמי». */
export const isOwnerActor = (actor: string | null): boolean => actor === OWNER_ACTOR;

// ---------- filters and their query ----------
export type TempoBucket = 'slow' | 'mid' | 'fast';
export type LengthBucket = 'short' | 'mid' | 'long';
export interface LibraryFilters { genre?: string; mood?: string; tempo?: TempoBucket; length?: LengthBucket; noCredit: boolean; commercial: boolean }
export const NO_FILTERS: LibraryFilters = { noCredit: false, commercial: false };
/** BPM ranges, inclusive; the chips are named by their numbers, not by words the contract does not carry. */
export const TEMPO_BUCKETS: Record<TempoBucket, { min?: number; max?: number }> = { slow: { max: 89 }, mid: { min: 90, max: 130 }, fast: { min: 131 } };
/** Seconds, inclusive. */
export const LENGTH_BUCKETS: Record<LengthBucket, { min?: number; max?: number }> = { short: { max: 59 }, mid: { min: 60, max: 180 }, long: { min: 181 } };
export const TEMPO_ORDER: readonly TempoBucket[] = ['slow', 'mid', 'fast'];
export const LENGTH_ORDER: readonly LengthBucket[] = ['short', 'mid', 'long'];

/** "1:07" / "12:05" for a length in whole seconds (a digit string, shown in the .num style). */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** "<90", "90–130", "131+" with the unit left to the caller. */
export function tempoLabel(b: TempoBucket): string { const r = TEMPO_BUCKETS[b]; return r.min === undefined ? `<${r.max! + 1}` : r.max === undefined ? `${r.min}+` : `${r.min}–${r.max}`; }
/** "0:00–0:59", "1:00–3:00", "3:01+". */
export function lengthLabel(b: LengthBucket): string { const r = LENGTH_BUCKETS[b]; return r.min === undefined ? `0:00–${formatLength(r.max!)}` : r.max === undefined ? `${formatLength(r.min)}+` : `${formatLength(r.min)}–${formatLength(r.max)}`; }

/** The GET /library/items query of a kind, a search text, the filters and a page cursor. Empty text and unset filters are left out. */
export function queryOf(kind: LibraryKind, text: string, f: LibraryFilters, cursor?: string | null): LibraryItemsQuery {
  const q: LibraryItemsQuery = { kind, limit: PAGE_SIZE };
  const t = text.trim();
  if (t) q.q = t;
  if (isAudioKind(kind)) {
    if (f.genre) q.genre = f.genre;
    if (f.mood) q.mood = f.mood;
    if (f.tempo) { const r = TEMPO_BUCKETS[f.tempo]; if (r.min !== undefined) q.bpmMin = r.min; if (r.max !== undefined) q.bpmMax = r.max; }
    if (f.length) { const r = LENGTH_BUCKETS[f.length]; if (r.min !== undefined) q.durMin = r.min; if (r.max !== undefined) q.durMax = r.max; }
  }
  if (f.noCredit) q.credit = 'none';
  if (f.commercial) q.commercial = 'allowed';
  if (cursor) q.cursor = cursor;
  return q;
}
export const hasHebrew = (s: string): boolean => /[֐-׿]/.test(s);
/** True when any filter narrows the list (the empty state then says nothing matched, not that the library is empty). */
export const filtersActive = (f: LibraryFilters, text: string): boolean => !!(text.trim() || f.genre || f.mood || f.tempo || f.length || f.noCredit || f.commercial);


// ---------- the panel's state from the status ----------
export type PanelState =
  | { kind: 'loading' }
  | { kind: 'not_built' }
  | { kind: 'setup'; state: 'not_configured' | 'root_missing' | 'ledger_missing' | 'ledger_invalid' }
  | { kind: 'indexing'; rows: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };
export interface FailureLike { status?: number; code?: string; message?: string; hint?: string }
/** What the panel shows for the status answer (or the failure of asking for it). A 501 library_not_built is its own state, never an error. */
export function panelState(status: LibraryStatus | null, failure: FailureLike | null, say: (f: FailureLike) => string): PanelState {
  if (failure) return failure.code === 'library_not_built' || failure.status === 501 ? { kind: 'not_built' } : { kind: 'error', message: say(failure) };
  if (!status) return { kind: 'loading' };
  if (status.state === 'indexing') return { kind: 'indexing', rows: status.progress?.rows ?? 0 };
  if (status.state === 'ready') return { kind: 'ready' };
  return { kind: 'setup', state: status.state };
}
/** Rows the library lists for these kinds, from the status counts (the previous index while indexing). */
export const countOf = (status: LibraryStatus | null, kinds: readonly LibraryKind[]): number => kinds.reduce((n, k) => n + (status?.counts[k] ?? 0), 0);
/** The kinds of a drawer that have rows, music and sounds always (so the empty music state has its switch), the rest only with rows. */
export function shownKinds(status: LibraryStatus | null, kinds: readonly LibraryKind[]): LibraryKind[] {
  return kinds.filter((k) => (status?.counts[k] ?? 0) > 0 || k === 'music' || k === 'sound' || (kinds === VISUAL_KINDS && k === 'sticker'));
}

// ---------- what a row shows ----------
export type BadgeId = 'nonCommercial' | 'credit' | 'people' | 'aiGenerated' | 'trademark' | 'diskOnly';
/** The badges of a catalogue row, most restrictive first; each is also a word, never colour alone. */
export function rowBadges(row: LibraryRow): BadgeId[] {
  const out: BadgeId[] = [];
  if (row.duties.nonCommercial) out.push('nonCommercial');
  if (row.duties.credit) out.push('credit');
  if (row.badges.people) out.push('people');
  if (row.badges.aiGenerated) out.push('aiGenerated');
  if (row.badges.trademark) out.push('trademark');
  if (!row.duties.shareable) out.push('diskOnly');
  return out;
}
export const badgeText = (lang: Lang, id: BadgeId): string => dictionaries[lang][`library.badge.${id}` as const];
export const kindText = (lang: Lang, k: LibraryKind): string => dictionaries[lang][`library.kind.${k}` as const];
export const unusableText = (lang: Lang, u: LibraryUnusable): string => dictionaries[lang][`library.unusable.${u}` as const];
export const stateText = (lang: Lang, s: LibraryStatus['state']): string => dictionaries[lang][`library.state.${s}` as const];

/** Decimal file size: "37.6 MB", "412 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
/** The publisher's tempo (a number) or nothing; the word for «no tempo given» is the caller's. */
export const tempoOf = (row: LibraryRow): number | null => (row.meta.bpm !== undefined ? Math.round(row.meta.bpm) : null);
/** m4a (ALAC) cannot be auditioned in the browser: the route answers 415, so the control says so before the click. */
export const auditionable = (row: LibraryRow): boolean => !/\.m4a(#|$)/i.test(row.key);
/** True for a row whose thumbnail is 256 px or less in its long side: the sticker note «רך מעל רבע מהמסך» applies. */
export const isSoft = (row: LibraryRow): boolean => row.kind === 'sticker' && Math.max(row.meta.width ?? 0, row.meta.height ?? 0) > 0 && Math.max(row.meta.width ?? 0, row.meta.height ?? 0) <= 256;
/** Only one-colour icons take a colour; everything else keeps its own. */
export const takesColour = (kind: LibraryKind): boolean => kind === 'icon';

/** The use_library_item body: the time at the playhead (frame-aligned by the editor), the target track of its media kind if one is chosen. */
export function useBody(row: LibraryRow, at: { start: NonNullable<LibraryUseBody['start']>; trackId: string | null; color?: string }): LibraryUseBody {
  const b: LibraryUseBody = { key: row.key, start: at.start };
  if (at.trackId) b.trackId = at.trackId;
  if (takesColour(row.kind) && at.color && /^#[0-9A-Fa-f]{6}$/.test(at.color)) b.color = at.color.toUpperCase();
  return b;
}

// ---------- the project file card ----------
export type AssetBadge = Extract<BadgeId, 'nonCommercial' | 'credit' | 'people' | 'aiGenerated'>;
/** The badges of a project file copied from the library, from its own record (never from the live catalogue). */
export function assetBadges(asset: Pick<Asset, 'provenance'>): AssetBadge[] {
  const lib = asset.provenance?.library;
  if (!lib) return [];
  const out: AssetBadge[] = [];
  if (lib.flags.nonCommercial) out.push('nonCommercial');
  if (lib.credit) out.push('credit');
  if (lib.flags.people) out.push('people');
  if (lib.flags.aiGenerated) out.push('aiGenerated');
  return out;
}

// ---------- the export job's licence lines ----------
export interface ExportLicence { nonCommercial: string[]; credits: { lines: number; descriptionText: string } | null; people: number }
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/**
 * Read output.licence of a finished export job; null when the job holds none. The server writes it (apps/server/src/export.ts
 * exportLicence): core's CreditsView without its descriptionText — `lines`, `onScreenMissing`, `nonCommercial` and `people` (each
 * an array of {assetId, title, …}) — plus `credits: {descriptionText, file}`. Shapes it does not know are skipped, not guessed.
 */
export function exportLicence(output: Record<string, unknown> | null | undefined): ExportLicence | null {
  const l = output?.licence;
  if (!isRec(l)) return null;
  const nc = Array.isArray(l.nonCommercial) ? l.nonCommercial.map((x) => (isRec(x) && typeof x.title === 'string' ? x.title : '')).filter(Boolean) : [];
  const c = isRec(l.credits) ? l.credits : null;
  const text = c && typeof c.descriptionText === 'string' ? c.descriptionText : '';
  const lines = Array.isArray(l.lines) ? l.lines.length : 0;
  return { nonCommercial: [...new Set(nc)], credits: lines > 0 && text ? { lines, descriptionText: text } : null, people: Array.isArray(l.people) ? l.people.length : 0 };
}

// ---------- the archive choice ----------
/** Library files of the project that may not be passed on (diskOnly), by their record. */
export function restrictedAssets(assets: Record<string, Pick<Asset, 'provenance' | 'name'>>): { id: string; title: string }[] {
  return Object.entries(assets).filter(([, a]) => a.provenance?.library?.flags.diskOnly).map(([id, a]) => ({ id, title: a.provenance.library!.title || a.name }));
}
/** The sharing archive is the safe default (the server answers 409 without a choice); «לעצמי» is offered to the owner's session only. */
export const archiveModes = (owner: boolean): ArchiveLibraryMode[] => (owner ? ['strip', 'keep'] : ['strip']);
/** A link with the library choice added (the project manager's archive link: the owner's own copy keeps everything). */
export const ownerArchiveHref = (projectId: string): string => `/api/v1/projects/${encodeURIComponent(projectId)}/archive?library=keep`;

/** «אין האזנה מקדימה לקובץ מסוג זה» (server code library_audio_unsupported), shared with the route's refusal. */
export const audioUnsupportedText = (lang: Lang): string => dictionaries[lang]['error.code.library_audio_unsupported'];
