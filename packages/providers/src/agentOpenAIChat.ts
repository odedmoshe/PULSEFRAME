/**
 * Family C network adapter `openai-chat` (Chat Completions; wave 8 autonomy Part 2, builder W2): OpenAI, xAI's legacy endpoint,
 * Gemini's OpenAI-compatible endpoint (beta), llama.cpp and Ollama. Wire facts from providers-research.md §2.3, §2.6, §3, §4.8,
 * §5, §6, §7 only (read 2026-11-26): POST {baseUrl}/chat/completions; `Authorization: Bearer <key>` when a key is stored (none for
 * a local server); the preset of `ep.providerId` decides tool_choice, parallel calls and the image part's form. No streaming in
 * version 1. Nothing here has been sent to a real service: a laptop with the owner's keys is the first to.
 *
 * Error map (C16; R§2.6, R§3.5, R§4.6): 401 → unauthorized · 402 (Gemini payment_required) → no_credit · 429 whose code/type is
 * credit_balance_exhausted, insufficient_quota or *_spend_limit_exceeded / *_usage_limit_exceeded → no_credit, other 429 →
 * rate_limited with retry-after · 500 / 502 / 503 / 504 → overloaded · 400 / 413 whose message talks of the context length →
 * context_too_long (HEURISTIC: no status/code is documented for it, R§2.6) · 400 that says the model does not support tools →
 * no_tool_calling (HEURISTIC) · other 4xx (403 country, 404 model) → bad_request · a 2xx that is not the documented JSON →
 * unknown_after_send · finish content_filter or a `refusal` → refused.
 */
import { AGENT_PROVIDER_PRESETS, AgentProviderError, fromOpenAIChatResponse, toOpenAIChatRequest, type AgentEndpoint, type AgentModelAdapter, type AgentProbeResult, type AgentProviderPreset, type AgentTurnRequest, type AgentTurnResponse, type OpenAIChatResponse } from './agentModel.ts';
import { detailOf, errorFields, joinUrl, postJson, providerError, redactKey, retryAfterSeconds, type AgentHttpAnswer, type AgentHttpOptions } from './agentHttp.ts';

export const OPENAI_CHAT_PATH = '/chat/completions';
export const OPENAI_NO_CREDIT_CODES: ReadonlySet<string> = new Set(['credit_balance_exhausted', 'insufficient_quota', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']);
/** HEURISTICS on an error message (no documented code): labelled, matched case-insensitively. */
export const OPENAI_MESSAGE_HEURISTICS = Object.freeze({
  contextTooLong: /context[ _]length|maximum context|context window|too many tokens|prompt is too long|reduce the length/i,
  noTools: /does not support tool|tools? (is|are)? ?not supported|tool[ _-]?calling is not supported/i,
});

/** The preset of a provider id; an id no preset has gets the plain OpenAI behaviour. */
export const presetFor = (ep: AgentEndpoint): AgentProviderPreset =>
  AGENT_PROVIDER_PRESETS.find((p) => p.id === ep.providerId) ?? { id: ep.providerId, family: 'openai-chat', baseUrl: ep.baseUrl, needsKey: true, versionHeader: null, supportsToolChoice: true, parallelToolCalls: true, compatNote: false, local: false, source: 'none' };

export const openAIHeaders = (key: string | null): Record<string, string> => (key ? { authorization: `Bearer ${key}` } : {});

export function openAIHttpError(providerId: string, a: AgentHttpAnswer, key: string | null): AgentProviderError {
  const f = errorFields(a.text);
  const d = detailOf(providerId, a.status, f, key);
  const H = OPENAI_MESSAGE_HEURISTICS;
  const s = a.status;
  const credit = (f.code && OPENAI_NO_CREDIT_CODES.has(f.code)) || (f.type && OPENAI_NO_CREDIT_CODES.has(f.type));
  if (s === 401) return providerError('unauthorized', d);
  if (s === 402) return providerError('no_credit', d);
  if (s === 429) return credit ? providerError('no_credit', d) : providerError('rate_limited', d, retryAfterSeconds(a.headers));
  if (s === 500 || s === 502 || s === 503 || s === 504) return providerError('overloaded', d, retryAfterSeconds(a.headers));
  if (s === 400 || s === 413) {
    if (H.contextTooLong.test(f.message) || f.code === 'context_length_exceeded') return providerError('context_too_long', d);
    if (H.noTools.test(f.message)) return providerError('no_tool_calling', d);
  }
  return providerError(s >= 500 ? 'overloaded' : 'bad_request', d);
}

function parseAnswer(providerId: string, a: AgentHttpAnswer, key: string | null): OpenAIChatResponse {
  let j: unknown;
  try { j = JSON.parse(a.text); } catch { throw providerError('unknown_after_send', redactKey(key, `${providerId} HTTP ${a.status}: the answer is not JSON; it is not sent again`)); }
  if (!j || typeof j !== 'object' || !Array.isArray((j as { choices?: unknown }).choices)) throw providerError('unknown_after_send', redactKey(key, `${providerId} HTTP ${a.status}: the answer has no choices array; it is not sent again`));
  return j as OpenAIChatResponse;
}

export function createOpenAIChatAdapter(opts: AgentHttpOptions = {}): AgentModelAdapter {
  return {
    id: 'openai-chat',
    family: 'openai-chat',
    async turn(req: AgentTurnRequest, ep: AgentEndpoint, key: string | null, signal: AbortSignal): Promise<AgentTurnResponse> {
      const a = await postJson(joinUrl(ep.baseUrl, OPENAI_CHAT_PATH), openAIHeaders(key), toOpenAIChatRequest(req, ep.model, presetFor(ep)), signal, key, opts);
      if (a.status < 200 || a.status >= 300) throw openAIHttpError(ep.providerId, a, key);
      let out: AgentTurnResponse;
      try { out = fromOpenAIChatResponse(parseAnswer(ep.providerId, a, key)); } catch (e) { if (e instanceof AgentProviderError) throw new AgentProviderError(e.code, e.retryable, redactKey(key, e.message)); throw e; }
      if (out.finish === 'refusal') throw providerError('refused', redactKey(key, `${ep.providerId}: the model refused${out.text ? `: ${out.text.slice(0, 200)}` : ''}`));
      return out;
    },
    /** «בדיקה»: max_tokens 1, no tools, one word. A 2xx answer proves the address, the model and (when needed) the key. */
    async probe(ep: AgentEndpoint, key: string | null, signal: AbortSignal): Promise<AgentProbeResult> {
      const preset = presetFor(ep);
      if (preset.needsKey && !key) return { ok: false, code: 'bad_config', detail: 'no key is stored for this provider' };
      try { new URL(ep.baseUrl); } catch { return { ok: false, code: 'bad_config', detail: 'the address is not a URL' }; }
      try {
        const a = await postJson(joinUrl(ep.baseUrl, OPENAI_CHAT_PATH), openAIHeaders(key), { model: ep.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, signal, key, opts);
        if (a.status === 404) return { ok: false, code: 'bad_config', detail: detailOf(ep.providerId, a.status, errorFields(a.text), key) };
        if (a.status < 200 || a.status >= 300) { const e = openAIHttpError(ep.providerId, a, key); return { ok: false, code: e.code, detail: e.message }; }
        const raw = parseAnswer(ep.providerId, a, key) as OpenAIChatResponse & { model?: unknown };
        return { ok: true, model: typeof raw.model === 'string' ? raw.model : ep.model };
      } catch (e) {
        if (e instanceof AgentProviderError) return { ok: false, code: e.code, detail: redactKey(key, e.message) };
        throw e;
      }
    },
  };
}
