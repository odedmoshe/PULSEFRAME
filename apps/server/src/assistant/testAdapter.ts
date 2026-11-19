/**
 * TEST DOUBLE — NOT A PROVIDER. A ChatModelAdapter for tests and the command-bar proof only (SPEC §27: mocks stay in tests
 * and are labelled). It opens no connection: it answers from a script it is given, counts its calls and keeps the exact
 * requests it was handed, so a test can check that nothing was sent (calls 0) or what was (no planted private string).
 * Its id says MOCK, and so does every result (providerRequestId 'MOCK-<n>'). Nothing in the server imports it: an owner's
 * config naming it finds no installed adapter (setup provider_not_configured) unless a test installs it through AssistantDeps.
 */
import type { ChatEndpoint, ChatModelAdapter, ChatProbeResult, ChatRequest, ChatResponse } from '@pulseframe/providers';
import { ChatProviderError } from '@pulseframe/providers';

export const TEST_ADAPTER_ID = 'TEST-MOCK-chat';

/** One scripted answer: a response (its providerRequestId is set to MOCK-<n>), an error to throw, or a function of the request. */
export type MockStep =
  | { respond: Omit<ChatResponse, 'providerRequestId'> }
  | { throw: ChatProviderError | Error }
  | { wait: (signal: AbortSignal) => Promise<Omit<ChatResponse, 'providerRequestId'>> };

export class TestChatAdapter implements ChatModelAdapter {
  readonly id: string;
  readonly bytesBoundTokens: boolean;
  calls = 0;
  probes = 0;
  readonly requests: { req: ChatRequest; cfg: ChatEndpoint; keyLength: number }[] = [];
  private script: MockStep[];
  constructor(opts: { id?: string; bytesBoundTokens?: boolean; script?: MockStep[] } = {}) {
    this.id = opts.id ?? TEST_ADAPTER_ID;
    if (!/MOCK/.test(this.id)) throw new Error('a test double says MOCK in its id');
    this.bytesBoundTokens = opts.bytesBoundTokens ?? true;
    this.script = [...(opts.script ?? [])];
  }
  /** Append answers for the next calls. */
  queue(...steps: MockStep[]): this { this.script.push(...steps); return this; }
  async probe(_cfg: ChatEndpoint, _key: string, _signal: AbortSignal): Promise<ChatProbeResult> { this.probes++; return { ok: true }; }
  async complete(req: ChatRequest, cfg: ChatEndpoint, key: string, signal: AbortSignal): Promise<ChatResponse> {
    this.calls++;
    this.requests.push({ req: structuredClone(req), cfg: { ...cfg }, keyLength: key.length });
    const n = this.calls;
    const step = this.script.shift();
    if (!step) throw new ChatProviderError('bad_request', false, 'MOCK: no scripted answer left');
    if ('throw' in step) throw step.throw;
    const r = 'wait' in step ? await step.wait(signal) : step.respond;
    if (signal.aborted) throw new ChatProviderError('unknown_after_send', false, 'MOCK: aborted after the request was handed over');
    return { ...r, providerRequestId: `MOCK-${n}` };
  }
}

/** A well-formed MOCK answer proposing `ops` through the tool. */
export const mockToolAnswer = (ops: { op: string; args: Record<string, unknown> }[], explanation = 'MOCK proposal', usage: ChatResponse['usage'] = { inputTokens: 1000, outputTokens: 100 }): MockStep =>
  ({ respond: { toolInput: { ops, explanation }, text: null, finish: 'tool', usage } });

const T1 = { value: '1', timescale: 1 };
/**
 * The nine invalid MOCK answers of plan §8 (W2) and proof check 11(b), each with the words its refusal must name. Each must
 * give invalid_model_output and no proposal. `clipId` is a clip of the project under test (for the ops that need one).
 */
export function invalidMockAnswers(clipId: string): { name: string; step: MockStep; reason: RegExp }[] {
  const tool = (toolInput: unknown): MockStep => ({ respond: { toolInput, text: null, finish: 'tool', usage: { inputTokens: 10, outputTokens: 10 } } });
  return [
    { name: 'unknown op', step: tool({ ops: [{ op: 'explode_clip', args: { clipId } }] }), reason: /not an operation/ },
    { name: 'internal op', step: tool({ ops: [{ op: 'import_asset', args: {} }] }), reason: /internal/ },
    { name: 'people op', step: tool({ ops: [{ op: 'remove_person', args: { personId: 'per_x' } }] }), reason: /changes people/ },
    { name: 'birth date in an allowed op', step: tool({ ops: [{ op: 'add_text', args: { text: 'x', start: T1, duration: T1, birthDate: '2019-03-04' } }] }), reason: /birth date/ },
    { name: 'bad args', step: tool({ ops: [{ op: 'split_clip', args: { clipId, at: 'three seconds' } }] }), reason: /invalid arguments/ },
    { name: '51 ops', step: tool({ ops: Array.from({ length: 51 }, () => ({ op: 'split_clip', args: { clipId, at: T1 } })) }), reason: /shape/ },
    { name: 'text that is not JSON', step: { respond: { toolInput: null, text: 'Sure! I split the clip for you.', finish: 'stop', usage: { inputTokens: 10, outputTokens: 10 } } }, reason: /not a JSON proposal/ },
    { name: 'finish length', step: { respond: { toolInput: { ops: [{ op: 'split_clip', args: { clipId, at: T1 } }] }, text: null, finish: 'length', usage: { inputTokens: 10, outputTokens: 2000 } } }, reason: /cut off/ },
    { name: 'empty tool input', step: tool({}), reason: /empty/ },
  ];
}
