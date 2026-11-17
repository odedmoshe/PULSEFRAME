/**
 * match_colour (ADR-0014): colour match to a reference clip, or automatic colour balance, for picture clips. Read-only: stills are
 * rendered from scratch documents through the export compositor (Exporter.renderStill), measured and fitted (engine
 * colourMatch.ts), verified by a second render, and returned as candidate set_colour_grade ops. Nothing is stored.
 * Wired by the lead: POST /api/v1/projects/:id/analysis/colour-match (job kind 'colour') and the MCP tool match_colour.
 *
 * What is measured (never the proxy, the thumbnails or the Scopes canvas):
 * - each clip alone in a scratch document (engine isolateClip, never committed; the panel's tiles use the same one): the other
 *   picture, title, caption and adjustment tracks are left out (sound tracks stay, so beat-driven effects see the same music), the
 *   clip fills the frame (cover) at its own place in time, with opacity 1, no keyframed transform, no mask, normal blend, no
 *   transition and no follow;
 * - the reference as it is shown (its grade and every other effect on);
 * - a target as its new grade will see it: its grade and the effects after it are off (set_colour_grade puts the grade where the
 *   old one was, or first after a time effect);
 * - frames at 25, 50 and 75 % of each clip (50 % when samples = 1), at a quarter of the frame size, from the original media.
 * The verify render is the target with the proposed op applied (the real op, dry-run), every effect on, at the same frames.
 */
