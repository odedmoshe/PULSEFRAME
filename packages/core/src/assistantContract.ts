/**
 * The language-model assistant of the command bar (ADR-0027, plan §7): the WIRE contract shared by the server
 * (apps/server/src/assistant/*, W2) and the editor (apps/web/src/editor/commandBar/*, W3). LEAD: imported, not edited.
 * Server-only parts (the adapter interface, the principal, the deps) are in apps/server/src/assistant/contract.ts and
 * packages/providers/src/chat.ts.
 *
 * Wave 1 builds the path only to the honest setup state «עוזר השפה לא מחובר»: no network adapter exists, no provider is
 * picked, no key is asked for. The decisions it carries (.artifacts/wave5-decisions.md, "Hebrew command bar"):
 *  - the assistant only PROPOSES (agent:assistant, mode propose, people 'names'); the owner accepts, as an owner transaction;
 *  - spending: a MONTHLY limit plus a PER-REQUEST cap, both set by the owner with prices the owner types in; nothing is
 *    sent until both are set (setup 'limit_missing' / 'prices_missing') — decision 8;
 *  - what is sent is an ALLOWLIST summary (AssistantSummary); title wording, marker names and people's names only behind two
 *    switches that are off by default; birth dates, capture dates, events, file names, transcripts and media never — decision 7;
 *  - the key lives in a 0600 file in the data directory, is never returned, logged, backed up or archived — decision 9.
 */
import type * as T from '@pulseframe/time';
import { z } from 'zod';
import { BAR_WORKSPACES, EXPORT_DESTINATION_IDS, type IntentId } from './commandBarContract.ts';
import { listOps } from './ops.ts';
import { PERSON_OPS } from './peopleOps.ts';

export const ASSISTANT_JOB_TYPE = 'assistant.propose';
/** The in-memory principal of a job (no token for it exists, so nothing outside the server can act as it). */
export const ASSISTANT_ACTOR = 'agent:assistant';
/** budget_ledger.grant_id of the assistant's reservations (Governance.reserveAssistant). */
export const ASSISTANT_GRANT_ID = 'assistant';
export const ASSISTANT_CAPABILITY_ID = 'assistant.edit-proposal';
/** At most this many ops in one model proposal (ModelProposalSchema). */
export const MAX_ASSISTANT_OPS = 50;
export const ASSISTANT_TEXT_MAX = 2000;
export const ASSISTANT_EXPLANATION_MAX = 600;
export const ASSISTANT_MAX_OUTPUT_TOKENS = 2000;
/** The summary is at most this many UTF-8 bytes; clips further than ASSISTANT_FOLD_SECONDS from the playhead and outside the selection are folded into per-track counts first. */
export const SUMMARY_MAX_BYTES = 32 * 1024;
export const ASSISTANT_FOLD_SECONDS = 60;
/** Added to the byte length of the request when the reservation is estimated (plan §7.4 step 2). */
export const ASSISTANT_ESTIMATE_OVERHEAD_BYTES = 512;

/**
 * Public ops the model may NOT propose (reviewed by the lead contracts; the plan's list plus everything that changes the
 * library, the project's settings, analyses, transcripts, privacy regions or motion tracks — data the assistant never reads).
 * PERSON_OPS are excluded as well (assistantOps()).
 */
