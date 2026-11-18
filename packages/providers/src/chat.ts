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
/** Every reason the assistant may not send, in the order the owner fixes them; empty = ready. W2 builds it (plan §7.1). */
export function chatBlockers(_d: ChatCapabilityDescriptor, _cfg: ChatSetupInput): ChatBlocker[] {
  throw new Error('chatBlockers: not built yet (ADR-0027 W2); the assistant stays «לא מחובר»');
}
