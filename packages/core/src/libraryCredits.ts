/**
 * Credits and the archive rule of library content (wave 7 library track). WORKER B builds the bodies; signatures are the lead's.
 * Pure over the document, so the editor's panel, the export job and the archive route compute the same thing.
 *
 * collectCredits (plan §4.3): walk the clips of the sequence in timeline order (start, then track order); a muted or hidden clip
 * still counts (over-crediting is harmless); each asset's provenance.library.credit verbatim, exact repeats dropped; groups music,
 * then sounds, then pictures and video. descriptionText(lang): one heading line, then each credit with a blank line between, then,
 * if any, «לשימוש לא מסחרי בלבד: <titles>» (English "For non-commercial use only: <titles>"). Credit strings are never translated
 * or re-wrapped. onScreenMissing: credits with placement on_screen whose whitespace-normalised text appears in no title clip on a
 * visible track of the sequence (the owner's own title satisfies it, not only our card).
 */
import * as T from '@pulseframe/time';
import type { Asset, LibraryRecord, ProjectDocument } from './schema.ts';
import { recordNeedsCredit, recordShareable } from './libraryDuties.ts';
import type { SourceRecord, SourceWarning } from './sourcesContract.ts';
import { sourceDuties } from './sourceDuties.ts';

export interface CreditLine {
  assetId: string; title: string; text: string; placement: 'description' | 'on_screen' | 'either'; group: 'music' | 'sound' | 'picture';
  /**
   * 'shortened' when the sequence plays a song made from this library file by «התאמה לאורך» (wave 7 musicfit: provenance.fitted, which
   * carries the source's record). The licence (CC BY) asks that a change be indicated: the description adds MODIFIED_LINE after the
   * credit, on its own line; the credit itself stays verbatim.
   */
  modified?: 'shortened';
}
export interface CreditsReport {
  lines: CreditLine[];
  /** The text to paste in the video's description, in the chosen language. */
  descriptionText: (lang: 'he' | 'en') => string;
  /** on_screen credits not found in any visible title of the sequence. */
  onScreenMissing: CreditLine[];
  /** Titles of non-commercial library files used in the sequence. */
  nonCommercial: { assetId: string; title: string }[];
  /** Library files flagged as showing people (stock footage). */
  people: { assetId: string; title: string }[];
  /** wave 8 sources (W1): the licence and term warnings of the source files in the sequence (sourceDuties), in timeline order; absent when there are none, so library-only answers stay byte-identical. */
  licenceNotes?: SourceWarning[];
}
/** The JSON shape of a CreditsReport (GET /projects/:id/credits, MCP get_credits, the export job's output.licence). */
export interface CreditsView { lines: CreditLine[]; descriptionText: string; onScreenMissing: CreditLine[]; nonCommercial: { assetId: string; title: string }[]; people: { assetId: string; title: string }[]; /** wave 8 sources (W1): as CreditsReport.licenceNotes; absent when none */ licenceNotes?: SourceWarning[] }

export interface ArchiveLibraryPlan {
  /** Content hashes (sha256:…) a shared archive leaves out: restricted library files and their conform originals. */
  omit: string[];
  omitted: { hash: string; assetId: string; itemId: string; title: string; licenceId: string }[];
  notices: { title: string; licenceId: string; credit: string | null; url: string | null }[];
}

/** The heading line of the description text and of the credits card. */
export const CREDITS_HEADING = { he: 'קרדיטים', en: 'Credits' } as const;
/** The line that names the non-commercial files (the export warning says the same). */
export const NON_COMMERCIAL_LINE = { he: 'לשימוש לא מסחרי בלבד', en: 'For non-commercial use only' } as const;
/** The line after a credit whose music was shortened in the editor (wave 7 musicfit; CreditLine.modified). */
export const MODIFIED_LINE = { he: '(קוצר בעורך: הוסרו תיבות מהאמצע)', en: '(shortened in the editor: bars removed from the middle)' } as const;

