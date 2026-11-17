/**
 * Recipes (SPEC §23, §24): repeatable multi-step edits planned by plain rules from what the project already contains
 * (clips, analysis data, transcripts). No language model is involved. A plan is an ordinary list of ops, applied as ONE
 * transaction (one undo), and everything it creates stays a normal editable object.
 * Regeneration keeps what was changed by hand since the last run and replaces only what was left untouched.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { CAPTION_PRESETS, type ProjectDocument } from './schema.ts';
import { cutOps, sourceTimesToTimeline, sourceRangesToTimeline, type TimeRange } from './cleanup.ts';
import { FORMAT_PROFILES } from './variants.ts';
import { findClip, type OpCall } from './ops.ts';
import { own } from './own.ts';

export class RecipeError extends Error {
  constructor(public code: 'not_found' | 'needs_analysis' | 'invalid_args' | 'nothing_to_do', message: string, public hint?: string) { super(message); }
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
}
export interface PlanContext {
  /** Timeline ranges that must be left alone (clips of a previous run that were edited by hand). */
  protectedRanges?: TimeRange[];
  /** Silent source ranges per asset, measured by the server (tidy-speech only). */
  silences?: Record<string, TimeRange[]>;
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
const TidySpeech = z.object({
  assetId: z.string().describe('Speech recording to tighten'),
  keepSeconds: z.number().min(0).max(2).default(0.12).describe('Pause left on each side of a cut'),
  loudness: z.number().min(-40).max(-5).nullable().default(-16),
  captions: z.boolean().default(true),
}).strict();

