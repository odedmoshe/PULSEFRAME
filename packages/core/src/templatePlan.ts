/**
 * The template planner (ADR-0016): pure, (document, template, input) -> TemplatePlan of public ops with bindings.
 * Rule-based; no model. Nothing here reads the clock, the disk or a random source: equal inputs give equal plans.
 *
 * How a plan is made:
 * - Anchor: input.at (frame-aligned), else 0 on an empty main sequence, else the end of the last picture or title clip.
 * - Grid: with music, its analysed beats (and bar starts) as they will fall on the timeline once the music is placed at the
 *   anchor with sourceIn = its first bar start (else its first beat, or 0 for startAt 'zero'): timeline beat = at + (b − sourceIn),
 *   exact. Without music, beats every 60/fallbackBpm seconds from the anchor, exact rationals, and a bar every four beats.
 * - Slots: each span (beats, bars or seconds, scaled by the tempo option) ends at an exact grid time; every boundary is snapped
 *   ONCE to the nearest frame, and a slot's length is the difference of two snapped boundaries (ADR-0003). Slots past the
 *   music's last usable beat are dropped. A cut that would come less than flashGapFrames after the one before is left out by
 *   merging that slot into the one before it (ADR-0009), so no second holds more than three cuts.
 * - Media: in order or shuffled by seed, each slot taking the first of the next three media its `accept` allows, cycling; a
 *   video used again starts further in. Each source window keeps the next slot's transition frames free after it when the
 *   file is long enough. A video shorter than its slot blocks the plan (slot_too_short); nothing is padded or slowed down.
 * - Ops, in this order: picture clips, camera moves, transitions, graphic elements, adjustment looks, titles, sound effects,
 *   music. Every op that makes an item is bound to the item's key, so later steps and the run's slot records refer to it.
 *
 * Content packs (ADR-0022):
 * - Built-in music (input.builtinMusic): the grid is the steady grid of the style's tempo from the anchor, which is exactly
 *   the track's own grid once the track is placed at the anchor from its start, and it has no end. The track is made to
 *   measure: N = max(minBars, ceil((E − at)·bpm/240)) bars, where E is the EXACT grid time the last used slot ends at (before
 *   it is snapped to a frame). The server makes the track (assetsNeeded kind 'music') and it arrives with its known grid.
 *   The clip is placed with an explicit length: min(the track floored to whole frames, the pictures). So the music never
 *   ends after the pictures and at most one frame before them. When the slots end on the bar line the track ends on, the
 *   composed ending lands with the last picture and nothing is faded. When the track is longer (slots that do not end on a
 *   bar line, or the style's shortest track), the clip is cut at the last picture and faded out (set_clip_fades, one
 *   second, at most half the clip; notice builtin_music_faded). fit_music is not used: it would end the music on an earlier
 *   bar and leave the last pictures silent.
 * - Fields: a template's own title text may hold pack fields ({name} {name2} {age} {night} {place} {when}), written in from
 *   input.fields, and live fields of the life line ({hebrewDate} and the others), which stay in the text: the title is made
 *   with its live fields on (set_text_fields). When a pack field has no value, or a picture under the title has no capture
 *   date for its live fields to read, the title's fallback words are used instead and a notice says so. Text the caller
 *   typed (input.texts) is literal: nothing in it is read as a field. {n} stays the per-slot counter and is written in
 *   after the fields. {night} is worked out from input.fields.date and atLighting when it is not given (the date is an
 *   input; nothing reads a clock).
 * - Two graphic elements of one plan that would lie on the same track range: the earlier one is left out (notice
 *   element_dropped), so apply never fails with an overlap the plan did not show.
 */
import * as T from '@pulseframe/time';
import { z } from 'zod';
import type { Asset, Clip, ProjectDocument, Track } from './schema.ts';
import {
  PACK_FIELD_KEYS, TemplateDefSchema, TemplateError, TemplateInputSchema, TEMPLATE_METHOD,
  type PackFieldKey, type PackFieldsInput, type PackFieldValues, type PlannedSlot, type PredictedSlot, type TemplateDef, type TemplateInput, type TemplateNotice, type TemplatePlan, type TemplatePlanContext, type TemplateStep, type TemplateSummary, type TemplateWarning,
} from './templateContract.ts';
import { barsForDuration, findMusicStyle, listMusicStyles, MUSIC_MAX_SECONDS, type MusicStyle } from './musicStyles.ts';
import { resolveTitleText, titleFieldUse, titleTextProblems } from './titleFields.ts';
import { candleNight } from './packs/suggest.ts';
import { captureOf } from './capture.ts';
import { defaultMotionFrames, MOTION_PRESETS, shortestSafeLoopFrames } from './motionPresets.ts';
import { findEffect, GPU_EFFECT_IDS, GPU_TRANSITION_IDS, TRANSITION_IDS } from './effects.ts';
import { findTextPreset } from './textPresets.ts';
import { ELEMENT_IDS } from './elements.ts';
import { flashGapFrames } from './flashSafety.ts';
import { clipEnd } from './validate.ts';
import { handleAfterEnd, isRamped } from './speed.ts';

type RT = T.RationalTime;
type SlotDef = TemplateDef['slots'][number];
type Timing = TemplateDef['texts'][number]['at'];

/** Bind names the planner gives to what is not an item of the template (an item key equal to one of these is refused). */
export const TEMPLATE_RESERVED_BINDS = { pictures: 'pictures-track', elements: 'elements-track', music: 'music' } as const;
/** The asset key of the built-in music track a plan asks the server to make (assetsNeeded kind 'music'). */
export const BUILTIN_MUSIC_ASSET_KEY = 'music-1';
/** The most operations one plan may hold (ApplyTemplateArgsSchema.ops). */
export const MAX_TEMPLATE_OPS = 2000;
const MAX_STEPS = 50;
const MOTION_IDS = new Set(MOTION_PRESETS.map((m) => m.id));
const TRANSITIONS = new Set<string>(TRANSITION_IDS);
const ELEMENTS = new Set<string>(ELEMENT_IDS);
const secs = (t: RT) => `${T.toSeconds(t).toFixed(3)} s`;

// ---------- reading direction ----------
/**
 * The transition or motion id that reads the same way in `lang`: for Hebrew (read right to left) the tokens "left" and
 * "right" of an id are swapped (push-left -> push-right, motion.move.pan-left -> motion.move.pan-right), when the swapped id
 * exists in this build. Every other id, and every id in English, is returned unchanged, so the result always exists when
 * the input does.
 */
export function mirrorForReading(id: string, lang: 'he' | 'en'): string {
  if (lang !== 'he') return id;
  const swapped = id.split(/([.-])/).map((part) => (part === 'left' ? 'right' : part === 'right' ? 'left' : part)).join('');
  if (swapped === id) return id;
  return TRANSITIONS.has(swapped) || MOTION_IDS.has(swapped) ? swapped : id;
}

// ---------- exact rationals ----------
const big = (t: RT) => ({ n: BigInt(t.value), d: BigInt(t.timescale) });
const floorDiv = (a: bigint, b: bigint) => { const q = a / b; return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q; };
/** 'n' or 'n/d' seconds as an exact time. */
const parseSeconds = (s: string): RT => { const m = /^(\d+)(?:\/(\d+))?$/.exec(s)!; return T.rt(BigInt(m[1]!), Number(m[2] ?? 1)); };
const halve = (t: RT): RT => T.rt(BigInt(t.value), t.timescale * 2);
const twice = (t: RT): RT => T.add(t, t);

