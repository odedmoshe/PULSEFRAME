/**
 * The Hebrew command bar («שורת פקודות», ADR-0027): the shared contract of the model-free grammar (W1, core
 * commandBar/), the bar inside the palette (W3, apps/web/src/editor/commandBar/) and the proof. LEAD: W1, W2 and W3 import it
 * and do not edit it (.artifacts/command-bar-plan.md §4, as corrected by its verifier and the lead's decisions in
 * .artifacts/wave5-decisions.md "Hebrew command bar").
 *
 * What it promises:
 * - interpret(text, ctx) is pure and deterministic (no clock, no random source, no DOM, no i18n import) and never guesses: an
 *   ambiguous or unknown request is answered with choices or "not understood", never with a plan or an action.
 * - A plan is ordinary public ops, already injected with the shown sequence (ctx.inject) and dry-run on ctx.rawDoc; it is
 *   committed STRICTLY (Editor.commitExact: expectedRevision = basisRevision, idempotency key 'bar:' + planHash) as ONE
 *   transaction labelled COMMAND_BAR_LABEL(intent), so one request is one undo and the typed text never enters the op log.
 * - Times are exact (ADR-0003): seconds become a frame index ONCE (T.nearestFrameIndex, ties up) and the stored time is
 *   T.frameTime(frame); numbers are bigint rationals until then.
 * - Only intent ids are ever remembered (BAR_PREFS_KEY), never typed text (lead decision 12).
 */
import * as T from '@pulseframe/time';
import { canonical } from './entities.ts';
import type { OpCall } from './ops.ts';
import type { ProjectDocument } from './schema.ts';
import { sha256Hex } from './sha256.ts';

/** False until W1's grammar is merged (the lead flips it at the merge); until then interpret() understands nothing and says so. */
export const COMMAND_BAR_GRAMMAR_BUILT = false;

/** At most this many operations in one request: the REST and MCP limit of one transaction (http.ts TxBody, mcp.ts propose_transaction). Never split into several undos. */
export const MAX_BAR_OPS = 200;
/** The dry run of a plan (W1) uses exactly these options, so the preview and the proof compute the same ids. */
export const BAR_PREVIEW_OPTIONS = { idSeed: 'bar-preview', actor: 'user:local' } as const;
/** Browser preferences of the bar (localStorage, try/catch): { recent: IntentId[] } with at most BAR_RECENT_MAX entries. Intent ids only. */
export const BAR_PREFS_KEY = 'pf.commandBar.v1';
export const BAR_RECENT_MAX = 10;
/** «הוסף מעבר בין כל הקליפים» (lead decision 5): a soft dissolve of half a second, rounded once to frames; existing transitions are kept; cuts without enough material are left out and named. */
export const TRANSITIONS_ALL_DEFAULT = { type: 'dissolve', seconds: { num: 1n, den: 2n } } as const;
/** Number words above this are refused with out_of_range (plan §4.2). */
export const BAR_NUMBER_MAX = 1_000_000;

export const INTENT_IDS = ['split_here', 'split_at', 'trim_start_here', 'trim_end_here', 'delete_clip', 'delete_keep_gap', 'add_title',
  'gain_change', 'mute', 'unmute', 'transitions_all', 'transition_here', 'add_marker', 'close_gaps', 'freeze', 'speed', 'fades', 'fit_music',
  'effect', 'look', 'rename_project', 'remove_empty_tracks', 'undo', 'redo', 'workspace', 'export_to', 'seek', 'play', 'pause',
  'select_all', 'deselect', 'zoom_in', 'zoom_out', 'language', 'open', 'sync_beat'] as const;
export type IntentId = (typeof INTENT_IDS)[number];
/** The transaction label of a request: the intent id only, never the typed text (it may name a child; the label lands in the op log). */
export const COMMAND_BAR_LABEL = (intent: IntentId): string => `Command bar: ${intent}`;

/**
 * The registry command (apps/web/src/editor/commands.ts COMMANDS) each intent stands beside, null when none does (the Sound
 * panel, the Inspector, the mode bar). W3's intentCommands.test.ts checks that every non-null id exists in COMMANDS; the
 * bar lists these as "nearest commands" and the 'command' action runs one.
 */
export const INTENT_COMMANDS: Readonly<Record<IntentId, string | null>> = {
  split_here: 'edit.split', split_at: null, trim_start_here: 'edit.trimStart', trim_end_here: 'edit.trimEnd', delete_clip: 'edit.delete', delete_keep_gap: 'edit.deleteKeepGap',
  add_title: 'edit.addText', gain_change: null, mute: null, unmute: null, transitions_all: null, transition_here: null, add_marker: 'marker.add', close_gaps: 'edit.closeGaps',
  freeze: null, speed: null, fades: null, fit_music: null, effect: null, look: null, rename_project: null, remove_empty_tracks: 'track.removeEmpty',
  undo: 'history.undo', redo: 'history.redo', workspace: null, export_to: 'file.export', seek: 'transport.start', play: 'transport.toggle', pause: 'transport.toggle',
  select_all: 'edit.selectAll', deselect: 'edit.deselect', zoom_in: 'view.zoomIn', zoom_out: 'view.zoomOut', language: 'view.language', open: null, sync_beat: null,
};
/** The registry commands the 'open' intent may run (plan §4.4 row 27): «פתח תבניות», «סרט משפחתי», «העלאה מהטלפון», «אנשים». */
export const BAR_OPEN_COMMANDS = ['view.openTemplates', 'view.openFamilyFilm', 'file.phoneDrop', 'life.people'] as const;

