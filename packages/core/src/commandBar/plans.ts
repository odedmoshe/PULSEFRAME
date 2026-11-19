/**
 * Planners of the command bar (ADR-0027, plan §4.4–4.5): from what a family read to ordinary public ops, injected with the
 * shown sequence (ctx.inject) and dry-run on ctx.rawDoc with BAR_PREVIEW_OPTIONS. An OpError gives `refused` with the op's
 * own code and message; the preview is never shown for ops that would be refused. Steps and notes are structured (the web
 * words them). Pure: no clock, no random source, no DOM, no i18n.
 */
import * as T from '@pulseframe/time';
import {
  BAR_PREVIEW_OPTIONS, barPlanHash, COMMAND_BAR_LABEL, MAX_BAR_OPS, TRANSITIONS_ALL_DEFAULT,
  type BarAction, type BarActionResult, type BarChoice, type BarContext, type BarMissing, type BarNote, type BarPlan, type BarReading, type BarRefusalCode, type BarResult,
  type BarToken, type BarWorkspace, type ExportDestinationId, type IntentId, type PlanStep,
} from '../commandBarContract.ts';
import { defaultTitleDuration, DEFAULT_TITLE_SECONDS, deleteOps, editEnd, emptyTrackIds, rippleDeleteOn, trackRole } from '../editHelpers.ts';
import { applyTransaction, OpError, previousAdjacent, type OpCall } from '../ops.ts';
import type { MediaClip, Track } from '../schema.ts';
import { speedValue } from '../speed.ts';
import { clipEnd } from '../validate.ts';
import { VERBS } from './lexicon.ts';
import type { FamilyParse, Hit, SpeedSpec, TimeSpec } from './match.ts';
import { ex, exNeg, exText } from './numbers.ts';
import { clipName, clipOption, clipsAt, findIn, isMedia, isPicture, isVideoClip, resolveClips, resolveMusic, resolveSplit, resolveTitle, soundClipOf, tracksOf, type Found, type Option, type Resolved } from './resolve.ts';
import { toBarTime, wholeFrames } from './time.ts';
import type { BarExact } from '../commandBarContract.ts';

/** Everything a planner needs. */
export interface PlanEnv { ctx: BarContext; tokens: BarToken[]; readings: BarReading[]; values: ReadonlyMap<string, unknown>; heads: readonly Hit[] }

// ---------- results ----------
const base = (env: PlanEnv) => ({ tokens: env.tokens, readings: env.readings });
export const refused = (env: PlanEnv, intent: IntentId, code: BarRefusalCode, extra: { opError?: { code: string; message: string; index: number }; choices?: BarChoice[] } = {}): BarResult =>
  ({ kind: 'refused', intent, ...base(env), code, ...(extra.opError ? { opError: extra.opError } : {}), ...(extra.choices?.length ? { choices: extra.choices } : {}) });
export const incomplete = (env: PlanEnv, intent: IntentId, missing: BarMissing[], he: string, en: string): BarResult => ({ kind: 'incomplete', intent, ...base(env), missing, example: { he, en } });
const act = (env: PlanEnv, intent: IntentId, action: BarAction, notes: BarNote[] = []): BarActionResult => ({ kind: 'action', intent, ...base(env), action, notes });

const rateOf = (env: PlanEnv) => env.ctx.doc.settings.frameRate;
const at = (env: PlanEnv, frame: number) => T.frameTime(frame, rateOf(env));
const masterNote = (ctx: BarContext): BarNote[] => (ctx.viewVariantId ? [{ code: 'applies_to_master', data: { variantId: ctx.viewVariantId } }] : []);

/**
 * The ops, injected, limited to MAX_BAR_OPS and dry-run on rawDoc. Refused with the op's own code and message when the dry
 * run throws; otherwise the plan with its hash over the injected ops and the basis revision.
 */
export function finishPlan(env: PlanEnv, intent: IntentId, calls: OpCall[], steps: PlanStep[], notes: BarNote[]): BarResult {
  if (!calls.length) return refused(env, intent, 'nothing_to_do');
  if (calls.length > MAX_BAR_OPS) return refused(env, intent, 'too_many_ops');
  const ops = calls.map((c) => env.ctx.inject(c));
  try { applyTransaction(env.ctx.rawDoc, ops, { ...BAR_PREVIEW_OPTIONS }); }
  catch (e) {
    if (!(e instanceof OpError)) throw e;
    return refused(env, intent, 'op_refused', { opError: { code: e.code, message: e.message, index: typeof e.details.index === 'number' ? e.details.index : 0 } });
  }
  const plan: BarPlan = { kind: 'plan', intent, ...base(env), ops, steps, notes: [...notes, ...masterNote(env.ctx)], label: COMMAND_BAR_LABEL(intent), basisRevision: env.ctx.revision, planHash: barPlanHash(intent, ops, env.ctx.revision) };
  return plan;
}