/**
 * The library files an asset stems from: itself when it carries a library record, and, through provider results
 * (provenance.derived.sourceAssetIds) and generated speech made from a reference recording (provenance.voice.referenceAssetId),
 * every library file it was made from, and the instrument sources of built-in music made with recorded instruments
 * (provenance.instruments.records: one pair per record, all with that asset). A file made from a library file carries its duties: its
 * credit, its non-commercial mark and the archive rule. Cycles and missing ids are ignored. In the order met, without repeats.
 */
export function libraryOrigins(doc: ProjectDocument, assetId: string): { asset: Asset; record: LibraryRecord }[] {
  const out: { asset: Asset; record: LibraryRecord }[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !Object.hasOwn(doc.assets, id)) return;
    seen.add(id);
    const a = doc.assets[id]!;
    if (a.provenance.library) out.push({ asset: a, record: a.provenance.library });
    // built-in music made with recorded instruments (wave 7 instruments): one record per library source of its kit — the union of duties
    for (const r of a.provenance.instruments?.records ?? []) out.push({ asset: a, record: r });
    for (const s of a.provenance.derived?.sourceAssetIds ?? []) visit(s);
    if (a.provenance.voice?.referenceAssetId) visit(a.provenance.voice.referenceAssetId);
  };
  visit(assetId);
  return out;
}

/**
 * The licensed files an asset stems from, library AND source records (wave 8 `sources`, verify C3/C4; W1 builds the body). It walks
 * the same graph as libraryOrigins (itself, provenance.derived sources, the voice reference, instrument records) and also yields an
 * asset's provenance.source (a shortened copy carries its one source's record, C4a). W1 then moves collectCredits, creditDue,
 * shareable, archiveLibraryPlan, the export lines (export.ts) and the summary's part (queries.ts) onto it; for documents without a
 * source record every answer stays byte-identical to credits.golden.json (recorded before this file was touched).
 * `due`: the credit is a duty of its licence (library: recordNeedsCredit; source: credit.due). `licenceNotes`: the source warnings
 * (sourceDuties.ts) of this origin, empty for library records.
 */
export interface LicensedOrigin {
  asset: Asset; origin: 'library' | 'source';
  /** exactly one of the two, as `origin` says */ library?: LibraryRecord; source?: SourceRecord;
  title: string; creditText: string | null; placement: CreditLine['placement'] | null; due: boolean; group: CreditLine['group'];
  nonCommercial: boolean; people: boolean; shareable: boolean; licenceId: string; itemId: string; licenceNotes: SourceWarning[];
}
export function licensedOrigins(doc: ProjectDocument, assetId: string): LicensedOrigin[] {
  const out: LicensedOrigin[] = [];
  const seen = new Set<string>();
  const lib = (asset: Asset, record: LibraryRecord): LicensedOrigin => ({
    asset, origin: 'library', library: record, title: titleOf(asset, record), creditText: record.credit?.text ?? null, placement: record.credit?.placement ?? null,
    due: recordNeedsCredit(record), group: groupOf(record), nonCommercial: !!record.flags.nonCommercial, people: !!record.flags.people, shareable: recordShareable(record),
    licenceId: record.licence.id, itemId: record.itemId, licenceNotes: [],
  });
  const src = (asset: Asset, record: SourceRecord): LicensedOrigin => {
    const title = record.title || asset.name;
    return {
      asset, origin: 'source', source: record, title, creditText: record.credit?.text ?? null, placement: record.credit?.placement ?? null, due: record.credit?.due === true,
      group: sourceGroup(record), nonCommercial: record.flags.nonCommercial === true, people: record.flags.people === true, shareable: record.flags.notShareable !== true,
      licenceId: record.licence.id, itemId: record.itemId, licenceNotes: sourceDuties(record, title).map((w) => ({ ...w, assetId: asset.id })),
    };
  };
  const visit = (id: string) => {
    if (seen.has(id) || !Object.hasOwn(doc.assets, id)) return;
    seen.add(id);
    const a = doc.assets[id]!;
    if (a.provenance.library) out.push(lib(a, a.provenance.library));
    for (const r of a.provenance.instruments?.records ?? []) out.push(lib(a, r));
    // a fetched file, or a song shortened from one (it carries its one source's record, C4a)
    if (a.provenance.source) out.push(src(a, a.provenance.source));
    for (const s of a.provenance.derived?.sourceAssetIds ?? []) visit(s);
    if (a.provenance.voice?.referenceAssetId) visit(a.provenance.voice.referenceAssetId);
  };
  visit(assetId);
  return out;
}