export const ASSISTANT_EXCLUDED_OPS = [
  // the library and the project's settings
  'import_asset', 'remove_asset', 'rename_asset', 'set_asset_colour', 'set_project_format', 'set_timeline_behaviour', 'set_loudness_target', 'edit_analysis',
  // people, capture dates, events and live fields (life line, ADR-0021)
  'add_person', 'update_person', 'remove_person', 'set_asset_capture', 'shift_asset_captures', 'add_event', 'update_event', 'remove_event', 'cluster_events', 'set_text_fields',
  // transcripts, captions and caption wording (never sent, so never edited blind; lead decision after the contracts review)
  'set_transcript', 'import_transcript', 'correct_transcript', 'delete_transcript_range', 'import_captions',
  'add_cue', 'update_cue', 'merge_cues', 'set_caption_style', 'set_variant_phrase_text',
  // privacy regions and the motion tracks they follow (a proposal must never take a redaction away)
  'set_redact_region', 'create_motion_track', 'edit_motion_track', 'remove_motion_track',
  // the content library (wave 7): the credits card writes licence text the assistant never reads; offering it would also change
  // the reviewed prompt (ASSISTANT_PROMPT_DIGEST), which needs its own review first
  'add_credits_card',
  // send and keep (wave 7): a project setting, and a match that needs measurements the assistant never reads
  'set_master_limiter', 'match_clip_loudness',
  // editing craft (wave 7): replace_text rewrites captions, transcripts and translations the assistant never reads; ripple_trim and
  // paste_attributes are left out until the owner has tried them (offering them would also change the reviewed prompt,
  // ASSISTANT_PROMPT_DIGEST, which needs its own review first)
  'replace_text', 'ripple_trim', 'paste_attributes',
  // stabilisation (wave 7): it reads camera measurements the assistant never sees; a command-bar intent is a non-goal of version 1
  'set_clip_stabilise', 'remove_camera_motion',
  // marked ranges («פנינים», wave 7): an accepted proposal commits as the owner, which would pass the owner-only tagging rule; labels
  // are family notes the assistant never reads (and offering them would change the reviewed ASSISTANT_PROMPT_DIGEST)
  'add_source_range', 'update_source_range', 'remove_source_range',
  // music that fits the film (wave 7 musicfit): every new public op is left out so the reviewed ASSISTANT_PROMPT_DIGEST stays as it is;
  // both stay on MCP and REST as ordinary reversible edits
  'set_clip_impact', 'sync_impact',
  // versions for an audience (wave 8 audiences): left out so the reviewed ASSISTANT_PROMPT_DIGEST stays as it is; on MCP and REST as
  // ordinary reversible edits
  'add_audience_version', 'update_audience_version', 'set_audience_keep',
  // «ציור חי» (wave 8 ink): left out so the reviewed ASSISTANT_PROMPT_DIGEST stays as it is; on MCP and REST as ordinary reversible edits
  'add_ink', 'edit_ink',
] as const;
/** The ops a proposal may hold: every registered public op minus ASSISTANT_EXCLUDED_OPS and PERSON_OPS, in registry order. */
export function assistantOps(): string[] {
  const out = new Set<string>([...ASSISTANT_EXCLUDED_OPS, ...PERSON_OPS]);
  return listOps().filter((o) => !o.internal && !out.has(o.name)).map((o) => o.name);
}

/** The setup state, in the order the owner fixes them. Only 'ready' lets a request leave the machine. */
export const ASSISTANT_SETUP_CODES = ['ready', 'provider_not_configured', 'prices_missing', 'limit_missing', 'host_not_allowed', 'prompt_digest_mismatch'] as const;
export type AssistantSetup = (typeof ASSISTANT_SETUP_CODES)[number];
export const ASSISTANT_ERROR_CODES = ['assistant_not_connected', 'owner_required', 'budget_exceeded', 'invalid_model_output', 'provider_error', 'submission_unknown',
  // the local assistant (wave 7, .artifacts/wave7/assistant-decisions.md §4): the grammar read the request itself (409, no job); the
  // owner's local server is not running, still loading its model, too slow, not on loopback, or answered an error
  'grammar_understood', 'local_not_running', 'local_loading', 'local_timeout', 'local_not_loopback', 'local_server_error',
  // a local job found queued or running after a restart: ended failed, never resumed, never 'submission unknown' (job.ts recoverAssistantJobs)
  'local_interrupted'] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];
/** Job stages, said in words in the editor (never a percentage). */
export const ASSISTANT_STAGES = ['sending', 'awaiting-provider', 'checking',
  // the local assistant (wave 7): waiting for the compute lane (another heavy job holds it), waiting for the owner's local model
  'waiting-for-compute', 'awaiting-local-model'] as const;
export type AssistantStage = (typeof ASSISTANT_STAGES)[number];

/** The two data switches (decision 7), both off by default. */
export interface AssistantToggles { titlesAndMarkers: boolean; peopleNames: boolean }
export const ASSISTANT_TOGGLES_DEFAULT: Readonly<AssistantToggles> = Object.freeze({ titlesAndMarkers: false, peopleNames: false });

/**
 * GET /api/v1/assistant/status as the OWNER'S OWN SESSION reads it (ADR-0027, note of 2026-11-25 "money and provider"). Never
 * holds the key nor any part of it. Money is in cents; `month` is the UTC calendar month the limit counts ('YYYY-MM').
 * Any other principal reads AssistantPublicStatus instead: the server's assistant/visibility.ts decides which.
 */