/** Each option of a resolution planned on its own; the viable ones become choices. */
function choicesOf<Tgt>(options: Option<Tgt>[], planFor: (items: Tgt[]) => BarResult): BarChoice[] {
  const out: BarChoice[] = [];
  for (const o of options) {
    const r = planFor(o.items);
    if (r.kind === 'plan' || r.kind === 'action') out.push({ he: o.he, en: o.en, result: r });
  }
  return out;
}
/** A resolution turned into a result: ok → the plan; refused → the refusal with the offered choices; ambiguous → choices. */
function withTargets<Tgt>(env: PlanEnv, intent: IntentId, r: Resolved<Tgt>, planFor: (items: Tgt[], notes: BarNote[]) => BarResult): BarResult {
  if (r.kind === 'ok') return planFor(r.items, r.notes);
  const choices = choicesOf(r.options, (items) => planFor(items, r.notes));
  if (r.kind === 'refused') return refused(env, intent, r.code, { choices });
  if (!choices.length) return refused(env, intent, 'nothing_to_do');
  return { kind: 'ambiguous', intent, ...base(env), choices, question: r.question };
}

// ---------- time on the timeline ----------
interface Placed { frame: number; rounded: boolean; seconds: BarExact | null }
type PlacedOr = Placed | { refused: BarRefusalCode };
function timeOf(env: PlanEnv, spec: TimeSpec): PlacedOr {
  const rate = rateOf(env), ph = env.ctx.playheadFrame;
  if (spec.kind === 'refused') return { refused: spec.code };
  if (spec.kind === 'here') return { frame: ph, rounded: false, seconds: null };
  if (spec.kind === 'start') return { frame: 0, rounded: false, seconds: null };
  if (spec.kind === 'end') return { frame: T.nearestFrameIndex(editEnd(env.ctx.doc), rate), rounded: false, seconds: null };
  if (spec.kind === 'abs') {
    const t = toBarTime(spec.amount, rate, spec.saidSeconds, spec.saidFrames);
    return t ? { frame: t.frame, rounded: t.rounded, seconds: t.seconds } : { refused: 'out_of_range' };
  }
  // relative to the playhead: the seconds are added to the playhead's exact time BEFORE the one rounding, the frames after
  const now = T.frameTime(ph, rate);
  const secs = spec.sign > 0 ? spec.amount.secs : exNeg(spec.amount.secs);
  const tExact = T.add(now, T.rt(secs.num, Number(secs.den)));
  const whole = wholeFrames(spec.amount, rate);
  if (whole === null) return { refused: 'out_of_range' };
  const frame = T.nearestFrameIndex(tExact, rate) + whole * spec.sign;
  if (frame < 0) return { refused: 'out_of_range' };
  return { frame, rounded: !T.isFrameAligned(tExact, rate), seconds: null };
}
function durationOf(env: PlanEnv, spec: TimeSpec): PlacedOr {
  if (spec.kind !== 'abs') return spec.kind === 'refused' ? { refused: spec.code } : { refused: 'out_of_range' };
  const r = timeOf(env, spec);
  if ('refused' in r) return r;
  if (r.frame <= 0) return { refused: 'out_of_range' };
  return r;
}
const roundedNote = (env: PlanEnv, p: Placed, field: string): BarNote[] => (p.rounded ? [{ code: 'rounded_to_frame', data: { field, frame: p.frame, time: at(env, p.frame), ...(p.seconds ? { seconds: exText(p.seconds) } : {}) } }] : []);
const atStep = (env: PlanEnv, op: string, p: Placed): PlanStep => ({ op, detail: { kind: 'at', frame: p.frame, time: at(env, p.frame), rounded: p.rounded } });
const clipStep = (env: PlanEnv, op: string, f: Found): PlanStep => ({ op, detail: { kind: 'clip', clipId: f.clip.id, name: clipName(env.ctx.doc, f.clip) } });
const trackStep = (op: string, t: Track): PlanStep => ({ op, detail: { kind: 'track', trackId: t.id, name: t.name } });

/** A value said in the request (the chosen reading set). */
const v = <X>(env: PlanEnv, key: string) => env.values.get(key) as X | undefined;
const headValue = (env: PlanEnv): string | null => (env.heads.find((h) => h.value !== null)?.value as string | undefined) ?? null;
const clipWord = (env: PlanEnv): 'one' | 'many' | 'title' | null => (v<string>(env, 'clip') as 'one' | 'many' | 'title' | undefined) ?? null;

// ---------- the planners, one per family ----------
type Planner = (env: PlanEnv) => BarResult;

const CUT_VERBS: ReadonlySet<string> = new Set(VERBS.cut);
const split: Planner = (env) => {
  const pos = v<TimeSpec>(env, 'pos');
  if (!pos) return incomplete(env, 'split_here', ['time'], 'חתוך כאן', 'split here');
  const intent: IntentId = pos.kind === 'here' ? 'split_here' : 'split_at';
  const p = timeOf(env, pos);
  if ('refused' in p) return refused(env, intent, p.refused);
  // «חתוך כאן» is split by its declared primary reading; the trim readings are named beside it (lead decision 1)
  const saidCut = env.heads.some((h) => env.tokens.slice(h.start, h.end).some((t) => CUT_VERBS.has(t.norm)));
  const alt: BarNote[] = intent === 'split_here' && saidCut ? [{ code: 'alternative_reading', data: { intents: ['trim_start_here', 'trim_end_here'] } }] : [];
  // «פצל את הכותרת כאן»: the title, and only when the frame is strictly inside it — never another clip under the playhead
  const targets = clipWord(env) === 'title' ? titleAt(env, p.frame) : resolveSplit(env.ctx, p.frame);
  return withTargets(env, intent, targets, (items, notes) =>
    finishPlan(env, intent, items.map((f) => ({ op: 'split_clip', args: { clipId: f.clip.id, at: at(env, p.frame) } })), items.map(() => atStep(env, 'split_clip', p)), [...notes, ...roundedNote(env, p, 'at'), ...alt]));
};