// ---------- the grid ----------
interface Grid {
  /** The n-th beat (n >= 1) strictly after c, or null when the grid ends first. */
  beatAfter(c: RT, n: number): RT | null;
  /** The n-th bar start (n >= 1) strictly after c, or null. */
  barAfter(c: RT, n: number): RT | null;
  /** Index of the first beat (bar start) at or after t, counted from the template start. */
  beatIndex(t: RT): number;
  barIndex(t: RT): number;
  /** The last usable grid time (music), or null for a grid without end. */
  last: RT | null;
  meter: number;
}
function listGrid(beats: readonly RT[], bars: readonly RT[] | null, meter: number): Grid {
  const firstAfter = (list: readonly RT[], c: RT) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (T.lt(c, list[m]!)) hi = m; else lo = m + 1; } return lo; };
  const firstAtOrAfter = (list: readonly RT[], c: RT) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (T.lte(c, list[m]!)) hi = m; else lo = m + 1; } return lo; };
  return {
    beatAfter: (c, n) => beats[firstAfter(beats, c) + n - 1] ?? null,
    barAfter: (c, n) => (bars ? bars[firstAfter(bars, c) + n - 1] ?? null : null),
    beatIndex: (t) => firstAtOrAfter(beats, t),
    barIndex: (t) => (bars ? firstAtOrAfter(bars, t) : 0),
    last: beats[beats.length - 1] ?? null,
    meter,
  };
}
/** Beats every 60/bpm seconds from `at` (exact), a bar every `meter` beats; endless. */
function steadyGrid(at: RT, bpm: number): Grid {
  const b = big(T.fromSeconds(bpm.toFixed(6)));
  // one beat lasts 60/bpm = 60·b.d/b.n seconds
  const beatAt = (k: bigint): RT => T.add(at, T.rt(k * 60n * b.d, Number(b.n)));
  /** floor((t − at) / (beats·period)), the number of whole groups of `beats` beats from `at` to t */
  const groups = (t: RT, beats: bigint) => { const x = big(T.sub(t, at)); return floorDiv(x.n * b.n, x.d * 60n * b.d * beats); };
  const meter = 4;
  return {
    beatAfter: (c, n) => beatAt((T.lt(c, at) ? 0n : groups(c, 1n) + 1n) + BigInt(n - 1)),
    barAfter: (c, n) => beatAt(((T.lt(c, at) ? 0n : groups(c, BigInt(meter)) + 1n) + BigInt(n - 1)) * BigInt(meter)),
    beatIndex: (t) => { const k = groups(t, 1n); return Number(T.eq(beatAt(k), t) ? k : k + 1n); },
    barIndex: (t) => { const k = groups(t, BigInt(meter)); return Number(T.eq(beatAt(k * BigInt(meter)), t) ? k : k + 1n); },
    last: null,
    meter,
  };
}

// ---------- the template definition ----------
/** Parse the definition and check what the schema cannot: unique keys, no reserved names, catalogue ids that exist. */
function checkDef(raw: TemplateDef): TemplateDef {
  const r = TemplateDefSchema.safeParse(raw);
  if (!r.success) throw new TemplateError('invalid_args', `template definition ${String((raw as { id?: unknown })?.id)} is invalid: ${z.prettifyError(r.error)}`);
  const def = r.data;
  const bad = (what: string) => new TemplateError('invalid_args', `template ${def.id}: ${what}`);
  const keys = [...def.slots, ...def.texts, ...def.elements, ...def.sfx, ...def.adjust].map((x) => x.key);
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) throw bad(`the key "${k}" is used twice`);
    if ((Object.values(TEMPLATE_RESERVED_BINDS) as string[]).includes(k) || k.includes('--')) throw bad(`the key "${k}" is reserved`);
    seen.add(k);
  }
  // items that make several clips bind them as key--1, key--2…: those names must stay within BIND_NAME's 32 characters
  const multi = [...def.texts.filter((x) => x.perSlot && x.perSlot !== 'none'), ...def.elements.filter((x) => x.perSlot && x.perSlot !== 'none'), ...def.sfx.filter((x) => x.at === 'boundaries'), ...def.adjust.filter((x) => typeof x.span === 'object' && 'tag' in x.span)];
  for (const x of multi) if (x.key.length > 28) throw bad(`the key "${x.key}" makes one clip per slot and must be at most 28 characters`);
  const slotKeys = new Set(def.slots.map((s) => s.key));
  const textKeys = new Set(def.texts.map((s) => s.key));
  for (const s of def.slots) {
    if (s.motion && !MOTION_IDS.has(s.motion.presetId)) throw bad(`slot ${s.key}: motion "${s.motion.presetId}" does not exist`);
    if (s.transitionIn && !TRANSITIONS.has(s.transitionIn.type)) throw bad(`slot ${s.key}: transition "${s.transitionIn.type}" does not exist`);
  }
  for (const x of def.texts) {
    // fields in a title's own words (ADR-0022): pack fields and live fields only, with fallback words for when one has no value
    const counter = !!x.perSlot && x.perSlot !== 'none';
    for (const lang of ['he', 'en'] as const) for (const problem of titleTextProblems(x.default[lang], x.fallback?.[lang], { counter })) throw bad(`text ${x.key} (${lang}): ${problem}`);
    if (!findTextPreset(x.presetId)) throw bad(`text ${x.key}: text style "${x.presetId}" does not exist`);
    if (!slotKeys.has(x.at.slot)) throw bad(`text ${x.key} starts at slot "${x.at.slot}", which the template does not have`);
  }
  for (const x of def.elements) {
    if (!ELEMENTS.has(x.elementId)) throw bad(`element ${x.key}: "${x.elementId}" does not exist`);
    if (x.motion && !MOTION_IDS.has(x.motion.presetId)) throw bad(`element ${x.key}: motion "${x.motion.presetId}" does not exist`);
    if (!slotKeys.has(x.at.slot)) throw bad(`element ${x.key} starts at slot "${x.at.slot}", which the template does not have`);
  }
  for (const x of def.sfx) {
    if (typeof x.at === 'object' && 'slot' in x.at && !slotKeys.has(x.at.slot)) throw bad(`sound ${x.key} names slot "${x.at.slot}", which the template does not have`);
    if (typeof x.at === 'object' && 'text' in x.at && !textKeys.has(x.at.text)) throw bad(`sound ${x.key} names text "${x.at.text}", which the template does not have`);
  }
  for (const x of def.adjust) {
    for (const fx of x.effects) if (!findEffect(fx.type)) throw bad(`look ${x.key}: effect "${fx.type}" does not exist`);
    if (typeof x.span === 'object' && 'slots' in x.span) for (const k of x.span.slots) if (!slotKeys.has(k)) throw bad(`look ${x.key} names slot "${k}", which the template does not have`);
  }
  return def;
}

/** A span with the tempo option applied: half = twice as long, double = half as long (a one-beat slot stays one beat). */
type Span = { beats: number } | { bars: number } | { seconds: RT };
function scaleSpan(span: SlotDef['span'], tempo: TemplateInput['tempo'], meter: number): Span {
  if ('seconds' in span) { const s = parseSeconds(span.seconds); return { seconds: tempo === 'half' ? twice(s) : tempo === 'double' ? halve(s) : s }; }
  if ('beats' in span) return { beats: tempo === 'half' ? span.beats * 2 : tempo === 'double' ? Math.max(1, Math.floor(span.beats / 2)) : span.beats };
  if (tempo === 'half') return { bars: span.bars * 2 };
  if (tempo === 'double') return span.bars >= 2 ? { bars: Math.floor(span.bars / 2) } : { beats: Math.max(1, Math.floor(meter / 2)) };
  return { bars: span.bars };
}
/** Length of a span in seconds on the template's own steady grid (for the gallery). */
const spanSeconds = (span: SlotDef['span'], bpm: number) => ('seconds' in span ? T.toSeconds(parseSeconds(span.seconds)) : ('beats' in span ? span.beats : span.bars * 4) * (60 / bpm));

