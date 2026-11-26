/** The agent's provider contract (wave 8 autonomy Part 2, lead pre-pass): the labelled scripted double, the model table, presets. */
import { describe, expect, it } from 'vitest';
import { AGENT_MODEL_TABLE, AGENT_PROVIDER_PRESETS, AgentModelRowSchema, AgentProviderError, costCents, createScriptedModel, isUnencryptedRemote, lastToolResult, mergeModelTable, MOCK_LABEL, type AgentTurnRequest } from './index.ts';

const req = (messages: AgentTurnRequest['messages'] = []): AgentTurnRequest => ({ system: 's', messages, tools: [], maxOutputTokens: 100, cache: false, parallelToolCalls: true });
const ep = { providerId: 'mock', family: 'openai-chat' as const, baseUrl: 'http://127.0.0.1:1/v1', model: 'm' };
const sig = new AbortController().signal;

describe('the MOCK scripted model (labelled test double)', () => {
  it('says MOCK in its id and every turn, records requests, and stops when the script ends', async () => {
    const m = createScriptedModel([{ text: 'plan', toolCalls: [{ name: 'get_summary', input: { projectId: 'p' } }] }]);
    expect(m.id).toMatch(/MOCK/);
    const a = await m.turn(req(), ep, null, sig);
    expect(a.text).toContain(MOCK_LABEL);
    expect(a.finish).toBe('tool');
    expect(a.toolCalls).toEqual([{ id: 'mock_0_0', name: 'get_summary', input: { projectId: 'p' } }]);
    expect(a.usage).toEqual({ inputTokens: 1000, outputTokens: 100 });
    const b = await m.turn(req(), ep, null, sig);
    expect([b.finish, b.toolCalls.length]).toEqual(['stop', 0]);
    expect(m.requests).toHaveLength(2);
  });
  it('a function turn reads an earlier tool result; a fail turn throws the typed error', async () => {
    const m = createScriptedModel([(r) => ({ toolCalls: [{ name: 'find_silences', input: { assetId: (lastToolResult(r, 'get_summary') as any).assets[0].id } }] }), { fail: 'rate_limited', retryAfterSeconds: 3 }]);
    const history = req([{ role: 'assistant', text: null, toolCalls: [{ id: 'c1', name: 'get_summary', input: {} }] }, { role: 'tool', results: [{ callId: 'c1', text: '{"assets":[{"id":"ast_1"}]}', isError: false }] }]);
    expect((await m.turn(history, ep, null, sig)).toolCalls[0]!.input).toEqual({ assetId: 'ast_1' });
    await expect(m.turn(req(), ep, null, sig)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 3 });
    expect(new AgentProviderError('unauthorized', false, 'x')).toBeInstanceOf(Error);
  });
});

describe('model table and presets (data from providers-research.md)', () => {
  it('every row parses, carries its read date and source, and ids are unique per provider', () => {
    const keys = new Set<string>();
    for (const r of AGENT_MODEL_TABLE) { AgentModelRowSchema.parse(r); expect(r.readAt).toBe('2026-11-26'); expect(r.source).toMatch(/^R§/); keys.add(`${r.providerId}/${r.id}`); }
    expect(keys.size).toBe(AGENT_MODEL_TABLE.length);
    for (const r of AGENT_MODEL_TABLE) expect(AGENT_PROVIDER_PRESETS.map((p) => p.id)).toContain(r.providerId);
  });
  it('the owner\'s rows replace built-ins of the same id and add the rest; cost is null without prices', () => {
    const mine = { ...AGENT_MODEL_TABLE[0]!, priceInPerMTok: 1, readAt: 'owner' };
    const extra = { providerId: 'ollama', id: 'qwen-small', label: 'qwen', contextTokens: null, maxOutputTokens: null, priceInPerMTok: null, priceOutPerMTok: null, vision: false, readAt: 'owner', source: 'owner' };
    const t = mergeModelTable(AGENT_MODEL_TABLE, [mine, extra]);
    expect(t[0]!.priceInPerMTok).toBe(1);
    expect(t.at(-1)!.id).toBe('qwen-small');
    expect(costCents(AGENT_MODEL_TABLE[0]!, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(400);
    expect(costCents(extra, { inputTokens: 5, outputTokens: 5 })).toBeNull();
  });
  it('version 1 families only; Anthropic sends the version header; local servers need no key; LAN http is flagged unencrypted', () => {
    for (const p of AGENT_PROVIDER_PRESETS) expect(['anthropic-messages', 'openai-chat']).toContain(p.family);
    expect(AGENT_PROVIDER_PRESETS.find((p) => p.id === 'anthropic')!.versionHeader).toBe('anthropic-version: 2026-10-21');
    for (const p of AGENT_PROVIDER_PRESETS.filter((x) => x.local)) expect(p.needsKey).toBe(false);
    expect(isUnencryptedRemote('http://192.168.1.20:9931/v1')).toBe(true);
    expect(isUnencryptedRemote('http://127.0.0.1:9931/v1')).toBe(false);
    expect(isUnencryptedRemote('https://api.x.ai/v1')).toBe(false);
  });
});