/** «הכותרת» at a frame: the resolved title when the frame is strictly inside it, else no_clip_here. */
function titleAt(env: PlanEnv, frame: number): Resolved<Found> {
  const r = resolveTitle(env.ctx);
  if (r.kind !== 'ok') return r;
  const t = at(env, frame), f = r.items[0]!;
  return T.lt(f.clip.start, t) && T.lt(t, clipEnd(f.clip)) ? r : { kind: 'refused', code: 'no_clip_here', options: [], notes: r.notes };
}

const trim: Planner = (env) => {
  const edge = v<'start' | 'end'>(env, 'edge');
  const intent: IntentId = edge === 'end' ? 'trim_end_here' : 'trim_start_here';
  if (!edge) return incomplete(env, intent, ['target'], 'חתוך את ההתחלה עד כאן', 'trim the start to here');
  const pos = v<TimeSpec>(env, 'pos');
  if (!pos) return incomplete(env, intent, ['time'], edge === 'end' ? 'קצץ את הסוף מכאן' : 'חתוך את ההתחלה עד כאן', edge === 'end' ? 'trim the end from here' : 'trim the start to here');
  const p = timeOf(env, pos) as Placed;
  return withTargets(env, intent, resolveClips(env.ctx, clipWord(env), () => true, { allowMany: true, atFrame: p.frame }), (items, notes) =>
    finishPlan(env, intent, items.map((f) => ({ op: 'trim_clip', args: { clipId: f.clip.id, edge, to: at(env, p.frame) } })), items.map(() => atStep(env, 'trim_clip', p)), notes));
};

const del: Planner = (env) => {
  const intent: IntentId = v(env, 'keepGap') ? 'delete_keep_gap' : 'delete_clip';
  const r = resolveClips(env.ctx, clipWord(env), () => true, { allowMany: true, atFrame: env.ctx.playheadFrame, selectionAsMany: true });
  return withTargets(env, intent, r, (items, notes) => {
    const doc = env.ctx.doc;
    // exactly what the Delete key builds (editHelpers.deleteOps; Shift+Delete keeps the gap)
    const plan = deleteOps(doc, items.map((f) => f.clip.id), intent === 'delete_clip' && rippleDeleteOn(doc));
    if (!plan) return refused(env, intent, 'nothing_selected');
    const steps = plan.ops.map((op): PlanStep => {
      if (op.op === 'ripple_delete_clips') { const ids = (op.args as { clipIds: string[] }).clipIds; return { op: op.op, detail: { kind: 'count', n: ids.length, of: ids.length } }; }
      const f = findIn(doc, (op.args as { clipId: string }).clipId);
      return f ? clipStep(env, op.op, f) : { op: op.op, detail: { kind: 'plain' } };
    });
    return finishPlan(env, intent, plan.ops, steps, [...notes, ...(plan.moved ? [{ code: 'ripple_moves' as const, data: { moved: plan.moved } }] : [])]);
  });
};

const addTitle: Planner = (env) => {
  const text = v<{ text: string; unclosed: boolean }>(env, 'text');
  if (!text || text.unclosed || !text.text.trim()) return incomplete(env, 'add_title', ['text'], 'הוסף כותרת "מזל טוב" כאן', 'add title "Happy birthday" here');
  const rate = rateOf(env);
  const notes: BarNote[] = [];
  const posSpec = v<TimeSpec>(env, 'pos');
  const p = posSpec ? timeOf(env, posSpec) : { frame: env.ctx.playheadFrame, rounded: false, seconds: null };
  if ('refused' in p) return refused(env, 'add_title', p.refused);
  if (!posSpec) notes.push({ code: 'default_used', data: { field: 'start', value: 'playhead', frame: p.frame } });
  notes.push(...roundedNote(env, p, 'start'));
  const durSpec = v<TimeSpec>(env, 'dur');
  let durFrames: number;
  if (durSpec) {
    const d = durationOf(env, durSpec);
    if ('refused' in d) return refused(env, 'add_title', d.refused);
    durFrames = d.frame; notes.push(...roundedNote(env, d, 'duration'));
  } else {
    // the editor's own default length, one constant (lead decision 4)
    durFrames = T.frameIndexAt(defaultTitleDuration(rate), rate);
    notes.push({ code: 'default_used', data: { field: 'duration', seconds: DEFAULT_TITLE_SECONDS, frames: durFrames } });
  }
  const style = v<string>(env, 'style');
  const args: Record<string, unknown> = { text: text.text, start: at(env, p.frame), duration: at(env, durFrames), ...(style ? { presetId: style } : {}) };
  return finishPlan(env, 'add_title', [{ op: 'add_text', args }], [{ op: 'add_text', detail: { kind: 'text', chars: [...text.text].length, startFrame: p.frame, durationFrames: durFrames } }], notes);
};

