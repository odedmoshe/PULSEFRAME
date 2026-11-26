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
/** `image_url` as a plain data-URL string only where the preset says so (Ollama's own example, R§5). */
export type OpenAIChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } | string };
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
/** JSON object (not an array, not null): the shape both families' tool input must have. */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Shown to the model in place of a tool result the history does not hold (both families need exactly one result per call). */
export const MISSING_RESULT_TEXT = 'no result was recorded for this call (the run was interrupted before it answered)';

/**
 * Family A (R§1.2, R§1.4). Rules: tool input is an OBJECT; the user message after an assistant turn with tool_use starts with
 * EXACTLY one tool_result per tool_use, in the calls' order (a missing one becomes an is_error result with MISSING_RESULT_TEXT;
 * a result whose call is not in the previous assistant turn is dropped), and any text or picture of a following user turn comes
 * AFTER the results in the same message; pictures of a tool result sit inside its tool_result.content; `is_error: true` only on
 * failures (the docs' success example has no flag); tool_choice is always {type:'auto'} (+ disable_parallel_tool_use when
 * parallel calls are off), and is left out when there are no tools; `cache` marks the system text and the LAST tool with
 * cache_control ephemeral (two of the four breakpoints); NEVER temperature / top_p / top_k (a 400 on 2026-10-21, R§1.1).
 * Thinking blocks are never replayed (the neutral history holds none; the API accepts a history with all of them removed).
 */
export function toAnthropicRequest(req: AgentTurnRequest, model: string): AnthropicMessagesRequest {
  type Block = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;
  const img = (i: AgentImage): AnthropicImageBlock => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.base64 } });
  const out: { role: 'user' | 'assistant'; content: Block[] }[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks); else out.push({ role, content: blocks });
  };
  let pendingCalls: AgentToolCall[] = [];
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: isObject(c.input) ? c.input : {} });
      push('assistant', blocks);
      pendingCalls = m.toolCalls;
      continue;
    }
    if (m.role === 'tool') {
      const byId = new Map(m.results.map((r) => [r.callId, r]));
      const blocks: Block[] = pendingCalls.map((c): AnthropicToolResultBlock => {
        const r = byId.get(c.id);
        if (!r) return { type: 'tool_result', tool_use_id: c.id, content: MISSING_RESULT_TEXT, is_error: true };
        const content: AnthropicToolResultBlock['content'] = r.images?.length ? [...(r.text ? [{ type: 'text' as const, text: r.text }] : []), ...r.images.map(img)] : r.text;
        return { type: 'tool_result', tool_use_id: c.id, content, ...(r.isError ? { is_error: true } : {}) };
      });
      pendingCalls = [];
      push('user', blocks);
      continue;
    }
    // a user turn: if it directly follows an assistant turn with calls and no tool message, the results are missing
    if (pendingCalls.length) { push('user', pendingCalls.map((c) => ({ type: 'tool_result' as const, tool_use_id: c.id, content: MISSING_RESULT_TEXT, is_error: true }))); pendingCalls = []; }
    push('user', [...(m.images ?? []).map(img), ...(m.text ? [{ type: 'text' as const, text: m.text }] : [])]);
  }
  if (pendingCalls.length) push('user', pendingCalls.map((c) => ({ type: 'tool_result' as const, tool_use_id: c.id, content: MISSING_RESULT_TEXT, is_error: true })));
  const tools = req.tools.map((t, i) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, ...(req.cache && i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}) }));
  const body: AnthropicMessagesRequest = { model, max_tokens: req.maxOutputTokens, tools, messages: out };
  if (req.system) body.system = req.cache ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }] : req.system;
  if (tools.length) body.tool_choice = req.parallelToolCalls ? { type: 'auto' } : { type: 'auto', disable_parallel_tool_use: true };
  return body;
}

/**
 * Family A answer → neutral. Text blocks are joined; tool_use blocks become calls (an input that is not an object throws
 * bad_tool_call); every other block type (thinking, progress updates, anything newer) is ignored. Raw stop reasons the loop
 * must act on are mapped by the network adapter (agentAnthropic.ts): refusal → refused, model_context_window_exceeded →
 * context_too_long; here they read as finish 'refusal' / 'length'.
 */
