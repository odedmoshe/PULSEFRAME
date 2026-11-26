/**
 * Keeps the Hebrew wording of the story refusals (packages/i18n/src/story.ts HE_STORY) in step with the fixed English of core
 * storyContract.ts (STORY_REFUSALS, STORY_BLOCKING_TEXT) and apps/server/src/story.ts (STORY_API_ERRORS): every sentence is worded
 * in Hebrew with a next step, no pattern is unused, the shared strings exist in both languages and say nothing forbidden.
 * The server's propose, ages and not-built refusals are provoked for real in apps/server/src/storyContracts.test.ts. The planner's
 * own refusals come from the table until W1's planStory exists; W1 then provokes each through planStory (it.todo below; W1 may
 * edit only those todo lines of this file). Integration added those two rows at the end: every refusal of the real planStory and
 * every blocking sentence of a real rebuild after the narration was deleted, reversed or sped up.
 */
import { describe, expect, it } from 'vitest';
import { STORY_BLOCKING_TEXT, STORY_DRAFT_LABEL, STORY_FORBIDDEN_WORDS, STORY_FORBIDDEN_WORDS_HE, STORY_REFUSALS, VOICE_LABEL } from '@pulseframe/core';
import { STORY_API_ERRORS } from '../../../apps/server/src/story.ts';
import { dictionaries, STORY_EN, STORY_HE, STORY_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { applyTransaction, findClip, planStory, STORY_BINDS, STORY_TEMPLATE_ID, STORY_VERSION, StoryError, storyRunParams, storyRunRecordParams, type ProjectDocument, type StoryPlanContext } from '@pulseframe/core';
import { project, R30, song, still } from '../../core/src/familyFilm.testDouble.ts';
import { storyRegeneration } from '../../../apps/server/src/storyRegeneration.ts';
import { storyStrings } from '../../../apps/web/src/editor/story/story.strings.ts';

const core = [
  STORY_REFUSALS.narrationMissing.message(), STORY_REFUSALS.narrationNotSound.message(), STORY_REFUSALS.narrationTooLong.message(),
  STORY_REFUSALS.nothingToShow.message(), STORY_REFUSALS.badParams.message('assetIds: Too small'), STORY_REFUSALS.notBuilt.message(),
  ...Object.values(STORY_BLOCKING_TEXT),
];
const E = STORY_API_ERRORS;
const server = [E.notBuilt(), E.propose(), E.ages(), E.blocked(STORY_BLOCKING_TEXT.narration_removed, []), E.runNotFound('run_x'), E.badParams(), E.keyClash('m000000000000'), E.retap()];
const all = [...core, ...server.map((e) => e.message)];

describe('story refusals in Hebrew', () => {
  it('every sentence is worded, in Hebrew, with a next step, and none falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:;—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of HE_STORY is used by some sentence, and each sentence is answered by the story table (not an earlier one)', () => {
    expect(STORY_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
    for (const en of all) expect({ en, ours: STORY_REFUSAL_PATTERNS.some((re) => re.test(en)) }).toEqual({ en, ours: true });
  });
  it('the error codes and shared strings exist in both languages and say nothing forbidden', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = ['story.name', 'cmd.openStory', ...server.map((e) => `error.code.${e.code}`).filter((c) => !['error.code.insufficient_scope', 'error.code.people_scope_required', 'error.code.not_found'].includes(c))].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
    expect(Object.keys(STORY_EN).sort()).toEqual(Object.keys(STORY_HE).sort());
    for (const s of [...Object.values(STORY_HE), ...Object.values(STORY_EN), STORY_DRAFT_LABEL.he, STORY_DRAFT_LABEL.en, VOICE_LABEL.he, VOICE_LABEL.en, ...all.map((en) => translateRefusal('he', en)!)]) {
      expect({ s, en: STORY_FORBIDDEN_WORDS.test(s) }).toEqual({ s, en: false });
      expect({ s, he: STORY_FORBIDDEN_WORDS_HE.test(s) }).toEqual({ s, he: false });
    }
  });
});

// ---- integration (wave 7 story): the planner's own refusals and the blocking sentences, provoked for real (W1's two rows) ----
// Media are the film's labelled test builders (core familyFilm.testDouble.ts); the planner, the regeneration and apply_template are real.

describe('story refusals provoked through the real planner', () => {
  const ctx: StoryPlanContext = { voice: null, voiceState: 'pending', capture: {}, title: null };
  const doc = () => { const d = project(R30); d.assets.nar = song('nar', 24); d.assets.tiny = song('tiny', 0.05); d.assets.long = song('long', 20 * 60 + 1); for (const id of ['s0', 's1', 's2']) d.assets[id] = still(id); return d; };
  const refusal = (params: Record<string, unknown>) => { try { planStory(doc(), { narrationAssetId: 'nar', assetIds: ['s0', 's1', 's2'], ...params }, ctx); } catch (e) { if (e instanceof StoryError) return e; throw e; } throw new Error(`no refusal for ${JSON.stringify(params)}`); };
  const cases: [keyof typeof STORY_REFUSALS, Record<string, unknown>, string?][] = [
    ['narrationMissing', { narrationAssetId: 'ghost' }], ['narrationNotSound', { narrationAssetId: 's0' }], ['narrationTooLong', { narrationAssetId: 'long' }],
    ['nothingToShow', { assetIds: ['nar', 'ghost'] }], ['nothingToShow', { narrationAssetId: 'tiny' }],
    ['badParams', { assetIds: [] }, 'assetIds'], ['badParams', { cutsMs: [1.5] }, 'cutsMs'], ['badParams', { musicAssetId: 's1' }, 'musicAssetId'],
  ];
  for (const [key, params, detail] of cases) it(`${key} ${JSON.stringify(params)}: the table's code and sentence, answered in Hebrew by the story patterns`, () => {
    const e = refusal(params);
    const r = STORY_REFUSALS[key];
    expect(e.code).toBe(r.code);
    if (key === 'badParams') expect(e.message).toMatch(new RegExp(`^the story parameters are not valid: ${detail}`));
    else expect(e.message).toBe((r.message as () => string)());
    expect(STORY_REFUSAL_PATTERNS.some((re) => re.test(e.message))).toBe(true);
    const he = translateRefusal('he', e.message);
    expect(he).toMatch(/[֐-׿]/);
    expect(he).not.toMatch(/לא עבר בדיקה/);
  });

  it('after the narration is deleted or reversed by hand, every blocking message of a rebuild equals STORY_BLOCKING_TEXT and is worded in Hebrew', () => {
    const d0 = doc();
    const plan = planStory(d0, { narrationAssetId: 'nar', assetIds: ['s0', 's1', 's2'], cutsMs: [8000, 16_000] }, ctx);
    const built = applyTransaction(d0, [{ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }], { idSeed: 'wd_', actor: 'test', allowInternal: true }).doc;
    const runId = Object.keys(built.recipeRuns)[0]!;
    const nar = built.recipeRuns[runId]!.slots!.find((s) => s.key === STORY_BINDS.narration)!.clipId;
    expect(findClip(built, nar)).toBeTruthy();
    const edits: [string, { op: string; args: unknown }[], keyof typeof STORY_BLOCKING_TEXT][] = [
      ['deleted', [{ op: 'delete_clip', args: { clipId: nar } }], 'narration_removed'],
      ['reversed', [{ op: 'set_clip_reverse', args: { clipId: nar, reverse: true } }], 'kept_narration_not_followable'],
      ['at another speed', [{ op: 'set_clip_speed', args: { clipId: nar, speed: 2 } }], 'kept_narration_not_followable'],
    ];
    for (const [what, ops, want] of edits) {
      const d: ProjectDocument = applyTransaction(built, ops, { idSeed: 'hand_', actor: 'person' }).doc;
      const run = d.recipeRuns[runId]!;
      const params = storyRunParams(run.params);
      const g = storyRegeneration(d, run, params);
      const p = planStory(g.without, params, { ...ctx, ...g.ctx });
      expect({ what, codes: p.blocking.map((b) => b.code), ops: p.ops.length }).toEqual({ what, codes: [want], ops: 0 });
      for (const b of p.blocking) {
        expect(b.message).toBe(STORY_BLOCKING_TEXT[b.code as keyof typeof STORY_BLOCKING_TEXT]);
        expect(STORY_REFUSAL_PATTERNS.some((re) => re.test(b.message))).toBe(true);
        expect(translateRefusal('he', b.message)).toMatch(/[֐-׿]/);
      }
    }
  });
});

describe('the interface strings of the story (apps/web/src/editor/story/story.strings.ts) are in this test\'s scope', () => {
  // every value: a string, a nested table, or a function called with sample arguments of both kinds (a count, a name)
  const flat = (lang: 'he' | 'en'): [string, string][] => Object.entries(storyStrings(lang)).flatMap(([k, v]): [string, string][] => {
    if (typeof v === 'string') return [[k, v]];
    if (typeof v === 'function') {
      const f = v as (...a: unknown[]) => string;
      const asText = (() => { try { const t = String(f('x.wav', 'x.wav')); return t.includes('NaN') ? [] : [[`${k}('x.wav')`, t] as [string, string]]; } catch { return []; } })(); // a function of numbers (it throws or says NaN on text) is called with numbers only
      return [[`${k}(3)`, String(f(3, 7))], ...asText];
    }
    return Object.entries(v as Record<string, unknown>).map(([kk, vv]) => [`${k}.${kk}`, typeof vv === 'function' ? String((vv as (...a: unknown[]) => string)(3, 7)) : String(vv)]);
  });
  it('every Hebrew string is in Hebrew, every English string has no Hebrew, and none says a forbidden word', () => {
    const he = flat('he'), en = flat('en');
    // a string with no letters at all (a clock like 0:03, a count) needs no Hebrew
    expect(he.filter(([, v]) => /[A-Za-z]/.test(v.replace(/dBFS|Ctrl\+Z|x\.wav|R\b|Space|Enter/g, '')) && !/[֐-׿]/.test(v)).map(([k]) => k)).toEqual([]);
    expect(en.filter(([, v]) => /[֐-׿]/.test(v)).map(([k]) => k)).toEqual([]);
    for (const [k, v] of [...he, ...en]) expect({ k, bad: STORY_FORBIDDEN_WORDS.test(v) || STORY_FORBIDDEN_WORDS_HE.test(v) }).toEqual({ k, bad: false });
  });
  it('the moved_back note the bar shows after a rebuild is worded in Hebrew', () => {
    expect(storyStrings('he').warning.moved_back).toMatch(/[֐-׿]/);
    expect(storyStrings('he').warning.moved_back).not.toBe(storyStrings('en').warning.moved_back);
  });
});
