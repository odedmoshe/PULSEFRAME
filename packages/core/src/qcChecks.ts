/**
 * «בדיקה לפני ייצוא» — the document rules and the explanation pass (wave 8 qc; contract in qcContract.ts). BUILDER B1 owns this
 * file after the pre-pass. Pure: exact rationals (T.frameIndexAt, BigInt source-time comparisons as exportChecks.ts insideSource),
 * no Date, no float time. Until B1 builds them QC_BUILT is false and both functions are honest no-ops: `documentChecks` returns
 * no issue with `built: false`, and `explainFindings` returns the report unchanged (nothing explained). Never a fake finding.
 *
 * What B1 builds here (qc-plan.md §3.3 as corrected by qc-verify.md; .artifacts/wave8/qc-b1.md):
 *   documentChecks(doc) on the PROJECTED output document (preflight's outputDoc), its main sequence:
 *     flash_clip         C10: a picture visible fewer than ⌈fps·QC_LIMITS.flashClipSeconds⌉ frames; skip clips fully under a
 *                        covering clip (C3's rule) and clips inside a transition overlap; warning, no fix.
 *     held_past_picture  C1: frames whose source time is ≥ the PICTURE end = (video.frameCount + startFrames) / video.frameRate (the
 *                        file's rate, ingest.ts), forward, reversed and speed; also a late picture start (startTime > 0) holds the
 *                        first picture (note, no fix). Note; fix (forward only): trim the picture alone, includeLinked: false.
 *     title_hidden       a text or drawn clip covered at every frame by a higher visible video clip that coversFrame AND passes
 *                        C3's guard (QC_COVER_SAFE_EFFECTS only, never inside a transition span). Warning, ids [title, coverers…].
 *     ends_mid_word      C5: the clip whose end is the film's end cuts ≥ QC_LIMITS.wordMarginFrames inside a transcript word
 *     cut_mid_word       (transcriptFor, lineage.ts; untimed copies skipped via untimedCopyFinder). Excused: a sound clip ending
 *                        with fadeOut or a volume key near 0 at that edge; a razor split (next clip on the track starts there, same
 *                        asset, sourceIn = previous sourceEnd, same speed). `timing: 'segment'` → skipped, named; `approximate` →
 *                        note only. Never quotes a word in `message`.
 *   explainFindings(doc, firstFrame, checks): EXPLAINED_REASONS with EXPLAINED_FOR, C9's tight fade_edge bound, C14's three.
 */
import type { ProjectDocument } from './schema.ts';
import type { ExportChecks } from './sendContract.ts';
import type { DocumentChecks, ExplainFindings } from './qcContract.ts';

/** True once B1 has built the rules: preflight's scope then names them with their numbers (apps/server preflight.ts). */
export const QC_BUILT = false;

/** The document rules of one output. Not built: no issue, `built: false` (nothing was looked at). */
export function documentChecks(doc: ProjectDocument): DocumentChecks {
  void doc;
  return { built: false, issues: [], skipped: [] };
}

/** The one explanation pass (C6). Not built: the report unchanged, so no finding is folded away. */
export const explainFindings: ExplainFindings = (doc, firstFrame, checks: ExportChecks) => {
  void doc; void firstFrame;
  return checks;
};