/** g · 10^(dB/20), rounded to 1e-6 (plan §4.4 row 7). */
export const gainAfter = (from: number, db: BarExact): number => Math.round(from * Math.pow(10, Number(db.num) / Number(db.den) / 20) * 1e6) / 1e6;
const dbText = (db: BarExact) => (db.num >= 0n ? `+${exText(db)}` : exText(db));
const gain: Planner = (env) => {
  const hv = headValue(env);
  const dir = hv === 'turn' ? v<string>(env, 'dir') ?? null : hv;
  const amount = v<BarExact>(env, 'db');
  const target = v<string>(env, 'target');
  if (!dir) return incomplete(env, 'gain_change', ['mode'], 'הגבר את המוזיקה ב־3 דציבל', 'turn the music up 3 dB');
  if (!amount) return incomplete(env, 'gain_change', ['amount'], 'הגבר את המוזיקה ב־3 דציבל', 'turn the music up 3 dB');
  if (!target) return incomplete(env, 'gain_change', ['target'], 'הגבר את המוזיקה ב־3 דציבל', 'turn the music up 3 dB');
  const db = dir === 'down' ? exNeg(amount) : amount;
  const onTrack = (t: Track, notes: BarNote[]): BarResult => {
    const from = t.audio?.gain ?? 1, to = gainAfter(from, db);
    if (to > 4) return refused(env, 'gain_change', 'gain_ceiling');
    if (to === from) return refused(env, 'gain_change', 'nothing_to_do');
    return finishPlan(env, 'gain_change', [{ op: 'set_track_audio', args: { trackId: t.id, gain: to } }], [{ op: 'set_track_audio', detail: { kind: 'gain', fromLinear: from, toLinear: to, db: dbText(db) } }], notes);
  };
  const onClip = (f: Found, notes: BarNote[]): BarResult => {
    const s = soundClipOf(env.ctx.doc, f) ?? f;
    if (s.track.locked) return refused(env, 'gain_change', 'locked'); // a picture's sound on a locked track: never a target
    if (s.clip.type !== 'media') return refused(env, 'gain_change', 'nothing_to_do');
    const from = s.clip.gain, to = gainAfter(from, db);
    if (to > 8) return refused(env, 'gain_change', 'gain_ceiling');
    if (to === from) return refused(env, 'gain_change', 'nothing_to_do');
    return finishPlan(env, 'gain_change', [{ op: 'set_clip_gain', args: { clipId: s.clip.id, gain: to } }], [{ op: 'set_clip_gain', detail: { kind: 'gain', fromLinear: from, toLinear: to, db: dbText(db) } }], notes);
  };
  if (target === 'music') return withTargets(env, 'gain_change', resolveMusic(env.ctx), (items, notes) => onTrack(items[0]!, notes));
  const clipRes = () => resolveClips(env.ctx, 'one', isMedia, { allowMany: false, atFrame: env.ctx.playheadFrame });
  if (target === 'clip') return withTargets(env, 'gain_change', clipRes(), (items, notes) => onClip(items[0]!, notes));
  // «הקול / הסאונד» alone: always asked — every unlocked audio track (the music first) or the chosen clip (plan §4.4 target
  // words). Lead decision: the master is NOT offered. No registered op changes a master gain in dB (set_loudness_target is an
  // export LUFS target), and inventing one would be a fabricated plan; the question says so, so the owner knows why.
  const choices: BarChoice[] = [];
  const m = resolveMusic(env.ctx);
  const musicId = m.kind === 'ok' ? m.items[0]!.id : null;
  if (m.kind === 'ok') { const r = onTrack(m.items[0]!, m.notes); if (r.kind === 'plan') choices.push({ he: 'רצועת המוזיקה', en: 'The music track', result: r }); }
  for (const t of tracksOf(env.ctx.doc)) {
    if (t.kind !== 'audio' || t.locked || t.id === musicId) continue;
    const r = onTrack(t, []);
    if (r.kind === 'plan') choices.push({ he: `רצועה «${t.name}»`, en: `Track “${t.name}”`, result: r });
  }
  const c = clipRes();
  if (c.kind === 'ok') { const r = onClip(c.items[0]!, c.notes); if (r.kind === 'plan') choices.push({ he: 'הקליפ הנבחר', en: 'The selected clip', result: r }); }
  return { kind: 'ambiguous', intent: 'gain_change', ...base(env), choices, question: { he: 'איזה קול — של רצועה או של הקליפ? (עוצמה כללית לכל הסרט אין אפשרות לשנות מכאן)', en: 'Which sound — a track or the clip? (The overall volume of the whole film cannot be changed from here.)' } };
};

const muteFamily = (intent: 'mute' | 'unmute'): Planner => (env) => {
  const target = v<string>(env, 'target');
  const example = intent === 'mute' ? ['השתק את המוזיקה', 'mute the music'] : ['בטל השתקה למוזיקה', 'unmute the music'];
  if (!target) return incomplete(env, intent, ['target'], example[0]!, example[1]!);
  const muted = intent === 'mute';
  const onTrack = (t: Track, notes: BarNote[]) => (t.muted === muted ? refused(env, intent, 'nothing_to_do') : finishPlan(env, intent, [{ op: 'set_track_audio', args: { trackId: t.id, muted } }], [trackStep('set_track_audio', t)], notes));
  if (target === 'music') return withTargets(env, intent, resolveMusic(env.ctx), (items, notes) => onTrack(items[0]!, notes));
  const audio = tracksOf(env.ctx.doc).filter((t) => t.kind === 'audio' && !t.locked);
  return withTargets(env, intent, { kind: 'ambiguous', options: audio.map((t) => ({ items: [t], he: `רצועה «${t.name}»`, en: `Track “${t.name}”` })), question: { he: 'איזה קול?', en: 'Which sound?' }, notes: [] }, (items, notes) => onTrack(items[0]!, notes));
};