export function fromAnthropicResponse(res: AnthropicMessagesResponse): AgentTurnResponse {
  const content = Array.isArray(res.content) ? res.content as { type: string }[] : [];
  const texts: string[] = [];
  const toolCalls: AgentToolCall[] = [];
  for (const b of content) {
    if (b.type === 'text') texts.push((b as AnthropicTextBlock).text);
    else if (b.type === 'tool_use') {
      const u = b as AnthropicToolUseBlock;
      if (!isObject(u.input) || typeof u.id !== 'string' || typeof u.name !== 'string') throw new AgentProviderError('bad_tool_call', false, `tool_use block ${String(u.id)} has no object input`);
      toolCalls.push({ id: u.id, name: u.name, input: u.input });
    }
  }
  const sr = res.stop_reason;
  const finish: AgentTurnResponse['finish'] = sr === 'tool_use' ? 'tool' : sr === 'end_turn' || sr === 'stop_sequence' ? 'stop' : sr === 'max_tokens' || sr === 'model_context_window_exceeded' ? 'length' : sr === 'refusal' ? 'refusal' : toolCalls.length ? 'tool' : 'other';
  const u = res.usage;
  return {
    text: texts.length ? texts.join('\n') : null,
    toolCalls,
    finish,
    usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, ...(u.cache_read_input_tokens !== undefined ? { cacheReadTokens: u.cache_read_input_tokens } : {}), ...(u.cache_creation_input_tokens !== undefined ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}) } : null,
    providerRequestId: typeof res.id === 'string' ? res.id : null,
  };
}

/** The label line that introduces the stills of the tool calls just above (family C, verifier C11). */
export const STILLS_FOLLOW_TEXT = 'Pictures returned by the tool calls above:';
/**
 * Family C (R§2.3, R§4.8, R§5, R§6). Rules: the system text is the first message; tool arguments are a JSON STRING; results are
 * `{role:"tool", tool_call_id, content}` text only, one per call in the calls' order (a missing one says MISSING_RESULT_TEXT), an
 * error result's text starts with "Error: " (no is_error flag exists, R§2.3); the stills of the results go in ONE following user
 * message, after a text line naming each picture's call (an image in a tool message is confirmed for no provider, R§8);
 * an image part is `{type:"image_url", image_url:{url:"data:…"}}`, or the plain data-URL string where the preset says so (Ollama's
 * own example, R§5); tool_choice 'auto' only when the preset supports it (Ollama: not supported, R§5); `parallel_tool_calls:false`
 * is sent when parallel calls are off for the request or the preset (local servers, R§6), and nothing when they are on (the default
 * on OpenAI and xAI; unknown on Gemini's compat endpoint, R§4.8, so nothing unasked is sent).
 */
export function toOpenAIChatRequest(req: AgentTurnRequest, model: string, preset: AgentProviderPreset): OpenAIChatRequest {
  const part = (i: AgentImage): OpenAIChatContentPart => {
    const url = `data:${i.mediaType};base64,${i.base64}`;
    return preset.imageUrlAsString ? { type: 'image_url', image_url: url } : { type: 'image_url', image_url: { url } };
  };
  const messages: OpenAIChatMessage[] = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  let pendingCalls: AgentToolCall[] = [];
  const closeMissing = () => { for (const c of pendingCalls) messages.push({ role: 'tool', tool_call_id: c.id, content: MISSING_RESULT_TEXT }); pendingCalls = []; };
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      closeMissing();
      messages.push({ role: 'assistant', content: m.text ?? null, ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(isObject(c.input) ? c.input : {}) } })) } : {}) });
      pendingCalls = m.toolCalls;
      continue;
    }
    if (m.role === 'tool') {
      const byId = new Map(m.results.map((r) => [r.callId, r]));
      const stills: { callId: string; image: AgentImage }[] = [];
      for (const c of pendingCalls) {
        const r = byId.get(c.id);
        messages.push({ role: 'tool', tool_call_id: c.id, content: !r ? MISSING_RESULT_TEXT : r.isError ? `Error: ${r.text}` : r.text });
        for (const image of r?.images ?? []) stills.push({ callId: c.id, image });
      }
      pendingCalls = [];
      if (stills.length) {
        const lines = stills.map((s, k) => `${k + 1}. ${s.image.label} (call ${s.callId})`);
        messages.push({ role: 'user', content: [{ type: 'text', text: [STILLS_FOLLOW_TEXT, ...lines].join('\n') }, ...stills.map((s) => part(s.image))] });
      }
      continue;
    }
    closeMissing();
    messages.push({ role: 'user', content: m.images?.length ? [...(m.text ? [{ type: 'text' as const, text: m.text }] : []), ...m.images.map(part)] : m.text });
  }
  closeMissing();
  const body: OpenAIChatRequest = { model, messages, tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })), max_tokens: req.maxOutputTokens };
  if (body.tools.length && preset.supportsToolChoice) body.tool_choice = 'auto';
  if (body.tools.length && (!req.parallelToolCalls || !preset.parallelToolCalls)) body.parallel_tool_calls = false;
  return body;
}