/** The gallery entry of a built-in template (TemplateSummary). `seconds` is its full length on its own steady grid. */
export function summarizeTemplate(def: TemplateDef, env: { elementsAvailable: boolean }): TemplateSummary {
  const elements = def.elements.length > 0;
  const gpu = def.adjust.some((a) => a.effects.some((e) => GPU_EFFECT_IDS.includes(e.type))) || def.slots.some((s) => !!s.transitionIn && GPU_TRANSITION_IDS.includes(s.transitionIn.type));
  const available = !(elements && !env.elementsAvailable);
  const uses = def.texts.flatMap((t) => [t.default.he, t.default.en].map((text) => titleFieldUse(text, { counter: !!t.perSlot && t.perSlot !== 'none' })));
  return {
    id: def.id, version: def.version, name: def.name, hint: def.hint, genre: def.genre, designedFor: def.designedFor,
    slots: def.slots.map((s) => ({ key: s.key, role: s.role, accept: s.accept })),
    texts: def.texts.map((t) => ({ key: t.key, role: t.role, default: t.default, maxChars: t.maxChars })),
    seconds: Math.round(def.slots.reduce((n, s) => n + spanSeconds(s.span, def.tempo.fallbackBpm), 0) * 100) / 100,
    needs: { music: def.music.need, elements, gpu, model: null },
    available,
    unavailableReason: available ? null : 'this template places graphic elements, which this machine cannot draw: its ffmpeg has no SVG decoder (librsvg)',
    method: TEMPLATE_METHOD,
    pack: def.pack ?? null, fields: PACK_FIELD_KEYS.filter((k) => uses.some((u) => u.pack.includes(k))), liveFields: uses.some((u) => u.live),
    builtinMusic: def.music.builtin !== undefined && findMusicStyle(def.music.builtin) ? def.music.builtin : null,
  };
}

// ---------- planning ----------
interface Kept {
  key: string; def: SlotDef; index: number;
  /** exact grid times of the slot's start and end, and their snapped frames */
  start: RT; end: RT; startFrame: number; endFrame: number;
  beats?: { from: number; count: number; unit: 'beat' | 'bar' };
  assetId: string; sourceInFrame: number | null; handle: number; cropShare: number;
}
interface Music { asset: Asset; sourceIn: RT; grid: Grid; beatCount: number; bpm: number | null; bars: boolean; confidence: number | null; method: string; edited: boolean }

const isPicture = (a: Asset) => !!a.video || (a.kind === 'image' && !!a.image);
const accepts = (accept: SlotDef['accept'], a: Asset) => accept === 'any' || (accept === 'video' ? !!a.video && a.kind !== 'image' : a.kind === 'image');
const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Default start: 0 on an empty main sequence, else the end of the last picture or title clip. */
function anchorOf(doc: ProjectDocument, at: RT | undefined): RT {
  const rate = doc.settings.frameRate;
  if (at) {
    if (T.isNegative(at)) throw new TemplateError('invalid_args', 'at must be 0 or later');
    if (!T.isFrameAligned(at, rate)) throw new TemplateError('invalid_args', `at must fall on a ${rate.num}/${rate.den} fps frame boundary`, `The nearest frame starts at ${JSON.stringify(T.snapToFrame(at, rate))}.`);
    return T.normalize(at);
  }
  let end: RT = T.ZERO;
  for (const t of doc.sequences[doc.mainSequenceId]?.tracks ?? []) if (t.kind === 'video' || t.kind === 'text') for (const c of t.clips) end = T.max(end, clipEnd(c));
  return end;
}

function musicOf(doc: ProjectDocument, def: TemplateDef, p: TemplateInput, at: RT, usesBars: boolean, builtin: boolean): Music | null {
  if (def.music.need === 'none' || p.musicAssetId === null) {
    // built-in music has its beats by construction, so it satisfies a template that cuts on beats. (The hint is unchanged: the
    // editor recognises it by its exact words, apps/web/src/editor/templateRefusals.ts.)
    if (def.music.need === 'beats' && !builtin) throw new TemplateError('invalid_args', `template ${def.id} cuts on the beats of music: choose a music file`, 'Pass musicAssetId: a sound file whose beats were measured.');
    return null;
  }
  const asset = Object.hasOwn(doc.assets, p.musicAssetId) ? doc.assets[p.musicAssetId] : undefined;
  if (!asset) throw new TemplateError('not_found', `music asset ${p.musicAssetId} is not in this project`);
  if (!asset.audio || asset.video || asset.kind === 'image') throw new TemplateError('invalid_args', `asset ${asset.id} is not a sound file`, 'Choose a sound-only file as the music.');
  const an = doc.analyses?.[asset.id]?.beats;
  const hint = 'Measure the beat of the music first (מדידת קצב, ללא בינה מלאכותית): POST /api/v1/projects/{id}/assets/{assetId}/analyze with {"kind":"beats"}, or analyze_asset kind=beats.';
  if (!an || an.beats.length < 2) throw new TemplateError('needs_analysis', 'the music has no beat analysis yet', hint);
  if (usesBars && !an.downbeats?.length) throw new TemplateError('needs_analysis', 'the beat analysis of this music has no bar starts, and this template counts in bars', 'Mark the bar starts with edit_analysis (downbeats), or measure the beat again.');
  const inFile = (b: RT) => !T.isNegative(b) && T.lt(b, asset.duration);
  const beats = [...an.beats].filter(inFile).sort(T.cmp);
  const downs = [...(an.downbeats ?? [])].filter(inFile).sort(T.cmp);
  const sourceIn = def.music.startAt === 'zero' ? T.ZERO : downs[0] ?? beats[0]!;
  const toTimeline = (list: RT[]) => list.filter((b) => !T.lt(b, sourceIn)).map((b) => T.add(at, T.sub(b, sourceIn))).filter((t, i, a) => i === 0 || !T.eq(a[i - 1]!, t));
  const tb = toTimeline(beats);
  if (tb.length < 2) throw new TemplateError('needs_analysis', 'fewer than two measured beats lie after the music\'s start', hint);
  return { asset, sourceIn, grid: listGrid(tb, downs.length ? toTimeline(downs) : null, an.meter ?? 4), beatCount: tb.length, bpm: an.bpm, bars: downs.length > 0, confidence: an.confidence, method: an.origin.method, edited: !!an.origin.edited };
}

/** Free over [start, end) at frames, on an unlocked, shown track. */
const freeOver = (t: Track, ranges: readonly (readonly [RT, RT])[]) => !t.locked && !t.hidden && ranges.every(([s, e]) => !t.clips.some((c) => T.lt(c.start, e) && T.lt(s, clipEnd(c))));

/**
 * What a transition at `start` on existing track `t` would play over: the clip there that ends exactly at `start`.
 * Returns the free source frames after it (Infinity for a still picture), 0 when none can be used, or null when nothing ends there.
 */
