/**
 * The local assistant's loopback rule, wire body, reply reader, descriptor and setup blockers (wave 7; assistant-decisions.md §4).
 * The address check is the hard line "nothing leaves the machine": pinned here.
 */
import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROMPT_DIGEST, ASSISTANT_CAPABILITY, CHAT_BLOCKER_CODES } from './chat.ts';
import {
  ASSISTANT_LOCAL_CAPABILITY, ASSISTANT_LOCAL_PROMPT_DIGEST, isLoopbackRemote, LOCAL_MODEL_HOST, LOCAL_MODEL_PATHS, LocalCapabilityDescriptorSchema,
  localBlockers, localModelName, localModelUrl, llamaChatBody, parseLlamaReply,
} from './localChat.ts';

describe('the loopback rule (nothing leaves the machine)', () => {
  it('builds only http://127.0.0.1:<port> URLs, for three paths', () => {
    expect(LOCAL_MODEL_HOST).toBe('127.0.0.1');
    for (const p of LOCAL_MODEL_PATHS) expect(localModelUrl(8791, p)).toBe(`http://127.0.0.1:8791${p}`);
    expect(() => localModelUrl(8791, '/slots' as never)).toThrow(RangeError);
    expect(() => localModelUrl(8791, '/props' as never)).toThrow(RangeError);
    for (const port of [0, 80, 1023, 65536, 8791.5, NaN, -1]) expect(() => localModelUrl(port, '/health'), String(port)).toThrow(RangeError);
  });
  it('accepts only 127.0.0.1 (or its IPv4-mapped form) as the socket\'s remote address', () => {
    expect(isLoopbackRemote('127.0.0.1')).toBe(true);
    expect(isLoopbackRemote('::ffff:127.0.0.1')).toBe(true);
    for (const a of ['127.0.0.2', '127.1.0.1', '::1', '0.0.0.0', '10.0.0.5', '192.168.1.20', '172.16.0.1', '8.8.8.8', '::ffff:10.0.0.5', 'localhost', '', ' 127.0.0.1', '127.0.0.1 ', undefined, null])
      expect(isLoopbackRemote(a as string | undefined), String(a)).toBe(false);
  });
});

describe('the wire body and the reply', () => {
  const req = { system: 'S', user: 'REQUEST (data):\nx', schema: { type: 'object' }, maxTokens: 128 };
  it('is llama.cpp\'s chat body with a JSON-schema response format, no cached prompt, and no credential anywhere', () => {
    const b = llamaChatBody(req);
    expect(b).toEqual({
      model: 'local', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'REQUEST (data):\nx' }],
      temperature: 0, top_k: 1, max_tokens: 128, stream: false, cache_prompt: false,
      response_format: { type: 'json_schema', json_schema: { name: 'command', schema: { type: 'object' } } },
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(JSON.stringify(b)).not.toMatch(/key|token"|authorization|cookie|bearer/i);
  });
  it('reads the message text, the finish and the model basename; refuses another shape', () => {
    expect(parseLlamaReply({ model: 'E:\\lib\\models\\DictaLM-3.0-1.7B-Thinking-Q4_K_M.gguf', choices: [{ finish_reason: 'stop', message: { content: '{"intent":"undo","slots":{}}' } }] }))
      .toEqual({ text: '{"intent":"undo","slots":{}}', finish: 'stop', model: 'DictaLM-3.0-1.7B-Thinking-Q4_K_M.gguf' });
    expect(parseLlamaReply({ choices: [{ finish_reason: 'length', message: { content: '{"in' } }] })?.finish).toBe('length');
    expect(parseLlamaReply({ choices: [{ finish_reason: 'tool_calls', message: {} }] })).toEqual({ text: null, finish: 'other', model: null });
    for (const bad of [null, 'x', {}, { choices: [] }, { choices: [{}] }]) expect(parseLlamaReply(bad), JSON.stringify(bad)).toBeNull();
    expect(localModelName('/home/u/m\u0007.gguf')).toBe('m.gguf');
    expect(localModelName('')).toBeNull();
  });
});

describe('the local descriptor and its setup', () => {
  it('parses, is loopback with no money, sends only the request and the UI language, and is a draft never executed', () => {
    expect(LocalCapabilityDescriptorSchema.parse(ASSISTANT_LOCAL_CAPABILITY)).toEqual(ASSISTANT_LOCAL_CAPABILITY);
    expect(ASSISTANT_LOCAL_CAPABILITY.egress).toEqual({ kind: 'loopback', host: '127.0.0.1' });
    expect(ASSISTANT_LOCAL_CAPABILITY.dataSent).toEqual(['request_text', 'ui_language']);
    expect(ASSISTANT_LOCAL_CAPABILITY.state).toBe('draft');
    expect(ASSISTANT_LOCAL_CAPABILITY.qualification.executed.status).toBe('not_assessed');
    expect(ASSISTANT_LOCAL_PROMPT_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('leaves the cloud pin byte-for-byte as reviewed', () => {
    expect(ASSISTANT_PROMPT_DIGEST).toBe('sha256:be49337a799f70911112f8f4ff4d92076eba11482beb047dccef90e68b3671c8');
    expect(ASSISTANT_CAPABILITY.promptDigest).toBe(ASSISTANT_PROMPT_DIGEST);
    expect(ASSISTANT_LOCAL_PROMPT_DIGEST).not.toBe(ASSISTANT_PROMPT_DIGEST);
  });
  it('reports only codes of CHAT_BLOCKER_CODES, in order; ready with the adapter chosen, installed, a port and the reviewed prompt', () => {
    const ok = { adapter: 'local-llama-server', installed: 'local-llama-server', local: { port: 8791, timeoutSeconds: 60 }, promptDigest: ASSISTANT_LOCAL_PROMPT_DIGEST };
    expect(localBlockers(ASSISTANT_LOCAL_CAPABILITY, ok)).toEqual([]);
    const all = localBlockers(ASSISTANT_LOCAL_CAPABILITY, { adapter: null, installed: null, local: null, promptDigest: 'sha256:x' });
    expect(all.map((b) => b.code)).toEqual(['provider_not_configured', 'prompt_digest_mismatch']);
    for (const b of all) expect(CHAT_BLOCKER_CODES as readonly string[]).toContain(b.code);
    expect(localBlockers(ASSISTANT_LOCAL_CAPABILITY, { ...ok, local: undefined })[0]!.message).toMatch(/no port/);
    expect(localBlockers(ASSISTANT_LOCAL_CAPABILITY, { ...ok, installed: null })[0]!.message).toMatch(/no local adapter installed/);
  });
});
