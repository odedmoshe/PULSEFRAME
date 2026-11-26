/**
 * Recipes (SPEC §23, §24): repeatable multi-step edits planned by plain rules from what the project already contains
 * (clips, analysis data, transcripts). No language model is involved. A plan is an ordinary list of ops, applied as ONE
 * transaction (one undo), and everything it creates stays a normal editable object.
 * Regeneration keeps what was changed by hand since the last run and replaces only what was left untouched.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { CAPTION_PRESETS, type Asset, type MediaClip, type ProjectDocument, type Track } from './schema.ts';
import { cutOps, skippedClips, sourceTimesToTimeline, sourceRangesToTimeline, timingCoverage, untimedCopyRefusal, type SkippedClip, type TimeRange } from './cleanup.ts';
import { beatsFor, untimedCopyFinder } from './lineage.ts';
import { FORMAT_PROFILES } from './variants.ts';
import { defineOp, findClip, getOp, OpError, type OpCall } from './ops.ts';
import { flashGapFrames } from './flashSafety.ts';
import { clipEnd } from './validate.ts';
import { FAMILY_FILM_RECIPE_ID, FamilyFilmParamsSchema } from './familyFilmContract.ts';
import { opOnlyEffect } from './livingContract.ts';
import { STORY_RECIPE_ID, StoryParamsSchema } from './storyContract.ts';
import type { LevelEnvelope } from './multicamEnvelope.ts';
import { MULTICAM_AUTO_RECIPE_ID, MulticamAutoParams } from './multicamApi.ts';
import { planMulticamAuto } from './multicamAuto.ts';

export class RecipeError extends Error {
  /** not_built: a recipe whose planner is only a contract in this build (none at present; multicam-auto was until ADR-0020 W2); the server answers 501. */
  /** untimed_copy: a clip shows a copy of the recording made without a recorded time mapping and nothing else plays it on a known clock (cleanup.ts timingCoverage); the server answers 422. */
  constructor(public code: 'not_found' | 'needs_analysis' | 'invalid_args' | 'nothing_to_do' | 'not_built' | 'untimed_copy', message: string, public hint?: string) { super(message); }
}
export interface RecipePlan {
  recipeId: string;
  params: Record<string, unknown>;
  /** Human-readable account of what the plan does, in order. */
  steps: string[];
  /** The data the plan was derived from, so the result is traceable. */
  basis: string[];
  ops: OpCall[];
  /** Other reasonable parameter choices for the same recipe. */
  alternatives: { label: string; params: Record<string, unknown> }[];
  /** Clips the plan left alone because they show a copy that does not keep the recording's timing (tidy-speech; cleanup.ts timingCoverage). */
  skippedClips?: SkippedClip[];
}
export interface PlanContext {
  /** Timeline ranges that must be left alone (clips of a previous run that were edited by hand). */
  protectedRanges?: TimeRange[];
  /**
   * Timeline ranges of a previous run's clips that were deleted by hand (run.ranges whose clip is gone; beat-montage): left empty,
   * so a hand delete survives the regeneration (ADR-0016 decision 6). The server passes none with restoreRemoved.
   */
  removedRanges?: TimeRange[];
  /** Silent source ranges per asset, measured by the server (tidy-speech only). */
  silences?: Record<string, TimeRange[]>;
  /** Level envelopes by asset id, loaded by the server (multicam-auto only; built on demand, never stored in the document). */
  multicamLevels?: Record<string, LevelEnvelope>;
}