/** The modes of the mode bar (apps/web/src/editor/Header.tsx MODES). Switching is refused while a take is recorded. */
export const BAR_WORKSPACES = ['pro', 'color', 'sound', 'captions', 'deliver', 'shorts', 'perform'] as const;
export type BarWorkspace = (typeof BAR_WORKSPACES)[number];
/** The export sheet's destinations (apps/web/src/editor/exportSheet.logic.ts DESTINATIONS minus 'custom'). The action only OPENS the sheet with it chosen. */
export const EXPORT_DESTINATION_IDS = ['reels', 'youtube', 'whatsapp', 'computer'] as const;
export type ExportDestinationId = (typeof EXPORT_DESTINATION_IDS)[number];

export interface BarContext {
  /** The editor's document (the ACTIVE sequence's projection) and the raw project the ops are validated against (apps/web/src/editor/store.ts load). */
  doc: ProjectDocument; rawDoc: ProjectDocument; activeSequenceId: string;
  revision: number; selection: readonly string[]; playheadFrame: number; cutClipId: string | null;
  workspace: string; performRecording: boolean; viewVariantId: string | null; lang: 'he' | 'en';
  /**
   * Exact undo target (plan finding 8): the owner's newest 'edit' or 'redo' history event whose undoneBy is null (the server's
   * own default rule, apps/server/src/store.ts undo), with its op names; null = nothing to undo. redoTarget: the owner's newest
   * 'undo' event not yet undone and not abandoned by a later edit.
   */
  undoTarget: { transactionId: string; ops: string[] } | null;
  redoTarget: { transactionId: string; ops: string[] } | null;
  /** Injects sequenceId exactly as the editor's commit does (apps/web/src/editor/shorts.view.ts injectSequenceId). */
  inject(call: OpCall): OpCall;
}

/** An exact non-negative-or-negative rational, reduced, den > 0. */
export interface BarExact { num: bigint; den: bigint }
export type BarTokenKind = 'word' | 'number' | 'quote' | 'timecode' | 'unit';
/** One token with its span in the ORIGINAL text (UTF-16 offsets, end exclusive), its normal form and the proclitics stripped from it. */
export interface BarToken { kind: BarTokenKind; raw: string; norm: string; start: number; end: number; prefixes: string[]; maqaf: boolean }
export type BarReadingRole = 'verb' | 'object' | 'target' | 'position' | 'duration' | 'amount' | 'text' | 'mode' | 'destination' | 'style' | 'filler';
/** What a span was read as (the «הבנתי» highlight). */
export interface BarReading { role: BarReadingRole; span: [number, number]; value: unknown }
/**
 * A parsed time. `seconds` is the exact amount when it was said in seconds (or minutes, hours), `frames` when it was said in
 * frames; `frame` is the ONE conversion (T.nearestFrameIndex(T.rt(num, den)), ties up; frames added after it as integers);
 * `rounded` says the seconds were not a whole frame.
 */
export interface BarTime { seconds: BarExact | null; frames: number | null; frame: number; rounded: boolean }

/** The detail of one preview step; the words are the web's (dictionaries[lang]['op.' + op] plus a detail sentence per kind). */
export type StepDetail =
  | { kind: 'at'; frame: number; time: T.RationalTime; rounded: boolean }
  | { kind: 'span'; fromFrame: number; toFrame: number }
  | { kind: 'clip'; clipId: string; name: string }
  | { kind: 'track'; trackId: string; name: string }
  | { kind: 'gain'; fromLinear: number; toLinear: number; /** signed decimal text as computed, e.g. '+3' */ db: string }
  | { kind: 'transition'; type: string; frames: number; clipId: string; name: string }
  | { kind: 'text'; chars: number; startFrame: number; durationFrames: number }
  | { kind: 'count'; n: number; of: number }
  | { kind: 'speed'; from: number; to: number }
  | { kind: 'rename'; to: string }
  | { kind: 'plain' };
export const STEP_DETAIL_KINDS = ['at', 'span', 'clip', 'track', 'gain', 'transition', 'text', 'count', 'speed', 'rename', 'plain'] as const satisfies readonly StepDetail['kind'][];
/** One preview step per op call of plan.ops, in the same order (steps.length === ops.length). */
export interface PlanStep { op: string; detail: StepDetail }

