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
] as const;
/** The ops a proposal may hold: every registered public op minus ASSISTANT_EXCLUDED_OPS and PERSON_OPS, in registry order. */
export function assistantOps(): string[] {
  const out = new Set<string>([...ASSISTANT_EXCLUDED_OPS, ...PERSON_OPS]);
  return listOps().filter((o) => !o.internal && !out.has(o.name)).map((o) => o.name);
}

/** The setup state, in the order the owner fixes them. Only 'ready' lets a request leave the machine. */
export const ASSISTANT_SETUP_CODES = ['ready', 'provider_not_configured', 'prices_missing', 'limit_missing', 'host_not_allowed', 'prompt_digest_mismatch'] as const;
export type AssistantSetup = (typeof ASSISTANT_SETUP_CODES)[number];
export const ASSISTANT_ERROR_CODES = ['assistant_not_connected', 'owner_required', 'budget_exceeded', 'invalid_model_output', 'provider_error', 'submission_unknown'] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];
/** Job stages, said in words in the editor (never a percentage). */
export const ASSISTANT_STAGES = ['sending', 'awaiting-provider', 'checking'] as const;
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
/** PUT /api/v1/assistant/config (owner only). No key in it: the key has its own route. */
export const AssistantConfigBodySchema = z.object({
  adapter: z.string().min(1).max(64).nullable(),
  host: z.string().min(1).max(253).nullable().describe('The service host (https only, and listed in PF_ASSISTANT_HOSTS)'),
  model: z.string().min(1).max(128).nullable(),
  pricesCentsPerMTok: z.object({ input: Price, output: Price }).strict().nullable().describe('Typed in by the owner from the provider’s price list'),
  monthlyLimitCents: Cents, perRequestCapCents: Cents,
  toggles: z.object({ titlesAndMarkers: z.boolean(), peopleNames: z.boolean() }).strict(),
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
