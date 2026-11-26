/**
 * «בדיקה לפני ייצוא» — the contract of the wave 8 `qc` track (.artifacts/wave8/qc-plan.md as corrected by qc-verify.md C1–C15 and
 * decisions.md "Batch C … qc"). LEAD pre-pass: the codes, the thresholds as named constants with their reasons, the reasons an
 * after-export finding can be explained by the edit, and the wire types. The rules themselves are B1's (qcChecks.ts); until B1
 * builds them QC_BUILT is false, `documentChecks` returns no issue and `explainFindings` explains nothing — never a fake finding,
 * and the preflight scope does not name the rules (apps/server/src/preflight.ts).
 *
 * Every number here is a RULE OF THUMB (the product says «כלל אצבע» and shows the number); nothing here calls a film fine, right
 * or safe, and nobody here has watched or listened to anything. Report only: no rule blocks an export (ADR-0009's rule).
 * CUT from version 1 and not to be stubbed: `faded_out` (verifier C4), the `there`/«מה יש שם» list (C15), the PNG "no time to
 * check" line, the `<details>` rules disclosure.
 */
import type { OpCall } from './ops.ts';
import type { ExportChecks } from './sendContract.ts';

// ---------- the document rules listed by preflight (REST, MCP, the export sheet) ----------
export const QC_CODES = ['flash_clip', 'held_past_picture', 'title_hidden', 'ends_mid_word', 'cut_mid_word'] as const;
export type QcCode = (typeof QC_CODES)[number];
/** The severity of each code (decisions.md, verifier "Lead decisions"); `ends_mid_word` on approximate word times is a note (C5a). */
export const QC_SEVERITY: Readonly<Record<QcCode, 'warning' | 'note'>> = {
  flash_clip: 'warning', // with no fix: deleting a short clip is judgement (C10); the row says «אם זה בכוונה, אפשר להתעלם»
  held_past_picture: 'note', // the sound tail is often why the file is long (C1); fix: trim the PICTURE only, or none
  title_hidden: 'warning', // only with C3's cover guard (no effects outside QC_COVER_SAFE_EFFECTS, never inside a transition span)
  ends_mid_word: 'warning', // at the film's end, word timing only; approximate times → note; segment timing → skipped and named
  cut_mid_word: 'note', // every other cut inside a word, at most QC_LIMITS.maxListedPerCode rows plus one summary row
};

export const QC_LIMITS = {
  /**
   * flash_clip: a picture visible for fewer than ⌈fps · 1/10⌉ frames (3 at 24/25/30 fps, 6 at 60). A trim leftover is 1–2 frames;
   * the generators never make one this short (C10: a perform take keeps ≥ flashGapFrames, a family-film slot ≥ 1.6 s, growing-up
   * holds ≥ flashGapFrames, the beat montage ≤ 3 cuts a second ≈ 10 frames at 30 fps).
   */
  flashClipSeconds: { num: 1, den: 10 },
  /** held_past_picture: any held frame counts (≥ 1). A held last picture is never "short enough" to be intended by the file. */
  heldMinFrames: 1,
  /** *_mid_word: a cut lies at least this many PROJECT frames inside both edges of a transcript word (a cut on a word edge is the intended kind). */
  wordMarginFrames: 1,
  /** more issues of one code are summed in one row (the pattern of preflight.ts trackingIssues). */
  maxListedPerCode: 20,
  /**
   * explained `slow_speed` (C14): one source frame lasts at least this long on the timeline, 1 / (file fps · speed) ≥ 2 s — the
   * same time as CHECK_LIMITS.frozenSeconds, so exactly the slow motion the frozen rule cannot tell from a held picture.
   */
  slowFrameSeconds: { num: 2, den: 1 },
  /**
   * explained `fade_edge` (C9, tight): every frame of the black run lies in frames where the fading clip's effective opacity is
   * < 1, plus at most CHECK_LIMITS.blackSeconds (0.5 s) beyond them. A 20 s black tail after a fade stays unexplained.
   */
  fadeEdgeSlackSeconds: { num: 1, den: 2 },
} as const;

/**
 * C3: a clip counts as covering a title (for `title_hidden` only) when it covers the frame by geometry (exportChecks.ts coversFrame)
 * AND every enabled effect on it is in this list — effects that keep its alpha and its geometry. `key.chroma` makes it transparent;
 * `motion.*` and `distort.*` move or warp it and uncover the edges; anything not listed is assumed to uncover (a missed warning,
 * never a false one). Frames inside a transition span of the covering clip are never covered. Adjustment clips above (an exposure
 * of −100) are not modelled: a miss, not a false alarm; the scope text says so.
 */
export const QC_COVER_SAFE_EFFECTS = ['color.adjust', 'color.grade', 'color.grayscale', 'color.invert', 'color.lut', 'color.sepia', 'color.tint', 'blur.gaussian', 'stylize.grain'] as const;

/** What a mid-word rule could not check, named in the answer (C5a; untimed copies via lineage.ts untimedCopyFinder). */
export const QC_SKIP_REASONS = ['ramped', 'untimed_copy', 'segment_timing'] as const;
export type QcSkipReason = (typeof QC_SKIP_REASONS)[number];

