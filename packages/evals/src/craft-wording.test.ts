/**
 * Keeps the Hebrew wording of the craft refusals (packages/i18n/src/craft.ts HE_CRAFT) in step with the fixed English sentences of
 * core craftContract.ts CRAFT_REFUSALS and apps/server/src/craft/contract.ts CRAFT_SERVER_REFUSALS: every sentence, with every
 * value it can carry, is worded in Hebrew, says what to do next, and every pattern of the table is used. A ripple TRIM refusal is
 * never worded with Delete's advice (Shift+Delete). notBuilt is provoked for real through the three operations; the others come
 * from the table until W1's bodies exist — W1 then provokes each through its operation here (it.todo below).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, ATTRIBUTE_GROUPS, CRAFT_OPS_BUILT, CRAFT_REFUSALS, createProject, OpError, RIPPLE_TRIM_WORDS, TIME_ENTRY_REFUSALS, type CraftRefusalKey } from '@pulseframe/core';
import { CRAFT_SERVER_REFUSALS, type CraftServerRefusalKey } from '../../../apps/server/src/craft/contract.ts';
import { CRAFT_REFUSAL_PATTERNS, dictionaries, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };
const OPS = ['ripple_trim', 'paste_attributes', 'replace_text'] as const;

function opSentences(): Record<CraftRefusalKey, string[]> {
  const doc = createProject({ id: 'prj_cw', name: 'CW', width: 640, height: 360 });
  const args: Record<(typeof OPS)[number], unknown> = {
    ripple_trim: { clipId: 'clp_x', edge: 'end', to: T.frameTime(30, { num: 30, den: 1 }) },
    paste_attributes: { fromClipId: 'clp_a', toClipIds: ['clp_b'], groups: ['colour'] },
    replace_text: { edits: [{ at: { kind: 'title', clipId: 'clp_t' }, was: 'נעה', text: 'נועה' }] },
  };
  const R = CRAFT_REFUSALS;
  return {
    notBuilt: CRAFT_OPS_BUILT ? OPS.map((op) => R.notBuilt.message(op)) : OPS.map((op, i) => caught(() => applyTransaction(doc, [{ op, args: args[op] }], { idSeed: `cw${i}_`, actor: 'test' }))),
    rippleStartLonger: [R.rippleStartLonger.message()], rippleNoChange: [R.rippleNoChange.message()],
    rippleDifferentAmounts: [R.rippleDifferentAmounts.message('clp_a', 'clp_b')], rippleBeforeZero: [R.rippleBeforeZero.message('clp_a')],
    rippleOver: [R.rippleOver.message('clp_a', 'clp_b', 'trk_video')],
    pasteSourceIsTarget: [R.pasteSourceIsTarget.message()], pasteNothing: [R.pasteNothing.message()],
    replaceChanged: [R.replaceChanged.message()], replaceEmpty: [R.replaceEmpty.message()], replaceFields: [R.replaceFields.message()],
    replaceTooLong: [R.replaceTooLong.message(2417, 2000)], replaceMissing: [R.replaceMissing.message('title clp_t')], replaceTwice: [R.replaceTwice.message()],
  };
}
function serverSentences(): Record<CraftServerRefusalKey, string[]> {
  const S = CRAFT_SERVER_REFUSALS;
  return {
    notBuilt: [S.notBuilt.message()], versionNotFound: [S.versionNotFound.message()], versionLimit: [S.versionLimit.message(50)], agentVersionLimit: [S.agentVersionLimit.message(10)],
    privacyChanged: [S.privacyChanged.message()], nothingToRestore: [S.nothingToRestore.message()], restoreTooLarge: [S.restoreTooLarge.message(6200, 5000)],
    versionConflict: [S.versionConflict.message('clip clp_a: overlaps clip clp_b')], needsConfirmation: [S.needsConfirmation.message(2)], frameOutOfRange: [S.frameOutOfRange.message(900)],
    staleRevision: [S.staleRevision.message(41)], ownerOnly: [S.ownerOnly.message()], proposeOnly: [S.proposeOnly.message()],
  };
}

describe('craft refusals in Hebrew', () => {
  const all = [...Object.values(opSentences()).flat(), ...Object.values(serverSentences()).flat()];
  it('every sentence is worded, in Hebrew, with a next step, and none falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:—]/.test(he!) || /חפשו שוב$/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of the table is used by some sentence', () => {
    const unused = CRAFT_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en)));
    expect(unused.map(String)).toEqual([]);
  });
  it('a ripple trim refusal never gives Delete\'s advice; the shared locked-partner sentence is worded', () => {
    for (const en of [RIPPLE_TRIM_WORDS.differentAmounts('a', 'b'), RIPPLE_TRIM_WORDS.beforeZero('a'), RIPPLE_TRIM_WORDS.over('a', 'b', 't')]) {
      const he = translateRefusal('he', en)!;
      expect({ en, he: /Shift\+Delete|למחוק/.test(he) }).toEqual({ en, he: false });
    }
    expect(translateRefusal('he', 'linked clip clp_a is on locked track trk_audio')).toMatch(/[֐-׿]/);
  });
  it('the shared strings exist in both languages', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const keys = [...OPS.map((o) => `op.${o}`), ...ATTRIBUTE_GROUPS.map((g) => `craft.group.${g}`), 'craft.skip.source_empty', 'craft.skip.target_animated',
        ...TIME_ENTRY_REFUSALS.map((r) => `craft.time.${r}`), ...Object.values(CRAFT_SERVER_REFUSALS).map((r) => `error.code.${r.code}`)];
      const missing = keys.filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });
  it.todo('W1: each operation refusal provoked for real through ripple_trim, paste_attributes and replace_text once CRAFT_OPS_BUILT');
  it.todo('W2: each server refusal provoked for real through its route (craft/routes.test.ts)');
});