export interface AssistantStatus {
  setup: AssistantSetup; detail: string;
  adapter: string | null; host: string | null; model: string | null;
  pricesCentsPerMTok: { input: number; output: number } | null;
  /** 0 = not set (setup limit_missing). */
  monthlyLimitCents: number;
  /** 0 = not set (setup limit_missing). */
  perRequestCapCents: number;
  /** `reservedCents` is everything the month still counts without a known cost: requests on their way, and the `held` amounts. */
  month: string; spentCents: number; reservedCents: number;
  /** The amounts of this month that stay counted because it is not known whether the service charged; the owner may release each. */
  held: AssistantHeldAmount[];
  toggles: AssistantToggles; keySet: boolean; keyAddedAt: string | null;
  /** Installed adapter ids: empty in wave 1 (no network adapter exists). */
  adapters: string[];
  /** The local assistant's settings and its last check (wave 7); absent or null when the local adapter is not chosen. Owner only (visibility.ts). */
  local?: AssistantLocalStatus | null;
}
/**
 * One held amount (budget_ledger state 'unknown'): the request's job, what stays counted, when the request was made, and how the
 * job ended ('canceled', 'failed', 'submission-unknown'; null when its project, and so the job, was deleted since).
 */
export interface AssistantHeldAmount { jobId: string; cents: number; requestedAt: string; status: string | null }
/**
 * All that a principal other than the owner's own session reads of the assistant's status, whatever its grant: connected or
 * not. No amount, limit, price, host, model, adapter, switch, key state or date, and not which setting is missing.
 */
export const ASSISTANT_PUBLIC_SETUP = ['ready', 'not_connected'] as const;
export interface AssistantPublicStatus { connected: boolean; setup: (typeof ASSISTANT_PUBLIC_SETUP)[number]; detail: string }
export const ASSISTANT_PUBLIC_STATUS_KEYS = ['connected', 'detail', 'setup'] as const satisfies readonly (keyof AssistantPublicStatus)[];
export type AssistantStatusAnswer = AssistantStatus | AssistantPublicStatus;
/** Whether a status answer is the owner's whole one (the editor shows amounts, the cap and the switches only then). */
export const isOwnerStatus = (s: AssistantStatusAnswer | null | undefined): s is AssistantStatus => !!s && !('connected' in s);
/** POST /api/v1/jobs/{jobId}/budget/release (owner's session only) → the ledger row after the release. */
export interface BudgetReleaseAnswer { jobId: string; ledger: { reservedCents: number; actualCents: number | null; state: string } | null }
const Cents = z.number().int().nonnegative().max(10_000_000);
/**
 * Cents per million tokens, typed in by the owner. More than 0 (lead decision after the contracts review): a price of 0
 * would estimate a reservation of 0 cents, which Governance.reserveAssistant refuses, so an accepted config can always reserve.
 */
const Price = z.number().max(1_000_000).refine((n) => Number.isFinite(n) && n > 0, {
  message: 'a price is more than 0 cents per million tokens: type the price from the provider\'s price list (for example 300 for $3 per million tokens)',
});
/**
 * The local assistant's settings (wave 7, .artifacts/wave7/assistant-decisions.md §4): ONLY a port and a time limit. The host is
 * never a setting: requests go to http://127.0.0.1:<port> (providers localChat.ts LOCAL_MODEL_HOST), so no typed value can point the
 * editor at another machine. Strict: a host, a URL or a path in it is refused with 400.
 */
export const AssistantLocalConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).describe('The port the owner\'s local server listens on, on 127.0.0.1 only'),
  timeoutSeconds: z.number().int().min(5).max(600),
}).strict();
export type AssistantLocalConfig = z.infer<typeof AssistantLocalConfigSchema>;
/** PUT /api/v1/assistant/config (owner only). No key in it: the key has its own route. */
export const AssistantConfigBodySchema = z.object({
  adapter: z.string().min(1).max(64).nullable(),
  host: z.string().min(1).max(253).nullable().describe('The service host (https only, and listed in PF_ASSISTANT_HOSTS)'),
  model: z.string().min(1).max(128).nullable(),
  pricesCentsPerMTok: z.object({ input: Price, output: Price }).strict().nullable().describe('Typed in by the owner from the provider’s price list'),
  monthlyLimitCents: Cents, perRequestCapCents: Cents,
  toggles: z.object({ titlesAndMarkers: z.boolean(), peopleNames: z.boolean() }).strict(),
  /** wave 7: the local assistant (used when `adapter` is ASSISTANT_LOCAL_ADAPTER_ID); absent in a config saved before it */
  local: AssistantLocalConfigSchema.nullable().optional(),
}).strict();
export type AssistantConfigBody = z.infer<typeof AssistantConfigBodySchema>;
/** PUT /api/v1/assistant/key (owner only). */
export const AssistantKeyBodySchema = z.object({ key: z.string().min(1).max(4096) }).strict();
export interface AssistantKeyState { keySet: boolean; keyAddedAt: string | null }
/** POST /api/v1/projects/:id/assistant/requests (owner only) → 202 { jobId } | 409 assistant_not_connected (no job row) | 402 budget_exceeded. */
export const AssistantRequestBodySchema = z.object({
  text: z.string().min(1).max(ASSISTANT_TEXT_MAX),
  selection: z.array(z.string().max(128)).max(2000),
  playheadFrame: z.number().int().nonnegative(),
  sequenceId: z.string().max(128).optional(),
  /** wave 7: the language the local assistant's phrase is written in (the editor's UI language); absent = Hebrew */
  lang: z.enum(['he', 'en']).optional(),
}).strict();
export type AssistantRequestBody = z.infer<typeof AssistantRequestBodySchema>;
/** The output of a succeeded assistant.propose job. */
export interface AssistantJobOutput { proposalId: string; explanation: string | null; opsCount: number; costCents: number; costBasis: 'reported' | 'reserved' }

