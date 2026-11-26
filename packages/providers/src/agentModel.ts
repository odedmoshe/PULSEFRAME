/**
 * The in-editor agent's model adapters (wave 8 autonomy Part 2). LEAD PRE-PASS: the provider-neutral interface, the two wire
 * families' request and response TYPES, the provider presets and the converter SIGNATURES (stubs). BUILDER W2 (opus) owns this
 * file after the pre-pass and writes the converters and the two network adapters in agentAnthropic.ts and agentOpenAIChat.ts.
 *
 * Wire facts come ONLY from .artifacts/wave8/providers-research.md (official pages read 2026-11-26), never from memory. Section
 * numbers below (R§1.2 …) point into it. Version 1 has two families (lead decision, Part 2 §1):
 *  A `anthropic-messages`  POST {baseUrl}/v1/messages; `x-api-key` (or Authorization: Bearer); `anthropic-version: 2026-10-21`
 *                          REQUIRED (R§1.1); that version REMOVES temperature/top_p/top_k (400 if sent, R§1.1); tool input is an
 *                          OBJECT; results are `tool_result` blocks inside a user message, FIRST in its content, one per tool_use,
 *                          `is_error` for failures (R§1.2); images may sit inside tool_result.content (R§1.2, vision); forced
 *                          tool_choice (`any`/`tool`) is a 400 on Fable 5.2, Opus 5.5, Sonnet 5.5 (R§1.1): the loop sends `auto`;
 *                          caching is opt-in with `cache_control` (R§1.4).
 *  C `openai-chat`         POST {baseUrl}/chat/completions; Authorization: Bearer (none for a local server); tool arguments are a
 *                          JSON STRING; results are `{role:"tool", tool_call_id, content}` (R§2.3); an image in a tool message is
 *                          NOT confirmed for any provider (R§8), so stills go in a FOLLOWING user message (verifier C11);
 *                          image parts are `{type:"image_url", image_url:{url:"data:…"}}` (R§2.3, R§4.8; Ollama's own example uses
 *                          a plain string, R§5); xAI streams a call whole (R§3.3); llama.cpp parallel calls are off by default
 *                          (R§6); Ollama does not support tool_choice (R§5); images on local servers need a projector (R§6).
 * Families B (OpenAI Responses, which OpenAI recommends and xAI prefers) and D (Gemini Interactions) are the NEXT step; the connect
 * card says «מחובר דרך נקודת הקצה התואמת» for providers reached through family C (preset.compatNote).
 *
 * Errors (C16): every adapter maps its provider's answer to AgentProviderError with one of AGENT_PROVIDER_ERROR_CODES (core):
 *  Anthropic (R§1.5): 401 unauthorized · 402 / 400 "spend limit" → no_credit · 429 → rate_limited (retry-after) · 529 / 500 / 504
 *  → overloaded · 400 "prompt is too long" or stop_reason model_context_window_exceeded → context_too_long · stop_reason refusal → refused.
 *  OpenAI-style (R§2.6, R§3.5, R§4.6): 401 unauthorized · 429 credit_balance_exhausted / insufficient_quota / *_spend_limit_exceeded
 *  → no_credit · other 429 → rate_limited · 503 / 500 → overloaded · 402 (Gemini payment_required) → no_credit · ECONNREFUSED on a
 *  loopback/LAN base URL → local_server_down · context too long: code not documented (R§2.6) → the adapter matches the message.
 *  A request written and its answer lost → unknown_after_send (never re-sent; counted as unknown money).
 * Keys: passed per call, never stored here, never put in an error (redact before building `detail`).
 */
/** The same list as core AGENT_PROVIDER_ERROR_CODES (providers does not depend on core; apps/server/src/agentContracts.test.ts keeps them equal). */
export const AGENT_ADAPTER_ERROR_CODES = ['unauthorized', 'no_credit', 'rate_limited', 'overloaded', 'unreachable', 'local_server_down', 'context_too_long', 'no_tool_calling', 'bad_tool_call', 'refused', 'bad_request', 'unknown_after_send'] as const;
export type AgentProviderErrorCode = (typeof AGENT_ADAPTER_ERROR_CODES)[number];