import { spawn } from 'node:child_process';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { applyTransaction, findClip, OpError, type EffectInstance, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { balanceGrade, fitGrade, GRADE_DEFAULTS, mergeSamples, pictureStats, samplePicture, statsDistance, type GradeFit, type GradeParams, type PictureSample, type PictureStats } from '@pulseframe/engine';
import { balanceGoal, colourSpread, isolateClip, verdictOf } from '@pulseframe/engine/colourMatch.ts';
import type { Exporter } from './export.ts';
import { ApiError, type Store } from './store.ts';

export const ColourMatchBody = z.object({
  method: z.enum(['match', 'balance']).default('match'),
  referenceClipId: z.string().optional(),
  targetClipIds: z.union([z.array(z.string()).min(1).max(200), z.literal('all')]),
  amount: z.number().min(0).max(1).default(1),
  samples: z.union([z.literal(1), z.literal(3)]).default(3),
}).strict();
export interface ColourMatchTarget {
  clipId: string; params: GradeParams; residual: { model: number; verified: number | null }; verdict: GradeFit['verdict']; limitedBy: (keyof GradeParams)[];
  warnings: ('changes_within_clip' | 'not_verified' | 'replaces_grade' | 'animated_grade')[];
  statsBefore: PictureStats; statsAfter: PictureStats | null;
}
export interface ColourMatch {
  revision: number; method: 'match' | 'balance'; reference: { clipId: string; stats: PictureStats } | null; targets: ColourMatchTarget[];
  /** set_colour_grade, mode replace; clips with an animated grade are left out */
  ops: OpCall[];
  unavailable: string | null; note: string;
}

/** Stills are rendered at this fraction of the frame size: plenty of points for statistics, a quarter of the cost. */
export const MATCH_STILL_SCALE = 0.25;
/** Two sample frames of one clip further apart than this (statsDistance) mean the clip changes look inside: one grade will not fit all of it. */
export const WITHIN_CLIP_LIMIT = 6;
const GRADE = 'color.grade';
const GRADE_KEYS = Object.keys(GRADE_DEFAULTS) as (keyof GradeParams)[];
/** A still the worker refused because an effect needs a graphics adapter it does not have (render.ts: gpu_effect_unavailable). */
const needsAdapter = (e: unknown) => e instanceof ApiError && /gpu_effect_unavailable|needs a graphics adapter/.test(e.message);

type Picture = { clip: MediaClip; trackId: string; trackIndex: number };
/** The picture clips of the main sequence: media clips on video tracks whose file is a video or an image, by start, then track. */
function pictureClips(doc: ProjectDocument): Picture[] {
  const seq = doc.sequences[doc.mainSequenceId]!;
  const out: Picture[] = [];
  seq.tracks.forEach((t, trackIndex) => {
    if (t.kind !== 'video') return;
    for (const c of t.clips) if (c.type === 'media' && ['video', 'image'].includes(doc.assets[c.assetId]?.kind ?? '')) out.push({ clip: c, trackId: t.id, trackIndex });
  });
  return out.sort((a, b) => T.cmp(a.clip.start, b.clip.start) || a.trackIndex - b.trackIndex);
}
function pictureOf(doc: ProjectDocument, clipId: string, role: 'reference' | 'target'): Picture {
  const f = findClip(doc, clipId);
  if (!f) throw new ApiError(404, 'not_found', `${role} clip ${clipId} not found`, { clipId }, 'Call get_timeline to list current clip ids.');
  const p = pictureClips(doc).find((x) => x.clip.id === clipId);
  if (!p) {
    const kind = f.clip.type === 'media' ? doc.assets[f.clip.assetId]?.kind ?? 'missing file' : f.clip.type;
    throw new ApiError(422, 'incompatible', `colour match measures pictures: the ${role} clip ${clipId} is ${f.seq.id !== doc.mainSequenceId ? 'not in the main sequence' : `a ${kind} clip on a ${f.track.kind} track`}`, { clipId, role, clipType: f.clip.type, trackKind: f.track.kind }, 'Choose video or image clips on a video track (get_timeline).');
  }
  return p;
}
/** Sample frames of a clip (timeline frame indices): 25, 50 and 75 % of its length, or the middle. */
function sampleFrames(doc: ProjectDocument, clip: MediaClip, samples: 1 | 3): number[] {
  const rate = doc.settings.frameRate, first = T.nearestFrameIndex(clip.start, rate), count = Math.max(1, T.frameCount(clip.duration, rate));
  return [...new Set((samples === 1 ? [0.5] : [0.25, 0.5, 0.75]).map((q) => first + Math.min(count - 1, Math.floor(count * q))))];
}
/** The clip's colour grade: the first color.grade, as set_colour_grade and apply_look find it. */
const gradeOf = (clip: MediaClip): EffectInstance | undefined => clip.effects?.find((e) => e.type === GRADE);
const animatedKeys = (fx: EffectInstance | undefined) => Object.keys(fx?.keyframes ?? {}).filter((k) => (GRADE_KEYS as string[]).includes(k));

/** Width and height from a PNG's header, and its pixels as straight RGBA through ffmpeg (the parity-suite decode). */
export function decodePng(png: Buffer): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const sig = png.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a' || png.subarray(12, 16).toString('latin1') !== 'IHDR') return Promise.reject(new ApiError(502, 'render_failed', 'the render worker did not return a PNG'));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'pipe', '-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000, killSignal: 'SIGKILL' });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.stderr.on('data', (b) => { err += b; });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.stdin.on('error', () => { /* reported by close */ });
    p.on('close', (code) => {
      const raw = Buffer.concat(out);
      if (code !== 0 || raw.length !== width * height * 4) return reject(new ApiError(502, 'render_failed', 'a rendered still could not be decoded', { tail: err.slice(-300), bytes: raw.length, expected: width * height * 4 }));
      resolve({ rgba: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), width, height });
    });
    p.stdin.end(png);
  });
}

