/**
 * Family A network adapter `anthropic-messages` (wave 8 autonomy Part 2, builder W2). Wire facts from providers-research.md §1
 * only (read 2026-11-26): POST {baseUrl}/v1/messages; `x-api-key` (R§1.1: "Legacy fallback for Authorization, still supported";
 * the curl example of the tool-use page uses it); `anthropic-version: 2026-10-21` required; no temperature/top_p/top_k. No
 * streaming in version 1. Nothing here has been sent to the real service: a laptop with the owner's key is the first to.
 *
 * Error map (C16, R§1.5): 401 / 403 → unauthorized · 402 → no_credit · 400 whose message names a spend limit or credit → no_credit
 * (HEURISTIC on the message: R§1.5 says the 400 "also spend-limit reached" without a code) · 400 "prompt is too long" and 413
 * request_too_large → context_too_long · 429 whose message names spend/billing/credit → no_credit (R§1.5: the spend-cap 429 has no
 * retry-after; HEURISTIC on the message), other 429 → rate_limited with retry-after · 500 / 503 / 504 / 529 → overloaded · 400 that
 * says tools are not supported → no_tool_calling (HEURISTIC) · other 4xx → bad_request · a 200 with stop_reason `refusal` → refused,
 * `model_context_window_exceeded` → context_too_long · a 200 whose body is not the documented JSON → unknown_after_send.
 */
import { ANTHROPIC_VERSION, fromAnthropicResponse, toAnthropicRequest, type AgentEndpoint, type AgentModelAdapter, type AgentProbeResult, type AgentTurnRequest, type AgentTurnResponse, type AnthropicMessagesResponse, AgentProviderError } from './agentModel.ts';
import { detailOf, errorFields, joinUrl, postJson, providerError, redactKey, retryAfterSeconds, type AgentHttpAnswer, type AgentHttpOptions } from './agentHttp.ts';

export const ANTHROPIC_MESSAGES_PATH = '/v1/messages';
/** HEURISTICS on an error message (the docs give no code for these): labelled, matched case-insensitively. */
export const ANTHROPIC_MESSAGE_HEURISTICS = Object.freeze({
  noCredit: /spend(ing)? limit|credit balance|billing|insufficient credit/i,
  contextTooLong: /prompt is too long|context window|too many tokens/i,
  noTools: /does not support tool|tools? (is|are)? ?not supported/i,
});

export function anthropicHeaders(key: string | null): Record<string, string> {
  return { 'anthropic-version': ANTHROPIC_VERSION, ...(key ? { 'x-api-key': key } : {}) };
}

/** An HTTP answer that is not a 2xx → the typed error (exported for the error-map tests). */
export function anthropicHttpError(providerId: string, a: AgentHttpAnswer, key: string | null): AgentProviderError {
  const f = errorFields(a.text);
  const d = detailOf(providerId, a.status, f, key);
  const H = ANTHROPIC_MESSAGE_HEURISTICS;
  const s = a.status;
  if (s === 401 || s === 403) return providerError('unauthorized', d);
  if (s === 402) return providerError('no_credit', d);
  if (s === 413) return providerError('context_too_long', d);
  if (s === 429) return H.noCredit.test(f.message) ? providerError('no_credit', d) : providerError('rate_limited', d, retryAfterSeconds(a.headers));
  if (s === 500 || s === 502 || s === 503 || s === 504 || s === 529) return providerError('overloaded', d, retryAfterSeconds(a.headers));
  if (s === 400) {
    if (H.contextTooLong.test(f.message)) return providerError('context_too_long', d);
    if (H.noCredit.test(f.message)) return providerError('no_credit', d);
    if (H.noTools.test(f.message)) return providerError('no_tool_calling', d);
  }
  return providerError(s >= 500 ? 'overloaded' : 'bad_request', d);
}

function parseAnswer(providerId: string, a: AgentHttpAnswer, key: string | null): AnthropicMessagesResponse {
  let j: unknown;
  try { j = JSON.parse(a.text); } catch { throw providerError('unknown_after_send', redactKey(key, `${providerId} HTTP ${a.status}: the answer is not JSON; it is not sent again`)); }
  if (!j || typeof j !== 'object' || !Array.isArray((j as { content?: unknown }).content)) throw providerError('unknown_after_send', redactKey(key, `${providerId} HTTP ${a.status}: the answer has no content array; it is not sent again`));
  return j as AnthropicMessagesResponse;
}

export function createAnthropicAdapter(opts: AgentHttpOptions = {}): AgentModelAdapter {
  return {
    id: 'anthropic-messages',
    family: 'anthropic-messages',
    async turn(req: AgentTurnRequest, ep: AgentEndpoint, key: string | null, signal: AbortSignal): Promise<AgentTurnResponse> {
      const a = await postJson(joinUrl(ep.baseUrl, ANTHROPIC_MESSAGES_PATH), anthropicHeaders(key), toAnthropicRequest(req, ep.model), signal, key, opts);
      if (a.status < 200 || a.status >= 300) throw anthropicHttpError(ep.providerId, a, key);
      const raw = parseAnswer(ep.providerId, a, key);
      if (raw.stop_reason === 'refusal') throw providerError('refused', redactKey(key, `${ep.providerId}: stop_reason refusal${(raw as { stop_details?: { category?: unknown } }).stop_details?.category ? ` (${String((raw as { stop_details?: { category?: unknown } }).stop_details?.category)})` : ''}`));
      if (raw.stop_reason === 'model_context_window_exceeded') throw providerError('context_too_long', `${ep.providerId}: stop_reason model_context_window_exceeded`);
      try { return fromAnthropicResponse(raw); } catch (e) { if (e instanceof AgentProviderError) throw new AgentProviderError(e.code, e.retryable, redactKey(key, e.message)); throw e; }
    },
    /** «בדיקה»: max_tokens 1, no tools, one word. A 2xx answer (any stop reason) proves the key, the address and the model. */
    async probe(ep: AgentEndpoint, key: string | null, signal: AbortSignal): Promise<AgentProbeResult> {
      if (!key) return { ok: false, code: 'bad_config', detail: 'no key is stored for this provider' };
      try { new URL(ep.baseUrl); } catch { return { ok: false, code: 'bad_config', detail: 'the address is not a URL' }; }
      try {
        const a = await postJson(joinUrl(ep.baseUrl, ANTHROPIC_MESSAGES_PATH), anthropicHeaders(key), { model: ep.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }, signal, key, opts);
        if (a.status === 404) return { ok: false, code: 'bad_config', detail: detailOf(ep.providerId, a.status, errorFields(a.text), key) };
        if (a.status < 200 || a.status >= 300) { const e = anthropicHttpError(ep.providerId, a, key); return { ok: false, code: e.code, detail: e.message }; }
        const raw = parseAnswer(ep.providerId, a, key);
        return { ok: true, model: typeof raw.model === 'string' ? raw.model : ep.model };
      } catch (e) {
        if (e instanceof AgentProviderError) return { ok: false, code: e.code, detail: redactKey(key, e.message) };
        throw e;
      }
    },
  };
}