const Montage = z.object({
  musicClipId: z.string().describe('Audio clip whose beats set the rhythm (its asset needs beat analysis)'),
  assetIds: z.array(z.string()).min(1).max(40).describe('Picture or video assets to cut between'),
  everyBeats: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(4).describe('Cut every N beats (or every N bars with cutOn=bars)'),
  cutOn: z.enum(['beats', 'bars']).default('beats').describe('beats = count from the first beat inside the clip; bars = cut on the bar starts of the beat analysis (it must have found or been given them)'),
  order: z.enum(['sequence', 'reverse', 'shuffle']).default('sequence'),
  seed: z.number().int().min(0).max(1_000_000).default(1).describe('Shuffle seed (same seed = same order)'),
}).strict();
const SocialPack = z.object({
  profiles: z.array(z.string()).min(1).max(8).default(['vertical-9x16', 'square-1x1', 'portrait-4x5']),
  captions: z.boolean().default(true).describe('Add a transcript caption track when a transcript exists and no caption track does'),
  captionPreset: z.enum(CAPTION_PRESETS).default('classic'),
  loudness: z.number().min(-40).max(-5).nullable().default(-14).describe('Loudness target to set if none is set (null = leave)'),
}).strict();
/** Portrait blur (ADR-0017): a still picture's background blurred behind its subject, from a cut-out made of that picture. */
const PortraitBlur = z.object({
  clipId: z.string().describe('Picture clip (a still) whose background to blur'),
  cutoutAssetId: z.string().optional().describe('Cut-out of the clip\'s picture (transparent background) made by the background-removal tool; default: the newest one'),
  radius: z.number().min(0.002).max(0.2).default(0.02).describe('Blur radius as a fraction of the frame height; it stays editable afterwards (update_effect)'),
}).strict();
const TidySpeech = z.object({
  assetId: z.string().describe('Speech recording to tighten'),
  keepSeconds: z.number().min(0).max(2).default(0.12).describe('Pause left on each side of a cut'),
  loudness: z.number().min(-40).max(-5).nullable().default(-16),
  captions: z.boolean().default(true),
}).strict();

export const RECIPES = [
  { id: 'beat-montage', name: { he: 'מונטאז׳ לפי קצב', en: 'Beat montage' }, description: 'Cut between the chosen pictures on the beats of a music clip.', params: Montage, needs: 'beat analysis of the music asset', regenerable: true, aiInput: null },
  { id: 'social-pack', name: { he: 'חבילת רשתות', en: 'Social pack' }, description: 'Add the usual output formats, captions from the transcript, and a loudness target. Skips whatever already exists.', params: SocialPack, needs: 'nothing; captions need a transcript', regenerable: false, aiInput: null },
  { id: 'tidy-speech', name: { he: 'הידוק דיבור', en: 'Tidy speech' }, description: 'Remove measured silences from a speech recording on every track, set a loudness target and show its transcript as captions.', params: TidySpeech, needs: 'silence measurement (done by the server when the recipe is planned)', regenerable: false, aiInput: null },
  { id: 'portrait-blur', name: { he: 'טשטוש רקע לתמונה', en: 'Portrait blur' }, description: 'Blur the background of a still picture behind its subject: the clip shows the cut-out of the subject, and a blurred copy of the picture goes on a new picture track directly below it, with the same timing, position and keyframes. The blur radius stays editable.', params: PortraitBlur, needs: 'a cut-out of the picture, made by the background-removal tool (AI tools)', regenerable: false,
    aiInput: 'the cut-out: made earlier by the background-removal tool (BiRefNet, an AI model), which is run on its own (run_capability) and whose result is validated before it enters the project' },
  // the family film (ADR-0026): planned by planFamilyFilm and applied through apply_template (familyFilmContract.ts), so a
  // run of it is recorded as 'template:tpl.family-film'
  { id: FAMILY_FILM_RECIPE_ID, name: { he: 'סרט משפחתי בלחיצה', en: 'Family film in one click' }, description: 'An editable first cut of an event: the measured moment of each clip, in capture order, cut on the beats and bars of the music, with an opening title and a closing card. Every clip states its measured reason. Heuristic; no model; faces are not used.', params: FamilyFilmParamsSchema, needs: 'measured moments of the videos (measure_moments); beats of the music when music is chosen', regenerable: true, aiInput: null },
  // auto-switch of a multicam program (ADR-0020): planned on the CURRENT document and regenerated in place (isInPlaceRecipe);
  // it has its own sheet in the multicam panel, not a form in the recipes panel
  { id: MULTICAM_AUTO_RECIPE_ID, name: { he: 'החלפת זוויות אוטומטית', en: 'Auto-switch angles' }, description: 'Heuristic: cut a multicam program to the angle of the clearly loudest mic, and to the wide angle when both or nobody speak. Not speaker identification.', params: MulticamAutoParams, needs: 'a synced multicam group with speakers mapped to mics, and level envelopes (built on demand)', regenerable: true, aiInput: null, inPlace: true },
  // «ספרו מה היה» (wave 7 story track, storyContract.ts): planned by planStory and applied through apply_template, so a run of it is
  // recorded as 'template:tpl.story'; its own dialog, not a form in the recipes panel
  { id: STORY_RECIPE_ID, name: { he: 'ספרו מה היה', en: 'Tell what happened' }, description: 'A film built on a recorded narration: each picture starts where you tapped while listening (or at measured pauses of the voice when there is no tap), with the narration, an opening title and music lowered under the voice. One undoable step; hand edits survive rebuilding. Heuristic level measurement; no model, no speech recognition.', params: StoryParamsSchema, needs: 'a sound file as narration (record it in the editor or bring a voice memo); taps from the editor\'s tap-along, or none', regenerable: true, aiInput: null },
] as const;
/**
 * Recipes whose runs record where each clip was placed (run.ranges, apply_recipe recordRanges), so that a clip deleted by hand
 * stays deleted on regeneration: the regenerable recipes that remove and re-plan their clips (beat-montage). Not the in-place
 * multicam auto-switch (switch_angles never fills a gap) and not the family film (its slot records say it).
 */
