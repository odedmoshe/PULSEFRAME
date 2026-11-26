/**
 * The language-model path of the command bar (ADR-0027, plan §7.1–7.2): a PROVIDER-NEUTRAL adapter interface and the chat
 * capability descriptor. LEAD: the types and the descriptor schema; W2 adds ASSISTANT_CAPABILITY (state 'draft') and the
 * body of chatBlockers here, and writes no network adapter (wave 1 ships none; no provider is picked, no key is asked for).
 *
 * ChatCapabilityDescriptorSchema stays OUTSIDE DescriptorSchema (descriptor.ts) until the first real adapter exists (lead
 * decision 10): capabilities.ts dispatches the registry by `provider`, and a chat capability is not run as a capability job.
 * A test keeps it out of ALL_CAPABILITIES and out of the union.
 */
import { z } from 'zod';
import { QualificationSchema } from './descriptor.ts';

/** JSON Schema of the one tool (the MCP propose_transaction input narrowed to the assistant's ops, z.toJSONSchema). */
export type JsonSchema = Record<string, unknown>;
/** Where requests go: chosen by the owner in Settings (config file, never the key). */
export interface ChatEndpoint { adapter: string; host: string; model: string }
export interface ChatRequest {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tool: { name: 'propose_transaction'; description: string; inputSchema: JsonSchema };
  maxOutputTokens: number;
  temperature: 0;
  /** The job id: sent as the provider's idempotency key where it has one. */
  idempotencyKey: string;
}
export type ChatFinish = 'tool' | 'stop' | 'length' | 'filtered' | 'other';
export interface ChatResponse {
  /** The tool call's input, or null when the model answered without it. */
  toolInput: unknown | null;
  text: string | null;
  finish: ChatFinish;
  /** Reported by the provider; null = not reported (the job then settles at the reservation). */
  usage: { inputTokens: number; outputTokens: number } | null;
  providerRequestId: string | null;
}
export const CHAT_ERROR_CODES = ['unauthorized', 'rate_limited', 'bad_request', 'unreachable_before_send', 'unknown_after_send'] as const;
export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];
/**
 * What an adapter throws. `unknown_after_send`: the request was written and the answer was lost (timeout, connection loss),
 * so the provider may have charged; the job becomes submission-unknown, the ledger stays unknown and nothing is retried
 * (SPEC §20). `detail` has passed redact(key) before it is built.
 */
export class ChatProviderError extends Error {
  constructor(public readonly code: ChatErrorCode, public readonly retryable: boolean, detail: string) {
    super(detail);
    this.name = 'ChatProviderError';
  }
}
export type ChatProbeResult = { ok: true } | { ok: false; code: 'unauthorized' | 'unreachable' | 'bad_config'; detail: string };
/** One chat-completion API (system text, user/assistant turns, one tool, a token cap, usage, an id). Nothing provider-specific leaks into the job. */
export interface ChatModelAdapter {
  /** e.g. 'openai-chat', 'anthropic-messages' — chosen later by the owner; a test double says MOCK in its id. */
  readonly id: string;
  /**
   * True when the provider's tokenizer never makes more tokens than UTF-8 bytes (byte-level BPE): the job's byte-bound
   * estimate is then an upper bound. Otherwise only the owner's per-request cap bounds a request.
   */
  readonly bytesBoundTokens: boolean;
  probe(cfg: ChatEndpoint, key: string, signal: AbortSignal): Promise<ChatProbeResult>;
  complete(req: ChatRequest, cfg: ChatEndpoint, key: string, signal: AbortSignal): Promise<ChatResponse>;
}