/**
 * The project summary a model receives (plan §7.3): an ALLOWLIST, built field by field (never a spread document object).
 * Assets appear only as aliases A1, A2… by first use. Text clips carry `text` only with toggles.titlesAndMarkers (live-field
 * tokens written as {שדה}), else `chars` and `hasFields`; markers carry `label` and tracks their own `name` only with that
 * toggle (else «רצועת וידאו 2»); `people` exists only
 * with toggles.peopleNames and then holds ids and names only. `folded` lists the per-track counts of clips left out to stay
 * under SUMMARY_MAX_BYTES (null when nothing was folded).
 */
export interface AssistantSummary {
  format: 'pulseframe.assistant-summary'; version: 1;
  settings: { width: number; height: number; frameRate: { num: number; den: number } };
  duration: { time: T.RationalTime; seconds: number };
  playheadFrame: number; selection: string[]; sequenceId: string;
  /**
   * `name` is the owner's own track name (cut to 40 characters) ONLY with toggles.titlesAndMarkers: track names are
   * owner-typed free text and may hold a child's name (lead decision after the contracts review). With the switch off it is
   * the track's kind and its position among the tracks of that kind, «רצועת וידאו 2».
   */
  tracks: { id: string; kind: string; name: string; locked: boolean; muted: boolean; gain: number | null }[];
  clips: {
    id: string; trackId: string; type: string; start: T.RationalTime; duration: T.RationalTime;
    asset: string | null; assetKind: 'video' | 'image' | 'audio' | null; linked: boolean; gain: number | null; speed: number | null;
    transition: boolean; effects: number; text?: string; chars?: number; hasFields?: boolean;
    /**
     * A drawn clip (wave 8 carrier, drawn.ts): its kind and the kind's name always; the kind's own summary (drawnSummary) only
     * with toggles.titlesAndMarkers, like a title's words (a map's stops are owner-typed names). Never the payload itself.
     */
    drawn?: { kind: string; name: { he: string; en: string } } & Record<string, unknown>;
  }[];
  folded: { trackId: string; clips: number }[] | null;
  music: { asset: string; beats: number; bpm: number | null }[];
  markers: { time: T.RationalTime; label?: string }[];
  people?: { id: string; name: string }[];
  /** What the switches allowed, so the summary says what it holds. */
  sent: AssistantToggles;
}
/** The top-level fields of AssistantSummary: the descriptor's dataSent and the «מה נשלח?» list. */
export const ASSISTANT_SUMMARY_FIELDS = ['format', 'version', 'settings', 'duration', 'playheadFrame', 'selection', 'sequenceId', 'tracks', 'clips', 'folded', 'music', 'markers', 'people', 'sent'] as const satisfies readonly (keyof AssistantSummary)[];
/** Never sent, whatever the switches (decision 7); each has words in i18n 'assistant.never.<id>'. */
export const ASSISTANT_NEVER_SENT = ['media', 'file_names', 'capture', 'events', 'transcripts', 'analyses', 'provenance', 'recipe_params', 'birth_dates'] as const;
export type AssistantNeverSent = (typeof ASSISTANT_NEVER_SENT)[number];