export const recordsRanges = (id: string): boolean => { const r = RECIPES.find((x) => x.id === id) as { regenerable: boolean; inPlace?: boolean } | undefined; return !!r && r.regenerable && !r.inPlace && id !== FAMILY_FILM_RECIPE_ID && id !== STORY_RECIPE_ID; };
/**
 * A recipe regenerated IN PLACE (ADR-0020): regenerateRecipe removes nothing, plans on the current document with the
 * protected ranges, and passes keepIds = the clips edited by hand (apps/server/src/recipes.ts, W2).
 */
export const isInPlaceRecipe = (id: string): boolean => !!(RECIPES.find((r) => r.id === id) as { inPlace?: boolean } | undefined)?.inPlace;
/**
 * method: how the plan is made. No recipe runs a model when it is planned or applied; aiInput names the project data a recipe
 * rests on that an AI model made earlier (null: none), so "no language model" is never read as "nothing here came from AI".
 */
export const describeRecipes = () => RECIPES.map((r) => ({
  id: r.id, name: r.name, description: r.description, needs: r.needs, regenerable: r.regenerable, paramsSchema: z.toJSONSchema(r.params),
  method: `rule-based plan from project data; no language model${r.aiInput ? '; no AI model runs when it is planned or applied, but it uses a result an AI model made earlier (aiInput)' : ''}`,
  aiInput: r.aiInput as string | null,
}));

const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const parse = <S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> => {
  const r = schema.safeParse(raw ?? {});
  if (!r.success) throw new RecipeError('invalid_args', z.prettifyError(r.error));
  return r.data;
};