const transitionFrames = (env: PlanEnv) => T.nearestFrameIndex(T.rt(TRANSITIONS_ALL_DEFAULT.seconds.num, Number(TRANSITIONS_ALL_DEFAULT.seconds.den)), rateOf(env));
const transitions: Planner = (env) => {
  const doc = env.ctx.doc;
  const named = v<string | null>(env, 'name');
  const type = named ?? TRANSITIONS_ALL_DEFAULT.type;
  const frames = transitionFrames(env);
  const defaults: BarNote[] = [...(named ? [] : [{ code: 'default_used' as const, data: { field: 'type', value: type } }]), { code: 'default_used', data: { field: 'frames', frames, seconds: exText(ex(TRANSITIONS_ALL_DEFAULT.seconds.num, TRANSITIONS_ALL_DEFAULT.seconds.den)) } }];
  const step = (f: Found): PlanStep => ({ op: 'set_transition', detail: { kind: 'transition', type, frames, clipId: f.clip.id, name: clipName(doc, f.clip) } });
  if (v(env, 'scope') === 'all') {
    // every unlocked picture clip with a clip ending where it starts and no transition yet; each call dry-run alone (lead decision 5)
    const calls: OpCall[] = [], steps: PlanStep[] = [];
    const noHandle: unknown[] = [], has: unknown[] = [], locked: unknown[] = [];
    for (const track of tracksOf(doc)) {
      if (track.kind !== 'video') continue;
      for (const clip of track.clips) {
        if (clip.type !== 'media' || !previousAdjacent(track, clip)) continue;
        const who = { clipId: clip.id, name: clipName(doc, clip) };
        if (track.locked) { locked.push(who); continue; }
        if (clip.transition) { has.push(who); continue; }
        const call: OpCall = { op: 'set_transition', args: { clipId: clip.id, type, frames } };
        try { applyTransaction(env.ctx.rawDoc, [env.ctx.inject(call)], { ...BAR_PREVIEW_OPTIONS }); }
        catch (e) { if (!(e instanceof OpError)) throw e; noHandle.push({ ...who, code: e.code, message: e.message }); continue; }
        calls.push(call); steps.push(step({ clip, track }));
      }
    }
    const notes: BarNote[] = [...defaults];
    if (noHandle.length) notes.push({ code: 'skipped_no_handle', data: { clips: noHandle } });
    if (has.length) notes.push({ code: 'skipped_has_transition', data: { clips: has } });
    if (locked.length) notes.push({ code: 'skipped_locked', data: { clips: locked } });
    return finishPlan(env, 'transitions_all', calls, steps, notes);
  }
  // «מעבר רך» alone names a transition; on the selected clip it needs a verb («הוסף מעבר כאן»)
  if (!env.heads.some((h) => h.role === 'verb' && h.value !== 'noun')) return incomplete(env, 'transition_here', ['target'], 'הוסף מעבר כאן', 'add a transition here');
  const pic = (f: Found) => f.track.kind === 'video' && f.clip.type === 'media';
  return withTargets(env, 'transition_here', resolveClips(env.ctx, clipWord(env), pic, { allowMany: true, atFrame: env.ctx.playheadFrame }), (items, notes) =>
    finishPlan(env, 'transition_here', items.map((f) => ({ op: 'set_transition', args: { clipId: f.clip.id, type, frames } })), items.map(step), [...notes, ...defaults]));
};

const marker: Planner = (env) => {
  const text = v<{ text: string; unclosed: boolean }>(env, 'text');
  if (text?.unclosed) return incomplete(env, 'add_marker', ['text'], 'סמן כאן "עוגה"', 'add a marker "cake"');
  const posSpec = v<TimeSpec>(env, 'pos');
  const p = posSpec ? timeOf(env, posSpec) : { frame: env.ctx.playheadFrame, rounded: false, seconds: null };
  if ('refused' in p) return refused(env, 'add_marker', p.refused);
  const notes: BarNote[] = [...(posSpec ? [] : [{ code: 'default_used' as const, data: { field: 'time', value: 'playhead', frame: p.frame } }]), ...roundedNote(env, p, 'time')];
  return finishPlan(env, 'add_marker', [{ op: 'add_marker', args: { time: at(env, p.frame), ...(text?.text ? { label: text.text.slice(0, 200) } : {}) } }], [atStep(env, 'add_marker', p)], notes);
};

const closeGaps: Planner = (env) => finishPlan(env, 'close_gaps', [{ op: 'close_gaps', args: {} }], [{ op: 'close_gaps', detail: { kind: 'plain' } }], []);