import type { JsonSchema } from './chat.ts';

// ---------- provider-neutral messages (what the loop rebuilds from the steps) ----------
export interface AgentImage { mediaType: 'image/png' | 'image/jpeg'; base64: string; /** what the loop shows instead once the image is dropped (keepImages) */ label: string }
export type AgentMessage =
  | { role: 'user'; text: string; images?: AgentImage[] }
  | { role: 'assistant'; text: string | null; toolCalls: AgentToolCall[] }
  | { role: 'tool'; results: AgentToolResult[] };
export interface AgentToolCall { id: string; name: string; /** parsed object (family C parses the JSON string; a parse failure is bad_tool_call) */ input: unknown }
export interface AgentToolResult { callId: string; text: string; isError: boolean; images?: AgentImage[] }
export interface AgentToolSpec { name: string; description: string; inputSchema: JsonSchema }

export interface AgentTurnRequest {
  system: string;
  messages: AgentMessage[];
  tools: AgentToolSpec[];
  maxOutputTokens: number;
  /** family A: mark the system and tools for caching (cache_control); ignored by family C (implicit caching) */
  cache: boolean;
  /** false for local servers (llama.cpp parallel calls off by default, R§6) */
  parallelToolCalls: boolean;
}
export interface AgentEndpoint { providerId: string; family: AgentFamily; baseUrl: string; model: string }
export interface AgentTurnResponse {
  text: string | null;
  toolCalls: AgentToolCall[];
  finish: 'tool' | 'stop' | 'length' | 'refusal' | 'other';
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | null;
  providerRequestId: string | null;
}
export type AgentProbeResult = { ok: true; model: string } | { ok: false; code: AgentProviderErrorCode | 'bad_config'; detail: string };

/** What an adapter throws. `retryAfterSeconds` from the provider's header when it sent one. */
export class AgentProviderError extends Error {
  constructor(readonly code: AgentProviderErrorCode, readonly retryable: boolean, detail: string, readonly retryAfterSeconds: number | null = null) {
    super(detail);
    this.name = 'AgentProviderError';
  }
}

export const AGENT_FAMILIES = ['anthropic-messages', 'openai-chat'] as const;
export type AgentFamily = (typeof AGENT_FAMILIES)[number];

/** One network adapter per family; a test double says MOCK in its id. */
export interface AgentModelAdapter {
  readonly id: string;
  readonly family: AgentFamily | 'mock-scripted';
  turn(req: AgentTurnRequest, ep: AgentEndpoint, key: string | null, signal: AbortSignal): Promise<AgentTurnResponse>;
  /** «בדיקה»: the smallest request that proves the key, the base URL and the model (a 1-token turn without tools) */
  probe(ep: AgentEndpoint, key: string | null, signal: AbortSignal): Promise<AgentProbeResult>;
}

// ---------- family A wire types (R§1.2, R§1.4) ----------
export type AnthropicImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } };
export type AnthropicTextBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
export type AnthropicToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type AnthropicToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string | (AnthropicTextBlock | AnthropicImageBlock)[]; is_error?: boolean };
export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system?: string | AnthropicTextBlock[];
  tools: { name: string; description: string; input_schema: JsonSchema; cache_control?: { type: 'ephemeral' } }[];
  /** always {type:'auto'} (forced choice is a 400 on the 5.5 models, R§1.1); disable_parallel_tool_use when parallelToolCalls is false */
  tool_choice?: { type: 'auto'; disable_parallel_tool_use?: boolean };
  messages: { role: 'user' | 'assistant'; content: string | (AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock)[] }[];
  /** NEVER temperature / top_p / top_k (removed in 2026-10-21, R§1.1) */
}
export interface AnthropicMessagesResponse {
  id: string; model: string; role: 'assistant';
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'model_context_window_exceeded' | string;
  content: (AnthropicTextBlock | AnthropicToolUseBlock)[];
  usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}
export const ANTHROPIC_VERSION = '2026-10-21';