function planMontage(doc: ProjectDocument, raw: unknown, ctx: PlanContext): RecipePlan {
  const p = parse(Montage, raw);
  const rate = doc.settings.frameRate;
  const music = findClip(doc, p.musicClipId);
  if (!music || music.clip.type !== 'media' || music.track.kind !== 'audio') throw new RecipeError('not_found', `music clip ${p.musicClipId} must be a clip on an audio track`);
  const mclip = music.clip;
  // the beats of the clip's own file, else of the nearest time-preserving source of it that was measured (lineage.ts beatsFor: a
  // cleaned-up copy of the music keeps its beats), moved exactly onto the clip's file's own clock
  const measured = beatsFor(doc, mclip.assetId);
  if (!measured) {
    // a copy made without a recorded time mapping (reversed, stretched) of measured music: where its beats are is unknown, and said so
    const untimed = untimedCopyFinder(doc, Object.keys(doc.analyses ?? {}).filter((id) => (doc.analyses[id]!.beats?.beats.length ?? 0) >= 2))(mclip.assetId);
    if (untimed) throw new RecipeError('untimed_copy', `music clip ${mclip.id} plays a copy of the measured music that does not keep its timing, so where the beats are in it is unknown`, 'Measure the beats of this copy itself (analyze_asset kind=beats), or give the clip the measured music or a copy that keeps its timing (replace_clip_media), and try again.');
  }
  const analysis = measured?.beats;
  if (!measured || !analysis || analysis.beats.length < 2) throw new RecipeError('needs_analysis', 'the music has no beat analysis yet', 'Run analyze_asset kind=beats on the music asset first.');
  const onOwnClock = (times: T.RationalTime[]) => (T.isZero(measured.offset) ? times : times.map((t) => T.sub(t, measured.offset)));
  for (const id of p.assetIds) { const a = doc.assets[id]; if (!a || (!a.video && !a.image)) throw new RecipeError('not_found', `asset ${id} is missing or has no picture`); }
  const from = mclip.start, to = T.add(mclip.start, mclip.duration);
  const fi = (t: T.RationalTime) => T.nearestFrameIndex(t, rate);
  const beatFrames = [...new Set(sourceTimesToTimeline(doc, mclip.assetId, onOwnClock(analysis.beats)).filter((t) => !T.lt(t, from) && T.lt(t, to)).map(fi))].sort((a, b) => a - b);
  // On bars, the cut points are the analysis's bar starts (the first beat of each bar), which sound like the natural places to cut.
  if (p.cutOn === 'bars' && !analysis.downbeats?.length) throw new RecipeError('needs_analysis', 'the beat analysis of this music has no bar starts', 'Cut on beats instead, or mark the bar starts with edit_analysis (downbeats).');
  const barFrames = p.cutOn === 'bars' ? [...new Set(sourceTimesToTimeline(doc, mclip.assetId, onOwnClock(analysis.downbeats!)).filter((t) => !T.lt(t, from) && T.lt(t, to)).map(fi))].sort((a, b) => a - b) : [];
  const wantedCuts = (p.cutOn === 'bars' ? barFrames : beatFrames).filter((_, i) => i % p.everyBeats === 0);
  // SAFETY (ADR-0009): cuts between pictures of different brightness flash. A cut that would come less than a third of a
  // second after the last one is left out, so the montage never cuts more than three times a second, however fast the music.
  const gap = flashGapFrames(rate.num / rate.den);
  const cuts: number[] = [];
  for (const c of wantedCuts) if (!cuts.length || c - cuts[cuts.length - 1]! >= gap) cuts.push(c);
  const thinnedOut = wantedCuts.length - cuts.length;
  if (cuts.length < 2) throw new RecipeError('nothing_to_do', 'fewer than two cut points fall inside the music clip');
  const bounds = [...cuts, fi(to)].filter((x, i, a) => i === 0 || x > a[i - 1]!);
  let order = p.assetIds.slice();
  if (p.order === 'reverse') order.reverse();
  if (p.order === 'shuffle') { const r = mulberry(p.seed); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; } }
  const used = new Map<string, number>();
  const ops: OpCall[] = [];
  let skipped = 0;
  const prot = (ctx.protectedRanges ?? []).map((r) => [fi(r.start), fi(r.end)] as const);
  const gone = (ctx.removedRanges ?? []).map((r) => [fi(r.start), fi(r.end)] as const);
  let leftEmpty = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]!, b = bounds[i + 1]!;
    if (prot.some(([s, e]) => a < e && s < b)) { skipped++; continue; }
    if (gone.some(([s, e]) => a < e && s < b)) { leftEmpty++; continue; }
    const assetId = order[i % order.length]!;
    const asset = doc.assets[assetId]!;
    let len = b - a, sourceIn = 0;
    if (asset.kind !== 'image') {
      const total = T.frameIndexAt(asset.duration, rate);
      len = Math.min(len, total);
      const n = used.get(assetId) ?? 0;
      // each reuse of a video starts further in, so the same moment is not repeated until the source is exhausted
      sourceIn = total - len > 0 ? (n * len) % (total - len + 1) : 0;
      used.set(assetId, n + 1);
    }
    if (len <= 0) continue;
    ops.push({ op: 'add_clip', args: { assetId, start: T.frameTime(a, rate), sourceIn: T.frameTime(sourceIn, rate), duration: T.frameTime(len, rate), withLinkedAudio: false } });
  }
  if (ops.length === 0 && leftEmpty) throw new RecipeError('nothing_to_do', 'every segment is covered by clips you edited or lies where you deleted clips by hand', 'Regenerate with restoreRemoved: true to fill the places of the deleted clips again.');
  if (ops.length === 0) throw new RecipeError('nothing_to_do', 'every segment is already covered by clips you edited');
  const bpm = analysis.bpm ? `${analysis.bpm.toFixed(1)} BPM` : 'unknown tempo';
  return {
    recipeId: 'beat-montage', params: p,
    steps: [`Place ${ops.length} picture clips, one every ${p.everyBeats} ${p.cutOn === 'bars' ? 'bar(s), starting on bar starts' : 'beat(s)'}, order: ${p.order}`, ...(thinnedOut ? [`Leave out ${thinnedOut} cut(s) that would come less than a third of a second after the one before, so the montage cuts at most three times a second (faster cutting between bright and dark pictures is a seizure risk for some viewers)`] : []), ...(skipped ? [`Leave ${skipped} segment(s) alone because they hold clips edited by hand`] : []), ...(leftEmpty ? [`Leave ${leftEmpty} segment(s) empty because their clips were deleted by hand (regenerate with restoreRemoved to fill them again)`] : [])],
    basis: [`${p.cutOn === 'bars' ? `${barFrames.length} bar starts among ` : ''}${beatFrames.length} beats of the music clip (${bpm}, confidence ${analysis.confidence ?? 'n/a'}${analysis.origin.edited ? ', corrected by hand' : ''})`, `method: ${analysis.origin.method}`, ...(measured.assetId !== mclip.assetId ? [`measured on "${(doc.assets[measured.assetId]?.name ?? measured.assetId).slice(0, 60)}", which the clip's file is a copy of that keeps its timing; its beats are moved exactly onto the copy's own clock`] : [])],
    ops,
    alternatives: [
      ...([1, 2, 4, 8] as const).filter((n) => n !== p.everyBeats).map((n) => ({ label: `Cut every ${n} ${p.cutOn === 'bars' ? 'bar(s)' : 'beat(s)'}`, params: { ...p, everyBeats: n } })),
      ...(analysis.downbeats?.length ? [p.cutOn === 'bars' ? { label: 'Cut on beats', params: { ...p, cutOn: 'beats' as const } } : { label: 'Cut on bar starts', params: { ...p, cutOn: 'bars' as const, everyBeats: 1 as const } }] : []),
      ...(['sequence', 'reverse', 'shuffle'] as const).filter((o) => o !== p.order).map((o) => ({ label: `Order: ${o}`, params: { ...p, order: o } })),
    ],
  };
}