/** Everything decided by rule rather than by the owner's words (plan §4.5), shown under the steps. */
export const BAR_NOTE_CODES = ['default_used', 'rounded_to_frame', 'skipped_locked', 'skipped_no_handle', 'skipped_has_transition', 'ripple_moves', 'applies_to_master', 'alternative_reading', 'no_beat_analysis'] as const;
export type BarNoteCode = (typeof BAR_NOTE_CODES)[number];
export interface BarNote { code: BarNoteCode; data: Record<string, unknown> }

/** What an action does (no project change). 'export_sheet' only opens the sheet; nothing is exported until its own button. */
export type BarAction =
  | { kind: 'undo'; transactionId: string; ops: string[] } | { kind: 'redo'; transactionId: string; ops: string[] }
  | { kind: 'workspace'; workspace: BarWorkspace } | { kind: 'export_sheet'; destination: ExportDestinationId }
  | { kind: 'seek'; frame: number } | { kind: 'play' } | { kind: 'pause' } | { kind: 'select_all' } | { kind: 'deselect' }
  | { kind: 'zoom'; dir: 1 | -1 } | { kind: 'language'; to: 'he' | 'en' }
  /** 'open', and a nearest command: runs that registry command by id */
  | { kind: 'command'; commandId: string }
  /** the recipes page with this recipe chosen (e.g. 'beat-montage' for «סנכרן לקצב») */
  | { kind: 'recipe'; recipeId: string };
export const BAR_ACTION_KINDS = ['undo', 'redo', 'workspace', 'export_sheet', 'seek', 'play', 'pause', 'select_all', 'deselect', 'zoom', 'language', 'command', 'recipe'] as const satisfies readonly BarAction['kind'][];

/** Why nothing runs (the words are i18n 'bar.refusal.<code>'; an op's own refusal comes with opError and translateRefusal). */
export const BAR_REFUSAL_CODES = ['nothing_selected', 'no_clip_here', 'no_title', 'no_music_track', 'locked', 'out_of_range', 'too_many_ops', 'op_refused', 'recording',
  'nothing_to_undo', 'nothing_to_redo', 'gain_ceiling', 'half_frame', 'nothing_to_do', 'unknown_name'] as const;
export type BarRefusalCode = (typeof BAR_REFUSAL_CODES)[number];
export const BAR_MISSING = ['text', 'time', 'duration', 'amount', 'target', 'mode', 'destination'] as const;
export type BarMissing = (typeof BAR_MISSING)[number];

export type BarPlan = { kind: 'plan'; intent: IntentId; tokens: BarToken[]; readings: BarReading[]; ops: OpCall[]; steps: PlanStep[]; notes: BarNote[]; label: string; basisRevision: number; planHash: string };
export type BarActionResult = { kind: 'action'; intent: IntentId; tokens: BarToken[]; readings: BarReading[]; action: BarAction; notes: BarNote[] };
/** One reading of an ambiguous request: a complete plan or action with its own words. */
export interface BarChoice { he: string; en: string; result: BarPlan | BarActionResult }
export type BarResult =
  | BarPlan
  | BarActionResult
  | { kind: 'ambiguous'; intent: IntentId | null; tokens: BarToken[]; readings: BarReading[]; choices: BarChoice[]; question: { he: string; en: string } }
  | { kind: 'incomplete'; intent: IntentId; tokens: BarToken[]; readings: BarReading[]; missing: BarMissing[]; example: { he: string; en: string } }
  | { kind: 'refused'; intent: IntentId; tokens: BarToken[]; readings: BarReading[]; code: BarRefusalCode; opError?: { code: string; message: string; index: number }; choices?: BarChoice[] }
  | { kind: 'unknown'; tokens: BarToken[]; readings: BarReading[]; unread: [number, number][]; partial: IntentId[] };
export type BarResultKind = BarResult['kind'];

/** W1 implements in commandBar/index.ts. Pure. Plan ops are already injected (ctx.inject) and dry-run on ctx.rawDoc with BAR_PREVIEW_OPTIONS. */
export type Interpret = (text: string, ctx: BarContext) => BarResult;
/** W1 (commandBar/numbers.ts): a number phrase starting at token `at`; `end` is the first token after it. */
export type ParseNumber = (tokens: BarToken[], at: number) => { value: BarExact; end: number } | { ambiguous: true; end: number } | null;
/** W1 (commandBar/time.ts): a time phrase starting at token `at`, converted once at `rate`. */
export type ParseTime = (tokens: BarToken[], at: number, rate: T.Rate) => { time: BarTime; end: number } | { ambiguous: true; end: number } | { refused: 'half_frame' | 'out_of_range'; end: number } | null;

/**
 * planHash = sha256 hex of canonical({ intent, ops, basisRevision }) (core canonical(), times reduced): the same in Node and
 * in the browser. The bar's idempotency key is 'bar:' + planHash, so a second Enter on the same plan replays and never applies twice.
 */
export const barPlanHash = (intent: IntentId, ops: readonly OpCall[], basisRevision: number): string => sha256Hex(canonical({ intent, ops, basisRevision }));
export const barIdempotencyKey = (planHash: string): string => `bar:${planHash}`;
