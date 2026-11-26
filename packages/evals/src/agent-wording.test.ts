/**
 * The in-editor agent's wording (wave 8 autonomy Part 2, lead pre-pass): every status, stop reason, provider failure, effect class
 * of «ביטול הכול» and refusal code of core agentContract.ts has a Hebrew and an English sentence; each failure carries a next step
 * (verifier C16); the connect card's one line says what is sent; presets are worded. W1 and W3 keep it green.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_EFFECT_CLASSES, AGENT_PROVIDER_ERROR_CODES, AGENT_REFUSAL_CODES, AGENT_RUN_STATUSES, AGENT_STOP_REASONS } from '@pulseframe/core';
import { AGENT_PROVIDER_PRESETS } from '@pulseframe/providers';
import { AGENT_EN, AGENT_HE } from '../../i18n/src/index.ts';

const he = AGENT_HE as Record<string, string>, en = AGENT_EN as Record<string, string>;
const both = (k: string) => { expect(he[k]?.trim(), `he ${k}`).toBeTruthy(); expect(en[k]?.trim(), `en ${k}`).toBeTruthy(); expect(he[k]).not.toBe(en[k]); };

describe('agent wording', () => {
  it('both languages have the same keys', () => { expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort()); });
  it('every status, stop reason, provider failure, effect class, refusal code and preset is worded', () => {
    for (const s of AGENT_RUN_STATUSES) both(`agent.status.${s}`);
    for (const s of AGENT_STOP_REASONS) both(`agent.stop.${s}`);
    for (const c of AGENT_PROVIDER_ERROR_CODES) both(`agent.provider.${c}`);
    for (const k of AGENT_EFFECT_CLASSES) both(`agent.notUndone.${k}`);
    for (const r of Object.values(AGENT_REFUSAL_CODES)) if (r.code !== 'owner_required' && r.code !== 'undo_conflict') both(`error.code.${r.code}`);
    for (const p of AGENT_PROVIDER_PRESETS) both(`agent.preset.${p.id}`);
  });
  it('a failure says the next step (a second sentence or an imperative), and a stop is not only a status', () => {
    const next = /(\. |: |;)|(הדביקו|הוסיפו|בחרו|הפעילו|נסו|חברו|פתחו|חכו|התחילו|אפשר|בדקו|נסחו|ממתינים|מנסים|ביקשנו|קיצרנו)/;
    for (const s of AGENT_STOP_REASONS) if (s !== 'finished' && s !== 'canceled_by_owner') expect(he[`agent.stop.${s}`], s).toMatch(next);
    for (const c of AGENT_PROVIDER_ERROR_CODES) expect(he[`agent.provider.${c}`], c).toMatch(next);
  });
  it('the connect card says in one line what is sent (pictures, transcripts, names, instructions) — information, not a question', () => {
    const line = he['agent.connect.sent']!;
    for (const w of ['תמונות', 'התמלולים', 'שמות', 'ההוראות']) expect(line).toContain(w);
    expect(line.includes('?')).toBe(false);
    expect(line.split('\n')).toHaveLength(1);
  });
});
