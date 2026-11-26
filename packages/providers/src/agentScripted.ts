/**
 * LABELLED TEST DOUBLE — "MOCK scripted model" (wave 8 autonomy Part 2, decision 6). It is NOT a language model and says so in its
 * id, its family and the text of every turn; proofs and tests use it for BOTH families' places in the loop, and nothing it does is
 * a claim about any real model. It never opens a socket. Complete in the pre-pass (the loop's tests need it from the first day).
 *
 * A script is a list of turns. A turn is either a fixed answer or a function of the request (so a later turn can read an id out of
 * an earlier tool result in `req.messages`, as a model would). When the script runs out the double answers `finish: 'stop'` with
 * no tool calls. `usage` is a fixed, labelled count (default 1000 in / 100 out) so cost arithmetic is testable; `fail` makes a
 * turn throw an AgentProviderError (for the C16 failure rows).
 */
import { AgentProviderError, type AgentEndpoint, type AgentModelAdapter, type AgentProbeResult, type AgentProviderErrorCode, type AgentToolCall, type AgentTurnRequest, type AgentTurnResponse } from './agentModel.ts';

export const MOCK_SCRIPTED_ID = 'MOCK-scripted-model';
export const MOCK_LABEL = '[MOCK scripted model — not a language model]';
export type ScriptedAnswer = { text?: string; toolCalls?: { name: string; input: unknown }[]; finish?: AgentTurnResponse['finish']; usage?: AgentTurnResponse['usage'] } | { fail: AgentProviderErrorCode; retryAfterSeconds?: number };
export type ScriptedTurn = ScriptedAnswer | ((req: AgentTurnRequest, turn: number) => ScriptedAnswer);

export interface ScriptedModel extends AgentModelAdapter {
  /** every request the loop sent, in order (tests read the tool lists and the rebuilt messages) */
  readonly requests: AgentTurnRequest[];
  readonly endpoints: AgentEndpoint[];
}

export function createScriptedModel(script: readonly ScriptedTurn[], opts: { usage?: { inputTokens: number; outputTokens: number } } = {}): ScriptedModel {
  const requests: AgentTurnRequest[] = [];
  const endpoints: AgentEndpoint[] = [];
  let calls = 0;
  return {
    id: MOCK_SCRIPTED_ID,
    family: 'mock-scripted',
    requests,
    endpoints,
    async turn(req, ep, _key, signal) {
      if (signal.aborted) throw new AgentProviderError('unreachable', true, 'aborted before send');
      requests.push(structuredClone(req));
      endpoints.push(ep);
      const n = calls++;
      const step = script[n];
      const a: ScriptedAnswer = step === undefined ? { text: 'script finished', finish: 'stop' } : typeof step === 'function' ? step(req, n) : step;
      if ('fail' in a) throw new AgentProviderError(a.fail, a.fail === 'rate_limited' || a.fail === 'overloaded', `${MOCK_LABEL} scripted failure ${a.fail}`, a.retryAfterSeconds ?? null);
      const toolCalls: AgentToolCall[] = (a.toolCalls ?? []).map((c, k) => ({ id: `mock_${n}_${k}`, name: c.name, input: c.input }));
      return {
        text: `${MOCK_LABEL} ${a.text ?? ''}`.trim(),
        toolCalls,
        finish: a.finish ?? (toolCalls.length ? 'tool' : 'stop'),
        usage: a.usage === undefined ? (opts.usage ?? { inputTokens: 1000, outputTokens: 100 }) : a.usage,
        providerRequestId: `mock_req_${n}`,
      };
    },
    async probe(ep): Promise<AgentProbeResult> { return { ok: true, model: ep.model }; },
  };
}

/** The text of the last tool result with this call's tool name, parsed as JSON when it is (for function turns). */
export function lastToolResult(req: AgentTurnRequest, toolName: string): unknown {
  const callNames = new Map<string, string>();
  for (const m of req.messages) if (m.role === 'assistant') for (const c of m.toolCalls) callNames.set(c.id, c.name);
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role !== 'tool') continue;
    for (let j = m.results.length - 1; j >= 0; j--) {
      const r = m.results[j]!;
      if (callNames.get(r.callId) !== toolName) continue;
      try { return JSON.parse(r.text); } catch { return r.text; }
    }
  }
  return undefined;
}
