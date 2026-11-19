/**
 * The shared wording of the Hebrew command bar and its assistant (ADR-0027; packages/i18n/src/commandBar.ts): every code of
 * the contract has words in both languages, the Hebrew is Hebrew, numbers sit in an isolate, the decided sentences are exact,
 * and nothing claims the assistant is connected or that a model answered (wave 1 has no network adapter).
 */
import { describe, expect, it } from 'vitest';
import { ASSISTANT_ERROR_CODES, ASSISTANT_NEVER_SENT, ASSISTANT_SETUP_CODES, ASSISTANT_STAGES, BAR_REFUSAL_CODES } from '@pulseframe/core';
import { dictionaries } from '../../i18n/src/index.ts';
import { COMMAND_BAR_EN, COMMAND_BAR_HE } from '../../i18n/src/commandBar.ts';

const he = dictionaries.he as Record<string, string>, en = dictionaries.en as Record<string, string>;
const HEBREW = /[א-ת]/;
describe('command bar wording (ADR-0027)', () => {
  it('every refusal, setup state, stage, never-sent item and error code has words in both languages', () => {
    const keys = [
      ...BAR_REFUSAL_CODES.map((c) => `bar.refusal.${c}`), ...ASSISTANT_SETUP_CODES.map((c) => `assistant.setup.${c}`), ...ASSISTANT_STAGES.map((s) => `assistant.stage.${s}`),
      ...ASSISTANT_NEVER_SENT.map((n) => `assistant.never.${n}`), ...ASSISTANT_ERROR_CODES.map((c) => `error.code.${c}`),
    ];
    for (const k of keys) {
      expect(he[k]?.trim(), k).toBeTruthy();
      expect(en[k]?.trim(), k).toBeTruthy();
      expect(HEBREW.test(he[k]!), k).toBe(true);
      expect(HEBREW.test(en[k]!), k).toBe(false);
    }
  });
  it('the two dictionaries of this module cover the same keys and reach the shared dictionaries', () => {
    expect(Object.keys(COMMAND_BAR_EN).sort()).toEqual(Object.keys(COMMAND_BAR_HE).sort());
    for (const k of Object.keys(COMMAND_BAR_HE)) { expect(he[k], k).toBe((COMMAND_BAR_HE as Record<string, string>)[k]); expect(en[k], k).toBe((COMMAND_BAR_EN as Record<string, string>)[k]); }
  });
  it('keeps the decided sentences exact', () => {
    expect(he['assistant.notConnected']).toBe('עוזר השפה לא מחובר');
    expect(he['assistant.setup.provider_not_configured']).toBe('עוזר השפה לא מחובר');
    expect(he['assistant.howToConnect']).toBe('איך מחברים');
    expect(he['bar.projectChanged']).toBe('הפרויקט השתנה — בדקו שוב');
    expect(he['assistant.toggle.titlesAndMarkers']).toBe('לשלוח נוסח כותרות וסמנים');
    expect(he['assistant.toggle.peopleNames']).toBe('לשלוח שמות אנשים');
    expect(he['bar.refusal.half_frame']!.startsWith('פריים הוא היחידה הקטנה ביותר; ')).toBe(true);
  });
  it('every bar refusal pairs the reason with the next step, in both languages (house rule)', () => {
    for (const c of BAR_REFUSAL_CODES) {
      for (const [lang, d] of [['he', he], ['en', en]] as const) {
        const v = d[`bar.refusal.${c}`]!;
        const [reason, next, ...rest] = v.split('; ');
        expect(rest.length, `${lang} ${c}: one reason, one next step: ${v}`).toBe(0);
        expect(reason?.trim().length, `${lang} ${c}: reason`).toBeGreaterThan(3);
        expect(next?.trim().length ?? 0, `${lang} ${c}: next step missing: ${v}`).toBeGreaterThan(3);
      }
    }
  });
  it('numbers in Hebrew sentences are isolated left to right', () => {
    for (const [k, v] of Object.entries(COMMAND_BAR_HE)) for (const m of v.matchAll(/\d+/g)) expect(v.slice(0, m.index).endsWith('⁦') || /⁦[^⁩]*$/.test(v.slice(0, m.index)), `${k}: ${v}`).toBe(true);
  });
  it('never says the assistant is connected or that a model answered', () => {
    for (const [k, v] of Object.entries(COMMAND_BAR_HE)) expect(/(?<!לא )מחובר/.test(v), `${k}: ${v}`).toBe(false);
    for (const [k, v] of Object.entries(COMMAND_BAR_EN)) expect(/(?<!not )\bconnected\b/i.test(v), `${k}: ${v}`).toBe(false);
  });
});