function planSocialPack(doc: ProjectDocument, raw: unknown): RecipePlan {
  const p = parse(SocialPack, raw);
  const ops: OpCall[] = [], steps: string[] = [], basis: string[] = [];
  const have = new Set(Object.values(doc.variants ?? {}).map((v) => v.profileId));
  for (const id of p.profiles) {
    const prof = FORMAT_PROFILES.find((x) => x.id === id);
    if (!prof) throw new RecipeError('not_found', `format profile "${id}" does not exist`, `Available: ${FORMAT_PROFILES.map((x) => x.id).join(', ')}`);
    if (have.has(id)) continue;
    ops.push({ op: 'add_variant', args: { profileId: id } });
    steps.push(`Add format ${prof.name.en} (${prof.width}×${prof.height})`);
  }
  const seq = doc.sequences[doc.mainSequenceId]!;
  const transcripts = Object.keys(doc.transcripts ?? {});
  if (p.captions && transcripts.length > 0 && !seq.tracks.some((t) => t.kind === 'caption')) {
    ops.push({ op: 'add_caption_track', args: { mode: 'transcript', style: { preset: p.captionPreset } } });
    steps.push(`Show the transcript as captions (${p.captionPreset})`);
    basis.push(`${transcripts.length} asset(s) with a transcript`);
  } else if (p.captions && transcripts.length === 0) basis.push('no transcript exists, so no captions were added');
  if (p.loudness !== null && !doc.settings.loudness) { ops.push({ op: 'set_loudness_target', args: { target: p.loudness } }); steps.push(`Set the loudness target to ${p.loudness} LUFS`); }
  if (ops.length === 0) throw new RecipeError('nothing_to_do', 'the project already has these formats, captions and a loudness target');
  return { recipeId: 'social-pack', params: p, steps, basis, ops, alternatives: [{ label: 'Formats only', params: { ...p, captions: false, loudness: null } }, { label: 'Karaoke captions', params: { ...p, captionPreset: 'karaoke' } }] };
}