const groupOf = (r: LibraryRecord): CreditLine['group'] => (r.kind === 'music' || r.kind === 'loop' ? 'music' : r.kind === 'sound' ? 'sound' : 'picture');
const sourceGroup = (r: SourceRecord): CreditLine['group'] => (r.kind === 'music' ? 'music' : r.kind === 'sound' ? 'sound' : 'picture');
const GROUP_ORDER: readonly CreditLine['group'][] = ['music', 'sound', 'picture'];
/** Whitespace-normalised text, for finding a credit inside a title. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const titleOf = (asset: Asset, r: LibraryRecord) => r.title || asset.name;

/** The description text of a report's parts (empty when there is nothing to say). Credit strings are written verbatim. */
function describe(lines: readonly CreditLine[], nonCommercial: readonly { title: string }[], lang: 'he' | 'en'): string {
  const parts: string[] = [];
  if (lines.length) parts.push(CREDITS_HEADING[lang], ...lines.map((l) => (l.modified ? `${l.text}\n${MODIFIED_LINE[lang]}` : l.text)));
  if (nonCommercial.length) parts.push(`${NON_COMMERCIAL_LINE[lang]}: ${nonCommercial.map((n) => n.title).join(', ')}`);
  return parts.join('\n\n');
}

/**
 * The credits of a sequence (default the main one). Refuses an unknown sequence id with an Error whose `code` is 'not_found'.
 * Every media clip counts, muted or hidden ones too, with its file and the library files that file was made from.
 */
export function collectCredits(doc: ProjectDocument, opts: { sequenceId?: string } = {}): CreditsReport {
  const seqId = opts.sequenceId ?? doc.mainSequenceId;
  const seq = Object.hasOwn(doc.sequences, seqId) ? doc.sequences[seqId] : undefined;
  if (!seq) throw Object.assign(new Error(`sequence ${seqId} not found`), { code: 'not_found' as const });
  const clips = seq.tracks.flatMap((t, ti) => t.clips.map((c) => ({ c, ti })))
    .sort((x, y) => T.cmp(x.c.start, y.c.start) || x.ti - y.ti);
  const lines: CreditLine[] = [];
  const texts = new Set<string>();
  const nonCommercial: CreditsReport['nonCommercial'] = [], people: CreditsReport['people'] = [];
  const ncSeen = new Set<string>(), peopleSeen = new Set<string>();
  const licenceNotes: SourceWarning[] = [];
  const notesSeen = new Set<string>();
  for (const { c } of clips) {
    if (c.type !== 'media') continue;
    for (const o of licensedOrigins(doc, c.assetId)) {
      const { asset, title } = o;
      const shortened = !!asset.provenance.fitted;
      if (o.creditText !== null && o.placement !== null && !texts.has(o.creditText)) {
        texts.add(o.creditText);
        lines.push({ assetId: asset.id, title, text: o.creditText, placement: o.placement, group: o.group, ...(shortened ? { modified: 'shortened' as const } : {}) });
      } else if (o.creditText !== null && shortened) {
        // the same credit met first through the original song: the change must still be indicated
        const line = lines.find((l) => l.text === o.creditText);
        if (line) line.modified = 'shortened';
      }
      if (o.nonCommercial && !ncSeen.has(asset.id)) { ncSeen.add(asset.id); nonCommercial.push({ assetId: asset.id, title }); }
      if (o.people && !peopleSeen.has(asset.id)) { peopleSeen.add(asset.id); people.push({ assetId: asset.id, title }); }
      // the source warnings once per file (the non-commercial mark is said by nonCommercial above)
      for (const n of o.licenceNotes) {
        const k = `${asset.id}\n${n.code}`;
        if (n.code === 'non_commercial_content' || notesSeen.has(k)) continue;
        notesSeen.add(k);
        licenceNotes.push(n);
      }
    }
  }
  // music, then sounds, then pictures and video; timeline order inside each group (a stable sort keeps it)
  lines.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const shown = seq.tracks.filter((t) => !t.hidden).flatMap((t) => t.clips).flatMap((c) => (c.type === 'text' ? [norm(c.text)] : []));
  // a duty only: a courtesy line (a licence that needs no credit) is listed but never missing
  const onScreenMissing = lines.filter((l) => l.placement === 'on_screen' && creditDue(doc, l) && !shown.some((s) => s.includes(norm(l.text))));
  return { lines, descriptionText: (lang) => describe(lines, nonCommercial, lang), onScreenMissing, nonCommercial, people, ...(licenceNotes.length ? { licenceNotes } : {}) };
}
/** Is this credit line a duty of its file's licence (libraryDuties.ts recordNeedsCredit), or a courtesy line? */
export function creditDue(doc: ProjectDocument, line: CreditLine): boolean {
  const a = Object.hasOwn(doc.assets, line.assetId) ? doc.assets[line.assetId]! : undefined;
  if (!a) return false;
  // a recorded built-in track (wave 7 instruments) holds several records: the one whose credit is this line's
  const r = a.provenance.library ?? a.provenance.instruments?.records.find((x) => x.credit?.text === line.text);
  if (r) return recordNeedsCredit(r);
  // a fetched file (wave 8 sources): its record says whether its licence asks for the credit (credit.due)
  const s = a.provenance.source;
  return !!s?.credit && s.credit.text === line.text && s.credit.due;
}
/** A report as JSON (GET /projects/:id/credits, MCP get_credits, the export job's output). */
export function creditsView(r: CreditsReport, lang: 'he' | 'en'): CreditsView {
  return { lines: r.lines, descriptionText: r.descriptionText(lang), onScreenMissing: r.onScreenMissing, nonCommercial: r.nonCommercial, people: r.people, ...(r.licenceNotes?.length ? { licenceNotes: r.licenceNotes } : {}) };
}

