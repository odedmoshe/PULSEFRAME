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

export interface CreditLine { assetId: string; title: string; text: string; placement: 'description' | 'on_screen' | 'either'; group: 'music' | 'sound' | 'picture' }
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
}
/** The JSON shape of a CreditsReport (GET /projects/:id/credits, MCP get_credits, the export job's output.licence). */
export interface CreditsView { lines: CreditLine[]; descriptionText: string; onScreenMissing: CreditLine[]; nonCommercial: { assetId: string; title: string }[]; people: { assetId: string; title: string }[] }

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

/**
 * The library files an asset stems from: itself when it carries a library record, and, through provider results
 * (provenance.derived.sourceAssetIds) and generated speech made from a reference recording (provenance.voice.referenceAssetId),
 * every library file it was made from. A file made from a library file carries its duties: its credit, its non-commercial mark and
 * the archive rule. Cycles and missing ids are ignored. In the order met, without repeats.
 */
export function libraryOrigins(doc: ProjectDocument, assetId: string): { asset: Asset; record: LibraryRecord }[] {
  const out: { asset: Asset; record: LibraryRecord }[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !Object.hasOwn(doc.assets, id)) return;
    seen.add(id);
    const a = doc.assets[id]!;
    if (a.provenance.library) out.push({ asset: a, record: a.provenance.library });
    for (const s of a.provenance.derived?.sourceAssetIds ?? []) visit(s);
    if (a.provenance.voice?.referenceAssetId) visit(a.provenance.voice.referenceAssetId);
  };
  visit(assetId);
  return out;
}

const groupOf = (r: LibraryRecord): CreditLine['group'] => (r.kind === 'music' || r.kind === 'loop' ? 'music' : r.kind === 'sound' ? 'sound' : 'picture');
const GROUP_ORDER: readonly CreditLine['group'][] = ['music', 'sound', 'picture'];
/** Whitespace-normalised text, for finding a credit inside a title. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const titleOf = (asset: Asset, r: LibraryRecord) => r.title || asset.name;

/** The description text of a report's parts (empty when there is nothing to say). Credit strings are written verbatim. */
function describe(lines: readonly CreditLine[], nonCommercial: readonly { title: string }[], lang: 'he' | 'en'): string {
  const parts: string[] = [];
  if (lines.length) parts.push(CREDITS_HEADING[lang], ...lines.map((l) => l.text));
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
  for (const { c } of clips) {
    if (c.type !== 'media') continue;
    for (const { asset, record } of libraryOrigins(doc, c.assetId)) {
      const title = titleOf(asset, record);
      if (record.credit && !texts.has(record.credit.text)) {
        texts.add(record.credit.text);
        lines.push({ assetId: asset.id, title, text: record.credit.text, placement: record.credit.placement, group: groupOf(record) });
      }
      if (record.flags.nonCommercial && !ncSeen.has(asset.id)) { ncSeen.add(asset.id); nonCommercial.push({ assetId: asset.id, title }); }
      if (record.flags.people && !peopleSeen.has(asset.id)) { peopleSeen.add(asset.id); people.push({ assetId: asset.id, title }); }
    }
  }
  // music, then sounds, then pictures and video; timeline order inside each group (a stable sort keeps it)
  lines.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const shown = seq.tracks.filter((t) => !t.hidden).flatMap((t) => t.clips).flatMap((c) => (c.type === 'text' ? [norm(c.text)] : []));
  // a duty only: a courtesy line (a licence that needs no credit) is listed but never missing
  const onScreenMissing = lines.filter((l) => l.placement === 'on_screen' && creditDue(doc, l) && !shown.some((s) => s.includes(norm(l.text))));
  return { lines, descriptionText: (lang) => describe(lines, nonCommercial, lang), onScreenMissing, nonCommercial, people };
}
/** Is this credit line a duty of its file's licence (libraryDuties.ts recordNeedsCredit), or a courtesy line? */
export function creditDue(doc: ProjectDocument, line: CreditLine): boolean {
  const r = Object.hasOwn(doc.assets, line.assetId) ? doc.assets[line.assetId]!.provenance.library : undefined;
  return !!r && recordNeedsCredit(r);
}
/** A report as JSON (GET /projects/:id/credits, MCP get_credits, the export job's output). */
export function creditsView(r: CreditsReport, lang: 'he' | 'en'): CreditsView {
  return { lines: r.lines, descriptionText: r.descriptionText(lang), onScreenMissing: r.onScreenMissing, nonCommercial: r.nonCommercial, people: r.people };
}

/**
 * May this asset's file travel in a shared archive? Assets without a library record: always. With one: only when the core table
 * knows its licence and allows it, and the record is neither diskOnly nor non-commercial (libraryDuties.ts recordShareable).
 */
export function shareable(asset: Asset): boolean {
  const r = asset.provenance.library;
  return !r || recordShareable(r);
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
    const restricted = libraryOrigins(doc, a.id).filter((o) => !shareable(o.asset));
    if (!restricted.length) continue;
    const root = restricted[0]!;
    for (const hash of [a.contentHash, ...(a.conform ? [a.conform.originalContentHash] : [])]) {
      if (omit.has(hash)) continue;
      omit.add(hash);
      omitted.push({ hash, assetId: a.id, itemId: root.record.itemId, title: a.provenance.library ? titleOf(a, root.record) : a.name, licenceId: root.record.licence.id });
    }
    for (const { asset, record } of restricted) {
      if (noticed.has(asset.id)) continue;
      noticed.add(asset.id);
      notices.push({ title: titleOf(asset, record), licenceId: record.licence.id, credit: record.credit?.text ?? null, url: record.licence.url ?? null });
    }
  }
  return { omit: [...omit].sort(), omitted, notices };
}