function handleBefore(doc: ProjectDocument, t: Track | undefined, start: RT): number | null {
  const rate = doc.settings.frameRate;
  const prev: Clip | undefined = t?.clips.find((c) => T.eq(clipEnd(c), start));
  if (!prev) return null;
  if (prev.type !== 'media') return 0;
  if (isRamped(prev)) return 0; // set_transition refuses to follow a gradual speed change
  const asset = doc.assets[prev.assetId];
  if (!asset) return 0;
  if (asset.kind === 'image') return Infinity;
  return Math.max(0, T.frameIndexAt(handleAfterEnd(prev, asset.duration), rate));
}

/**
 * The words of the pack fields from the plan's input: the six literal fields as given, and {night} (the Hanukkah candle)
 * worked out from `date` and `atLighting` (default true: filmed at that evening's lighting) when it is not given itself.
 */
function packFieldValues(input: PackFieldsInput | undefined): PackFieldValues {
  const out: Partial<Record<PackFieldKey, string>> = {};
  if (!input) return out;
  for (const k of PACK_FIELD_KEYS) { const v = Object.hasOwn(input, k) ? input[k] : undefined; if (v !== undefined) out[k] = v; }
  if (out.night === undefined && input.date !== undefined) {
    const [y, m, day] = input.date.split('-').map(Number) as [number, number, number];
    const candle = candleNight({ y, m, d: day }, input.atLighting ?? true);
    if (candle !== null) out.night = String(candle);
  }
  return out;
}

/**
 * Build the plan for a template from the current document. Pure; throws TemplateError when the template cannot apply. A plan
 * whose `blocking` list is not empty must not be applied (the server answers 409 template_blocked).
 */