const freeze: Planner = (env) => {
  const durSpec = v<TimeSpec>(env, 'dur');
  if (!durSpec) return incomplete(env, 'freeze', ['duration'], 'הקפא את הפריים לשנייה וחצי', 'freeze frame for 2 seconds');
  const d = durationOf(env, durSpec);
  if ('refused' in d) return refused(env, 'freeze', d.refused);
  const posSpec = v<TimeSpec>(env, 'pos');
  const p = posSpec ? timeOf(env, posSpec) : { frame: env.ctx.playheadFrame, rounded: false, seconds: null };
  if ('refused' in p) return refused(env, 'freeze', p.refused);
  const video = isVideoClip(env.ctx.doc);
  // the selected video clip when the frame is inside it, else the one video clip under the frame
  const t = at(env, p.frame);
  const sel = env.ctx.selection.map((id) => findIn(env.ctx.doc, id)).filter((f): f is Found => !!f && video(f) && !f.track.locked && T.lte(f.clip.start, t) && T.lt(t, clipEnd(f.clip)));
  const under = sel.length ? { open: sel, locked: [] } : clipsAt(env.ctx.doc, p.frame, video, false);
  const r: Resolved<Found> = under.open.length === 1 ? { kind: 'ok', items: under.open, notes: [] }
    : !under.open.length ? { kind: 'refused', code: under.locked.length ? 'locked' : 'no_clip_here', options: [], notes: [] }
    : { kind: 'ambiguous', options: under.open.map((f) => clipOption(env.ctx.doc, f)), question: { he: 'איזה קליפ להקפיא?', en: 'Which clip to freeze?' }, notes: [] };
  return withTargets(env, 'freeze', r, (items, notes) => finishPlan(env, 'freeze', [{ op: 'freeze_frame', args: { clipId: items[0]!.clip.id, at: t, duration: at(env, d.frame) } }],
    [{ op: 'freeze_frame', detail: { kind: 'span', fromFrame: p.frame, toFrame: p.frame + d.frame } }], [...notes, ...(posSpec ? [] : [{ code: 'default_used' as const, data: { field: 'at', value: 'playhead', frame: p.frame } }]), ...roundedNote(env, p, 'at'), ...roundedNote(env, d, 'duration')]));
};

const exNum = (a: BarExact) => Number(a.num) / Number(a.den);
const speed: Planner = (env) => {
  const s = v<SpeedSpec>(env, 'speed');
  if (!s) return incomplete(env, 'speed', ['amount'], 'מהירות כפולה', 'speed 2');
  const mode = headValue(env) ?? 'set';
  const r = resolveClips(env.ctx, clipWord(env), (f) => f.clip.type === 'media' && env.ctx.doc.assets[f.clip.assetId]?.kind !== 'image', { allowMany: true, atFrame: env.ctx.playheadFrame });
  return withTargets(env, 'speed', r, (items, notes) => {
    const calls: OpCall[] = [], steps: PlanStep[] = [];
    for (const f of items) {
      const from = speedValue(f.clip);
      let to: number;
      if (s.kind === 'half') to = mode === 'set' ? 0.5 : from / 2;
      else if (s.kind === 'abs') to = exNum(s.v);
      else if (s.k.num <= 0n) return refused(env, 'speed', 'out_of_range');
      else to = mode === 'slower' ? from / exNum(s.k) : mode === 'faster' ? from * exNum(s.k) : exNum(s.k);
      to = Math.round(to * 1e6) / 1e6;
      if (!(to >= 0.1 && to <= 8)) return refused(env, 'speed', 'out_of_range');
      if (to === from) continue;
      calls.push({ op: 'set_clip_speed', args: { clipId: f.clip.id, speed: to } });
      steps.push({ op: 'set_clip_speed', detail: { kind: 'speed', from, to } });
    }
    return finishPlan(env, 'speed', calls, steps, notes);
  });
};

const fades: Planner = (env) => {
  const hv = headValue(env);
  const edge = (hv === 'in' || hv === 'out' ? hv : v<'in' | 'out'>(env, 'edge')) ?? null;
  if (!edge) return incomplete(env, 'fades', ['mode'], 'עמעום בהתחלה של חצי שנייה', 'fade out 1 second');
  const durSpec = v<TimeSpec>(env, 'dur');
  if (!durSpec) return incomplete(env, 'fades', ['duration'], 'עמעום בהתחלה של חצי שנייה', 'fade out 1 second');
  const d = durationOf(env, durSpec);
  if ('refused' in d) return refused(env, 'fades', d.refused);
  const len = at(env, d.frame);
  const onClip = (f: Found, notes: BarNote[]): BarResult => {
    const s = soundClipOf(env.ctx.doc, f) ?? f;
    if (s.track.locked) return refused(env, 'fades', 'locked'); // a picture's sound on a locked track: never a target
    const startF = T.frameIndexAt(s.clip.start, rateOf(env)), endF = T.frameIndexAt(clipEnd(s.clip), rateOf(env));
    return finishPlan(env, 'fades', [{ op: 'set_clip_fades', args: { clipId: s.clip.id, ...(edge === 'in' ? { fadeIn: len } : { fadeOut: len }) } }],
      [{ op: 'set_clip_fades', detail: { kind: 'span', fromFrame: edge === 'in' ? startF : endF - d.frame, toFrame: edge === 'in' ? startF + d.frame : endF } }], [...notes, ...roundedNote(env, d, 'duration')]);
  };
  if (v(env, 'target') === 'music') {
    return withTargets(env, 'fades', resolveMusic(env.ctx), (items, notes) => {
      const t = items[0]!;
      const clips = t.clips.map((clip) => ({ clip, track: t }));
      if (clips.length === 1) return onClip(clips[0]!, notes);
      return withTargets(env, 'fades', { kind: 'ambiguous', options: clips.map((f) => clipOption(env.ctx.doc, f)), question: { he: 'איזה קטע מוזיקה?', en: 'Which music clip?' }, notes }, (it, n) => onClip(it[0]!, n));
    });
  }
  return withTargets(env, 'fades', resolveClips(env.ctx, clipWord(env), (f) => !!soundClipOf(env.ctx.doc, f), { allowMany: false, atFrame: env.ctx.playheadFrame }), (items, notes) => onClip(items[0]!, notes));
};

