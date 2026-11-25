/**
 * The craft contracts (wave 7 craft pre-pass; .artifacts/wave7/craft-decisions.md §4): the three ops are registered with their
 * final schemas and refuse as not built, changing nothing; every stub refuses instead of answering; the assistant cannot propose
 * them; the shared shift words differ from Delete's; the one mark table is the command bar's. The it.todo rows name what each
 * builder makes pass (W1: craft.test.ts; W2: versionDiff.test.ts), and are removed here when built.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, assistantOps, ASSISTANT_EXCLUDED_OPS, ATTRIBUTE_GROUPS, BIDI_CONTROLS, composeRestore, CRAFT_OPS_BUILT, CRAFT_REFUSALS, CraftNotBuilt, createProject,
  describeDiff, durationOps, findText, getOp, HEBREW_MARKS, matchText, OpError, parseTimeEntry, PasteAttributesArgsSchema, planPasteAttributes, planReplace,
  privacyDigest, ReplaceTextArgsSchema, RIPPLE_DELETE_WORDS, RIPPLE_TRIM_WORDS, rippleTrimCall, rippleTrimTarget, RippleTrimArgsSchema,
} from './index.ts';
import { normWord } from './commandBar/normalize.ts';

const R = { num: 30, den: 1 };
const doc = createProject({ id: 'prj_craft', name: 'C', width: 640, height: 360 });
const flags = { wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false };
const query = { text: 'נעה', ...flags, scope: 'project' as const, formats: 'all' as const };

describe('craft contracts', () => {
  it('the three ops are public, version 1, and refuse as not built while CRAFT_OPS_BUILT is false, changing nothing', () => {
    expect(CRAFT_OPS_BUILT).toBe(false);
    const calls = [
      { op: 'ripple_trim', args: { clipId: 'clp_x', edge: 'end', to: T.frameTime(30, R) } },
      { op: 'paste_attributes', args: { fromClipId: 'clp_a', toClipIds: ['clp_b'], groups: ['colour'] } },
      { op: 'replace_text', args: { edits: [{ at: { kind: 'title', clipId: 'clp_t' }, was: 'נעה', text: 'נועה' }] } },
    ];
    for (const call of calls) {
      const def = getOp(call.op)!;
      expect(def.internal ?? false, call.op).toBe(false);
      expect(def.version).toBe(1);
      const before = JSON.stringify(doc);
      let err: unknown;
      try { applyTransaction(doc, [call], { idSeed: 'c_', actor: 'test' }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(OpError);
      expect((err as OpError).message).toBe(CRAFT_REFUSALS.notBuilt.message(call.op));
      expect(JSON.stringify(doc)).toBe(before);
    }
  });
  it('the argument schemas hold the limits of the decisions', () => {
    expect(RippleTrimArgsSchema.safeParse({ clipId: 'c', edge: 'middle', to: T.frameTime(1, R) }).success).toBe(false);
    expect(PasteAttributesArgsSchema.safeParse({ fromClipId: 'a', toClipIds: Array.from({ length: 201 }, (_, i) => `c${i}`), groups: ['colour'] }).success).toBe(false);
    expect(PasteAttributesArgsSchema.safeParse({ fromClipId: 'a', toClipIds: ['b'], groups: ['colour', 'colour'] }).success).toBe(false);
    expect(PasteAttributesArgsSchema.safeParse({ fromClipId: 'a', toClipIds: ['b'], groups: ['speed'] }).success).toBe(false); // «מהירות» is cut
    expect(ATTRIBUTE_GROUPS).toEqual(['colour', 'effects', 'transform', 'animation', 'sound', 'titleStyle']);
    expect(ReplaceTextArgsSchema.safeParse({ edits: [{ at: { kind: 'title', clipId: 'c' }, was: 'a', text: '' }] }).success).toBe(false);
    expect(ReplaceTextArgsSchema.safeParse({ edits: [{ at: { kind: 'phrase', assetId: 'a', segmentId: 's' }, was: 'a', text: 'x'.repeat(4001) }] }).success).toBe(false);
  });
  it('every stub refuses with CraftNotBuilt instead of answering', () => {
    const stubs: (() => unknown)[] = [
      () => parseTimeEntry('5s', R), () => rippleTrimTarget(doc, { clipIds: [], sequenceId: doc.mainSequenceId }, 0), () => rippleTrimCall(doc, 'c', 'start', 0),
      () => durationOps(doc, ['c'], 150), () => planPasteAttributes(doc, { fromClipId: 'a', toClipIds: ['b'], groups: ['colour'] }), () => matchText('נעה', 'נעה', flags),
      () => findText(doc, query), () => planReplace(doc, query, 'נועה'), () => privacyDigest(doc), () => composeRestore(doc, doc), () => describeDiff(doc, doc),
    ];
    for (const s of stubs) expect(s).toThrow(CraftNotBuilt);
  });
  it('the language assistant cannot propose any craft op (the reviewed prompt stays as it is)', () => {
    for (const op of ['replace_text', 'ripple_trim', 'paste_attributes']) {
      expect(ASSISTANT_EXCLUDED_OPS).toContain(op);
      expect(assistantOps()).not.toContain(op);
    }
  });
  it('ripple trim words differ from Delete\'s in every sentence and hint, so the Hebrew can advise a trim', () => {
    expect(RIPPLE_TRIM_WORDS.differentAmounts('a', 'b')).not.toBe(RIPPLE_DELETE_WORDS.differentAmounts('a', 'b'));
    expect(RIPPLE_TRIM_WORDS.beforeZero('a')).not.toBe(RIPPLE_DELETE_WORDS.beforeZero('a'));
    expect(RIPPLE_TRIM_WORDS.over('a', 'b', 't')).not.toBe(RIPPLE_DELETE_WORDS.over('a', 'b', 't'));
    for (const k of ['differentAmountsHint', 'lockedPartnerHint', 'beforeZeroHint', 'overHint'] as const) {
      expect(RIPPLE_TRIM_WORDS[k]).not.toBe(RIPPLE_DELETE_WORDS[k]);
      expect(RIPPLE_TRIM_WORDS[k]).not.toMatch(/delete/i);
    }
  });
  it('the one mark table is the command bar\'s: normWord still strips with it; direction controls are a separate table', () => {
    expect('שָׁלוֹם'.replace(HEBREW_MARKS, '')).toBe('שלום');
    expect(normWord('שָׁלוֹם')).toBe('שלום');
    expect('א⁧ב⁩‏'.replace(BIDI_CONTROLS, '')).toBe('אב');
    expect('־'.replace(HEBREW_MARKS, '')).toBe('־'); // maqaf is not a mark
  });
  it.todo('W1: ripple_trim — shortening the end, lengthening the end (shift first), the start edge, by = 0, each RIPPLE_TRIM_WORDS refusal, undo exact');
  it.todo('W1: paste_attributes — each group, source_empty never clears, target_animated, rollback confined to the target and its linked clips, keys past the end counted');
  it.todo('W1: replace_text — each carrier, was mismatch, empty, fields, limits per carrier, cue word timing kept iff the count is unchanged');
  it.todo('W1: parseTimeEntry — the shared golden with the command bar reader; sign, suffix, bare number, rounding ties up, every refusal');
  it.todo('W1: matchText / findText / planReplace — findReplace.golden.json (200+ cases) and the notes');
  it.todo('W2: privacyDigest, composeRestore, describeDiff (versionDiff.test.ts)');
});