/**
 * May this asset's file travel in a shared archive? Assets without a library record: always. With one: only when the core table
 * knows its licence and allows it, and the record is neither diskOnly nor non-commercial (libraryDuties.ts recordShareable).
 */
export function shareable(asset: Asset): boolean {
  const r = asset.provenance.library;
  if (r) return recordShareable(r);
  // a fetched file (wave 8 sources): its record marks what may not travel (notShareable is a data fact of its licence id)
  return asset.provenance.source?.flags.notShareable !== true;
}

/**
 * What «ארכיון לשיתוף» leaves out of the project's archive, and the notices the manifest carries. Restricted = an asset whose own
 * library record is not shareable, or a file made from one (libraryOrigins). Every hash such an asset stores is left out: its
 * file and its conform original, even when another asset names the same bytes (the bytes are what may not travel).
 */
export function archiveLibraryPlan(doc: ProjectDocument): ArchiveLibraryPlan {
  const omit = new Set<string>();
  const omitted: ArchiveLibraryPlan['omitted'] = [];
  const notices: ArchiveLibraryPlan['notices'] = [];
  const noticed = new Set<string>();
  for (const a of Object.values(doc.assets).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    // by the record, not the asset: a recorded built-in track carries several records (wave 7 instruments); for a copied file the two agree
    // wave 8 sources: a fetched file whose record marks it not shareable is left out the same way (licensedOrigins)
    const restricted = licensedOrigins(doc, a.id).filter((o) => !o.shareable);
    if (!restricted.length) continue;
    const root = restricted[0]!;
    const rootTitle = root.library?.title ?? root.source?.title ?? '';
    for (const hash of [a.contentHash, ...(a.conform ? [a.conform.originalContentHash] : [])]) {
      if (omit.has(hash)) continue;
      omit.add(hash);
      omitted.push({ hash, assetId: a.id, itemId: root.itemId, title: a.provenance.library || a.provenance.source ? rootTitle || a.name : a.name, licenceId: root.licenceId });
    }
    for (const o of restricted) {
      const nk = `${o.asset.id}\n${o.itemId}`;
      if (noticed.has(nk)) continue;
      noticed.add(nk);
      notices.push({ title: o.title, licenceId: o.licenceId, credit: o.creditText, url: (o.library ? o.library.licence.url : o.source?.licence.url) ?? null });
    }
  }
  return { omit: [...omit].sort(), omitted, notices };
}