// =====================================================================================================================
// The LOCAL language assistant (wave 7 track `assistant`; .artifacts/wave7/assistant-decisions.md). LEAD pre-pass contract.
//
// The owner starts a local llama.cpp server (the library's model, a short Hebrew guide); the editor reaches it ONLY at
// http://127.0.0.1:<port> (providers localChat.ts). The model writes no operations: it answers { intent, slots } from the small
// vocabulary below. The server keeps only what the owner said (groundLocalAnswer: a number, time or text that is not in the request
// is dropped, so the grammar asks), renders ONE phrase in the bar's own language (localPhrase), and the owner's tab reads it with the
// model-free grammar: preview, then Enter, then commitExact (one transaction, one undo). Nothing from the project is sent. No money.
// =====================================================================================================================
export const ASSISTANT_LOCAL_ADAPTER_ID = 'local-llama-server';
/** The settings the editor offers first (the guide uses the same port); the owner may change both. */
export const ASSISTANT_LOCAL_DEFAULTS: Readonly<AssistantLocalConfig> = Object.freeze({ port: 8791, timeoutSeconds: 60 });
/** The longest request the local assistant is sent (a small model's context; the bar's own limit is ASSISTANT_TEXT_MAX). */
export const ASSISTANT_LOCAL_TEXT_MAX = 400;
/** The answer is at most this many tokens (`{ intent, slots }` needs far fewer). */
export const ASSISTANT_LOCAL_MAX_TOKENS = 128;
/** The job input's `profile` of a local request (a cloud request has none). */
export const ASSISTANT_LOCAL_PROFILE = 'local' as const;

/** The grammar intents the local model may answer with (a subset of INTENT_IDS; effects, looks, names, language, open and sync are not offered). */
export const LOCAL_INTENTS = ['split_here', 'split_at', 'trim_start_here', 'trim_end_here', 'delete_clip', 'delete_keep_gap', 'add_title',
  'gain_change', 'mute', 'unmute', 'transitions_all', 'transition_here', 'add_marker', 'close_gaps', 'freeze', 'speed', 'fades', 'fit_music',
  'rename_project', 'remove_empty_tracks', 'undo', 'redo', 'seek', 'play', 'pause', 'zoom_in', 'zoom_out', 'workspace', 'export_to'] as const satisfies readonly IntentId[];
export type LocalIntent = (typeof LOCAL_INTENTS)[number];
/** 'none': nothing in the vocabulary fits (or the request is not an editing request). */
export const LOCAL_ANSWER_INTENTS = [...LOCAL_INTENTS, 'none'] as const;
export type LocalAnswerIntent = (typeof LOCAL_ANSWER_INTENTS)[number];

export const LOCAL_SLOT_NAMES = ['at', 'atSeconds', 'forSeconds', 'target', 'dir', 'db', 'factor', 'edge', 'text', 'workspace', 'destination'] as const;
export type LocalSlotName = (typeof LOCAL_SLOT_NAMES)[number];
export const LOCAL_POSITIONS = ['here', 'start', 'end'] as const;
export const LOCAL_TARGETS = ['music', 'clip'] as const;
export const LOCAL_DIRECTIONS = ['up', 'down'] as const;
export const LOCAL_EDGES = ['in', 'out'] as const;
/** The slots that carry a number: kept only when the grammar's own number or time reader finds that exact value in the request. */
export const LOCAL_NUMERIC_SLOTS = ['atSeconds', 'forSeconds', 'db', 'factor'] as const satisfies readonly LocalSlotName[];
/** A number slot is a decimal STRING (never a float): up to 6 digits, optionally a point and up to 3 digits. Checked on the server only. */
export const LOCAL_DECIMAL = /^\d{1,6}(?:\.\d{1,3})?$/;
/** A text slot (title, marker, project name): at most this many characters, an exact substring of the request, no quote or control character. */
export const LOCAL_TEXT_SLOT_MAX = 80;
export interface LocalSlots {
  at?: (typeof LOCAL_POSITIONS)[number]; atSeconds?: string; forSeconds?: string;
  target?: (typeof LOCAL_TARGETS)[number]; dir?: (typeof LOCAL_DIRECTIONS)[number]; db?: string; factor?: string;
  edge?: (typeof LOCAL_EDGES)[number]; text?: string; workspace?: (typeof BAR_WORKSPACES)[number]; destination?: (typeof EXPORT_DESTINATION_IDS)[number];
}
/** Which slots each intent takes; any other slot in an answer is dropped ('not_for_intent'). */
export const LOCAL_INTENT_SLOTS: Readonly<Record<LocalIntent, readonly LocalSlotName[]>> = {
  split_here: [], split_at: ['atSeconds'], trim_start_here: [], trim_end_here: [], delete_clip: [], delete_keep_gap: [],
  add_title: ['text', 'at', 'atSeconds', 'forSeconds'], gain_change: ['target', 'dir', 'db'], mute: ['target'], unmute: ['target'],
  transitions_all: [], transition_here: [], add_marker: ['text'], close_gaps: [], freeze: ['forSeconds'], speed: ['factor'],
  fades: ['edge', 'forSeconds'], fit_music: [], rename_project: ['text'], remove_empty_tracks: [], undo: [], redo: [],
  seek: ['at', 'atSeconds'], play: [], pause: [], zoom_in: [], zoom_out: [], workspace: ['workspace'], export_to: ['destination'],
};
/**
 * The model's answer as the SERVER checks it (the schema sent to the model is apps/server/src/assistant/localPrompt.ts
 * localAnswerJsonSchema: the same keys, pattern-free, because llama.cpp's grammar converter takes no Unicode classes).
 */
