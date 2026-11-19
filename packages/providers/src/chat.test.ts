/**
 * The chat capability descriptor of the command bar's language assistant (ADR-0027, plan §7.1) and its setup blockers.
 * No adapter exists in this build: nothing here talks to a network.
 */
import { describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES, DescriptorSchema, QUALIFICATION_DIMENSIONS } from './index.ts';
import { ASSISTANT_CAPABILITY, ASSISTANT_PROMPT_DIGEST, CHAT_BLOCKER_CODES, CHAT_HOST_PATTERN, ChatCapabilityDescriptorSchema, chatBlockers, type ChatSetupInput } from './chat.ts';

const ready: ChatSetupInput = {
  adapter: 'TEST-MOCK', host: 'api.example.test', model: 'mock-model', keySet: true,
  pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 500, perRequestCapCents: 50,
  adapters: ['TEST-MOCK'], allowedHosts: ['api.example.test'], promptDigest: ASSISTANT_PROMPT_DIGEST,
};
const codes = (cfg: Partial<ChatSetupInput>) => chatBlockers(ASSISTANT_CAPABILITY, { ...ready, ...cfg }).map((b) => b.code);

describe('ASSISTANT_CAPABILITY', () => {
  it('is a draft chat descriptor that parses, stays outside the capability union, and claims nothing it has not shown', () => {
    expect(ChatCapabilityDescriptorSchema.safeParse(ASSISTANT_CAPABILITY).success).toBe(true);
    expect(DescriptorSchema.safeParse(ASSISTANT_CAPABILITY).success).toBe(false);
    expect(ALL_CAPABILITIES.some((c) => c.id === ASSISTANT_CAPABILITY.id)).toBe(false);
    expect(ASSISTANT_CAPABILITY).toMatchObject({ id: 'assistant.edit-proposal', state: 'draft', provider: 'chat', egress: { kind: 'remote-api', hosts: [] }, languages: ['he', 'en'] });
    expect(ASSISTANT_CAPABILITY.promptDigest).toBe(ASSISTANT_PROMPT_DIGEST);
    for (const dim of QUALIFICATION_DIMENSIONS) expect(ASSISTANT_CAPABILITY.qualification[dim].status, dim).toBe(dim === 'schemaValid' ? 'pass' : 'not_assessed');
    expect(ASSISTANT_CAPABILITY.dataSent.length).toBeGreaterThan(0);
  });
});

describe('chatBlockers: one code for each thing the owner still has to set, in order', () => {
  it('a complete setup has no blocker', () => expect(codes({})).toEqual([]));
  it('provider_not_configured: no adapter, an adapter not installed, no host, no model, no key', () => {
    for (const cfg of [{ adapter: null }, { adapter: 'openai-chat' }, { adapters: [] }, { host: null }, { model: null }, { keySet: false }] as Partial<ChatSetupInput>[])
      expect(codes(cfg), JSON.stringify(cfg)).toEqual(['provider_not_configured']);
    const b = chatBlockers(ASSISTANT_CAPABILITY, { ...ready, adapters: [], keySet: false })[0]!;
    expect(b.message).toMatch(/no network adapter/);
    expect(b.message).toMatch(/no key is stored/);
  });
  it('prices_missing: none, or a price that is not more than 0', () => {
    for (const p of [null, { input: 0, output: 10 }, { input: 10, output: 0 }, { input: Number.NaN, output: 1 }, { input: Number.POSITIVE_INFINITY, output: 1 }])
      expect(codes({ pricesCentsPerMTok: p }), JSON.stringify(p)).toEqual(['prices_missing']);
  });
  it('limit_missing: the monthly limit or the per-request cap is 0', () => {
    expect(codes({ monthlyLimitCents: 0 })).toEqual(['limit_missing']);
    expect(codes({ perRequestCapCents: 0 })).toEqual(['limit_missing']);
    expect(chatBlockers(ASSISTANT_CAPABILITY, { ...ready, monthlyLimitCents: 0, perRequestCapCents: 0 })[0]!.message).toMatch(/monthly limit and the per-request cap/);
  });
  it('host_not_allowed: not in PF_ASSISTANT_HOSTS, or not a plain host name', () => {
    expect(codes({ allowedHosts: [] })).toEqual(['host_not_allowed']);
    expect(codes({ host: 'other.example.test' })).toEqual(['host_not_allowed']);
    for (const host of ['https://api.example.test', 'api.example.test:443', '127.0.0.1', 'API.example.test', 'api.example.test/v1', 'localhost'])
      expect(codes({ host, allowedHosts: [host] }), host).toEqual(['host_not_allowed']);
    expect(CHAT_HOST_PATTERN.test('api.example.test')).toBe(true);
  });
  it('prompt_digest_mismatch: the prompt the server would send is not the reviewed one', () => {
    expect(codes({ promptDigest: `sha256:${'1'.repeat(64)}` })).toEqual(['prompt_digest_mismatch']);
  });
  it('reports every blocker, in the order of CHAT_BLOCKER_CODES', () => {
    const all = codes({ adapter: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, host: 'not.allowed.test', promptDigest: 'sha256:x' });
    expect(all).toEqual([...CHAT_BLOCKER_CODES]);
  });
});
