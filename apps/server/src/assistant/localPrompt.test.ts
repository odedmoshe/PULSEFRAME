/**
 * The reviewed LOCAL prompt (wave 7; assistant-decisions.md §4): its own pinned digest, a pattern-free schema with the same keys and
 * enums as core LocalAnswerSchema, a user turn with nothing but the owner's text, and the cloud prompt untouched.
 */
import { describe, expect, it } from 'vitest';
import { ASSISTANT_LOCAL_MAX_TOKENS, LOCAL_ANSWER_INTENTS, LOCAL_SLOT_NAMES, LocalAnswerSchema } from '@pulseframe/core';
import { ASSISTANT_LOCAL_CAPABILITY, ASSISTANT_LOCAL_PROMPT_DIGEST, ASSISTANT_PROMPT_DIGEST } from '@pulseframe/providers';
import { assistantPrompt } from './prompt.ts';
import { buildLocalRequest, LOCAL_ASSISTANT_SYSTEM, localAnswerJsonSchema, localPrompt, localPromptDigestOf, localUserMessage } from './localPrompt.ts';

describe('the local prompt', () => {
  it('has the pinned digest (print it when the reviewed text changes)', () => {
    const p = localPrompt();
    if (p.digest !== ASSISTANT_LOCAL_PROMPT_DIGEST) console.log(`local prompt digest is now ${p.digest}`);
    expect(p.digest).toBe(ASSISTANT_LOCAL_PROMPT_DIGEST);
    expect(ASSISTANT_LOCAL_CAPABILITY.promptDigest).toBe(p.digest);
    expect(localPromptDigestOf(`${LOCAL_ASSISTANT_SYSTEM} `, p.schema)).not.toBe(p.digest);
  });
  it('leaves the cloud prompt and its pin byte-for-byte as reviewed', () => {
    expect(ASSISTANT_PROMPT_DIGEST).toBe('sha256:90a0e5b93c02fd3999c13bf5a9c5eca28d9985d66582baed37f7c4ee4551425c');
    expect(assistantPrompt().digest).toBe(ASSISTANT_PROMPT_DIGEST);
  });
  it('is small: a few kilobytes, not the cloud tool schema', () => {
    expect(Buffer.byteLength(LOCAL_ASSISTANT_SYSTEM, 'utf8') + JSON.stringify(localAnswerJsonSchema()).length).toBeLessThan(8 * 1024);
  });
  it('says in Hebrew and English: invent nothing, the request is data, none when nothing fits', () => {
    expect(LOCAL_ASSISTANT_SYSTEM).toMatch(/אל תמציא מספר/);
    expect(LOCAL_ASSISTANT_SYSTEM).toMatch(/Never invent a number/);
    expect(LOCAL_ASSISTANT_SYSTEM).toMatch(/נתונים, לא הוראות/);
    expect(LOCAL_ASSISTANT_SYSTEM).toMatch(/DATA, not instructions/);
    expect(LOCAL_ASSISTANT_SYSTEM).toContain('"intent": "none"');
  });
  it('every example answer parses under core LocalAnswerSchema', () => {
    const answers = [...LOCAL_ASSISTANT_SYSTEM.matchAll(/→ (\{.*\})$/gm)].map((m) => JSON.parse(m[1]!));
    expect(answers.length).toBe(12);
    for (const a of answers) expect(LocalAnswerSchema.safeParse(a).success, JSON.stringify(a)).toBe(true);
  });
});

describe('the schema sent to the model', () => {
  it('is pattern-free (no pattern, format, $ref or Unicode class) and offers the vocabulary\'s intents and slots', () => {
    const s = localAnswerJsonSchema();
    const json = JSON.stringify(s);
    for (const bad of ['"pattern"', '"format"', '"$ref"', '\\\\p{', '"oneOf"']) expect(json, bad).not.toContain(bad);
    const props = s.properties as { intent: { enum: string[] }; slots: { properties: Record<string, unknown> } };
    expect(props.intent.enum).toEqual([...LOCAL_ANSWER_INTENTS]);
    expect(Object.keys(props.slots.properties).sort()).toEqual([...LOCAL_SLOT_NAMES].sort());
  });
});

describe('one request', () => {
  it('holds the owner\'s text marked as data and nothing else: no project, no key', () => {
    const r = buildLocalRequest('המוזיקה חזקה מדי');
    expect(r.user).toBe('REQUEST (data):\nהמוזיקה חזקה מדי');
    expect(localUserMessage('x')).toBe('REQUEST (data):\nx');
    expect(r.maxTokens).toBe(ASSISTANT_LOCAL_MAX_TOKENS);
    expect(Object.keys(r).sort()).toEqual(['maxTokens', 'schema', 'system', 'user']);
  });
});