export async function matchColour(store: Store, exporter: Exporter, projectId: string, body: z.infer<typeof ColourMatchBody>): Promise<ColourMatch> {
  const { doc, revision } = store.getProject(projectId);
  const { method, amount, samples } = body;
  // ---- who is measured ----
  let reference: Picture | null = null;
  if (method === 'match') {
    if (!body.referenceClipId) throw new ApiError(400, 'invalid_request', 'method match needs referenceClipId: the clip whose colours the others should take', {}, 'Pass referenceClipId, or method balance for an automatic colour balance without a reference.');
    reference = pictureOf(doc, body.referenceClipId, 'reference');
  } else if (body.referenceClipId) throw new ApiError(400, 'invalid_request', 'method balance takes no reference clip', { referenceClipId: body.referenceClipId }, 'Leave referenceClipId out, or use method match.');
  const all = body.targetClipIds === 'all';
  const ids = all ? pictureClips(doc).map((p) => p.clip.id).filter((id) => id !== reference?.clip.id) : [...new Set(body.targetClipIds as string[])];
  if (!all && reference && ids.includes(reference.clip.id)) throw new ApiError(422, 'invalid_args', 'the reference clip cannot also be a target', { clipId: reference.clip.id }, 'Leave the reference out of targetClipIds.');
  const pictures = ids.map((id) => pictureOf(doc, id, 'target'));
  // An op the transaction would refuse (a locked track, the 16-effect limit) is refused here for a listed clip, and left out of 'all'.
  const skipped: { clipId: string; reason: string }[] = [];
  const targets = pictures.filter((p) => {
    try { applyTransaction(doc, [setGrade(p.clip.id, GRADE_DEFAULTS, animatedKeys(gradeOf(p.clip)).length > 0)], { idSeed: 'cmcheck_', actor: 'colour-match' }); return true; } catch (e) {
      if (!(e instanceof OpError)) throw e;
      if (!all) throw new ApiError(422, e.code, `clip ${p.clip.id}: ${e.message}`, { ...e.details, clipId: p.clip.id }, e.hint);
      skipped.push({ clipId: p.clip.id, reason: e.message });
      return false;
    }
  });
  if (!targets.length) throw new ApiError(422, 'invalid_args', skipped.length ? `no clip can take a colour grade: ${skipped.map((s) => `${s.clipId} (${s.reason})`).join('; ')}` : 'there is no picture clip to match', { skipped }, 'Add video or image clips on a video track, or unlock their tracks.');

  // ---- measuring ----
  // Every still of a sample is awaited, also when one of them fails (the first failure, in frame order, is the one thrown). With
  // Promise.all the others went on rendering after the request had answered: a still refused for want of a graphics adapter left
  // two behind, and when the server was closed next they started a browser nobody closed.
  const sampleOf = async (d: ProjectDocument, frames: number[]): Promise<PictureSample[]> => {
    const stills = await Promise.allSettled(frames.map(async (frame) => { const png = await exporter.renderStill(d, revision, frame, MATCH_STILL_SCALE); const { rgba, width, height } = await decodePng(png); return samplePicture(rgba, width, height); }));
    return stills.map((x) => { if (x.status === 'rejected') throw x.reason; return x.value; });
  };
  let refStats: PictureStats | null = null, hold = { shadows: 0, highlights: 0, fade: 0 };
  if (reference) {
    try { refStats = pictureStats(mergeSamples(await sampleOf(isolateClip(doc, reference.clip.id, 'shown'), sampleFrames(doc, reference.clip, samples)))); } catch (e) {
      if (needsAdapter(e)) throw new ApiError(503, 'renderer_unavailable', `the reference clip ${reference.clip.id} uses an effect that needs a graphics adapter, and the render worker has none, so it cannot be measured: ${(e as ApiError).message.slice(0, 300)}`, { clipId: reference.clip.id }, 'Choose a reference without GPU effects, or see `pnpm probe:gpu` for the render worker\'s graphics adapter.');
      throw e;
    }
    const g = gradeOf(reference.clip);
    if (g?.enabled) for (const k of ['shadows', 'highlights', 'fade'] as const) hold[k] = typeof g.params[k] === 'number' ? (g.params[k] as number) : 0;
  }
  let unavailable: string | null = null;
  const out: ColourMatchTarget[] = [], ops: OpCall[] = [];
  for (const { clip } of targets) {
    const frames = sampleFrames(doc, clip, samples), grade = gradeOf(clip), animated = animatedKeys(grade).length > 0;
    const parts = await sampleOf(isolateClip(doc, clip.id, 'grade-input'), frames);
    const sample = mergeSamples(parts), statsBefore = pictureStats(sample);
    const fit = refStats ? fitGrade(sample, refStats, { hold, amount }) : balanceGrade(sample, { amount });
    const goal = refStats ?? balanceGoal(statsBefore);
    const warnings: ColourMatchTarget['warnings'] = [];
    const each = parts.map(pictureStats);
    if (each.some((a, i) => each.some((b, j) => j > i && statsDistance(a, b) > WITHIN_CLIP_LIMIT))) warnings.push('changes_within_clip');
    if (grade) warnings.push('replaces_grade');
    if (animated) warnings.push('animated_grade');
    // ---- verifying: the real op, dry-run, rendered at the same frames ----
    let statsAfter: PictureStats | null = null, verified: number | null = null;
    if (!unavailable) {
      try {
        const graded = applyTransaction(doc, [setGrade(clip.id, fit.params, animated)], { idSeed: 'cmverify_', actor: 'colour-match' }).doc;
        statsAfter = pictureStats(mergeSamples(await sampleOf(isolateClip(graded, clip.id, 'shown'), frames)));
        // balance aims at neutral mid-tones and keeps the picture's own colourfulness: its spread counts as reached
        verified = statsDistance(statsAfter, refStats ? goal : { ...goal, meanA: 0, meanB: 0, meanC: colourSpread(statsAfter) });
      } catch (e) {
        if (!needsAdapter(e)) throw e;
        unavailable = `the render worker has no graphics adapter for the colour grade (WebGPU), so the result was not rendered and checked: ${(e as ApiError).message.slice(0, 300)}`;
      }
    }
    if (verified === null) warnings.push('not_verified');
    // the verdict says what was measured: the verify render when there is one (it sees the effects after the grade and the real
    // pass, which the model does not), the model only when nothing was rendered
    out.push({ clipId: clip.id, params: fit.params, residual: { model: fit.residual, verified }, verdict: verdictOf(verified ?? fit.residual), limitedBy: fit.limitedBy, warnings, statsBefore, statsAfter });
    if (!animated) ops.push(setGrade(clip.id, fit.params, false));
  }
  const left = [
    ...out.filter((t) => t.warnings.includes('animated_grade')).map((t) => `${t.clipId} (its grade is animated with keyframes: apply set_colour_grade with dropKeyframes=true yourself if the animation should go)`),
    ...skipped.map((s) => `${s.clipId} (${s.reason})`),
  ];
  const note = [
    'Candidates only. To apply, send `ops` as ONE transaction with expectedRevision set to this revision (or propose it).',
    'Each op replaces the clip\'s colour grade (a look included); every value stays editable with update_effect.',
    method === 'match' ? 'Matched by picture statistics (lightness spread and the mean colour of the mid-tones), not by what the pictures show: a large area of one colour pulls the result toward it.' : 'Balanced toward neutral grey mid-tones and a fuller lightness range: a scene that should look warm, cool or dark is pulled toward neutral (lower `amount` to keep some of it).',
    'The verdict and residual say how close it got (the verdict follows residual.verified when the result was rendered, residual.model only when it was not); nobody has compared the result by eye on real footage yet.',
    ...(left.length ? [`Left out of ops: ${left.join('; ')}.`] : []),
    ...(unavailable ? ['Not verified: see `unavailable`; the residual.model numbers come from the model of the grade only.'] : []),
  ].join(' ');
  return { revision, method, reference: reference && refStats ? { clipId: reference.clip.id, stats: refStats } : null, targets: out, ops, unavailable, note };
}
const setGrade = (clipId: string, params: GradeParams, dropKeyframes: boolean): OpCall => ({ op: 'set_colour_grade', args: { clipId, params: { ...params }, mode: 'replace', ...(dropKeyframes ? { dropKeyframes: true } : {}) } });
