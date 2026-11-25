/**
 * Property run of the story planner (W1, S18 for the planner; the regeneration half of S18 runs in
 * apps/server/src/storyRegeneration.test.ts, where regeneration lives). Random frame rates, pictures, short and long videos, taps
 * and voice measures (labelled synthetic data): every plan applies through the REAL apply_template, the pictures tile the narration
 * from its first frame with no overlap, no cut is closer than flashGapFrames, every tapped picture starts on its tap's own frame
 * (unless the video before it ended early), the plan is deterministic, and a held tap never changes the live picture.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, canonical, clipEnd, findClip, flashGapFrames, STORY_HELD_REASONS, STORY_TEMPLATE_ID, STORY_VERSION, storyRunRecordParams, validateProject,
  type ProjectDocument, type StoryPlanContext, type VoiceMeasure,
} from './index.ts';
import { planStory, storyLiveDocument } from './story.ts';
import { project, song, still, video, type Rate } from './familyFilm.testDouble.ts';

const RATES: Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];

describe('story planner properties (S18)', () => {
  it('random stories plan, apply, tile the narration and keep the flash gap', () => {
    const arb = fc.record({
      rate: fc.constantFrom(...RATES),
      narrationMs: fc.integer({ min: 3000, max: 60_000 }),
      atFrame: fc.integer({ min: 0, max: 50 }),
      items: fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 100, max: 15_000 })), { minLength: 1, maxLength: 14 }),
      taps: fc.array(fc.integer({ min: 0, max: 70_000 }), { maxLength: 20 }),
      voice: fc.option(fc.array(fc.integer({ min: 0, max: 60_000 }), { maxLength: 30 }), { nil: undefined }),
      ownSound: fc.constantFrom('under', 'mute'),
    });
    fc.assert(fc.property(arb, (x) => {
      const doc: ProjectDocument = project(x.rate);
      doc.assets.nar = song('nar', x.narrationMs / 1000);
      const ids = x.items.map((len, i) => { const id = `a${i}`; doc.assets[id] = len === 0 ? still(id) : video(id, len / 1000, { audio: i % 2 === 0 }); return id; });
      const starts = [...new Set(x.voice ?? [])].sort((a, b) => a - b);
      const voice: VoiceMeasure | null = x.voice ? { algo: 1, noiseDb10: -600, voiceDb10: -100, flat: false, ranges: starts.map((ms) => ({ start: ms * 48, end: ms * 48 + 4800 })).filter((r, i, all) => i === 0 || r.start >= all[i - 1]!.end) } : null;
      const ctx: StoryPlanContext = { voice, voiceState: voice ? 'measured' : 'pending', capture: {}, title: null };
      const params = { narrationAssetId: 'nar', assetIds: ids, cutsMs: x.taps, at: T.frameTime(x.atFrame, x.rate), ownSound: x.ownSound };
      const fps = x.rate.num / x.rate.den, gap = flashGapFrames(fps);
      let plan;
      try { plan = planStory(doc, params, ctx); } catch (e) {
        // the only refusal for these inputs: nothing can show (every video shorter than the gap, or a narration too short)
        expect((e as { code?: string }).code).toBe('nothing_to_do');
        return;
      }
      expect(canonical(planStory(doc, params, ctx))).toBe(canonical(plan));
      const S = x.atFrame, E = S + T.frameCount(doc.assets.nar!.duration, x.rate);
      expect([plan.predicted.startFrame, plan.predicted.endFrame]).toEqual([S, E]);
      // pictures: from S, back to back, never past E; each at least the gap long; the last ends at E unless a video ended early
      let at = S;
      for (const [i, k] of plan.picks.entries()) {
        expect(k.startFrame).toBe(at);
        expect(k.frames).toBeGreaterThanOrEqual(gap);
        at = k.startFrame + k.frames;
        const prevEarly = i > 0 && plan.picks[i - 1]!.endedEarly;
        if (k.endedEarly && plan.picks[i + 1]) expect(plan.picks[i + 1]!.startFrame).toBe(at);
        if (k.how === 'tap' && !prevEarly) expect(k.startFrame).toBe(T.nearestFrameIndex(T.add(T.frameTime(S, x.rate), T.rt(k.cutMs!, 1000)), x.rate));
        if (k.how === 'first') expect(i).toBe(0);
      }
      expect(at).toBeLessThanOrEqual(E);
      if (!plan.picks.at(-1)!.endedEarly) expect(at).toBe(E);
      const bounds = [S, ...plan.predicted.cuts];
      for (let i = 1; i < bounds.length; i++) expect(bounds[i]! - bounds[i - 1]!).toBeGreaterThanOrEqual(gap);
      // chips: one per distinct tap, kept ones made the tap picks, held ones say why
      expect(plan.chips.map((c) => c.cutMs)).toEqual([...new Set(x.taps)].sort((a, b) => a - b));
      expect(plan.chips.filter((c) => c.state === 'kept').map((c) => c.cutMs)).toEqual(plan.picks.filter((k) => k.how === 'tap').map((k) => k.cutMs));
      for (const c of plan.chips) if (c.state === 'held') expect(STORY_HELD_REASONS).toContain(c.reason);
      // through the real op: valid, and the clips lie where the plan says
      const out = applyTransaction(doc, [{ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }], { idSeed: 'p_', actor: 'test', allowInternal: true }).doc;
      expect(validateProject(out)).toEqual([]);
      const run = Object.values(out.recipeRuns)[0]!;
      const placed = (run.slots ?? []).filter((s) => s.kind === 'picture').map((s) => { const c = findClip(out, s.clipId)!.clip; return [T.nearestFrameIndex(c.start, x.rate), T.nearestFrameIndex(clipEnd(c), x.rate)]; }).sort((a, b) => a[0]! - b[0]!);
      expect(placed).toEqual(plan.picks.map((k) => [k.startFrame, k.startFrame + k.frames]));
      // the live picture: the held taps change nothing
      const kept = plan.chips.filter((c) => c.state === 'kept').map((c) => c.cutMs);
      expect(canonical(storyLiveDocument(doc, params, ctx, x.taps))).toBe(canonical(storyLiveDocument(doc, params, ctx, kept)));
    }), { numRuns: 150, seed: 7_2026 });
  });
});