export function planTemplate(doc: ProjectDocument, def: TemplateDef, input: unknown, ctx: TemplatePlanContext = {}): TemplatePlan {
  const d = checkDef(def);
  const parsed = TemplateInputSchema.safeParse(input ?? {});
  if (!parsed.success) throw new TemplateError('invalid_args', z.prettifyError(parsed.error));
  const p0 = parsed.data;
  if (d.elements.length && ctx.elementsAvailable === false) throw new TemplateError('needs_capability', `template ${d.id} places graphic elements, which this machine cannot draw: its ffmpeg has no SVG decoder (librsvg)`, 'Install an ffmpeg build with librsvg and restart the server, or choose a template without elements.');
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gap = flashGapFrames(fps);
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) throw new TemplateError('not_found', 'the project has no main sequence');
  const at = anchorOf(doc, p0.at);
  const p: TemplateInput = { ...p0, at };
  const lang = p.lang;
  const keep = new Set(ctx.keepKeys ?? []);
  const warnings: TemplateWarning[] = [], blocking: TemplateWarning[] = [], steps: string[] = [], basis: string[] = [];
  const warn = (code: TemplateWarning['code'], message: string, details: Record<string, unknown> = {}) => warnings.push({ code, message, details });
  const notices: TemplateNotice[] = [];
  const notice = (code: TemplateNotice['code'], message: string, details: Record<string, unknown> = {}) => notices.push({ code, message, details });
  const nf = (t: RT) => T.nearestFrameIndex(t, rate);
  const ft = (f: number) => T.frameTime(f, rate);

  // ----- inputs -----
  for (const k of Object.keys(p.texts)) if (!d.texts.some((t) => t.key === k)) throw new TemplateError('invalid_args', `template ${d.id} has no text "${k}"`, `Its texts are: ${d.texts.map((t) => t.key).join(', ') || 'none'}.`);
  if (!p.media.length) throw new TemplateError('invalid_args', 'choose at least one picture or video', 'Pass media: asset ids of pictures or videos, in order.');
  const media = p.media.map((id) => {
    const a = Object.hasOwn(doc.assets, id) ? doc.assets[id] : undefined;
    if (!a) throw new TemplateError('not_found', `asset ${id} is not in this project`);
    if (!isPicture(a)) throw new TemplateError('invalid_args', `asset ${id} has no picture`, 'Choose pictures or videos for the slots.');
    return a;
  });
  const useCount = d.slotUse.mode === 'all' ? d.slots.length : Math.min(d.slots.length, Math.max(d.slotUse.min, media.length));
  // built-in music (ADR-0022): one source of music at a time; an unknown or rejected style is refused
  const wanted = p.builtinMusic ?? null;
  if (wanted && p.musicAssetId !== null) throw new TemplateError('invalid_args', 'choose a music file or built-in music, not both', 'Send musicAssetId: null together with builtinMusic, and builtinMusic: null together with musicAssetId (a regeneration merges new parameters into the run\'s own).');
  const style: MusicStyle | null = wanted ? findMusicStyle(wanted.styleId) ?? null : null;
  if (wanted && !style) throw new TemplateError('invalid_args', `there is no built-in music style "${wanted.styleId}"`, `The styles are: ${listMusicStyles().map((x) => x.id).join(', ') || 'none in this build'} (GET /api/v1/music).`);
  const builtin = style && d.music.need !== 'none' ? { style, seed: wanted!.seed } : null;
  const meterHint = d.music.need === 'none' || p.musicAssetId === null ? 4 : doc.analyses?.[p.musicAssetId]?.beats?.meter ?? 4;
  const spans = d.slots.slice(0, useCount).map((s) => scaleSpan(s.span, p.tempo, meterHint));
  const music = musicOf(doc, d, p, at, spans.some((s) => 'bars' in s), !!builtin);
  if (p.musicAssetId !== null && d.music.need === 'none') basis.push('this template does not use music; the chosen music was not placed');
  if (style && !builtin) basis.push('this template does not use music; no built-in music was made');
  // with built-in music the grid is the style's own tempo from the anchor: the track's grid once it is placed there, without end
  const grid = music?.grid ?? steadyGrid(at, builtin ? builtin.style.bpm : d.tempo.fallbackBpm);

  // ----- slots on the grid -----
  const raw: { def: SlotDef; index: number; start: RT; end: RT; beats?: Kept['beats'] }[] = [];
  let cursor = at;
  const dropped: string[] = [];
  for (let i = 0; i < useCount; i++) {
    const s = d.slots[i]!, span = spans[i]!;
    let end: RT | null = 'beats' in span ? grid.beatAfter(cursor, span.beats) : 'bars' in span ? grid.barAfter(cursor, span.bars) : T.add(cursor, span.seconds);
    if (end && grid.last && T.lt(grid.last, end)) end = null;
    if (!end) { dropped.push(...d.slots.slice(i, useCount).map((x) => x.key)); break; }
    const beats = 'beats' in span ? { from: grid.beatIndex(cursor), count: span.beats, unit: 'beat' as const } : 'bars' in span ? { from: grid.barIndex(cursor), count: span.bars, unit: 'bar' as const } : undefined;
    raw.push({ def: s, index: i, start: cursor, end, ...(beats ? { beats } : {}) });
    cursor = end;
  }
  if (!raw.length) throw new TemplateError('nothing_to_do', 'the music ends before the first slot of this template does', 'Choose longer music, or start it earlier (at).');
  if (dropped.length) warn('slots_dropped', `${dropped.length} slot(s) would end after the music's last measured beat and were left out`, { slots: dropped, lastBeat: grid.last });
  // snapped once, then thinned: a cut less than `gap` frames after the previous cut is merged into the slot before it
  type Pre = Omit<Kept, 'assetId' | 'sourceInFrame' | 'handle' | 'cropShare'>;
  const pre: Pre[] = [];
  const alias = new Map<string, string>();
  const merged: string[] = [];
  const mergeInto = (into: Pre, r: { def: SlotDef; end: RT; beats?: Kept['beats'] }) => {
    into.end = r.end; into.endFrame = nf(r.end);
    into.beats = into.beats && r.beats && into.beats.unit === r.beats.unit && into.beats.count + r.beats.count <= 64 ? { ...into.beats, count: into.beats.count + r.beats.count } : undefined;
    if (!into.beats) delete into.beats;
    alias.set(r.def.key, into.key);
    for (const [k, v] of alias) if (v === r.def.key) alias.set(k, into.key);
    merged.push(r.def.key);
  };
  for (const r of raw) {
    const last = pre[pre.length - 1];
    const s = nf(r.start);
    if (last && s - last.startFrame < gap) { mergeInto(last, r); continue; }
    pre.push({ key: r.def.key, def: r.def, index: r.index, start: r.start, end: r.end, startFrame: s, endFrame: nf(r.end), ...(r.beats ? { beats: r.beats } : {}) });
  }
  if (pre.length > 1 && pre[pre.length - 1]!.endFrame - pre[pre.length - 1]!.startFrame < gap) { const lastOne = pre.pop()!; mergeInto(pre[pre.length - 1]!, lastOne); }
  if (merged.length) warn('cuts_merged', `${merged.length} cut(s) would come less than ${gap} frames after the one before; those slots were merged into the slot before them so there are at most three cuts a second (cuts between bright and dark pictures can trigger seizures)`, { slots: merged, gapFrames: gap });
  const slotIndex = new Map(pre.map((s, i) => [s.key, i]));
  for (const [k, v] of alias) slotIndex.set(k, slotIndex.get(v)!);
  const startFrame = pre[0]!.startFrame, endFrame = pre[pre.length - 1]!.endFrame;
  if (endFrame <= startFrame) throw new TemplateError('nothing_to_do', 'the slots of this template would be shorter than one frame here', 'Choose another tempo or other music.');
  // built-in music made to measure: whole bars that cover the pictures, counted from the EXACT end of the last slot (not its frame)
  let made: { style: MusicStyle; seed: number; bars: number; trackFrames: number; clipFrames: number } | null = null;
  if (builtin) {
    const bars = barsForDuration(builtin.style.id, T.sub(pre[pre.length - 1]!.end, at));
    const length = T.rt(240 * bars, builtin.style.bpm);
    if (T.lt(T.rt(MUSIC_MAX_SECONDS, 1), length)) throw new TemplateError('invalid_args', `built-in music for this template would be ${Math.ceil(T.toSeconds(length))} s long (${bars} bars); a built-in track is at most ${MUSIC_MAX_SECONDS} s`, 'Use fewer or shorter slots (tempo: double), or choose a music file instead (musicAssetId).');
    const trackFrames = T.frameIndexAt(length, rate); // the track floored to whole frames
    made = { ...builtin, bars, trackFrames, clipFrames: Math.min(trackFrames, endFrame - startFrame) };
  }

  // ----- media -----
  let order = media.map((a) => a.id);
  if (p.order === 'shuffle') { const r = mulberry(p.seed); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; } }
  // transition frames wanted at each slot's start: from seconds, at most the slot itself and the schema's 150
  const wantTr = pre.map((s) => (s.def.transitionIn ? Math.min(150, s.endFrame - s.startFrame, Math.max(1, Math.round(s.def.transitionIn.seconds * fps))) : 0));
  const queue: string[] = [];
  const uses = new Map<string, number>();
  const mismatched: string[] = [];
  const W = doc.settings.width, H = doc.settings.height, cover = doc.settings.fit === 'cover';
  const kept: Kept[] = pre.map((s, i) => {
    while (queue.length < 3) queue.push(...order);
    let pick = queue.slice(0, 3).findIndex((id) => accepts(s.def.accept, doc.assets[id]!));
    if (pick < 0) { pick = 0; mismatched.push(s.key); }
    const assetId = queue.splice(pick, 1)[0]!;
    const a = doc.assets[assetId]!;
    const n = uses.get(assetId) ?? 0;
    uses.set(assetId, n + 1);
    const frames = s.endFrame - s.startFrame;
    let sourceInFrame: number | null = null, handle = Infinity;
    if (a.kind !== 'image') {
      const total = T.frameIndexAt(a.duration, rate);
      if (total < frames) {
        blocking.push({ code: 'slot_too_short', message: `"${a.name}" is ${(total / fps).toFixed(2)} s long; slot ${s.key} needs ${(frames / fps).toFixed(2)} s`, details: { slot: s.key, assetId, haveFrames: total, needFrames: frames } });
        sourceInFrame = 0; handle = 0;
      } else {
        const want = Math.min(total, frames + (wantTr[i + 1] ?? 0));
        const span = total - want;
        sourceInFrame = span > 0 ? (n * frames) % (span + 1) : 0;
        handle = total - sourceInFrame - frames;
      }
    }
    const pw = a.video?.width ?? a.image?.width ?? W, ph = a.video?.height ?? a.image?.height ?? H;
    const k = (cover ? Math.max : Math.min)(W / pw, H / ph);
    const shown = (pw * k * ph * k) / (W * H);
    const cropShare = Math.round((cover ? 1 - 1 / shown : 1 - shown) * 10000) / 10000;
    return { ...s, assetId, sourceInFrame, handle, cropShare: Math.max(0, cropShare) };
  });
  if (mismatched.length) basis.push(`slot(s) ${mismatched.join(', ')} ask for ${mismatched.map((k) => kept[slotIndex.get(k)!]!.def.accept).join('/')} media; none of the next three chosen fitted, so the next one was used`);
  const unused = order.filter((id) => !uses.has(id));
  if (unused.length) warn('media_unused', `${unused.length} of the chosen media did not fit into the ${kept.length} slot(s)`, { assetIds: unused });
  const reused = [...uses].filter(([, n]) => n > 1).map(([id]) => id);
  if (reused.length) warn('media_reused', `${reused.length} of the chosen media appear more than once (a video starts further in each time)`, { assetIds: reused });

  // ----- where the pictures go -----
  const emitted = kept.filter((s) => !keep.has(s.key));
  const ranges = (list: readonly { startFrame: number; endFrame: number }[]) => list.map((s) => [ft(s.startFrame), ft(s.endFrame)] as const);
  const pictureTrack = seq.tracks.find((t) => t.kind === 'video' && freeOver(t, ranges(emitted)));
  const ops: TemplateStep[] = [];
  const slots: PlannedSlot[] = [];
  const ref = (bind: string, out?: string) => (out ? { $ref: bind, out } : { $ref: bind });
  const pictureTrackArg = pictureTrack ? pictureTrack.id : ref(TEMPLATE_RESERVED_BINDS.pictures, 'trackId');
  if (emitted.length && !pictureTrack) ops.push({ op: 'add_track', args: { kind: 'video' }, bind: TEMPLATE_RESERVED_BINDS.pictures });
  const keepAudio = emitted.filter((s) => s.def.keepAudio).length;
  for (const s of emitted) {
    const a = doc.assets[s.assetId]!;
    ops.push({ op: 'add_clip', args: { assetId: s.assetId, trackId: pictureTrackArg, start: ft(s.startFrame), duration: ft(s.endFrame - s.startFrame), ...(s.sourceInFrame !== null && a.kind !== 'image' ? { sourceIn: ft(s.sourceInFrame) } : {}), withLinkedAudio: !!s.def.keepAudio }, bind: s.key });
    slots.push({ key: s.key, kind: 'picture', clipId: ref(s.key), accept: s.def.accept, ...(s.beats && s.beats.count <= 64 ? { beats: s.beats } : {}) });
  }
  const bpmText = music ? (music.bpm ? `${music.bpm.toFixed(1)} BPM` : 'unknown tempo') : `${made ? made.style.bpm : d.tempo.fallbackBpm} BPM`;
  if (emitted.length) steps.push(`Place ${emitted.length} picture slot(s) from ${secs(ft(startFrame))} to ${secs(ft(endFrame))} on ${pictureTrack ? `track ${pictureTrack.name}` : 'a new picture track'}, ${music ? `cut on the beats of "${music.asset.name}" (${bpmText})` : made ? `cut on the beats of the built-in music "${made.style.name.en}" (${bpmText}, known from its recipe)` : `cut on a steady ${bpmText} grid (no music)`}${p.tempo !== 'normal' ? `, ${p.tempo} tempo` : ''}, media ${p.order === 'shuffle' ? `shuffled (seed ${p.seed})` : 'in order'}${keepAudio ? `; ${keepAudio} keep their own sound` : '; their own sound is left out (the music carries the sound)'}`);

  // camera moves
  const motionFrames = (presetId: string, frames: number): { frames?: number } | null => {
    const preset = MOTION_PRESETS.find((m) => m.id === presetId)!;
    if (frames < 2) return null;
    if (preset.kind === 'move') return frames <= 600 ? { frames } : {};
    const f = Math.min(defaultMotionFrames(presetId, fps), frames, 600);
    const safe = shortestSafeLoopFrames(presetId, fps);
    if (safe !== null && f < safe) return null;
    return { frames: Math.max(1, f) };
  };
  let moved = 0;
  if (p.motion === 'full') for (const s of emitted) {
    if (!s.def.motion) continue;
    const presetId = mirrorForReading(s.def.motion.presetId, lang);
    const f = motionFrames(presetId, s.endFrame - s.startFrame);
    if (!f) continue;
    ops.push({ op: 'apply_motion_preset', args: { clipId: ref(s.key), presetId, ...f, ...(s.def.motion.amount !== undefined ? { amount: s.def.motion.amount } : {}) } });
    moved++;
  }
  if (moved) steps.push(`Give ${moved} picture(s) a camera move${lang === 'he' ? ' (left and right follow Hebrew reading direction)' : ''}`);
  else if (p.motion === 'none' && d.slots.some((s) => s.motion)) steps.push('No camera moves (reduced motion)');

  // transitions
  let transitions = 0;
  for (const [i, s] of kept.entries()) {
    if (!s.def.transitionIn || keep.has(s.key)) continue;
    const want = wantTr[i]!;
    const prevPlanned = i > 0 && !keep.has(kept[i - 1]!.key) ? kept[i - 1]! : null;
    const handle = prevPlanned ? prevPlanned.handle : handleBefore(doc, pictureTrack, ft(s.startFrame)) ?? Infinity;
    const frames = Math.min(want, handle);
    const type = s.def.transitionIn.dir === 'reading' ? mirrorForReading(s.def.transitionIn.type, lang) : s.def.transitionIn.type;
    if (frames < Math.max(1, Math.round(s.def.transitionIn.seconds * fps))) warn('transition_shortened', frames < 1 ? `the ${type} into slot ${s.key} was left out: the picture before it has no unused frames after its end` : `the ${type} into slot ${s.key} was shortened to ${frames} frame(s)`, { slot: s.key, type, frames: Math.max(0, frames), wantedFrames: Math.round(s.def.transitionIn.seconds * fps) });
    if (frames < 1) continue;
    ops.push({ op: 'set_transition', args: { clipId: ref(s.key), type, frames } });
    transitions++;
  }
  if (transitions) steps.push(`Add ${transitions} transition(s) between the pictures${lang === 'he' && d.slots.some((s) => s.transitionIn?.dir === 'reading') ? ' (directions follow Hebrew reading)' : ''}`);

  // ----- timing of the other items -----
  const lastKept = kept.length - 1;
  const clamped: string[] = [];
  const slotAt = (key: string) => { const i = slotIndex.get(key); if (i !== undefined) return i; if (!clamped.includes(key)) clamped.push(key); return lastKept; };
  /** Start of slot i plus n grid beats; the slot's own start when that would leave nothing of the item before `end`. */
  const beatOffset = (i: number, n: number | undefined, end: number) => { if (!n) return kept[i]!.startFrame; const b = grid.beatAfter(kept[i]!.start, n); const f = b ? nf(b) : kept[i]!.startFrame; return f < end ? f : kept[i]!.startFrame; };
  /** One range per copy: the item's own range, or one per used slot from its slot onwards (count-down / count-up). */
  const copiesOf = (at: Timing, perSlot: 'none' | 'count-down' | 'count-up' | undefined) => {
    const i0 = slotAt(at.slot);
    if (!perSlot || perSlot === 'none') {
      const e = kept[Math.min(lastKept, i0 + (at.spanSlots ?? 1) - 1)]!.endFrame, s = beatOffset(i0, at.offsetBeats, e);
      return e > s ? [{ suffix: '', n: 0, start: s, end: e }] : [];
    }
    const count = kept.length - i0;
    return kept.slice(i0).map((k, j) => ({ suffix: `--${j + 1}`, n: perSlot === 'count-down' ? count - j : j + 1, start: beatOffset(i0 + j, at.offsetBeats, k.endFrame), end: k.endFrame })).filter((c) => c.end > c.start);
  };

  // elements, on a picture track above the pictures
  const assetsNeeded: TemplatePlan['assetsNeeded'] = [];
  const assetKey = (kind: 'sfx' | 'element', id: string, color?: string, color2?: string) => {
    const found = assetsNeeded.find((x) => x.kind === kind && x.id === id && x.color === color && x.color2 === color2);
    if (found) return found.key;
    const key = `${kind === 'sfx' ? 'sfx' : 'el'}-${assetsNeeded.filter((x) => x.kind === kind).length + 1}`;
    assetsNeeded.push({ key, kind, id, ...(color ? { color } : {}), ...(color2 ? { color2 } : {}) });
    return key;
  };
  const allElementCopies = d.elements.flatMap((e) => copiesOf(e.at, e.perSlot).map((c) => ({ e, ...c, bind: `${e.key}${c.suffix}` }))).filter((c) => !keep.has(c.bind));
  // all copies go on one track: where two would share a range (an element of an unused slot is moved to the last used one, a
  // merged slot's element to the slot it was merged into), the earlier one is left out, so apply never meets an overlap
  const overlapped = allElementCopies.filter((c, i) => allElementCopies.slice(i + 1).some((o) => o.start < c.end && c.start < o.end));
  const elementCopies = allElementCopies.filter((c) => !overlapped.includes(c));
  if (overlapped.length) {
    notice('element_dropped', `${overlapped.length} graphic element(s) would lie on the same track range as a later one of this template and were left out`, { keys: overlapped.map((c) => c.bind) });
    basis.push(`graphic element(s) ${overlapped.map((c) => c.bind).join(', ')} would share a track range with a later element (fewer slots are used than the template has, or cuts were merged) and were left out`);
  }
  if (elementCopies.length) {
    const below = pictureTrack ? seq.tracks.indexOf(pictureTrack) : seq.tracks.length;
    const elTrack = pictureTrack ? seq.tracks.find((t, i) => i > below && t.kind === 'video' && freeOver(t, ranges(elementCopies.map((c) => ({ startFrame: c.start, endFrame: c.end }))))) : undefined;
    if (!elTrack) ops.push({ op: 'add_track', args: { kind: 'video' }, bind: TEMPLATE_RESERVED_BINDS.elements });
    const trackArg = elTrack ? elTrack.id : ref(TEMPLATE_RESERVED_BINDS.elements, 'trackId');
    for (const c of elementCopies) {
      ops.push({ op: 'add_clip', args: { assetId: { $asset: assetKey('element', c.e.elementId, c.e.color, c.e.color2) }, trackId: trackArg, start: ft(c.start), duration: ft(c.end - c.start), withLinkedAudio: false }, bind: c.bind });
      ops.push({ op: 'set_clip_transform', args: { clipId: ref(c.bind), transform: { x: c.e.place.x, y: c.e.place.y, ...(c.e.place.scale !== undefined ? { scale: c.e.place.scale } : {}) } } });
      if (c.e.motion && p.motion === 'full') {
        const presetId = mirrorForReading(c.e.motion.presetId, lang);
        const f = motionFrames(presetId, c.end - c.start);
        if (f) ops.push({ op: 'apply_motion_preset', args: { clipId: ref(c.bind), presetId, ...f } });
      }
      slots.push({ key: c.bind, kind: 'element', clipId: ref(c.bind) });
    }
    steps.push(`Add ${elementCopies.length} graphic element(s) (${[...new Set(elementCopies.map((c) => c.e.elementId))].join(', ')}) on ${elTrack ? `track ${elTrack.name}` : 'a new picture track'} above the pictures`);
  }

  // adjustment looks
  let looks = 0;
  for (const a of d.adjust) {
    const runs: { start: number; end: number }[] = [];
    if (a.span === 'all') runs.push({ start: startFrame, end: endFrame });
    else if ('slots' in a.span) { const idx = a.span.slots.map(slotAt); runs.push({ start: kept[Math.min(...idx)]!.startFrame, end: kept[Math.max(...idx)]!.endFrame }); }
    else {
      const tag = a.span.tag;
      for (const s of kept) {
        if (s.def.tag !== tag) continue;
        const last = runs[runs.length - 1];
        if (last && last.end === s.startFrame) last.end = s.endFrame; else runs.push({ start: s.startFrame, end: s.endFrame });
      }
      if (!runs.length) basis.push(`look ${a.key}: no used slot carries the tag "${tag}", so it was not added`);
    }
    const multi = typeof a.span === 'object' && 'tag' in a.span;
    for (const [j, r] of runs.entries()) {
      const bind = multi ? `${a.key}--${j + 1}` : a.key;
      if (keep.has(bind) || r.end <= r.start) continue;
      ops.push({ op: 'add_adjustment', args: { span: { start: ft(r.start), duration: ft(r.end - r.start) }, effects: a.effects.map((e) => ({ type: e.type, ...(e.params ? { params: e.params } : {}) })) }, bind });
      const len = r.end - r.start;
      const fade = a.fadeSeconds ? Math.min(Math.round(a.fadeSeconds * fps), Math.floor(len / 2)) : 0;
      if (fade >= 1) {
        const keys: [number, number][] = [[0, 0], [fade, 1], ...(len - fade > fade ? [[len - fade, 1] as [number, number]] : []), [len, 0]];
        for (const [f, v] of keys) ops.push({ op: 'set_keyframe', args: { clipId: ref(bind), property: 'opacity', time: ft(f), value: v } });
      }
      slots.push({ key: bind, kind: 'look', clipId: ref(bind) });
      looks++;
    }
  }
  if (looks) steps.push(`Add ${looks} adjustment look(s) over the pictures (${[...new Set(d.adjust.flatMap((a) => a.effects.map((e) => e.type)))].join(', ')}); titles stay clean`);

  // titles
  const textStart = new Map<string, number>();
  let titles = 0, liveTitles = 0;
  const fieldValues = packFieldValues(p.fields);
  for (const t of d.texts) {
    const given = Object.hasOwn(p.texts, t.key) ? p.texts[t.key] : undefined;
    if (given !== undefined && given.length > t.maxChars) warn('text_too_long', `the text for ${t.key} has ${given.length} characters; this template is designed for at most ${t.maxChars}`, { key: t.key, length: given.length, maxChars: t.maxChars });
    const counter = !!t.perSlot && t.perSlot !== 'none';
    const told = new Set<TemplateNotice['code']>();
    for (const c of copiesOf(t.at, t.perSlot)) {
      const bind = `${t.key}${c.suffix}`;
      if (!textStart.has(t.key)) textStart.set(t.key, c.start);
      if (keep.has(bind)) continue;
      // Words the caller typed are literal. The template's own words may hold fields (ADR-0022): pack fields are written in,
      // live fields stay and the title is made with them on; without a value or a capture date the fallback words are used.
      const dated = kept.filter((k) => k.startFrame < c.end && c.start < k.endFrame).every((k) => captureOf(doc, k.assetId) !== null);
      const own = given === undefined ? resolveTitleText(t.default[lang], t.fallback?.[lang], fieldValues, dated, { counter }) : null;
      if (own?.usedFallback && own.missing.length && !told.has('field_missing')) { told.add('field_missing'); notice('field_missing', `title ${t.key} has no value for ${own.missing.map((k) => `{${k}}`).join(', ')}; its fallback words were used`, { key: t.key, fields: own.missing }); }
      else if (own?.usedFallback && own.noDate && !told.has('field_no_date')) { told.add('field_no_date'); notice('field_no_date', `title ${t.key} shows the capture date of the picture under it, and a picture under it has no capture date; its fallback words were used`, { key: t.key }); }
      const value = given ?? own!.text;
      const text = c.suffix ? value.replaceAll('{n}', String(c.n)) : value;
      ops.push({ op: 'add_text', args: { text, start: ft(c.start), duration: ft(c.end - c.start), transform: { x: t.place.x, y: t.place.y } }, bind });
      ops.push({ op: 'apply_text_preset', args: { clipId: ref(bind), presetId: t.presetId } });
      if (t.place.sizeFrac !== undefined) ops.push({ op: 'update_text', args: { clipId: ref(bind), style: { sizeFrac: t.place.sizeFrac } } });
      if (t.anim && p.motion === 'full') {
        const total = c.end - c.start;
        let inF = t.anim.in ? Math.min(600, Math.max(1, Math.round(t.anim.inSeconds * fps)), total) : 0;
        let outF = t.anim.out ? Math.min(600, Math.max(1, Math.round(t.anim.outSeconds * fps)), total - inF) : 0;
        const inOn = !!t.anim.in && inF >= 1, outOn = !!t.anim.out && outF >= 1;
        if (!inOn) inF = 0;
        if (!outOn) outF = 0;
        if (inOn || outOn || t.anim.loop) ops.push({ op: 'set_text_animation', args: { clipId: ref(bind), animation: { by: t.anim.by, in: inOn ? t.anim.in : null, out: outOn ? t.anim.out : null, loop: t.anim.loop, inFrames: Math.max(1, inF), outFrames: Math.max(1, outF) } } });
      }
      if (own?.fields) { ops.push({ op: 'set_text_fields', args: { clipId: ref(bind), enabled: true } }); liveTitles++; }
      slots.push({ key: bind, kind: 'text', clipId: ref(bind) });
      titles++;
    }
  }
  if (titles) steps.push(`Add ${titles} title(s) in ${lang === 'he' ? 'Hebrew' : 'English'}${p.motion === 'full' ? ', animated' : ' without animation (reduced motion)'}${liveTitles ? `; ${liveTitles} show the capture date of the picture under them (live fields)` : ''}`);

  // sound effects
  let sounds = 0;
  for (const s of d.sfx) {
    let at2: number[];
    if (s.at === 'boundaries') at2 = kept.slice(1).filter((_, i) => i % (s.everyN ?? 1) === 0).map((k) => k.startFrame);
    else if (s.at === 'first') at2 = [startFrame];
    else if (s.at === 'last') at2 = [kept[lastKept]!.startFrame];
    else if ('slot' in s.at) at2 = [kept[slotAt(s.at.slot)]!.startFrame];
    else { const f = textStart.get(s.at.text); at2 = f === undefined ? [] : [f]; }
    const multi = s.at === 'boundaries';
    for (const [j, f] of at2.entries()) {
      const bind = multi ? `${s.key}--${j + 1}` : s.key;
      if (keep.has(bind)) continue;
      ops.push({ op: 'add_clip', args: { assetId: { $asset: assetKey('sfx', s.sfxId) }, start: ft(f), withLinkedAudio: false }, bind });
      if (s.gain !== undefined && s.gain !== 1) ops.push({ op: 'set_clip_gain', args: { clipId: ref(bind), gain: s.gain } });
      slots.push({ key: bind, kind: 'sound', clipId: ref(bind) });
      sounds++;
    }
  }
  if (sounds) steps.push(`Add ${sounds} sound effect(s) (${[...new Set(d.sfx.map((s) => s.sfxId))].join(', ')})`);

  // music
  if (music && !keep.has(TEMPLATE_RESERVED_BINDS.music)) {
    ops.push({ op: 'add_clip', args: { assetId: music.asset.id, start: at, sourceIn: music.sourceIn, withLinkedAudio: false }, bind: TEMPLATE_RESERVED_BINDS.music });
    ops.push({ op: 'fit_music', args: { clipId: ref(TEMPLATE_RESERVED_BINDS.music), to: ft(endFrame) } });
    slots.push({ key: TEMPLATE_RESERVED_BINDS.music, kind: 'music', clipId: ref(TEMPLATE_RESERVED_BINDS.music) });
    steps.push(`Place the music "${music.asset.name}" from ${secs(at)} (its first ${music.bars && d.music.startAt === 'first-downbeat' ? 'bar start' : d.music.startAt === 'zero' ? 'moment' : 'beat'} at ${secs(music.sourceIn)} in the file) and end it on a beat at the end of the pictures`);
  }

  // built-in music, made to measure (ADR-0022): the server makes the track; it is placed from its start for exactly as long as the pictures
  if (made && !keep.has(TEMPLATE_RESERVED_BINDS.music)) {
    assetsNeeded.push({ key: BUILTIN_MUSIC_ASSET_KEY, kind: 'music', id: made.style.id, bars: made.bars, seed: made.seed });
    ops.push({ op: 'add_clip', args: { assetId: { $asset: BUILTIN_MUSIC_ASSET_KEY }, start: at, duration: ft(made.clipFrames), withLinkedAudio: false }, bind: TEMPLATE_RESERVED_BINDS.music });
    const cut = made.trackFrames - made.clipFrames;
    const fade = cut > 0 ? Math.min(Math.round(fps), Math.floor(made.clipFrames / 2)) : 0;
    if (fade >= 1) ops.push({ op: 'set_clip_fades', args: { clipId: ref(TEMPLATE_RESERVED_BINDS.music), fadeOut: ft(fade) } });
    if (cut > 0) notice('builtin_music_faded', `the built-in music is ${made.bars} bars long, ${cut} frame(s) more than the pictures; it is cut at the last picture and fades out there instead of ending on its own last bar`, { bars: made.bars, trackFrames: made.trackFrames, clipFrames: made.clipFrames, fadeFrames: fade });
    slots.push({ key: TEMPLATE_RESERVED_BINDS.music, kind: 'music', clipId: ref(TEMPLATE_RESERVED_BINDS.music) });
    steps.push(`Make built-in music "${made.style.name.en}" (${made.style.id}, seed ${made.seed}): ${made.bars} bars at ${made.style.bpm} BPM, placed from ${secs(at)} for the length of the pictures${cut > 0 ? ', cut at the last picture with a fade-out' : '; its ending lands with the last picture'}`);
  }

  // ----- what the plan rests on -----
  if (clamped.length) basis.push(`item(s) placed at slot(s) ${clamped.join(', ')}, which are not used with this much media, were placed on the last used slot`);
  if (keep.size) warn('kept_by_hand', `${keep.size} item(s) edited by hand since the last run were kept as they are and not made again`, { keys: [...keep].sort() });
  const shape = H > W * 1.1 ? 'tall' : W > H * 1.1 ? 'wide' : 'square';
  if (shape !== d.designedFor) warn('designed_for_other_shape', `this template is designed for a ${d.designedFor} frame; this project is ${shape} (${W}×${H})`, { designedFor: d.designedFor, project: shape, width: W, height: H });
  basis.unshift(
    music ? `${music.beatCount} measured beats of "${music.asset.name}" (${bpmText}, confidence ${music.confidence ?? 'n/a'}${music.edited ? ', corrected by hand' : ''}${music.bars ? ', with bar starts' : ''}); method: ${music.method}`
      : made ? `built-in music "${made.style.name.en}" (${made.style.id}): ${made.style.bpm} beats a minute, four beats to a bar; its beats and bars are known from its recipe, nothing was measured`
      : `no music: a steady grid of ${d.tempo.fallbackBpm} beats a minute from the template, four beats to a bar`,
    `${media.length} chosen picture(s) or video(s), ${kept.length} slot(s) used of ${d.slots.length}; ${rate.num}/${rate.den} frames a second; cuts at least ${gap} frames apart`,
  );
  if (ops.length === 0) throw new TemplateError('nothing_to_do', 'every item of this template was edited by hand since the last run; there is nothing to make again');
  if (ops.length > MAX_TEMPLATE_OPS) throw new TemplateError('invalid_args', `this plan would need ${ops.length} operations; at most ${MAX_TEMPLATE_OPS} fit in one step`, 'Use fewer media or a shorter template.');
  if (slots.length > 400) throw new TemplateError('invalid_args', `this plan would record ${slots.length} slots; a run holds at most 400`);

  const alternatives: TemplatePlan['alternatives'] = [
    ...(['normal', 'half', 'double'] as const).filter((t) => t !== p.tempo).map((t) => ({ label: t === 'half' ? 'Half tempo: slots twice as long' : t === 'double' ? 'Double tempo: slots half as long' : 'Normal tempo', params: { tempo: t } })),
    p.order === 'shuffle' ? { label: 'Media in the order chosen', params: { order: 'sequence' as const } } : { label: 'Shuffle the media', params: { order: 'shuffle' as const, seed: p.seed + 1 } },
    p.motion === 'full' ? { label: 'No camera moves or animated titles (reduced motion)', params: { motion: 'none' as const } } : { label: 'With camera moves and animated titles', params: { motion: 'full' as const } },
  ];
  const predicted: PredictedSlot[] = kept.map((s) => ({ key: s.key, startFrame: s.startFrame, frames: s.endFrame - s.startFrame, assetId: s.assetId, sourceInFrame: s.sourceInFrame, cropShare: s.cropShare }));
  const clip = (s: string) => (s.length > 400 ? `${s.slice(0, 399)}…` : s);
  return {
    templateId: d.id, version: d.version, params: p,
    steps: steps.slice(0, MAX_STEPS).map(clip), basis: basis.slice(0, MAX_STEPS).map(clip), warnings, notices, blocking, alternatives, assetsNeeded, ops, slots,
    predicted: { startFrame, endFrame, boundaries: [startFrame, ...kept.map((s) => s.endFrame)], gapFrames: gap, slots: predicted },
  };
}