/**
 * Family C answer → neutral. choices[0] only; arguments are parsed from the JSON string (unparseable, or not an object →
 * bad_tool_call); finish_reason tool_calls → 'tool', stop → 'stop', length → 'length', content_filter or a non-empty `refusal`
 * → 'refusal'; no choices → bad_request.
 */
export function fromOpenAIChatResponse(res: OpenAIChatResponse): AgentTurnResponse {
  const choice = Array.isArray(res.choices) ? res.choices[0] : undefined;
  if (!choice || !choice.message) throw new AgentProviderError('bad_request', false, 'the answer has no choices');
  const msg = choice.message;
  const toolCalls: AgentToolCall[] = (msg.tool_calls ?? []).map((c) => {
    let input: unknown;
    try { input = JSON.parse(c.function.arguments); } catch { throw new AgentProviderError('bad_tool_call', false, `the arguments of call ${c.id} (${c.function?.name}) are not JSON`); }
    if (!isObject(input)) throw new AgentProviderError('bad_tool_call', false, `the arguments of call ${c.id} (${c.function?.name}) are not a JSON object`);
    return { id: c.id, name: c.function.name, input };
  });
  const fr = choice.finish_reason;
  const finish: AgentTurnResponse['finish'] = msg.refusal ? 'refusal' : fr === 'tool_calls' ? 'tool' : fr === 'stop' ? (toolCalls.length ? 'tool' : 'stop') : fr === 'length' ? 'length' : fr === 'content_filter' ? 'refusal' : toolCalls.length ? 'tool' : 'other';
  const u = res.usage;
  const cached = u?.prompt_tokens_details?.cached_tokens;
  return {
    text: typeof msg.content === 'string' && msg.content.length ? msg.content : (msg.refusal ?? null),
    toolCalls,
    finish,
    usage: u ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, ...(cached !== undefined ? { cacheReadTokens: cached } : {}) } : null,
    providerRequestId: typeof res.id === 'string' ? res.id : null,
  };
}

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
  /** the image part's `image_url` is the plain data-URL string (Ollama's compat page example, R§5); otherwise {url} */
  imageUrlAsString?: boolean;
}
export const AGENT_PROVIDER_PRESETS: readonly AgentProviderPreset[] = Object.freeze([
  { id: 'anthropic', family: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', needsKey: true, versionHeader: `anthropic-version: ${ANTHROPIC_VERSION}`, supportsToolChoice: true, parallelToolCalls: true, compatNote: false, local: false, source: 'R§1' },
  { id: 'openai', family: 'openai-chat', baseUrl: 'https://api.openai.com/v1', needsKey: true, versionHeader: null, supportsToolChoice: true, parallelToolCalls: true, compatNote: true, local: false, source: 'R§2.1, R§2.3' },
  { id: 'xai', family: 'openai-chat', baseUrl: 'https://api.x.ai/v1', needsKey: true, versionHeader: null, supportsToolChoice: true, parallelToolCalls: true, compatNote: true, local: false, source: 'R§3.1 (Chat Completions is xAI\'s legacy endpoint)' },
  { id: 'gemini', family: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, versionHeader: null, supportsToolChoice: true, parallelToolCalls: true, compatNote: true, local: false, source: 'R§4.8 (beta)' },
  { id: 'ollama', family: 'openai-chat', baseUrl: 'http://localhost:11434/v1', needsKey: false, versionHeader: null, supportsToolChoice: false, parallelToolCalls: false, compatNote: false, local: true, source: 'R§5', imageUrlAsString: true },
  { id: 'llamacpp', family: 'openai-chat', baseUrl: 'http://127.0.0.1:9931/v1', needsKey: false, versionHeader: null, supportsToolChoice: true, parallelToolCalls: false, compatNote: false, local: true, source: 'R§6 (port of this README version; the owner types his)' },
]);
/** True when the key and the stills would cross the network unencrypted (http:// to a host other than loopback): the card says so. */
export function isUnencryptedRemote(baseUrl: string): boolean {
  let u: URL;
  try { u = new URL(baseUrl); } catch { return false; }
  return u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
}