/**
 * One document issue. The same shape as apps/server preflight.ts PreflightIssue (into which preflight pushes it), with the frame
 * range and the measured numbers required. `message` is English for agents and NEVER quotes transcript words (C5: a child's speech).
 * `fix.label` is English and goes through the sheet's fixLabelOf for Hebrew (C15).
 */
export interface QcIssue {
  code: QcCode;
  severity: 'warning' | 'note';
  message: string;
  ids: string[];
  /** [startFrame, endFrame) in the output's own frames (the projected document of preflight's chosen output) */
  range: { startFrame: number; endFrame: number };
  /** the numbers behind the issue, e.g. flash_clip {frames, minFrames}; held_past_picture {heldFrames, atStart 0|1}; *_mid_word {wordStartMs, wordEndMs, cutMs, approximate 0|1} */
  measured: Record<string, number>;
  fix?: { label: string; ops: OpCall[] };
}
export interface DocumentChecks {
  /** false until B1 builds the rules: then `issues` is empty because nothing was looked at, not because nothing was found */
  built: boolean;
  issues: QcIssue[];
  skipped: { clipId: string; reason: QcSkipReason }[];
}

// ---------- after export: findings the edit explains (folded on the file card under «יש לזה הסבר בעריכה (n)») ----------
/**
 * Verifier "Lead decisions": the v1 kinds. black: `dip_transition` (every frame inside a dip-black transition span), `fade_edge`
 * (C9's tight bound above; a title's own entrance/exit animation at the edge counts; a gap at the very start is `empty_picture`
 * before export and is NOT also explained). silence: `freeze_hold` (every block inside a freeze clip's span). frozen (C14):
 * `picture_ends` (a held run of C1: the sound in the file runs past its last picture), `slow_speed` (QC_LIMITS.slowFrameSeconds),
 * `still_source` (a derived asset whose source is an image, provenance.derived.sourceAssetIds → kind 'image').
 */
export const EXPLAINED_REASONS = ['dip_transition', 'fade_edge', 'freeze_hold', 'picture_ends', 'slow_speed', 'still_source'] as const;
export type ExplainedReason = (typeof EXPLAINED_REASONS)[number];
/** Which finding kind each reason may explain (anything else is a rule bug: B1's test holds it). */
export const EXPLAINED_FOR: Readonly<Record<ExplainedReason, 'black' | 'silence' | 'frozen'>> = {
  dip_transition: 'black', fade_edge: 'black', freeze_hold: 'silence', picture_ends: 'frozen', slow_speed: 'frozen', still_source: 'frozen',
};

/**
 * The ONE pass that adds `explained` (C6): called after assembleChecks by the export (export.ts), the fast export, and the
 * loudness route (programmeLoudness.ts), so proof:send K4's byte-equality of sound findings holds. `firstFrame` is the export's
 * first timeline frame (a range export). Pure; it never removes or reorders a finding and never changes `measured`.
 */
export type ExplainFindings = (doc: import('./schema.ts').ProjectDocument, firstFrame: number, checks: ExportChecks) => ExportChecks;

// ---------- preflight codes the sheet shows (C12) ----------
/**
 * Every preflight code the export sheet may list. Before wave 8 the sheet's table (apps/web exportSheet.strings.ts `issue`) had
 * Hebrew for ten of them and fell back to the server's English `message` for the 28 below (four of which have a headline in
 * packages/i18n lifeline.ts `preflight.*` that the sheet never read). B2 gives every code a Hebrew row; the wording test then holds
 * each new code to have one. apps/server preflightCodes.test.ts holds this list to the codes the server can emit.
 */
export const PREFLIGHT_CODES_WITH_HEBREW_BEFORE_QC = ['outside_safe_area', 'captions_outside_safe_area', 'captions_too_fast', 'upscaled', 'empty_picture', 'transition_freeze', 'velocity_source', 'decode_budget', 'no_sound', 'no_loudness_target'] as const;
export const PREFLIGHT_CODES_ENGLISH_ONLY_BEFORE_QC = [
  'missing_media', 'missing_font', 'renderer_unavailable', 'out_of_bounds', 'empty_range', 'empty_sequence', 'variant_over_sequence_format',
  'unknown_effect', 'unknown_audio_effect', 'gif_has_no_sound', 'gif_large', 'no_captions', 'resampled_audio', 'audio_tail_cut',
  'non_commercial_content', 'credits_for_description', 'credit_not_on_screen', 'stock_people', 'follow_target_missing', 'follow_track_loss',
  'redact_track_loss', 'multicam_out_of_sync', 'stabilise_limited', 'stabilise_unmeasured', 'field_no_data', 'field_sunset_undecided',
  'capture_estimated', 'stamp_no_date',
] as const;
export const PREFLIGHT_SHOWN_CODES = [...PREFLIGHT_CODES_WITH_HEBREW_BEFORE_QC, ...PREFLIGHT_CODES_ENGLISH_ONLY_BEFORE_QC, ...QC_CODES] as const;
