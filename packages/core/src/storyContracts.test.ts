/**
 * The story track's core contract (lead pre-pass, wave 7; .artifacts/wave7/story-decisions.md §4): the parameters, the run-record
 * helpers, the recipe listing, the stubs that refuse until built, the lifted film window rule, and the labelled test double applied
 * through the REAL apply_template as one transaction. The planner's own behaviour is W1's (story.test.ts, it.todo below).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, ASSISTANT_EXCLUDED_OPS, assistantOps, createProject, describeRecipes, filmSourceWindow, planRecipe, planStory, RecipeError, recordsRanges, sameCuts, STORY, STORY_FORBIDDEN_WORDS, STORY_FORBIDDEN_WORDS_HE,
  STORY_PLANNER_BUILT, STORY_RECIPE_ID, STORY_REFUSALS, STORY_RUN_RECIPE_ID, STORY_TEMPLATE_ID, STORY_VERSION, StoryError, StoryNotBuilt, StoryParamsSchema, storyLiveDocument, storyRunParams, storyRunPicked, storyRunRecordParams, storyRunRemovedPicks,
  VOICE_ACTIVITY_BUILT, voiceActivity, voiceOnsets, type Asset, type ProjectDocument, type StoryPlanContext,
} from './index.ts';
import { planStoryDouble } from './story.testDouble.ts';

const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const R = { num: 30, den: 1 };
function doc(): ProjectDocument {
  const d = createProject({ id: 'prj_story', name: 'S', width: 640, height: 360, frameRate: R });
  d.assets.nar = { id: 'nar', kind: 'audio', name: 'קריינות.wav', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(24, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: prov } as Asset;
  for (const id of ['i1', 'i2', 'i3', 'i4']) d.assets[id] = { id, kind: 'image', name: `${id}.png`, contentHash: `sha256:${id.padEnd(64, '0')}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov } as Asset;
  return d;
}
const ctx: StoryPlanContext = { voice: null, voiceState: 'pending', capture: {}, title: null };

describe('story contract (lead)', () => {
  it('parameters: strict, integer taps in source milliseconds, at most 200 pictures and 400 taps', () => {
    expect(StoryParamsSchema.safeParse({ narrationAssetId: 'nar', assetIds: ['i1'], cutsMs: [1500, 4200] }).success).toBe(true);
    expect(StoryParamsSchema.safeParse({ narrationAssetId: 'nar', assetIds: ['i1'], cutsMs: [1.5] }).success).toBe(false);
    expect(StoryParamsSchema.safeParse({ narrationAssetId: 'nar', assetIds: ['i1'], snap: 'pause' }).success).toBe(false);
    expect(StoryParamsSchema.safeParse({ narrationAssetId: 'nar', assetIds: [] }).success).toBe(false);
    expect(StoryParamsSchema.safeParse({ narrationAssetId: 'nar', assetIds: ['i1'], cutsMs: new Array(STORY.maxCuts + 1).fill(0) }).success).toBe(false);
    for (const v of Object.values(STORY)) expect(Number.isFinite(v)).toBe(true);
    for (const k of ['tailMs', 'minAutoMs', 'fadeMs', 'maxRecordMs', 'maxNarrationMs', 'pauseReachMs'] as const) expect(Number.isInteger(STORY[k])).toBe(true);
  });
  it('the recipe is listed last, planned elsewhere, and records no ranges of its own (its slot records do)', () => {
    expect(describeRecipes().at(-1)!.id).toBe(STORY_RECIPE_ID);
    expect(() => planRecipe(doc(), STORY_RECIPE_ID, {})).toThrow(RecipeError);
    expect(recordsRanges(STORY_RECIPE_ID)).toBe(false);
    expect(STORY_RUN_RECIPE_ID).toBe(`template:${STORY_TEMPLATE_ID}`);
  });
  it('no new op: the assistant offers nothing for the story', () => {
    expect(assistantOps().filter((o) => /story|voice_activity/.test(o))).toEqual([]);
    expect(ASSISTANT_EXCLUDED_OPS.filter((o) => /story|voice_activity/.test(o))).toEqual([]);
  });
  it('run record helpers round-trip and never throw on junk', () => {
    const picks = [{ key: 'm000000000001', assetId: 'i1', cutMs: null, how: 'first' as const }, { key: 'm000000000002', assetId: 'i2', cutMs: 1500, how: 'tap' as const }];
    const rec = storyRunRecordParams({ params: { narrationAssetId: 'nar' } as never, picks: picks as never }, [{ key: 'm000000000003', assetId: 'i3', cutMs: 9000, how: 'pause' }]);
    expect(storyRunPicked(rec)).toEqual(picks);
    expect(storyRunRemovedPicks(rec)).toEqual([{ key: 'm000000000003', assetId: 'i3', cutMs: 9000, how: 'pause' }]);
    expect(storyRunParams({ ...rec, templateVersion: 1 })).toEqual({ narrationAssetId: 'nar' });
    expect(storyRunPicked({ picked: [null, 3, { key: 1 }, { key: 'k', assetId: 'a', cutMs: 1.5, how: 'tap' }] })).toEqual([]);
    expect(sameCuts([3, 1, 1], [1, 3])).toBe(true);
    expect(sameCuts([1], [1, 2])).toBe(false);
    expect(voiceOnsets({ flat: true, ranges: [{ start: 1, end: 2 }] })).toEqual([]);
  });
  it('the stubs refuse with not_built and the Hebrew-worded sentence until built (never a made-up value)', () => {
    if (!STORY_PLANNER_BUILT) {
      expect(() => planStory(doc(), {}, ctx)).toThrow(StoryNotBuilt);
      expect(() => storyLiveDocument(doc(), {}, ctx, [])).toThrow(StoryNotBuilt);
      try { planStory(doc(), {}, ctx); } catch (e) { expect((e as StoryError).message).toBe(STORY_REFUSALS.notBuilt.message()); }
    }
    if (!VOICE_ACTIVITY_BUILT) expect(() => voiceActivity(new Int16Array(4), 512)).toThrow(StoryNotBuilt);
  });
  it('the film window rule is exported as it was (a still shows itself)', () => {
    const w = filmSourceWindow(doc().assets.i1!, null, null, 30, R);
    expect(w).toMatchObject({ sourceInFrame: null, kind: 'still' });
  });
  it('the labelled double applies through apply_template as ONE transaction with its run record', () => {
    const d = doc();
    const plan = planStoryDouble(d, { narrationAssetId: 'nar', assetIds: ['i1', 'i2', 'i3', 'i4'], cutsMs: [3000, 3100, 8000] }, ctx);
    expect(plan.basis.join(' ')).toMatch(/test double/);
    expect(plan.chips.map((c) => c.state)).toEqual(['kept', 'held', 'kept']);
    const r = applyTransaction(d, [{ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }], { idSeed: 'st_', actor: 'test', allowInternal: true });
    const run = Object.values(r.doc.recipeRuns)[0]!;
    expect(run.recipeId).toBe(STORY_RUN_RECIPE_ID);
    expect(storyRunPicked(run.params).map((p) => p.how)).toEqual(['first', 'tap', 'tap', 'even']);
    expect(() => planStoryDouble(d, { narrationAssetId: 'i1', assetIds: ['i2'] }, ctx)).toThrow(StoryError);
  });
  it('forbidden words cover synced and perfect in both languages', () => {
    expect(STORY_FORBIDDEN_WORDS.test('perfectly in sync')).toBe(true);
    expect(STORY_FORBIDDEN_WORDS_HE.test('מסונכרן')).toBe(true);
    expect(STORY_FORBIDDEN_WORDS.test('the next picture')).toBe(false);
  });
});
