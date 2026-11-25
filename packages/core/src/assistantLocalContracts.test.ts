/**
 * The LOCAL assistant's vocabulary and wire contract (wave 7; .artifacts/wave7/assistant-decisions.md §4), and builder A's rows.
 */
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_LOCAL_DEFAULTS, ASSISTANT_LOCAL_TEXT_MAX, AssistantConfigBodySchema, AssistantLocalConfigSchema, AssistantRequestBodySchema, INTENT_IDS,
  isLocalOutput, LOCAL_ANSWER_INTENTS, LOCAL_DECIMAL, LOCAL_INTENT_SLOTS, LOCAL_INTENTS, LOCAL_NUMERIC_SLOTS, LOCAL_SLOT_NAMES, LocalAnswerSchema,
  ASSISTANT_TEXT_MAX,
} from './index.ts';
import { groundLocalAnswer, LOCAL_INTENT_BUILT, localPhrase } from './commandBar/localIntent.ts';
import { interpret } from './commandBar/index.ts';
import { barUnderstands } from './commandBar/understands.ts';
import { ctxFor } from './commandBar/fixture.testFixture.ts';
import type { LocalSlots } from './assistantContract.ts';

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
  it('is built', () => { expect(LOCAL_INTENT_BUILT).toBe(true); });
  it('groundLocalAnswer keeps a numeric slot only when parseNumber/parseTime read that exact value in the request («שש» → "6"; «וחצי» → .5; «הרביעית» grounds nothing), and drops it otherwise as ungrounded', () => {
    expect(groundLocalAnswer('תורידי את המוזיקה בשש דציבל', { intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' } }).slots.db).toBe('6');
    expect(groundLocalAnswer('תקפיא לשנייה וחצי', { intent: 'freeze', slots: { forSeconds: '1.5' } }).slots.forSeconds).toBe('1.5');
    expect(groundLocalAnswer('תחתוך בשנייה הרביעית', { intent: 'split_at', slots: { atSeconds: '4' } }).dropped).toEqual([{ slot: 'atSeconds', why: 'ungrounded' }]);
    expect(groundLocalAnswer('תורידי קצת את המוזיקה', { intent: 'gain_change', slots: { db: '3' } }).dropped).toEqual([{ slot: 'db', why: 'ungrounded' }]);
  });
  it('groundLocalAnswer keeps a text slot only as an exact substring of the NFC request without a quote, control or format character; drops a slot the intent does not take (not_for_intent) and a number outside LOCAL_DECIMAL (malformed); never adds or changes a value', () => {
    expect(groundLocalAnswer('תקרא לפרויקט גן רימון', { intent: 'rename_project', slots: { text: 'גן רימון' } })).toEqual({ intent: 'rename_project', slots: { text: 'גן רימון' }, dropped: [] });
    expect(groundLocalAnswer('תקרא לפרויקט "גן רימון"', { intent: 'rename_project', slots: { text: '"גן רימון"' } }).dropped).toEqual([{ slot: 'text', why: 'malformed' }]);
    expect(groundLocalAnswer('תקרא לפרויקט גן\u200Fרימון', { intent: 'rename_project', slots: { text: 'גן\u200Fרימון' } }).dropped).toEqual([{ slot: 'text', why: 'malformed' }]);
    expect(groundLocalAnswer('תקרא לפרויקט גן רימון', { intent: 'rename_project', slots: { text: 'גן תפוח' } }).dropped).toEqual([{ slot: 'text', why: 'ungrounded' }]);
    expect(groundLocalAnswer('בטל בשש', { intent: 'undo', slots: { db: '6' } }).dropped).toEqual([{ slot: 'db', why: 'not_for_intent' }]);
    expect(groundLocalAnswer('בשש', { intent: 'gain_change', slots: { db: '6.0000' } }).dropped).toEqual([{ slot: 'db', why: 'malformed' }]);
  });
  it('localPhrase: for every intent × slot combination of a table, the Hebrew and English phrase satisfies barUnderstands and interpret(phrase, ctxFor(intent)) has that intent; null where no grammar phrase fits (mute with target clip)', () => {
    // the full table (every intent × every combination, read back value by value) is commandBar/localIntent.test.ts; one row per intent here
    for (const intent of LOCAL_INTENTS) for (const lang of ['he', 'en'] as const) {
      const slots = FULL[intent] ?? {};
      const phrase = localPhrase(intent, slots, lang);
      expect(phrase, `${intent} ${lang}`).not.toBeNull();
      expect(barUnderstands(phrase!), phrase!).toBe(true);
      const r = interpret(phrase!, ctxFor(intent));
      expect(r.kind === 'unknown' || r.kind === 'incomplete' ? null : r.intent, phrase!).toBe(intent);
    }
    expect(localPhrase('mute', { target: 'clip' }, 'he')).toBeNull();
  });
  it('localPhrase with a dropped number gives the grammar\'s incomplete result (it asks), never a default amount', () => {
    const g = groundLocalAnswer('תורידי קצת את המוזיקה', { intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '3' } });
    const r = interpret(localPhrase('gain_change', g.slots, 'he')!, ctxFor('gain_change'));
    expect(r).toMatchObject({ kind: 'incomplete', intent: 'gain_change', missing: ['amount'] });
  });
});

/** A complete answer of every intent (each required slot said). */
const FULL: Partial<Record<(typeof LOCAL_INTENTS)[number], LocalSlots>> = {
  split_at: { atSeconds: '4' }, add_title: { text: 'מזל טוב', at: 'start', forSeconds: '2' }, gain_change: { target: 'music', dir: 'down', db: '6' }, mute: { target: 'music' },
  unmute: { target: 'music' }, add_marker: { text: 'עוגה' }, freeze: { forSeconds: '1.5' }, speed: { factor: '0.5' }, fades: { edge: 'in', forSeconds: '0.5' },
  rename_project: { text: 'גן רימון' }, seek: { atSeconds: '10' }, workspace: { workspace: 'sound' }, export_to: { destination: 'whatsapp' },
};