function planTidySpeech(doc: ProjectDocument, raw: unknown, ctx: PlanContext): RecipePlan {
  const p = parse(TidySpeech, raw);
  if (!doc.assets[p.assetId]?.audio) throw new RecipeError('not_found', `asset ${p.assetId} is missing or has no sound`);
  const silences = ctx.silences?.[p.assetId];
  if (!silences) throw new RecipeError('needs_analysis', 'silence measurement for this asset was not supplied');
  // clips of copies without a recorded time mapping are skipped and named; with nothing else playing the recording, refused
  const cov = timingCoverage(doc, p.assetId);
  if (cov.mapped === 0 && cov.untimed.length) { const r = untimedCopyRefusal(cov.untimed); throw new RecipeError(r.code, r.message, r.hint); }
  const skipped = skippedClips(cov.untimed);
  const ranges = sourceRangesToTimeline(doc, p.assetId, silences, T.fromSeconds(p.keepSeconds.toFixed(6)));
  const ops: OpCall[] = cutOps(ranges), steps: string[] = [], basis: string[] = [`${silences.length} silent stretch(es) measured in the recording`];
  for (const c of skipped) basis.push(`clip ${c.clipId} was not searched for pauses: it shows a copy that does not keep the recording's timing`);
  const removed = ranges.reduce((n, r) => n + T.toSeconds(T.sub(r.end, r.start)), 0);
  if (ranges.length) steps.push(`Remove ${ranges.length} pause(s), ${removed.toFixed(1)} s in total, from every track (keeping ${p.keepSeconds} s around speech)`);
  const seq = doc.sequences[doc.mainSequenceId]!;
  if (p.captions && doc.transcripts?.[p.assetId] && !seq.tracks.some((t) => t.kind === 'caption')) { ops.push({ op: 'add_caption_track', args: { mode: 'transcript' } }); steps.push('Show the transcript as captions'); }
  if (p.loudness !== null && doc.settings.loudness?.target !== p.loudness) { ops.push({ op: 'set_loudness_target', args: { target: p.loudness } }); steps.push(`Set the loudness target to ${p.loudness} LUFS`); }
  if (ops.length === 0) throw new RecipeError('nothing_to_do', 'no pauses long enough to remove, and captions and loudness are already set');
  return { recipeId: 'tidy-speech', params: p, steps, basis, ops, alternatives: [{ label: 'Tighter (keep 0.05 s)', params: { ...p, keepSeconds: 0.05 } }, { label: 'Looser (keep 0.25 s)', params: { ...p, keepSeconds: 0.25 } }], ...(skipped.length ? { skippedClips: skipped } : {}) };
}

// ---------- portrait blur (ADR-0017): one public op, because a recipe plan cannot name the clips it creates ----------
/**
 * Tool outputs that are a cut-out of a picture's subject (transparent background). A cut-out is recognised by the derived
 * provenance a validated provider result carries: which reviewed capability made it, which of its outputs it is, from which file.
 */