export const RECIPES = [
  { id: 'beat-montage', name: { he: 'מונטאז׳ לפי קצב', en: 'Beat montage' }, description: 'Cut between the chosen pictures on the beats of a music clip.', params: Montage, needs: 'beat analysis of the music asset', regenerable: true },
  { id: 'social-pack', name: { he: 'חבילת רשתות', en: 'Social pack' }, description: 'Add the usual output formats, captions from the transcript, and a loudness target. Skips whatever already exists.', params: SocialPack, needs: 'nothing; captions need a transcript', regenerable: false },
  { id: 'tidy-speech', name: { he: 'הידוק דיבור', en: 'Tidy speech' }, description: 'Remove measured silences from a speech recording on every track, set a loudness target and show its transcript as captions.', params: TidySpeech, needs: 'silence measurement (done by the server when the recipe is planned)', regenerable: false },
] as const;
export const describeRecipes = () => RECIPES.map((r) => ({ id: r.id, name: r.name, description: r.description, needs: r.needs, regenerable: r.regenerable, paramsSchema: z.toJSONSchema(r.params), method: 'rule-based plan from project data; no language model' }));

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
  const analysis = doc.analyses?.[mclip.assetId]?.beats;
  if (!analysis || analysis.beats.length < 2) throw new RecipeError('needs_analysis', 'the music has no beat analysis yet', 'Run analyze_asset kind=beats on the music asset first.');
  for (const id of p.assetIds) { const a = own(doc.assets, id); if (!a || (!a.video && !a.image)) throw new RecipeError('not_found', `asset ${id} is missing or has no picture`); }
  const from = mclip.start, to = T.add(mclip.start, mclip.duration);
  const fi = (t: T.RationalTime) => T.nearestFrameIndex(t, rate);
  const beatFrames = [...new Set(sourceTimesToTimeline(doc, mclip.assetId, analysis.beats).filter((t) => !T.lt(t, from) && T.lt(t, to)).map(fi))].sort((a, b) => a - b);
  // On bars, the cut points are the analysis's bar starts (the first beat of each bar), which sound like the natural places to cut.
  if (p.cutOn === 'bars' && !analysis.downbeats?.length) throw new RecipeError('needs_analysis', 'the beat analysis of this music has no bar starts', 'Cut on beats instead, or mark the bar starts with edit_analysis (downbeats).');
  const barFrames = p.cutOn === 'bars' ? [...new Set(sourceTimesToTimeline(doc, mclip.assetId, analysis.downbeats!).filter((t) => !T.lt(t, from) && T.lt(t, to)).map(fi))].sort((a, b) => a - b) : [];
  const cuts = (p.cutOn === 'bars' ? barFrames : beatFrames).filter((_, i) => i % p.everyBeats === 0);
  if (cuts.length < 2) throw new RecipeError('nothing_to_do', 'fewer than two cut points fall inside the music clip');
  const bounds = [...cuts, fi(to)].filter((x, i, a) => i === 0 || x > a[i - 1]!);
  let order = p.assetIds.slice();
  if (p.order === 'reverse') order.reverse();
  if (p.order === 'shuffle') { const r = mulberry(p.seed); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; } }
  const used = new Map<string, number>();
  const ops: OpCall[] = [];
  let skipped = 0;
  const prot = (ctx.protectedRanges ?? []).map((r) => [fi(r.start), fi(r.end)] as const);
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]!, b = bounds[i + 1]!;
    if (prot.some(([s, e]) => a < e && s < b)) { skipped++; continue; }
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
  if (ops.length === 0) throw new RecipeError('nothing_to_do', 'every segment is already covered by clips you edited');
  const bpm = analysis.bpm ? `${analysis.bpm.toFixed(1)} BPM` : 'unknown tempo';
  return {
    recipeId: 'beat-montage', params: p,
    steps: [`Place ${ops.length} picture clips, one every ${p.everyBeats} ${p.cutOn === 'bars' ? 'bar(s), starting on bar starts' : 'beat(s)'}, order: ${p.order}`, ...(skipped ? [`Leave ${skipped} segment(s) alone because they hold clips edited by hand`] : [])],
    basis: [`${p.cutOn === 'bars' ? `${barFrames.length} bar starts among ` : ''}${beatFrames.length} beats of the music clip (${bpm}, confidence ${analysis.confidence ?? 'n/a'}${analysis.origin.edited ? ', corrected by hand' : ''})`, `method: ${analysis.origin.method}`],
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
  if (!own(doc.assets, p.assetId)?.audio) throw new RecipeError('not_found', `asset ${p.assetId} is missing or has no sound`);
  const silences = own(ctx.silences, p.assetId);
  if (!silences) throw new RecipeError('needs_analysis', 'silence measurement for this asset was not supplied');
  const ranges = sourceRangesToTimeline(doc, p.assetId, silences, T.fromSeconds(p.keepSeconds.toFixed(6)));
  const ops: OpCall[] = cutOps(ranges), steps: string[] = [], basis: string[] = [`${silences.length} silent stretch(es) measured in the recording`];
  const removed = ranges.reduce((n, r) => n + T.toSeconds(T.sub(r.end, r.start)), 0);
  if (ranges.length) steps.push(`Remove ${ranges.length} pause(s), ${removed.toFixed(1)} s in total, from every track (keeping ${p.keepSeconds} s around speech)`);
  const seq = doc.sequences[doc.mainSequenceId]!;
  if (p.captions && own(doc.transcripts, p.assetId) && !seq.tracks.some((t) => t.kind === 'caption')) { ops.push({ op: 'add_caption_track', args: { mode: 'transcript' } }); steps.push('Show the transcript as captions'); }
  if (p.loudness !== null && doc.settings.loudness?.target !== p.loudness) { ops.push({ op: 'set_loudness_target', args: { target: p.loudness } }); steps.push(`Set the loudness target to ${p.loudness} LUFS`); }
  if (ops.length === 0) throw new RecipeError('nothing_to_do', 'no pauses long enough to remove, and captions and loudness are already set');
  return { recipeId: 'tidy-speech', params: p, steps, basis, ops, alternatives: [{ label: 'Tighter (keep 0.05 s)', params: { ...p, keepSeconds: 0.05 } }, { label: 'Looser (keep 0.25 s)', params: { ...p, keepSeconds: 0.25 } }] };
}

/** Build the plan for a recipe from the current document. Pure; throws RecipeError when the recipe cannot apply. */
export function planRecipe(doc: ProjectDocument, recipeId: string, params: unknown, ctx: PlanContext = {}): RecipePlan {
  if (recipeId === 'beat-montage') return planMontage(doc, params, ctx);
  if (recipeId === 'social-pack') return planSocialPack(doc, params);
  if (recipeId === 'tidy-speech') return planTidySpeech(doc, params, ctx);
  throw new RecipeError('not_found', `recipe "${recipeId}" does not exist`, `Available: ${RECIPES.map((r) => r.id).join(', ')}`);
}