// ---------- family C wire types (R§2.3) ----------
export type OpenAIChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type OpenAIChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIChatContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  tools: { type: 'function'; function: { name: string; description: string; parameters: JsonSchema } }[];
  /** 'auto' except for providers whose preset says tool_choice is unsupported (Ollama, R§5): then omitted */
  tool_choice?: 'auto';
  parallel_tool_calls?: boolean;
  max_tokens?: number;
}
export interface OpenAIChatResponse {
  id?: string;
  choices: { index: number; finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | string; message: { role: 'assistant'; content: string | null; refusal?: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
}

// ---------- converters (W2; pure, unit-tested against the research's quoted examples) ----------
const notBuilt = (fn: string): never => { throw new Error(`${fn}: the agent adapters are not built in this build yet (agent_not_built)`); };
export function toAnthropicRequest(req: AgentTurnRequest, model: string): AnthropicMessagesRequest { void req; void model; return notBuilt('toAnthropicRequest'); }
export function fromAnthropicResponse(res: AnthropicMessagesResponse): AgentTurnResponse { void res; return notBuilt('fromAnthropicResponse'); }
export function toOpenAIChatRequest(req: AgentTurnRequest, model: string, preset: AgentProviderPreset): OpenAIChatRequest { void req; void model; void preset; return notBuilt('toOpenAIChatRequest'); }
export function fromOpenAIChatResponse(res: OpenAIChatResponse): AgentTurnResponse { void res; return notBuilt('fromOpenAIChatResponse'); }

// ---------- provider presets (data; the owner edits base URL and model in the connect card) ----------
export interface AgentProviderPreset {
  id: string;
  family: AgentFamily;
  baseUrl: string;
  /** false for local servers: the key field is hidden and no key is sent */
  needsKey: boolean;
  /** headers family A must send besides the key */
  versionHeader: string | null;
  supportsToolChoice: boolean;
  parallelToolCalls: boolean;
  /** the provider's own default API is another family: the card says «מחובר דרך נקודת הקצה התואמת» */
  compatNote: boolean;
  /** http:// to a non-loopback host: the card says «החיבור לא מוצפן» (verifier C5) and nothing blocks it; computed per base URL too */
  local: boolean;
  /** research section the facts come from */
  source: string;
}
export const AGENT_PROVIDER_PRESETS: readonly AgentProviderPreset[] = Object.freeze([
  { id: 'anthropic', family: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', needsKey: true, versionHeader: `anthropic-version: ${ANTHROPIC_VERSION}`, supportsToolChoice: true, parallelToolCalls: true, compatNote: false, local: false, source: 'R§1' },
  { id: 'openai', family: 'openai-chat', baseUrl: 'https://api.openai.com/v1', needsKey: true, versionHeader: null, supportsToolChoice: true, parallelToolCalls: true, compatNote: true, local: false, source: 'R§2.1, R§2.3' },
  { id: 'xai', family: 'openai-chat', baseUrl: 'https://api.x.ai/v1', needsKey: true, versionHeader: null, supportsToolChoice: true, parallelToolCalls: true, compatNote: true, local: false, source: 'R§3.1 (Chat Completions is xAI\'s legacy endpoint)' },
  { id: 'gemini', family: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, versionHeader: null, supportsToolChoice: true, parallelToolCalls: true, compatNote: true, local: false, source: 'R§4.8 (beta)' },
  { id: 'ollama', family: 'openai-chat', baseUrl: 'http://localhost:11434/v1', needsKey: false, versionHeader: null, supportsToolChoice: false, parallelToolCalls: false, compatNote: false, local: true, source: 'R§5' },
  { id: 'llamacpp', family: 'openai-chat', baseUrl: 'http://127.0.0.1:9931/v1', needsKey: false, versionHeader: null, supportsToolChoice: true, parallelToolCalls: false, compatNote: false, local: true, source: 'R§6 (port of this README version; the owner types his)' },
]);
/** True when the key and the stills would cross the network unencrypted (http:// to a host other than loopback): the card says so. */
export function isUnencryptedRemote(baseUrl: string): boolean {
  let u: URL;
  try { u = new URL(baseUrl); } catch { return false; }
  return u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
}