export const CUTOUT_SOURCES: readonly { capabilityId: string; outputName: string }[] = [{ capabilityId: 'comfy.image.remove-background', outputName: 'cutout' }];
/** True when `a` is a still cut-out made from the asset `fromAssetId` by one of CUTOUT_SOURCES. */
export function isCutoutOf(a: Asset | undefined, fromAssetId: string): boolean {
  const der = a?.provenance.derived;
  return !!a && a.kind === 'image' && !!a.image && !!der && der.sourceAssetIds[0] === fromAssetId
    && CUTOUT_SOURCES.some((c) => c.capabilityId === der.capabilityId && c.outputName === der.outputName);
}
/** The cut-outs made from a picture, newest first (by import time, then id). */
export function cutoutsOf(doc: ProjectDocument, fromAssetId: string): Asset[] {
  return Object.values(doc.assets).filter((a) => isCutoutOf(a, fromAssetId))
    .sort((x, y) => (x.provenance.importedAt < y.provenance.importedAt ? 1 : x.provenance.importedAt > y.provenance.importedAt ? -1 : x.id < y.id ? 1 : -1));
}
const PORTRAIT_DEFAULT_RADIUS = 0.02;
defineOp({
  name: 'portrait_blur',
  version: 1,
  checksOwnIds: ['cutoutAssetId'],
  description: 'Blur the background of a still picture clip behind its subject, in one step: the clip shows the cut-out of its picture (sharp subject, clear background; made by the background-removal tool from this picture), and a copy of the clip showing the original picture, with a blur.gaussian effect added, goes on a new picture track directly below it. The copy keeps the clip\'s start, length, position, size, rotation, opacity, keyframes, effects, mask and per-format changes, and its track is hidden when the clip\'s track is. The blur radius stays editable (update_effect on the copy). Refused for moving pictures, on a locked track, and while a transition joins the clip to its neighbours.',
  args: z.object({
    clipId: z.string(),
    cutoutAssetId: z.string().describe('The cut-out asset (an image made from the clip\'s picture by the background-removal tool)'),
    radius: z.number().min(0.002).max(0.2).optional().describe(`Blur radius as a fraction of the frame height (default ${PORTRAIT_DEFAULT_RADIUS})`),
  }).strict(),
  apply(d, a, ctx) {
    const f = findClip(d, a.clipId);
    if (!f) throw new OpError('not_found', `clip ${a.clipId} not found`, { clipId: a.clipId }, 'Call get_timeline for clip ids.');
    if (f.clip.type !== 'media' || f.track.kind !== 'video' || d.assets[f.clip.assetId]?.kind !== 'image') throw new OpError('incompatible', 'portrait blur works on a still picture clip', { clipId: f.clip.id }, 'A moving picture needs a cut-out of every frame, which this build does not make.');
    if (f.track.locked) throw new OpError('track_locked', `track ${f.track.id} is locked`, { trackId: f.track.id, clipId: f.clip.id });
    const photo = d.assets[f.clip.assetId]!;
    if (!Object.hasOwn(d.assets, a.cutoutAssetId)) throw new OpError('not_found', `the cut-out ${a.cutoutAssetId} is not in the project`, { assetId: a.cutoutAssetId }, 'get_summary lists the assets; run the background-removal tool on the picture to make a cut-out.');
    const cutout = d.assets[a.cutoutAssetId]!;
    if (!isCutoutOf(cutout, photo.id)) throw new OpError('incompatible', 'the cut-out was not made from the picture this clip shows', { clipId: f.clip.id, assetId: cutout.id, pictureAssetId: photo.id }, 'Run the background-removal tool on this clip\'s picture and use its cut-out.');
    const clip = f.clip as MediaClip;
    // A transition draws this clip past its own ends; the blurred copy below would not follow it.
    if (clip.transition) throw new OpError('incompatible', 'remove the transition at this clip first', { clipId: clip.id }, 'set_transition with type none, then blur the background.');
    const end = clipEnd(clip);
    const into = f.track.clips.find((c) => c.type === 'media' && c.id !== clip.id && c.transition && T.eq(c.start, end));
    if (into) throw new OpError('incompatible', 'remove the transition into the next clip first', { clipId: clip.id, nextClipId: into.id }, 'set_transition with type none on the next clip, then blur the background.');
    // 1. the copy that shows the original picture, on a new picture track directly below the clip's track
    const copy = structuredClone(clip);
    copy.id = ctx.newId('clp');
    copy.linkGroupId = null;
    // «תמונה חיה» (wave 8, verifier C11): the blurred backdrop stays still; the living picture and its depth stay on the clip only
    delete copy.depth;
    if (copy.effects) { copy.effects = copy.effects.filter((e) => !opOnlyEffect(e.type)); if (!copy.effects.length) delete copy.effects; }
    const count = f.seq.tracks.filter((t) => t.kind === 'video').length + 1;
    // The copy is part of the clip's picture: it is shown exactly when the clip's own track is (a clip on a hidden track stays unseen).
    const below: Track = { id: ctx.newId('trk'), kind: 'video', name: `V${count}`, locked: false, muted: false, hidden: f.track.hidden, clips: [copy] };
    f.seq.tracks.splice(f.seq.tracks.indexOf(f.track), 0, below);
    for (const v of Object.values(d.variants)) if (Object.hasOwn(v.overrides, clip.id)) v.overrides[copy.id] = structuredClone(v.overrides[clip.id]!);
    // 2. the blur on the copy, and 3. the clip shows the cut-out: both through the ordinary public ops, with their own checks
    const run = (op: string, args: unknown) => { const def = getOp(op)!; return def.apply(d, def.args.parse(args), ctx); };
    const fx = run('add_effect', { clipId: copy.id, type: 'blur.gaussian', params: { radius: a.radius ?? PORTRAIT_DEFAULT_RADIUS } });
    const swap = run('replace_clip_asset', { clipId: clip.id, assetId: cutout.id });
    return {
      affectedIds: [below.id, copy.id, clip.id],
      summary: `Portrait blur: "${photo.name.slice(0, 60)}" over a blurred copy`,
      output: { cutoutClipId: clip.id, backgroundClipId: copy.id, createdClipIds: [copy.id], trackId: below.id, effectId: fx.output!.effectId, previousAssetId: swap.output!.previousAssetId },
    };
  },
});

