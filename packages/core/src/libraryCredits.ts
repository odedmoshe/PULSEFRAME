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
import type { Asset, ProjectDocument } from './schema.ts';

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

export function collectCredits(doc: ProjectDocument, opts: { sequenceId?: string } = {}): CreditsReport {
  void doc; void opts;
  throw new Error('collectCredits is not built yet (library worker B)');
}

/** May this asset's file travel in a shared archive? Assets without a library record: always. */
export function shareable(asset: Asset): boolean {
  return !asset.provenance.library?.flags.diskOnly;
}

export interface ArchiveLibraryPlan {
  /** Content hashes (sha256:…) a shared archive leaves out: restricted library files and their conform originals. */
  omit: string[];
  omitted: { hash: string; assetId: string; itemId: string; title: string; licenceId: string }[];
  notices: { title: string; licenceId: string; credit: string | null; url: string | null }[];
}
/** What «ארכיון לשיתוף» leaves out of the project's archive, and the notices the manifest carries. Worker B. */
export function archiveLibraryPlan(doc: ProjectDocument): ArchiveLibraryPlan {
  void doc;
  throw new Error('archiveLibraryPlan is not built yet (library worker B)');
}