const fitMusicPlan = (env: PlanEnv, intent: IntentId): BarResult => withTargets(env, intent, resolveMusic(env.ctx), (items, notes) => {
  const t = items[0]!;
  const clips: Found[] = t.clips.map((clip) => ({ clip, track: t }));
  const plan = (f: Found, n: BarNote[]) => finishPlan(env, 'fit_music', [{ op: 'fit_music', args: { clipId: f.clip.id } }], [clipStep(env, 'fit_music', f)], n);
  if (clips.length === 1) return plan(clips[0]!, notes);
  return withTargets(env, 'fit_music', { kind: 'ambiguous', options: clips.map((f) => clipOption(env.ctx.doc, f)), question: { he: 'איזה קטע מוזיקה?', en: 'Which music clip?' }, notes }, (it, n) => plan(it[0]!, n));
});

const catalogPlanner = (intent: 'effect' | 'look', op: 'add_effect' | 'apply_look'): Planner => (env) => {
  if (!env.values.has('name')) return incomplete(env, intent, ['mode'], intent === 'effect' ? 'הוסף אפקט שחור לבן' : 'החל מראה חם', intent === 'effect' ? 'add effect black & white' : 'apply look vintage');
  const id = v<string | null>(env, 'name');
  if (!id) return refused(env, intent, 'unknown_name');
  return withTargets(env, intent, resolveClips(env.ctx, clipWord(env), isPicture, { allowMany: true, atFrame: env.ctx.playheadFrame }), (items, notes) =>
    finishPlan(env, intent, items.map((f) => ({ op, args: op === 'add_effect' ? { clipId: f.clip.id, type: id } : { clipId: f.clip.id, lookId: id } })), items.map((f) => clipStep(env, op, f)), notes));
};

const rename: Planner = (env) => {
  const text = v<{ text: string; unclosed: boolean }>(env, 'text');
  if (!text || text.unclosed || !text.text.trim()) return incomplete(env, 'rename_project', ['text'], 'שנה את שם הפרויקט ל"גן רימון"', 'rename the project to "Rimon"');
  const name = text.text.trim().slice(0, 200);
  return finishPlan(env, 'rename_project', [{ op: 'rename_project', args: { name } }], [{ op: 'rename_project', detail: { kind: 'rename', to: name } }], []);
};

const removeEmpty: Planner = (env) => {
  const ids = emptyTrackIds(env.ctx.doc);
  const tracks = tracksOf(env.ctx.doc);
  return finishPlan(env, 'remove_empty_tracks', ids.map((id) => ({ op: 'remove_track', args: { trackId: id } })), ids.map((id) => trackStep('remove_track', tracks.find((t) => t.id === id)!)), []);
};

const undo: Planner = (env) => (env.ctx.undoTarget ? act(env, 'undo', { kind: 'undo', ...env.ctx.undoTarget }) : refused(env, 'undo', 'nothing_to_undo'));
const redo: Planner = (env) => (env.ctx.redoTarget ? act(env, 'redo', { kind: 'redo', ...env.ctx.redoTarget }) : refused(env, 'redo', 'nothing_to_redo'));
const workspace: Planner = (env) => {
  const w = v<BarWorkspace>(env, 'workspace');
  if (!w) return incomplete(env, 'workspace', ['mode'], 'עבור למצב הופעה', 'switch to perform mode');
  if (env.ctx.performRecording) return refused(env, 'workspace', 'recording');
  return act(env, 'workspace', { kind: 'workspace', workspace: w });
};
const exportTo: Planner = (env) => {
  const d = v<ExportDestinationId>(env, 'destination');
  return d ? act(env, 'export_to', { kind: 'export_sheet', destination: d }) : incomplete(env, 'export_to', ['destination'], 'ייצא לוואטסאפ', 'export to whatsapp');
};
const seek: Planner = (env) => {
  const pos = v<TimeSpec>(env, 'pos');
  if (!pos) return incomplete(env, 'seek', ['time'], 'עבור לשנייה 10', 'go to the end');
  const p = timeOf(env, pos);
  if ('refused' in p) return refused(env, 'seek', p.refused);
  return act(env, 'seek', { kind: 'seek', frame: p.frame }, roundedNote(env, p, 'frame'));
};
const language: Planner = (env) => {
  const to = v<'he' | 'en'>(env, 'lang') ?? (headValue(env) === 'toggle' ? (env.ctx.lang === 'he' ? 'en' : 'he') : null);
  return to ? act(env, 'language', { kind: 'language', to }) : incomplete(env, 'language', ['mode'], 'עבור לאנגלית', 'switch to english');
};
const open: Planner = (env) => {
  const id = v<string>(env, 'open');
  return id ? act(env, 'open', { kind: 'command', commandId: id }) : incomplete(env, 'open', ['target'], 'פתח תבניות', 'open templates');
};