function planPortraitBlur(doc: ProjectDocument, raw: unknown): RecipePlan {
  const p = parse(PortraitBlur, raw);
  const f = findClip(doc, p.clipId);
  if (!f) throw new RecipeError('not_found', `clip ${p.clipId} not found`);
  const photo = f.clip.type === 'media' ? doc.assets[f.clip.assetId] : undefined;
  if (!photo || photo.kind !== 'image' || f.track.kind !== 'video') throw new RecipeError('invalid_args', 'portrait blur works on a still picture clip', 'Select a picture clip (a still image) on a picture track.');
  const choices = cutoutsOf(doc, photo.id);
  let cutout: Asset | undefined;
  if (p.cutoutAssetId !== undefined) {
    cutout = Object.hasOwn(doc.assets, p.cutoutAssetId) ? doc.assets[p.cutoutAssetId] : undefined;
    if (!cutout) throw new RecipeError('not_found', `asset ${p.cutoutAssetId} not found`);
    if (!isCutoutOf(cutout, photo.id)) throw new RecipeError('invalid_args', 'the chosen file is not a cut-out made from this picture', 'Pick a cut-out the background-removal tool made from this picture.');
  } else cutout = choices[0];
  if (!cutout) throw new RecipeError('needs_analysis', `the picture "${photo.name.slice(0, 60)}" has no cut-out yet`, 'Run the background-removal tool (AI tools, picture tab) on this picture first; its cut-out is what stays sharp.');
  const der = cutout.provenance.derived!;
  const pct = (r: number) => `${(r * 100).toFixed(1)}% of the frame height`;
  return {
    recipeId: 'portrait-blur', params: { ...p, cutoutAssetId: cutout.id },
    steps: [
      `Show the cut-out "${cutout.name.slice(0, 60)}" in the clip, in place of the picture: the subject stays sharp`,
      `Put a copy of the clip with the picture "${photo.name.slice(0, 60)}" on a new picture track directly below, with the same start, length, position, size and keyframes, blurred by ${pct(p.radius)}`,
    ],
    basis: [
      `cut-out made by ${der.capabilityId} ${der.capabilityVersion} (job ${der.jobId}) from "${photo.name.slice(0, 60)}"${choices.length > 1 ? `; ${choices.length} cut-outs of this picture exist, the ${p.cutoutAssetId ? 'chosen' : 'newest'} one is used` : ''}`,
      'the blur radius stays editable afterwards (the blur effect of the copy)',
    ],
    ops: [{ op: 'portrait_blur', args: { clipId: f.clip.id, cutoutAssetId: cutout.id, radius: p.radius } }],
    alternatives: [0.01, 0.04].filter((r) => r !== p.radius).map((r) => ({ label: r < p.radius ? 'Softer blur' : 'Stronger blur', params: { ...p, cutoutAssetId: cutout.id, radius: r } })),
  };
}

/** Build the plan for a recipe from the current document. Pure; throws RecipeError when the recipe cannot apply. */
export function planRecipe(doc: ProjectDocument, recipeId: string, params: unknown, ctx: PlanContext = {}): RecipePlan {
  if (recipeId === 'beat-montage') return planMontage(doc, params, ctx);
  if (recipeId === 'social-pack') return planSocialPack(doc, params);
  if (recipeId === 'tidy-speech') return planTidySpeech(doc, params, ctx);
  if (recipeId === 'portrait-blur') return planPortraitBlur(doc, params);
  if (recipeId === MULTICAM_AUTO_RECIPE_ID) return planMulticamAuto(doc, params, ctx);
  if (recipeId === FAMILY_FILM_RECIPE_ID) throw new RecipeError('invalid_args', 'family-film is planned by planFamilyFilm; the server applies it through apply_template', 'Use the recipe routes (POST /api/v1/projects/{id}/recipes/family-film/plan or /apply) or the MCP recipe tools, which the server answers with the film planner.');
  if (recipeId === STORY_RECIPE_ID) throw new RecipeError('invalid_args', 'story is planned by planStory; the server applies it through apply_template', 'Use the recipe routes (POST /api/v1/projects/{id}/recipes/story/plan or /apply) or the MCP recipe tools, which the server answers with the story planner.');
  throw new RecipeError('not_found', `recipe "${recipeId}" does not exist`, `Available: ${RECIPES.map((r) => r.id).join(', ')}`);
}
