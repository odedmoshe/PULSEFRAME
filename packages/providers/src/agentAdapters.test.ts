/**
 * The agent's two wire families (wave 8 autonomy Part 2, builder W2): the converters on the request/response examples QUOTED in
 * .artifacts/wave8/providers-research.md (R§1.2 Anthropic weather example, R§2.3 Chat Completions example), the C11 placement of
 * pictures, and the C16 error map against CANNED HTTP answers from a LABELLED local test double (`http.createServer` on port 0,
 * loopback only). No real provider is called; no real key exists here (the key below is a made-up test string).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from './agentAnthropic.ts';
import { isLocalOrLanHost, joinUrl, redactKey } from './agentHttp.ts';
import { AGENT_PROVIDER_PRESETS, fromAnthropicResponse, fromOpenAIChatResponse, MISSING_RESULT_TEXT, STILLS_FOLLOW_TEXT, toAnthropicRequest, toOpenAIChatRequest, type AgentEndpoint, type AgentImage, type AgentTurnRequest } from './agentModel.ts';
import { createOpenAIChatAdapter } from './agentOpenAIChat.ts';

const FAKE_KEY = 'TEST-ONLY-not-a-real-key-7f3a9c';
const weatherTool = {
  name: 'get_weather', description: 'Get the current weather in a given location',
  inputSchema: { type: 'object', properties: { location: { type: 'string', description: 'The city and state, e.g. San Francisco, CA' }, unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'The unit of temperature, either \'celsius\' or \'fahrenheit\'' } }, required: ['location'] },
};
const still: AgentImage = { mediaType: 'image/png', base64: 'iVBORw0KGgo=', label: 'frame 30 at revision 4' };
const req = (over: Partial<AgentTurnRequest> = {}): AgentTurnRequest => ({ system: '', messages: [{ role: 'user', text: 'What\'s the weather in San Francisco?' }], tools: [weatherTool], maxOutputTokens: 1024, cache: false, parallelToolCalls: true, ...over });
const preset = (id: string) => AGENT_PROVIDER_PRESETS.find((p) => p.id === id)!;
const toolTurn = (results: AgentTurnRequest['messages'][number]): AgentTurnRequest['messages'] => [
  { role: 'user', text: 'What\'s the weather in San Francisco?' },
  { role: 'assistant', text: 'I\'ll check the current weather in San Francisco for you.', toolCalls: [{ id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { location: 'San Francisco, CA', unit: 'celsius' } }] },
  results,
];

describe('anthropic-messages converters (R§1.2)', () => {
  it('the request is the docs\' weather example: input_schema, max_tokens, the user turn; no temperature/top_p/top_k; tool_choice auto', () => {
    const body = toAnthropicRequest(req(), 'claude-opus-5-5');
    expect(body).toEqual({
      model: 'claude-opus-5-5', max_tokens: 1024,
      tools: [{ name: 'get_weather', description: weatherTool.description, input_schema: weatherTool.inputSchema }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What\'s the weather in San Francisco?' }] }],
    });
    for (const banned of ['temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(banned);
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'tool_choice', 'tools']);
  });
  it('the docs\' tool-use answer reads as one call with an OBJECT input and finish tool', () => {
    const res = fromAnthropicResponse({ id: 'msg_01Aq9w938a90dw8q', model: 'claude-opus-5-5', stop_reason: 'tool_use', role: 'assistant', content: [{ type: 'text', text: 'I\'ll check the current weather in San Francisco for you.' }, { type: 'tool_use', id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { location: 'San Francisco, CA', unit: 'celsius' } }] });
    expect(res).toEqual({ text: 'I\'ll check the current weather in San Francisco for you.', toolCalls: [{ id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { location: 'San Francisco, CA', unit: 'celsius' } }], finish: 'tool', usage: null, providerRequestId: 'msg_01Aq9w938a90dw8q',
      providerState: { anthropicContent: [{ type: 'text', text: 'I\'ll check the current weather in San Francisco for you.' }, { type: 'tool_use', id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { location: 'San Francisco, CA', unit: 'celsius' } }] } }); // the answer kept whole for its replay (lead decision 6)
  });
  it('a result goes back as the docs\' tool_result; an error carries is_error; results come FIRST, then the next user text', () => {
    const ok = toAnthropicRequest(req({ messages: toolTurn({ role: 'tool', results: [{ callId: 'toolu_01A09q90qw90lq917835lq9', text: '15 degrees', isError: false }] }) }), 'm');
    expect(ok.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'I\'ll check the current weather in San Francisco for you.' }, { type: 'tool_use', id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { location: 'San Francisco, CA', unit: 'celsius' } }] });
    expect(ok.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01A09q90qw90lq917835lq9', content: '15 degrees' }] });
    const err = toAnthropicRequest(req({ messages: [...toolTurn({ role: 'tool', results: [{ callId: 'toolu_01A09q90qw90lq917835lq9', text: 'ConnectionError: the weather service API is not available (HTTP 500)', isError: true }] }), { role: 'user', text: 'try once more' }] }), 'm');
    expect(err.messages).toHaveLength(3);
    expect(err.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01A09q90qw90lq917835lq9', content: 'ConnectionError: the weather service API is not available (HTTP 500)', is_error: true }, { type: 'text', text: 'try once more' }] });
  });
  it('one tool_result per tool_use, in the calls\' order: a missing result is an error result, an orphan result is dropped', () => {
    const body = toAnthropicRequest(req({ messages: [{ role: 'user', text: 'go' }, { role: 'assistant', text: null, toolCalls: [{ id: 'a', name: 'x', input: {} }, { id: 'b', name: 'y', input: {} }] }, { role: 'tool', results: [{ callId: 'b', text: 'B', isError: false }, { callId: 'zzz', text: 'orphan', isError: false }] }] }), 'm');
    expect(body.messages[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'a', content: MISSING_RESULT_TEXT, is_error: true }, { type: 'tool_result', tool_use_id: 'b', content: 'B' }]);
  });
  it('C11: a still sits INSIDE its tool_result (base64 image block); a user picture precedes its text', () => {
    const body = toAnthropicRequest(req({ messages: [...toolTurn({ role: 'tool', results: [{ callId: 'toolu_01A09q90qw90lq917835lq9', text: '{"frame":30}', isError: false, images: [still] }] }), { role: 'user', text: 'and this one', images: [still] }] }), 'm');
    expect(body.messages[2]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_01A09q90qw90lq917835lq9', content: [{ type: 'text', text: '{"frame":30}' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }] },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'text', text: 'and this one' },
    ]);
  });
  it('parallel off → disable_parallel_tool_use; cache → cache_control on the system text and the LAST tool only; no tools → no tool_choice', () => {
    const two = [weatherTool, { ...weatherTool, name: 'get_time' }];
    const body = toAnthropicRequest(req({ system: 'You edit films.', tools: two, cache: true, parallelToolCalls: false }), 'm');
    expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(body.system).toEqual([{ type: 'text', text: 'You edit films.', cache_control: { type: 'ephemeral' } }]);
    expect(body.tools.map((t) => t.cache_control ?? null)).toEqual([null, { type: 'ephemeral' }]);
    expect(toAnthropicRequest(req({ system: 'plain', tools: [] }), 'm')).not.toHaveProperty('tool_choice');
    expect(toAnthropicRequest(req({ system: 'plain' }), 'm').system).toBe('plain');
  });
  it('thinking and unknown blocks are ignored; usage and stop reasons map; a non-object input is bad_tool_call', () => {
    const res = fromAnthropicResponse({ id: 'm1', model: 'x', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' } as never, { type: 'text', text: 'done' }], usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } });
    expect(res).toMatchObject({ text: 'done', finish: 'stop', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 0 } });
    expect(fromAnthropicResponse({ id: 'm', model: 'x', role: 'assistant', stop_reason: 'max_tokens', content: [] }).finish).toBe('length');
    expect(() => fromAnthropicResponse({ id: 'm', model: 'x', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'n', input: 'nope' }] })).toThrow(expect.objectContaining({ code: 'bad_tool_call' }));
  });

  it('lead decision 6: the answer\'s whole content (thinking blocks with their signatures) comes back as opaque providerState and is replayed UNCHANGED; without it the turn is rebuilt with no thinking block', () => {
    const content = [{ type: 'thinking', thinking: '', signature: 'TEST-ONLY-signature' } as never, { type: 'text' as const, text: 'I\'ll check.' }, { type: 'tool_use' as const, id: 'toolu_1', name: 'get_weather', input: { location: 'Paris' } }];
    const res = fromAnthropicResponse({ id: 'm1', model: 'x', role: 'assistant', stop_reason: 'tool_use', content });
    expect(res.providerState).toEqual({ anthropicContent: content });
    const messages: AgentTurnRequest['messages'] = [
      { role: 'user', text: 'weather?' },
      { role: 'assistant', text: res.text, toolCalls: res.toolCalls, providerState: res.providerState },
      { role: 'tool', results: [{ callId: 'toolu_1', text: '15 C', isError: false }] },
    ];
    const body = toAnthropicRequest(req({ messages }), 'claude-opus-5-5');
    expect(body.messages[1]).toEqual({ role: 'assistant', content });
    expect(body.messages[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_1', content: '15 C' }]);
    const { providerState: _, ...plain } = messages[1] as Extract<AgentTurnRequest['messages'][number], { role: 'assistant' }>;
    const rebuilt = toAnthropicRequest(req({ messages: [messages[0]!, plain, messages[2]!] }), 'claude-opus-5-5');
    expect((rebuilt.messages[1]!.content as { type: string }[]).map((b) => b.type)).toEqual(['text', 'tool_use']);
    // a state whose calls do not match the turn is not trusted: the turn is rebuilt
    const odd = toAnthropicRequest(req({ messages: [messages[0]!, { ...plain, providerState: { anthropicContent: [{ type: 'tool_use', id: 'other', name: 'x', input: {} }] } }, messages[2]!] }), 'claude-opus-5-5');
    expect((odd.messages[1]!.content as { type: string }[]).map((b) => b.type)).toEqual(['text', 'tool_use']);
    // the openai-chat family ignores it
    expect(JSON.stringify(toOpenAIChatRequest(req({ messages }), 'gpt', preset('openai')))).not.toContain('TEST-ONLY-signature');
  });
});

describe('openai-chat converters (R§2.3, R§4.8, R§5, R§6)', () => {
  it('the request is the reference example\'s shape: system first, tools as {type:function, function:{…}}, tool_choice auto', () => {
    const body = toOpenAIChatRequest(req({ system: 'You edit films.' }), 'gpt-5.6-terra', preset('openai'));
    expect(body).toEqual({
      model: 'gpt-5.6-terra', max_tokens: 1024,
      messages: [{ role: 'system', content: 'You edit films.' }, { role: 'user', content: 'What\'s the weather in San Francisco?' }],
      tools: [{ type: 'function', function: { name: 'get_weather', description: weatherTool.description, parameters: weatherTool.inputSchema } }],
      tool_choice: 'auto',
    });
  });
  it('the reference answer: arguments are a JSON STRING parsed into an object; finish tool', () => {
    const res = fromOpenAIChatResponse({ id: 'chatcmpl-1', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc123', type: 'function', function: { name: 'get_current_weather', arguments: '{\n"location": "Boston, MA"\n}' } }] } }], usage: { prompt_tokens: 82, completion_tokens: 17, prompt_tokens_details: { cached_tokens: 0 } } });
    expect(res).toEqual({ text: null, toolCalls: [{ id: 'call_abc123', name: 'get_current_weather', input: { location: 'Boston, MA' } }], finish: 'tool', usage: { inputTokens: 82, outputTokens: 17, cacheReadTokens: 0 }, providerRequestId: 'chatcmpl-1' });
  });
  it('history: assistant arguments re-serialised as a string; results as role tool + tool_call_id; an error result says so in the text', () => {
    const body = toOpenAIChatRequest(req({ messages: toolTurn({ role: 'tool', results: [{ callId: 'toolu_01A09q90qw90lq917835lq9', text: 'HTTP 500', isError: true }] }) }), 'm', preset('openai'));
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'I\'ll check the current weather in San Francisco for you.', tool_calls: [{ id: 'toolu_01A09q90qw90lq917835lq9', type: 'function', function: { name: 'get_weather', arguments: '{"location":"San Francisco, CA","unit":"celsius"}' } }] });
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'toolu_01A09q90qw90lq917835lq9', content: 'Error: HTTP 500' });
  });
  it('C11: stills leave the tool message (text only) and go in ONE following user message as image_url data URLs', () => {
    const body = toOpenAIChatRequest(req({ messages: toolTurn({ role: 'tool', results: [{ callId: 'toolu_01A09q90qw90lq917835lq9', text: '{"frame":30}', isError: false, images: [still, still] }] }) }), 'm', preset('openai'));
    expect(body.messages.slice(2)).toEqual([
      { role: 'tool', tool_call_id: 'toolu_01A09q90qw90lq917835lq9', content: '{"frame":30}' },
      { role: 'user', content: [
        { type: 'text', text: `${STILLS_FOLLOW_TEXT}\n1. frame 30 at revision 4 (call toolu_01A09q90qw90lq917835lq9)\n2. frame 30 at revision 4 (call toolu_01A09q90qw90lq917835lq9)` },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ] },
    ]);
    for (const m of body.messages) if (m.role === 'tool') expect(typeof m.content).toBe('string');
  });
  it('Ollama: no tool_choice, parallel_tool_calls false, the image part as the plain data-URL string (its page\'s example); llama.cpp: parallel off', () => {
    const o = toOpenAIChatRequest(req({ messages: [{ role: 'user', text: 'look', images: [still] }] }), 'qwen', preset('ollama'));
    expect(o).not.toHaveProperty('tool_choice');
    expect(o.parallel_tool_calls).toBe(false);
    expect(o.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: 'data:image/png;base64,iVBORw0KGgo=' }] });
    const l = toOpenAIChatRequest(req(), 'm', preset('llamacpp'));
    expect([l.tool_choice, l.parallel_tool_calls]).toEqual(['auto', false]);
    const x = toOpenAIChatRequest(req(), 'grok-4.7', preset('xai'));
    expect(x).not.toHaveProperty('parallel_tool_calls');
    expect(toOpenAIChatRequest(req({ parallelToolCalls: false }), 'm', preset('openai')).parallel_tool_calls).toBe(false);
  });
  it('a missing result is closed with MISSING_RESULT_TEXT; unparseable or non-object arguments are bad_tool_call; content_filter is a refusal', () => {
    const body = toOpenAIChatRequest(req({ messages: [{ role: 'user', text: 'go' }, { role: 'assistant', text: null, toolCalls: [{ id: 'c1', name: 'x', input: {} }] }, { role: 'user', text: 'again' }] }), 'm', preset('openai'));
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: MISSING_RESULT_TEXT });
    const bad = (args: string) => () => fromOpenAIChatResponse({ choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: args } }] } }] });
    expect(bad('{"location":')).toThrow(expect.objectContaining({ code: 'bad_tool_call' }));
    expect(bad('[1,2]')).toThrow(expect.objectContaining({ code: 'bad_tool_call' }));
    expect(fromOpenAIChatResponse({ choices: [{ index: 0, finish_reason: 'content_filter', message: { role: 'assistant', content: null } }] }).finish).toBe('refusal');
    expect(() => fromOpenAIChatResponse({ choices: [] })).toThrow(expect.objectContaining({ code: 'bad_request' }));
  });
});

// ---------- the error map against a LABELLED local test double (canned answers, loopback, port 0) ----------
type Canned = { status: number; body: unknown; headers?: Record<string, string>; hang?: boolean; destroy?: boolean; raw?: string };
let server: http.Server, base = '', next: Canned = { status: 200, body: {} };
const seen: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
beforeAll(async () => {
  server = http.createServer((rq, rs) => {
    let data = '';
    rq.on('data', (c) => { data += c; });
    rq.on('end', () => {
      seen.push({ url: rq.url!, headers: rq.headers, body: data ? JSON.parse(data) : null });
      const c = next;
      if (c.hang) return; // never answers: the adapter's time limit fires after the request was written
      if (c.destroy) { rs.socket?.destroy(); return; }
      rs.writeHead(c.status, { 'content-type': 'application/json', ...(c.headers ?? {}) });
      rs.end(c.raw ?? JSON.stringify(c.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
const sig = () => new AbortController().signal;
const epA = (): AgentEndpoint => ({ providerId: 'anthropic', family: 'anthropic-messages', baseUrl: base, model: 'claude-opus-5-5' });
const epC = (id = 'openai'): AgentEndpoint => ({ providerId: id, family: 'openai-chat', baseUrl: `${base}/v1/`, model: 'gpt-6.2-sol' });
const anth = createAnthropicAdapter({ timeoutMs: 500 });
const oai = createOpenAIChatAdapter({ timeoutMs: 500 });
const failA = async (c: Canned) => { next = c; return anth.turn(req(), epA(), FAKE_KEY, sig()).then(() => { throw new Error('no error'); }, (e) => e); };
const failC = async (c: Canned) => { next = c; return oai.turn(req(), epC(), FAKE_KEY, sig()).then(() => { throw new Error('no error'); }, (e) => e); };
const anthErr = (type: string, message: string) => ({ type: 'error', error: { type, message }, request_id: 'req_test' });
const oaiErr = (code: string | null, message: string, type = 'invalid_request_error') => ({ error: { message, type, code } });

describe('anthropic-messages adapter over HTTP (LABELLED local double, canned answers)', () => {
  it('sends POST /v1/messages with x-api-key and anthropic-version 2026-10-21, and reads the answer', async () => {
    next = { status: 200, body: { id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_weather', input: { location: 'X' } }], usage: { input_tokens: 3, output_tokens: 4 } } };
    const r = await anth.turn(req(), epA(), FAKE_KEY, sig());
    const s = seen.at(-1)!;
    expect([s.url, s.headers['x-api-key'], s.headers['anthropic-version'], s.headers['content-type']]).toEqual(['/v1/messages', FAKE_KEY, '2026-10-21', 'application/json']);
    expect(s.body).not.toHaveProperty('temperature');
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'get_weather', input: { location: 'X' } }]);
  });
  it('maps every documented status (R§1.5) to its code, with retry-after, and never puts the key in a detail', async () => {
    const rows: [Canned, string, boolean, number | null][] = [
      [{ status: 401, body: anthErr('authentication_error', `invalid x-api-key ${FAKE_KEY}`) }, 'unauthorized', false, null],
      [{ status: 402, body: anthErr('billing_error', 'add credit') }, 'no_credit', false, null],
      [{ status: 400, body: anthErr('invalid_request_error', 'You have reached your specified workspace spend limit') }, 'no_credit', false, null],
      [{ status: 400, body: anthErr('invalid_request_error', 'prompt is too long: 1200000 tokens > 1000000 maximum') }, 'context_too_long', false, null],
      [{ status: 413, body: anthErr('request_too_large', 'too large') }, 'context_too_long', false, null],
      [{ status: 429, body: anthErr('rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit'), headers: { 'retry-after': '7' } }, 'rate_limited', true, 7],
      [{ status: 429, body: anthErr('rate_limit_error', 'You have reached your monthly spend limit') }, 'no_credit', false, null],
      [{ status: 529, body: anthErr('overloaded_error', 'Overloaded') }, 'overloaded', true, null],
      [{ status: 500, body: anthErr('api_error', 'x') }, 'overloaded', true, null],
      [{ status: 504, body: anthErr('timeout_error', 'x') }, 'overloaded', true, null],
      [{ status: 404, body: anthErr('not_found_error', 'model: claude-nope') }, 'bad_request', false, null],
      [{ status: 200, body: { id: 'm', model: 'x', role: 'assistant', stop_reason: 'refusal', content: [] } }, 'refused', false, null],
      [{ status: 200, body: { id: 'm', model: 'x', role: 'assistant', stop_reason: 'model_context_window_exceeded', content: [] } }, 'context_too_long', false, null],
      [{ status: 200, body: null, raw: 'not json' }, 'unknown_after_send', false, null],
    ];
    for (const [c, code, retryable, after] of rows) {
      const e = await failA(c);
      expect([c.status, e.code, e.retryable, e.retryAfterSeconds]).toEqual([c.status, code, retryable, after]);
      expect(e.message).not.toContain(FAKE_KEY);
    }
  });
  it('answer lost after the request was written → unknown_after_send (time limit, socket reset); refused connection → local_server_down', async () => {
    expect((await failA({ status: 0, body: null, hang: true })).code).toBe('unknown_after_send');
    expect((await failA({ status: 0, body: null, destroy: true })).code).toBe('unknown_after_send');
    const closed = http.createServer(); await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port; await new Promise((r) => closed.close(r));
    const e = await anth.turn(req(), { ...epA(), baseUrl: `http://127.0.0.1:${port}` }, FAKE_KEY, sig()).catch((x) => x);
    expect([e.code, e.retryable]).toEqual(['local_server_down', true]);
  });
  it('probe: max_tokens 1, no tools; ok with the model; a wrong key is unauthorized; no key is bad_config without a request', async () => {
    next = { status: 200, body: { id: 'm', model: 'claude-opus-5-5', role: 'assistant', stop_reason: 'max_tokens', content: [{ type: 'text', text: 'p' }] } };
    expect(await anth.probe(epA(), FAKE_KEY, sig())).toEqual({ ok: true, model: 'claude-opus-5-5' });
    expect(seen.at(-1)!.body).toEqual({ model: 'claude-opus-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    next = { status: 401, body: anthErr('authentication_error', 'invalid x-api-key') };
    expect(await anth.probe(epA(), FAKE_KEY, sig())).toMatchObject({ ok: false, code: 'unauthorized' });
    const n = seen.length;
    expect(await anth.probe(epA(), null, sig())).toMatchObject({ ok: false, code: 'bad_config' });
    expect(seen.length).toBe(n);
  });
});

describe('openai-chat adapter over HTTP (LABELLED local double, canned answers)', () => {
  it('sends POST {base}/chat/completions with Bearer; a local preset sends no key header', async () => {
    next = { status: 200, body: { id: 'c1', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
    expect((await oai.turn(req(), epC(), FAKE_KEY, sig())).text).toBe('hi');
    expect([seen.at(-1)!.url, seen.at(-1)!.headers.authorization]).toEqual(['/v1/chat/completions', `Bearer ${FAKE_KEY}`]);
    await oai.turn(req(), epC('ollama'), null, sig());
    expect(seen.at(-1)!.headers.authorization).toBeUndefined();
    expect(seen.at(-1)!.body).not.toHaveProperty('tool_choice');
  });
  it('maps the documented codes (R§2.6, R§4.6) and the labelled message heuristics; never the key in a detail', async () => {
    const rows: [Canned, string, number | null][] = [
      [{ status: 401, body: oaiErr('invalid_api_key', `Incorrect API key provided: ${FAKE_KEY}`) }, 'unauthorized', null],
      [{ status: 402, body: { error: { code: 402, message: 'Prepay credit balance is depleted', status: 'payment_required' } } }, 'no_credit', null],
      [{ status: 429, body: oaiErr('credit_balance_exhausted', 'no credit', 'insufficient_quota') }, 'no_credit', null],
      [{ status: 429, body: oaiErr('project_spend_limit_exceeded', 'limit') }, 'no_credit', null],
      [{ status: 429, body: oaiErr(null, 'Rate limit reached for requests', 'rate_limit_error'), headers: { 'retry-after': '2' } }, 'rate_limited', 2],
      [{ status: 503, body: oaiErr('server_is_overloaded', 'overloaded', 'service_unavailable_error') }, 'overloaded', null],
      [{ status: 400, body: oaiErr('context_length_exceeded', 'This model\'s maximum context length is 128000 tokens') }, 'context_too_long', null],
      [{ status: 400, body: { error: 'registry.ollama.ai/library/tiny does not support tools' } }, 'no_tool_calling', null],
      [{ status: 403, body: oaiErr('unsupported_country_region_territory', 'Country not supported') }, 'bad_request', null],
      [{ status: 200, body: { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: 'I can\'t help with that' } }] } }, 'refused', null],
      [{ status: 200, body: { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{oops' } }] } }] } }, 'bad_tool_call', null],
      [{ status: 200, body: { nothing: true } }, 'unknown_after_send', null],
    ];
    for (const [c, code, after] of rows) {
      const e = await failC(c);
      expect([c.status, e.code, e.retryAfterSeconds]).toEqual([c.status, code, after]);
      expect(e.message).not.toContain(FAKE_KEY);
    }
  });
  it('probe of a local server that is not running → local_server_down; ok on an answer', async () => {
    const closed = http.createServer(); await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port; await new Promise((r) => closed.close(r));
    expect(await oai.probe({ ...epC('llamacpp'), baseUrl: `http://127.0.0.1:${port}/v1` }, null, sig())).toMatchObject({ ok: false, code: 'local_server_down' });
    next = { status: 200, body: { model: 'gpt-6.2-sol', choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: 'p' } }] } };
    expect(await oai.probe(epC(), FAKE_KEY, sig())).toEqual({ ok: true, model: 'gpt-6.2-sol' });
    expect(await oai.probe(epC(), null, sig())).toMatchObject({ ok: false, code: 'bad_config' });
  });
});

describe('http helpers', () => {
  it('redacts the key as typed and URL-encoded; joins URLs; tells local/LAN hosts apart', () => {
    expect(redactKey('a+b/c', 'x a+b/c y a%2Bb%2Fc')).toBe('x [redacted] y [redacted]');
    expect(joinUrl('http://h/v1/', '/chat/completions')).toBe('http://h/v1/chat/completions');
    expect(['http://127.0.0.1:9931', 'http://localhost:11434/v1', 'http://192.168.1.20:9931', 'http://10.0.0.5', 'http://gpu-box:8080', 'http://[::1]:1'].map(isLocalOrLanHost)).toEqual([true, true, true, true, true, true]);
    expect(['https://api.anthropic.com', 'https://api.x.ai/v1', 'http://8.8.8.8'].map(isLocalOrLanHost)).toEqual([false, false, false]);
  });
});