/** «סנכרן לקצב» always asks (lead decision 6): the chosen cut to a beat, the beat montage, the music's end on a beat, beat-locked transitions. */
const syncBeat: Planner = (env) => {
  const choices: BarChoice[] = [];
  const doc = env.ctx.doc;
  const music = tracksOf(doc).filter((t) => t.kind === 'audio' && trackRole(doc, t) === 'music');
  const noBeats: BarNote[] = music.length ? [] : [{ code: 'no_beat_analysis', data: {} }];
  if (env.ctx.cutClipId) choices.push({ he: 'להזיז את החיתוך הנבחר לפעימה', en: 'Move the chosen cut to a beat', result: act(env, 'sync_beat', { kind: 'command', commandId: 'cut.toBeat' }, noBeats) });
  choices.push({ he: 'מונטאז׳ לפי קצב (פותח את המתכונים)', en: 'Beat montage (opens the recipes)', result: act(env, 'sync_beat', { kind: 'recipe', recipeId: 'beat-montage' }, noBeats) });
  const fit = fitMusicPlan(env, 'fit_music');
  if (fit.kind === 'plan') choices.push({ he: 'לסיים את המוזיקה על פעימה', en: 'End the music on a beat', result: fit });
  const calls: OpCall[] = [], steps: PlanStep[] = [];
  for (const track of tracksOf(doc)) {
    if (track.kind !== 'video' || track.locked) continue;
    for (const clip of track.clips) {
      const tr = clip.type === 'media' ? (clip as MediaClip).transition : undefined;
      if (!tr || tr.sync === 'beat') continue;
      const call: OpCall = { op: 'set_transition_options', args: { clipId: clip.id, sync: 'beat' } };
      try { applyTransaction(env.ctx.rawDoc, [env.ctx.inject(call)], { ...BAR_PREVIEW_OPTIONS }); } catch (e) { if (e instanceof OpError) continue; throw e; }
      calls.push(call); steps.push({ op: 'set_transition_options', detail: { kind: 'transition', type: tr.type, frames: tr.frames, clipId: clip.id, name: clipName(doc, clip) } });
    }
  }
  if (calls.length && music.length) { const r = finishPlan(env, 'sync_beat', calls, steps, []); if (r.kind === 'plan') choices.push({ he: 'לנעול את המעברים לקצב', en: 'Lock the transitions to the beat', result: r }); }
  const why = music.length ? { he: '', en: '' } : { he: ' (למוזיקה אין ניתוח פעימות)', en: ' (no music has a beat analysis)' };
  return { kind: 'ambiguous', intent: 'sync_beat', ...base(env), choices, question: { he: `איזה סנכרון לקצב?${why.he}`, en: `Which kind of beat sync?${why.en}` } };
};

export const PLANNERS: Readonly<Record<string, Planner>> = {
  split, trim, delete: del, add_title: addTitle, gain_change: gain, mute: muteFamily('mute'), unmute: muteFamily('unmute'), transitions, add_marker: marker, close_gaps: closeGaps,
  freeze, speed, fades, fit_music: (env) => fitMusicPlan(env, 'fit_music'), effect: catalogPlanner('effect', 'add_effect'), look: catalogPlanner('look', 'apply_look'), rename_project: rename,
  remove_empty_tracks: removeEmpty, undo, redo, workspace, export_to: exportTo, seek,
  play: (env) => act(env, 'play', { kind: 'play' }), pause: (env) => act(env, 'pause', { kind: 'pause' }), select_all: (env) => act(env, 'select_all', { kind: 'select_all' }),
  deselect: (env) => act(env, 'deselect', { kind: 'deselect' }), zoom_in: (env) => act(env, 'zoom_in', { kind: 'zoom', dir: 1 }), zoom_out: (env) => act(env, 'zoom_out', { kind: 'zoom', dir: -1 }),
  language, open, sync_beat: syncBeat,
};

/** Every reading set of a parse: the cartesian product of the alternatives some hits carry (normally one or two sets). */
export function readingSets(p: FamilyParse): { values: Map<string, unknown>; labels: { he: string; en: string }[] }[] {
  let sets: { values: Map<string, unknown>; labels: { he: string; en: string }[] }[] = [{ values: new Map(), labels: [] }];
  for (const h of p.hits) {
    if (h.role === 'verb' || h.role === 'filler') continue;
    if (!h.alts) { sets = sets.filter((s) => !s.values.has(h.key)); for (const s of sets) s.values.set(h.key, h.value); continue; }
    const next: typeof sets = [];
    for (const s of sets) for (const a of h.alts) {
      if (s.values.has(a.key)) continue; // a length said twice («ב־3 שניות למשך 4 שניות»): that reading is out
      const values = new Map(s.values); values.set(a.key, a.value);
      next.push({ values, labels: [...s.labels, { he: a.he, en: a.en }] });
    }
    sets = next;
  }
  return sets;
}