export const LocalAnswerSchema = z.object({
  intent: z.enum(LOCAL_ANSWER_INTENTS),
  slots: z.object({
    at: z.enum(LOCAL_POSITIONS).optional(), atSeconds: z.string().max(12).optional(), forSeconds: z.string().max(12).optional(),
    target: z.enum(LOCAL_TARGETS).optional(), dir: z.enum(LOCAL_DIRECTIONS).optional(), db: z.string().max(12).optional(), factor: z.string().max(12).optional(),
    edge: z.enum(LOCAL_EDGES).optional(), text: z.string().max(LOCAL_TEXT_SLOT_MAX).optional(),
    workspace: z.enum(BAR_WORKSPACES).optional(), destination: z.enum(EXPORT_DESTINATION_IDS).optional(),
  }).strict(),
}).strict();
export type LocalAnswer = z.infer<typeof LocalAnswerSchema>;
/** Why a slot of the answer was not kept: not said by the owner, not a slot of that intent, or not in the slot's form. */
export const LOCAL_DROP_REASONS = ['ungrounded', 'not_for_intent', 'malformed'] as const;
export type LocalDropReason = (typeof LOCAL_DROP_REASONS)[number];
/** Why an answer was refused (job failed invalid_model_output, with the category and a fixed sentence; nothing of the answer is kept). */
export const LOCAL_INVALID_CATEGORIES = ['cut_off', 'empty', 'not_json', 'wrong_shape', 'not_a_command'] as const;
export type LocalInvalidCategory = (typeof LOCAL_INVALID_CATEGORIES)[number];

/**
 * The output of a succeeded LOCAL job (job input profile 'local'). `phrase` is the bar phrase the server rendered (null for intent
 * 'none'); the owner's tab puts it in the bar's input and the grammar reads it. `phrase` and `slots.text` can repeat what the owner
 * typed, so they live in the row only until the owner's tab calls `taken`, the next request on the project, or project delete; then
 * `cleared` is true, `phrase` null and `slots` {} (direct SQL inside Store.erasing). `model` is the name the local server reported
 * (basename only). `wallMs` is one measurement of this request.
 */
export interface AssistantLocalOutput {
  kind: 'local-intent'; intent: LocalAnswerIntent; slots: LocalSlots;
  dropped: { slot: LocalSlotName; why: LocalDropReason }[];
  phrase: string | null; model: string | null; wallMs: number; cleared?: true;
}
/** What a succeeded assistant job carries: the cloud proposal (no `kind`) or the local phrase. */
export type AssistantJobAnswer = AssistantJobOutput | AssistantLocalOutput;
export const isLocalOutput = (o: unknown): o is AssistantLocalOutput => !!o && typeof o === 'object' && (o as { kind?: unknown }).kind === 'local-intent';

/** What the check route found on the owner's port: a llama.cpp-like server with its model loaded, one still loading, nothing, or something else. */
export const LOCAL_RUNTIME_STATES = ['running', 'loading', 'stopped', 'not_llama'] as const;
export type LocalRuntimeState = (typeof LOCAL_RUNTIME_STATES)[number];
/** POST /api/v1/assistant/local/check (owner's session only) → this; also kept as AssistantLocalStatus.lastCheck (in memory). */
export interface AssistantLocalCheck { state: LocalRuntimeState; model: string | null; checkedAt: string }
/** The owner's status, `local` part. */
export interface AssistantLocalStatus { port: number; timeoutSeconds: number; lastCheck: AssistantLocalCheck | null }
