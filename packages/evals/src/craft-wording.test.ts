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
import { buildFilm } from './craft-proof.ops.ts';
import type { OpCall, ProjectDocument } from '@pulseframe/core';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };
const OPS = ['ripple_trim', 'paste_attributes', 'replace_text'] as const;
const findClipTrack = (doc: ProjectDocument, clipId: string) => doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.clips.some((c) => c.id === clipId))!.id;

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
  it('each operation refusal provoked for real through ripple_trim, paste_attributes and replace_text, worded in Hebrew with a next step', () => {
    expect(CRAFT_OPS_BUILT).toBe(true);
    let doc = createProject({ id: 'prj_cw', name: 'CW', width: 640, height: 360, frameRate: { num: 30, den: 1 } });
    let n = 0;
    const run = (d: ProjectDocument, ops: OpCall[], internal = false) => applyTransaction(d, ops, { idSeed: `cwr${n++}_`, actor: 'test', allowInternal: internal });
    const film = buildFilm((ops, internal) => { const r = run(doc, ops, internal); doc = r.doc; return { doc, outputs: r.results.map((x) => x.output) }; });
    const f = (k: number) => T.frameTime(k, { num: 30, den: 1 });
    const on = (d: ProjectDocument, ops: OpCall[]) => caught(() => run(d, ops));
    const rt = (clipId: string, edge: string, to: number) => ({ op: 'ripple_trim', args: { clipId, edge, to: f(to) } });
    // J-cut: B's sound moved before 0 would be; a sound in the way of a moving one; two clips linked across the edge
    const jcut = run(doc, [{ op: 'delete_clip', args: { clipId: film.As, includeLinked: false } }, { op: 'move_clip', args: { clipId: film.Bs, start: f(2), includeLinked: false } }]).doc;
    const blocked = run(run(doc, [{ op: 'delete_clip', args: { clipId: film.As, includeLinked: false } }]).doc, [{ op: 'add_clip', args: { assetId: film.mus, start: f(20), duration: f(6), trackId: findClipTrack(doc, film.Bs) } }]).doc;
    const crossed = structuredClone(doc);
    for (const id of [film.A, film.C]) { const c = crossed.sequences[crossed.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((x) => x.id === id)!; if (c.type === 'media') c.linkGroupId = 'lnk_cw'; }
    const withFields = run(doc, [{ op: 'add_text', args: { text: 'נעה {date}', start: f(75), duration: f(10), fields: true } }]);
    const ft = (withFields.results[0]!.output as { clipId: string }).clipId;
    const t = { kind: 'title', clipId: film.title };
    const rep = (...edits: object[]) => [{ op: 'replace_text', args: { edits } }];
    const real: Record<Exclude<CraftRefusalKey, 'notBuilt'>, string> = {
      rippleStartLonger: on(doc, [rt(film.B, 'start', 20)]),
      rippleNoChange: on(doc, [rt(film.B, 'end', 60)]),
      rippleDifferentAmounts: on(crossed, [rt(film.B, 'end', 50)]),
      rippleBeforeZero: on(jcut, [rt(film.A, 'start', 10)]),
      rippleOver: on(blocked, [rt(film.A, 'end', 15)]),
      pasteSourceIsTarget: on(doc, [{ op: 'paste_attributes', args: { fromClipId: film.A, toClipIds: [film.A], groups: ['colour'] } }]),
      pasteNothing: on(doc, [{ op: 'paste_attributes', args: { fromClipId: film.A, toClipIds: [film.B], groups: ['colour'] } }]),
      replaceChanged: on(doc, rep({ at: t, was: 'stale', text: 'x' })),
      replaceEmpty: on(doc, rep({ at: t, was: 'שלום נעה', text: '  ' })),
      replaceFields: on(withFields.doc, rep({ at: { kind: 'title', clipId: ft }, was: 'נעה {date}', text: 'נועה' })),
      replaceTooLong: on(doc, rep({ at: t, was: 'שלום נעה', text: 'א'.repeat(2417) })),
      replaceMissing: on(doc, rep({ at: { kind: 'title', clipId: 'clp_t' }, was: 'a', text: 'b' })),
      replaceTwice: on(doc, rep({ at: t, was: 'שלום נעה', text: 'a' }, { at: t, was: 'שלום נעה', text: 'b' })),
    };
    const table = opSentences();
    for (const [key, en] of Object.entries(real) as [Exclude<CraftRefusalKey, 'notBuilt'>, string][]) {
      // the sentence the op said has the table's shape (its values differ: real clip ids), and is worded in Hebrew
      expect({ key, shaped: CRAFT_REFUSAL_PATTERNS.some((re) => re.test(en) && table[key].some((x) => re.test(x))) }).toEqual({ key, shaped: true });
      const he = translateRefusal('he', en);
      expect({ key, en, hebrew: !!he && /[֐-׿]/.test(he) && !/לא עבר בדיקה/.test(he) }).toEqual({ key, en, hebrew: true });
      if (key.startsWith('ripple')) expect({ key, he: /Shift\+Delete/.test(he!) }).toEqual({ key, he: false });
    }
  });
});