const Bilingual = z.object({ he: z.string(), en: z.string() }).strict();
/** The capability a chat model offers this product: an edit PROPOSAL from an allowlisted summary. Not a DescriptorSchema member. */
export const ChatCapabilityDescriptorSchema = z.object({
  id: z.literal('assistant.edit-proposal'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  state: z.enum(['draft', 'published']),
  provider: z.literal('chat'),
  title: Bilingual,
  description: Bilingual,
  /** sha256 of canonical({ system, tool }) of the reviewed prompt (apps/server/src/assistant/prompt.ts), pinned like graphDigest and codeDigest. */
  promptDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /** Hosts are filled only from the owner's config (and must be in PF_ASSISTANT_HOSTS); empty in the shipped descriptor. */
  egress: z.object({ kind: z.literal('remote-api'), hosts: z.array(z.string()) }).strict(),
  /** The summary's fields (core ASSISTANT_SUMMARY_FIELDS): exactly what may leave the machine. */
  dataSent: z.array(z.string()).min(1),
  cost: z.object({ basis: z.literal('per token at owner-entered prices'), perRequestCapCents: z.number().int().nonnegative() }).strict(),
  languages: z.array(z.enum(['he', 'en'])),
  /** The seven dimensions; all not_assessed except schemaValid until a real adapter is qualified by a live run. */
  qualification: QualificationSchema,
}).strict();
export type ChatCapabilityDescriptor = z.infer<typeof ChatCapabilityDescriptorSchema>;

/** Why the assistant cannot send (the same codes as core ASSISTANT_SETUP_CODES minus 'ready'; a server test keeps them equal). */
export const CHAT_BLOCKER_CODES = ['provider_not_configured', 'prices_missing', 'limit_missing', 'host_not_allowed', 'prompt_digest_mismatch'] as const;
export type ChatBlockerCode = (typeof CHAT_BLOCKER_CODES)[number];
export interface ChatBlocker { code: ChatBlockerCode; message: string }
/** What chatBlockers reads: the owner's config (no key), whether a key is stored, the installed adapters, the allowed hosts and the current prompt digest. */
export interface ChatSetupInput {
  adapter: string | null; host: string | null; model: string | null; keySet: boolean;
  pricesCentsPerMTok: { input: number; output: number } | null; monthlyLimitCents: number; perRequestCapCents: number;
  adapters: readonly string[]; allowedHosts: readonly string[]; promptDigest: string;
}
/** A host name as PF_ASSISTANT_HOSTS lists them: two or more lowercase DNS labels, the last with a letter (so no IPv4 literal); no scheme, port or path. */
export const CHAT_HOST_PATTERN = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+(?!-)(?=[a-z0-9-]*[a-z])[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Every reason the assistant may not send, in the order the owner fixes them (plan §7.1); empty = ready. Pure: it reads only
 * what it is handed (never the key itself, only whether one is stored).
 *  - provider_not_configured: no adapter chosen, the chosen adapter is not installed in this build (none is, in wave 1), no
 *    host, no model, or no key;
 *  - prices_missing: no prices, or a price that is not more than 0;
 *  - limit_missing: the monthly limit or the per-request cap is 0 (not set) — decision 8, nothing is sent until both are set;
 *  - host_not_allowed: the host is not a plain host name (requests go to https://<host> only) or is not in PF_ASSISTANT_HOSTS;
 *  - prompt_digest_mismatch: the prompt and tool schema this server would send are not the reviewed ones the descriptor pins.
 */
export function chatBlockers(d: ChatCapabilityDescriptor, cfg: ChatSetupInput): ChatBlocker[] {
  const out: ChatBlocker[] = [];
  const missing: string[] = [];
  if (!cfg.adapter) missing.push('no adapter is chosen');
  else if (!cfg.adapters.includes(cfg.adapter)) missing.push(cfg.adapters.length ? `the adapter "${cfg.adapter}" is not installed (installed: ${cfg.adapters.join(', ')})` : `the adapter "${cfg.adapter}" is not installed: this build has no network adapter`);
  if (!cfg.host) missing.push('no host is set');
  if (!cfg.model) missing.push('no model is set');
  if (!cfg.keySet) missing.push('no key is stored');
  if (missing.length) out.push({ code: 'provider_not_configured', message: `the language assistant is not connected: ${missing.join('; ')}` });
  const p = cfg.pricesCentsPerMTok;
  if (!p || !(p.input > 0) || !(p.output > 0) || !Number.isFinite(p.input) || !Number.isFinite(p.output)) out.push({ code: 'prices_missing', message: 'the prices per million input and output tokens are not set (each must be more than 0, typed in from the provider\'s price list)' });
  if (!(cfg.monthlyLimitCents > 0) || !(cfg.perRequestCapCents > 0)) out.push({ code: 'limit_missing', message: `spending is not limited yet: ${[!(cfg.monthlyLimitCents > 0) ? 'the monthly limit' : '', !(cfg.perRequestCapCents > 0) ? 'the per-request cap' : ''].filter(Boolean).join(' and ')} must be set (more than 0)` });
  if (cfg.host && (!CHAT_HOST_PATTERN.test(cfg.host) || !cfg.allowedHosts.includes(cfg.host))) out.push({ code: 'host_not_allowed', message: CHAT_HOST_PATTERN.test(cfg.host) ? `the host ${cfg.host} is not listed in PF_ASSISTANT_HOSTS` : `"${cfg.host}" is not a host name (requests go to https://<host> only)` });
  if (cfg.promptDigest !== d.promptDigest) out.push({ code: 'prompt_digest_mismatch', message: `the prompt and tool schema this server would send (${cfg.promptDigest}) are not the reviewed ones (${d.promptDigest})` });
  return out;
}

/**
 * The top-level fields of the summary that may leave the machine: the same list as core ASSISTANT_SUMMARY_FIELDS (this
 * package does not depend on core; apps/server/src/assistant/summary.test.ts keeps the two equal).
 */
export const ASSISTANT_DATA_SENT = ['format', 'version', 'settings', 'duration', 'playheadFrame', 'selection', 'sequenceId', 'tracks', 'clips', 'folded', 'music', 'markers', 'people', 'sent'] as const;
/**
 * sha256 of canonical({ system, tool }) of the reviewed prompt (apps/server/src/assistant/prompt.ts). Pinned: when the system
 * text or any op schema the tool offers changes, the server's digest differs, the setup state becomes prompt_digest_mismatch
 * and nothing is sent until the new prompt is reviewed and this pin is updated (prompt.test.ts prints the new digest).
 */
export const ASSISTANT_PROMPT_DIGEST = 'sha256:90a0e5b93c02fd3999c13bf5a9c5eca28d9985d66582baed37f7c4ee4551425c'; // wave 8 growing: re-pinned after review; the only change is add_clip's optional freeze argument
/**
 * The chat capability of wave 1 (plan §7.1): a DRAFT. No adapter exists, so it was never executed, and nothing about its
 * quality is claimed; only its schema is checked (chat.test.ts). Hosts are empty here: they come from the owner's config.
 */
export const ASSISTANT_CAPABILITY: ChatCapabilityDescriptor = ChatCapabilityDescriptorSchema.parse({
  id: 'assistant.edit-proposal',
  version: '0.1.0',
  state: 'draft',
  provider: 'chat',
  title: { he: 'עוזר השפה: הצעת עריכה', en: 'Language assistant: edit proposal' },
  description: {
    he: 'מודל שפה שהבעלים בוחר מקבל סיכום מצומצם של העריכה ומציע פעולות עריכה. ההצעה נבדקת ומחכה לאישור; שום דבר לא משתנה בלי אישור.',
    en: 'A language model the owner chooses receives an allowlisted summary of the edit and proposes editing operations. The proposal is checked and waits for the owner; nothing changes without their accept.',
  },
  promptDigest: ASSISTANT_PROMPT_DIGEST,
  egress: { kind: 'remote-api', hosts: [] },
  dataSent: [...ASSISTANT_DATA_SENT],
  cost: { basis: 'per token at owner-entered prices', perRequestCapCents: 0 },
  languages: ['he', 'en'],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'ChatCapabilityDescriptorSchema parses it (packages/providers/src/chat.test.ts)' },
    dependencyReady: { status: 'not_assessed', evidence: 'no network adapter exists in this build' },
    licenseReviewed: { status: 'not_assessed', evidence: 'no provider is chosen' },
    executed: { status: 'not_assessed', evidence: 'never run: no provider was called' },
    qualityReviewed: { status: 'not_assessed' },
    hebrewQualified: { status: 'not_assessed' },
    hardwareQualified: { status: 'not_assessed' },
  },
});
