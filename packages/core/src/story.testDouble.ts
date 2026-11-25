/**
 * TEST DOUBLE of the story planner (labelled; never used outside tests, the UI's unit tests and the UI builder's work before W1
 * lands). It is NOT the planner: stills and videos are placed at the taps on a new picture track, the narration whole on a new
 * sound track; pictures without a tap share the last segment EVENLY (no voice measurement, no pause cuts); no regeneration, no
 * music, no title, no source windows, no own sound. Held taps: only too_close (flash gap) and no_picture_left. Its plan says so in
 * `basis` ("test double"), so a screen or a proof can never mistake it for the real one.
 */
import * as T from '@pulseframe/time';
import { flashGapFrames } from './flashSafety.ts';
import { sha256Hex } from './sha256.ts';
import type { ProjectDocument } from './schema.ts';
import { STORY_DRAFT_LABEL, STORY_METHOD, STORY_RECIPE_ID, STORY_TEMPLATE_ID, STORY_VERSION, StoryParamsSchema, storyRefusal, type StoryChip, type StoryPick, type StoryPlan, type StoryPlanContext, type StoryPlanView } from './storyContract.ts';

const key = (assetId: string) => `m${sha256Hex(`${assetId}:0`).slice(0, 12)}`;

/** The double's plan: same shape as planStory's. Throws StoryError like the planner for a missing or non-sound narration. */
export function planStoryDouble(doc: ProjectDocument, raw: unknown, _ctx: StoryPlanContext): StoryPlan {
  const parsed = StoryParamsSchema.safeParse(raw ?? {});
  if (!parsed.success) throw storyRefusal('badParams', parsed.error.issues[0]?.message ?? 'invalid');
  const p = parsed.data;
  const n = Object.hasOwn(doc.assets, p.narrationAssetId) ? doc.assets[p.narrationAssetId] : undefined;
  if (!n) throw storyRefusal('narrationMissing');
  if (n.kind !== 'audio') throw storyRefusal('narrationNotSound');
  const rate = doc.settings.frameRate, fps = rate.num / rate.den;
  const end = T.nearestFrameIndex(n.duration, rate);
  const gap = flashGapFrames(fps);
  const ids = p.assetIds.filter((id) => Object.hasOwn(doc.assets, id) && doc.assets[id]!.kind !== 'audio');
  if (!ids.length) throw storyRefusal('nothingToShow');
  const taps = [...new Set(p.cutsMs ?? [])].sort((a, b) => a - b);
  const chips: StoryChip[] = [];
  const cuts: { frame: number; ms: number | null; how: 'first' | 'tap' | 'even' }[] = [{ frame: 0, ms: null, how: 'first' }];
  for (const [index, ms] of taps.entries()) {
    const frame = T.nearestFrameIndex(T.rt(ms, 1000), rate);
    if (cuts.length >= ids.length) { chips.push({ index, cutMs: ms, state: 'held', reason: 'no_picture_left' }); continue; }
    if (frame - cuts.at(-1)!.frame < gap || end - frame < gap) { chips.push({ index, cutMs: ms, state: 'held', reason: 'too_close' }); continue; }
    cuts.push({ frame, ms, how: 'tap' });
    chips.push({ index, cutMs: ms, state: 'kept', frame });
  }
  const last = cuts.at(-1)!.frame, left = ids.length - cuts.length;
  for (let i = 1; i <= left; i++) cuts.push({ frame: last + Math.round((i * (end - last)) / (left + 1)), ms: null, how: 'even' });
  const picks: StoryPick[] = ids.map((assetId, i) => {
    const startFrame = cuts[i]!.frame, frames = (cuts[i + 1]?.frame ?? end) - startFrame;
    return { key: key(assetId), assetId, cutMs: cuts[i]!.ms, how: cuts[i]!.how, order: i, startFrame, frames, sourceInFrame: null, sourceFrames: null, kind: 'still', windowIndex: null, reasons: [], ownSound: false };
  });
  const ft = (f: number) => T.frameTime(f, rate);
  const ops: StoryPlan['ops'] = [
    { op: 'add_track', args: { kind: 'video' }, bind: 'pictures-track' },
    { op: 'add_track', args: { kind: 'audio' }, bind: 'voice-track' },
    { op: 'add_clip', args: { assetId: n.id, trackId: { $ref: 'voice-track', out: 'trackId' }, start: ft(0), withLinkedAudio: false }, bind: 'narration' },
    ...picks.map((k) => ({ op: 'add_clip', args: { assetId: k.assetId, trackId: { $ref: 'pictures-track', out: 'trackId' }, start: ft(k.startFrame), duration: ft(k.frames), withLinkedAudio: false }, bind: k.key })),
  ];
  const slots: StoryPlan['slots'] = [{ key: 'narration', kind: 'sound', clipId: { $ref: 'narration' } }, ...picks.map((k) => ({ key: k.key, kind: 'picture' as const, clipId: { $ref: k.key } }))];
  return {
    recipeId: STORY_RECIPE_ID, templateId: STORY_TEMPLATE_ID, version: STORY_VERSION,
    params: { narrationAssetId: n.id, assetIds: ids, cutsMs: taps, musicAssetId: null, ownSound: 'mute', openingTitle: false, lang: p.lang ?? 'he', motion: 'none', at: ft(0), picks: { exclude: [], window: {} }, event: p.event },
    steps: [`Test double: ${picks.length} picture(s) at the taps`], basis: ['test double: not the story planner (no measurement, no regeneration)'],
    warnings: left ? [{ code: 'auto_cuts', message: `${left} picture(s) had no tap and share the end evenly (test double)`, details: { even: left, pause: 0 } }] : [], blocking: [], alternatives: [],
    picks, excluded: [], chips, ops, slots,
    predicted: { startFrame: 0, endFrame: end, cuts: cuts.slice(1).map((c) => c.frame), tapCuts: cuts.filter((c) => c.how === 'tap').length, pauseCuts: 0, evenCuts: left, gapFrames: 0, seconds: T.toSeconds(n.duration) },
    narration: { seconds: T.toSeconds(n.duration), onsetsMs: [], measured: false },
    method: STORY_METHOD,
  };
}
/** A plan view from the double (what the server would send), for UI tests. */
export function planViewDouble(doc: ProjectDocument, raw: unknown, revision = 1): StoryPlanView {
  const ctx: StoryPlanContext = { voice: null, voiceState: 'pending', capture: {}, title: null };
  const { ops, slots: _s, ...rest } = planStoryDouble(doc, raw, ctx);
  return { ...rest, revision, operations: ops.length, label: STORY_DRAFT_LABEL, note: 'test double', context: ctx };
}
