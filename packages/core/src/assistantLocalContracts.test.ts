/**
 * The LOCAL assistant's vocabulary and wire contract (wave 7; .artifacts/wave7/assistant-decisions.md §4), and builder A's rows.
 */
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_LOCAL_DEFAULTS, ASSISTANT_LOCAL_TEXT_MAX, AssistantConfigBodySchema, AssistantLocalConfigSchema, AssistantRequestBodySchema, INTENT_IDS,
  isLocalOutput, LOCAL_ANSWER_INTENTS, LOCAL_DECIMAL, LOCAL_INTENT_SLOTS, LOCAL_INTENTS, LOCAL_NUMERIC_SLOTS, LOCAL_SLOT_NAMES, LocalAnswerSchema,
  ASSISTANT_TEXT_MAX,
} from './index.ts';
import { LOCAL_INTENT_BUILT } from './commandBar/localIntent.ts';

const base = { adapter: 'local-llama-server', host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false } };

describe('the vocabulary', () => {
  it('offers grammar intents only, each with its slots from the slot list', () => {
    for (const i of LOCAL_INTENTS) expect(INTENT_IDS as readonly string[]).toContain(i);
    expect(Object.keys(LOCAL_INTENT_SLOTS).sort()).toEqual([...LOCAL_INTENTS].sort());
    for (const [i, slots] of Object.entries(LOCAL_INTENT_SLOTS)) for (const s of slots) expect(LOCAL_SLOT_NAMES as readonly string[], `${i}.${s}`).toContain(s);
    expect(LOCAL_ANSWER_INTENTS.at(-1)).toBe('none');
    expect(LOCAL_INTENTS).toHaveLength(29);
    for (const n of LOCAL_NUMERIC_SLOTS) expect(LOCAL_SLOT_NAMES as readonly string[]).toContain(n);
  });
  it('the answer schema is strict and its numbers are decimal strings', () => {
    expect(LocalAnswerSchema.safeParse({ intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' } }).success).toBe(true);
    expect(LocalAnswerSchema.safeParse({ intent: 'none', slots: {} }).success).toBe(true);
    for (const bad of [{ intent: 'gain_change' }, { intent: 'delete_all', slots: {} }, { intent: 'undo', slots: {}, ops: [] }, { intent: 'speed', slots: { factor: 2 } }, { intent: 'add_title', slots: { colour: 'red' } }])
      expect(LocalAnswerSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    for (const ok of ['6', '0.5', '1.25', '123456']) expect(LOCAL_DECIMAL.test(ok), ok).toBe(true);
    for (const no of ['', '6.', '.5', '-3', '1e3', '6 dB', '1,5', '1234567', '0.1234', '٦']) expect(LOCAL_DECIMAL.test(no), no).toBe(false);
  });
});

describe('settings and requests', () => {
  it('the local block holds only a port and a time limit: a host, URL or path is refused', () => {
    expect(AssistantConfigBodySchema.safeParse({ ...base, local: { ...ASSISTANT_LOCAL_DEFAULTS } }).success).toBe(true);
    expect(AssistantConfigBodySchema.safeParse(base).success).toBe(true); // a config saved before wave 7
    expect(AssistantConfigBodySchema.safeParse({ ...base, local: null }).success).toBe(true);
    for (const bad of [{ port: 8791, timeoutSeconds: 60, host: '10.0.0.5' }, { port: 8791, timeoutSeconds: 60, url: 'http://evil.example' }, { port: 80, timeoutSeconds: 60 }, { port: 65536, timeoutSeconds: 60 }, { port: 8791, timeoutSeconds: 4 }, { port: 8791.5, timeoutSeconds: 60 }, { port: '8791', timeoutSeconds: 60 }])
      expect(AssistantLocalConfigSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it('a request may say its language; the local text limit is below the bar\'s', () => {
    expect(AssistantRequestBodySchema.safeParse({ text: 'x', selection: [], playheadFrame: 0, lang: 'en' }).success).toBe(true);
    expect(AssistantRequestBodySchema.safeParse({ text: 'x', selection: [], playheadFrame: 0, lang: 'fr' }).success).toBe(false);
    expect(ASSISTANT_LOCAL_TEXT_MAX).toBeLessThan(ASSISTANT_TEXT_MAX);
  });
  it('a local output is told apart from a cloud one', () => {
    expect(isLocalOutput({ kind: 'local-intent', intent: 'none', slots: {}, dropped: [], phrase: null, model: null, wallMs: 1 })).toBe(true);
    expect(isLocalOutput({ proposalId: 'p', explanation: null, opsCount: 1, costCents: 1, costBasis: 'reported' })).toBe(false);
    expect(isLocalOutput(null)).toBe(false);
  });
});

describe('builder A (core localIntent.ts)', () => {
  it('is not built yet', () => { expect(LOCAL_INTENT_BUILT).toBe(false); });
  it.todo('groundLocalAnswer keeps a numeric slot only when parseNumber/parseTime read that exact value in the request («שש» → "6"; «וחצי» → .5; «הרביעית» grounds nothing), and drops it otherwise as ungrounded');
  it.todo('groundLocalAnswer keeps a text slot only as an exact substring of the NFC request without a quote, control or format character; drops a slot the intent does not take (not_for_intent) and a number outside LOCAL_DECIMAL (malformed); never adds or changes a value');
  it.todo('localPhrase: for every intent × slot combination of a table, the Hebrew and English phrase satisfies barUnderstands and interpret(phrase, ctxFor(intent)) has that intent; null where no grammar phrase fits (mute with target clip)');
  it.todo('localPhrase with a dropped number gives the grammar\'s incomplete result (it asks), never a default amount');
});
