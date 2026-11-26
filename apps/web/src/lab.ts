/**
 * Lab page: every registered effect, blend mode, mask and transition drawn by the shared evaluate + drawGraph.
 * No server data. Pictures are generated here; the in-memory project goes through the real ops.
 */
import './lab.css';
import './strictPage.ts';
import * as T from '@pulseframe/time';
import { applyTransaction, BLEND_MODES, createProject, DEFAULT_MASK, describeCatalog, EFFECTS, LIVING_BUILT, opOnlyEffect, TRANSITIONS, type ClipDepth, type Mask, type TransitionDef, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { drawGraph, evaluate, gpuStatus, initGpu, placedArea, type DrawOptions, type FrameImage } from '@pulseframe/engine';
import { ensureFonts } from './fonts.ts';
import { pictureSize } from './pictureSize.ts';

const lang: 'he' | 'en' = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'he';
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
const S = {
  he: {
    title: 'מעבדת מראה', what: 'דף סקירה: כל אפקט, מצב מיזוג, מסכה ומעבר רשומים במערכת, כפי שהם נראים בפועל.', same: 'כל אריח מצויר על ידי אותו מַרכֵּב (compositor) שמשמש לתצוגה מקדימה ולייצוא.',
    effects: 'אפקטים', blends: 'מצבי מיזוג', masks: 'מסכות', transitions: 'מעברים', entries: 'רשומות', errors: 'שגיאות',
  },
  en: {
    title: 'Look Lab', what: 'A review page: every registered effect, blend mode, mask and transition as it actually renders.', same: 'Every tile is drawn by the same compositor used for preview and export.',
    effects: 'Effects', blends: 'Blend modes', masks: 'Masks', transitions: 'Transitions', entries: 'entries', errors: 'errors',
  },
}[lang];

type Aspect = '16:9' | '9:16';
const RATE = { num: 30, den: 1 };
const SIZE: Record<Aspect, [number, number]> = { '16:9': [640, 360], '9:16': [360, 640] };
const f = (n: number) => T.frameTime(n, RATE);
let seq = 0;
type Step = { doc: ProjectDocument; out: Record<string, any>[] };
const step = (doc: ProjectDocument, ops: OpCall[], allowInternal = false): Step => {
  const r = applyTransaction(doc, ops, { idSeed: `lab${seq++}_`, actor: 'lab', allowInternal });
  return { doc: r.doc, out: r.results.map((x) => x.output ?? {}) };
};

// ---- test pictures ----
function paint(w: number, h: number, variant: 'a' | 'b'): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  const s = Math.min(w, h) / 360;
  const grad = g.createLinearGradient(0, 0, w, h);
  if (variant === 'a') { grad.addColorStop(0, '#ff3b6b'); grad.addColorStop(0.35, '#ffb400'); grad.addColorStop(0.65, '#19c37d'); grad.addColorStop(1, '#2a6cff'); }
  else { grad.addColorStop(0, '#0b1d3a'); grad.addColorStop(0.5, '#7a2cff'); grad.addColorStop(1, '#ffd23f'); }
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // fine lines
  g.strokeStyle = variant === 'a' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)';
  g.lineWidth = 1;
  for (let i = 0; i < 40; i++) { g.beginPath(); const x = (w * i) / 40; g.moveTo(x, 0); g.lineTo(variant === 'a' ? x : w - x, h * 0.25); g.stroke(); }
  // shapes
  g.fillStyle = variant === 'a' ? '#ffffff' : '#101010';
  g.fillRect(w * 0.06, h * 0.55, w * 0.22, h * 0.14);
  g.beginPath(); g.moveTo(w * 0.75, h * 0.52); g.lineTo(w * 0.93, h * 0.72); g.lineTo(w * 0.57, h * 0.72); g.closePath(); g.fill();
  if (variant === 'b') { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#fff' : '#000'; g.fillRect(w * 0.06 + i * 8 * s, h * 0.78 + j * 2.5 * s, 8 * s, 2.5 * s); } }
  // face-like circle
  const cx = w / 2, cy = h * 0.4, r = Math.min(w, h) * 0.17;
  g.fillStyle = variant === 'a' ? '#f2c9a0' : '#9fe0c8'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#222'; for (const dx of [-0.38, 0.38]) { g.beginPath(); g.arc(cx + dx * r, cy - 0.2 * r, r * 0.1, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#222'; g.lineWidth = Math.max(2, r * 0.06); g.beginPath(); g.arc(cx, cy + 0.05 * r, r * 0.55, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  // text
  g.fillStyle = variant === 'a' ? '#ffffff' : '#ffe9a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 4;
  g.font = `700 ${Math.round(Math.min(w, h) * 0.1)}px Heebo`;
  g.fillText(variant === 'a' ? 'שלום עולם' : 'בוקר טוב', cx, h * 0.84);
  g.font = `400 ${Math.round(Math.min(w, h) * 0.065)}px Heebo`;
  g.fillText(variant === 'a' ? 'PULSEFRAME 0123' : 'Lab picture B', cx, h * 0.93);
  g.shadowBlur = 0;
  return c;
}

interface Scene { aspect: Aspect; w: number; h: number; base: ProjectDocument; a: string; b: string; v1: string; v2: string; pics: Map<string, OffscreenCanvas> }
function makeScene(aspect: Aspect): Scene {
  const [w, h] = SIZE[aspect];
  const [pw, ph] = aspect === '16:9' ? [1280, 720] : [720, 1280];
  const asset = (name: string, hash: string) => ({
    kind: 'image' as const, name, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1),
    image: { width: pw, height: ph, codec: 'png', hasAlpha: false },
    provenance: { origin: 'fixture' as const, importedAt: '2026-01-01T00:00:00Z', importedBy: 'lab' },
  });
  let s = step(createProject({ id: 'prj_lab', name: 'Lab', width: w, height: h, frameRate: RATE }), [
    { op: 'import_asset', args: { asset: asset('lab-a', aspect === '16:9' ? 'a' : 'c') } },
    { op: 'import_asset', args: { asset: asset('lab-b', aspect === '16:9' ? 'b' : 'd') } },
    { op: 'add_track', args: { kind: 'video', name: 'V2' } },
  ], true);
  const [a, b] = [s.out[0]!.assetId as string, s.out[1]!.assetId as string];
  const seqd = s.doc.sequences[s.doc.mainSequenceId]!;
  const v1 = seqd.tracks.find((t) => t.kind === 'video')!.id;
  const v2 = s.out[2]!.trackId as string;
  const pics = new Map([[a, paint(pw, ph, 'a')], [b, paint(pw, ph, 'b')]]);
  return { aspect, w, h, base: s.doc, a, b, v1, v2, pics };
}

// ---- tile building ----
interface Tile { kind: 'effect' | 'blend' | 'mask' | 'transition'; id: string; variant: string; aspect: Aspect; params: unknown; build: (s: Scene) => { doc: ProjectDocument; frame: number }; strip?: boolean; /** Not built in this build: drawn without the effect and labelled so (an honest unavailable tile). */ pending?: string }
const clipOps = (s: Scene, assetId: string, trackId: string, start = 0, dur = 150) => ({ op: 'add_clip', args: { assetId, trackId, start: f(start), duration: f(dur), withLinkedAudio: false } }) as OpCall;

function withClip(s: Scene, extra: (clipId: string) => OpCall[], base = false) {
  let st: Step = { doc: s.base, out: [] };
  if (base) st = step(st.doc, [clipOps(s, s.b, s.v1)]);
  st = step(st.doc, [clipOps(s, s.a, base ? s.v2 : s.v1)]);
  const clipId = st.out[0]!.clipId as string;
  return step(st.doc, extra(clipId)).doc;
}

const numericExtreme = (type: string): Record<string, number> => {
  const props = (describeCatalog().effects.find((e) => e.id === type)!.paramsSchema as any).properties as Record<string, { type: string; maximum?: number }>;
  const o: Record<string, number> = {};
  for (const [k, p] of Object.entries(props)) if ((p.type === 'number' || p.type === 'integer') && p.maximum !== undefined) o[k] = p.maximum;
  const over: Record<string, Record<string, number>> = {
    'color.adjust': { brightness: 1.5, contrast: 2, saturation: 3, hue: 120 },
    'light.vignette': { amount: 1, size: 0 },
    'stylize.grain': { amount: 1 },
    'digital.rgb-split': { amount: 0.05, angle: 45 },
    'stylize.shadow': { opacity: 1, blur: 0.03, x: 0.05, y: 0.05 },
  };
  const r = { ...o, ...(over[type] ?? {}) };
  delete r.seed;
  if (type === 'stylize.grain') delete r.seed;
  return r;
};

const tiles: Tile[] = [];
const catalog = describeCatalog();
/**
 * A time effect changes only what moves (ADR-0011): its clip slides across the frame (keyframed x, 0.4 of the width a second)
 * and is drawn at frame 17, so echo, time split, shutter and stutter each show, and their default and extreme settings differ.
 */
const TIME_FRAME = 17;
const moving = (c: string): OpCall[] => [
  { op: 'set_keyframe', args: { clipId: c, property: 'x', time: f(0), value: -0.2 } },
  { op: 'set_keyframe', args: { clipId: c, property: 'x', time: f(30), value: 0.2 } },
];
/**
 * «תמונה חיה» (wave 8 living, verifier C4): an effect only its own op adds is tiled through that op, on a drawn depth (a flat base and
 * one near dab), at a late frame of its 150-frame clip so the move shows. Until the feature is built the tile shows the photo without
 * it and says so.
 */
const LAB_DEPTH: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 250, pts: [500, 450] }] };
const LIVING_FRAME = 120;
const opOnlyTileOps = (c: string, params: Record<string, unknown>): OpCall[] => [
  { op: 'set_clip_depth', args: { clipId: c, depth: LAB_DEPTH } },
  ...(LIVING_BUILT ? [{ op: 'set_living_picture', args: { clipId: c, ...(typeof params.move === 'string' ? { move: params.move } : {}), ...(typeof params.amount === 'number' ? { amount: params.amount } : {}) } }] : []),
];
for (const e of EFFECTS) {
  const defaults = catalog.effects.find((x) => x.id === e.id)!.defaults;
  if (opOnlyEffect(e.id)) {
    for (const aspect of ['16:9', '9:16'] as const) for (const [variant, params] of [['default', {}], ['extreme', { amount: 1 }]] as const)
      tiles.push({ kind: 'effect', id: e.id, variant, aspect, params: { ...defaults, ...params }, build: (s) => ({ doc: withClip(s, (c) => opOnlyTileOps(c, params)), frame: LIVING_FRAME }), ...(LIVING_BUILT ? {} : { pending: 'not built in this build yet' }) });
    continue;
  }
  const time = e.category === 'time';
  for (const aspect of ['16:9', '9:16'] as const) {
    const variants: [string, Record<string, unknown>, number][] = [['default', {}, time ? TIME_FRAME : 0], ['extreme', numericExtreme(e.id), time ? TIME_FRAME : 0]];
    if (e.id === 'stylize.grain') variants.push(['default frame 1', {}, 1], ['default frame 2', {}, 2]);
    for (const [variant, params, frame] of variants) {
      tiles.push({ kind: 'effect', id: e.id, variant, aspect, params: { ...defaults, ...params }, build: (s) => ({ doc: withClip(s, (c) => [...(e.id === 'stylize.shadow' ? [{ op: 'set_clip_transform', args: { clipId: c, transform: { scale: 0.7 } } }] : []), ...(time ? moving(c) : []), { op: 'add_effect', args: { clipId: c, type: e.id, params } }], e.id === 'stylize.shadow'), frame }) });
    }
  }
}
for (const mode of BLEND_MODES) tiles.push({ kind: 'blend', id: mode, variant: 'A over B', aspect: '16:9', params: { mode }, build: (s) => ({ doc: withClip(s, (c) => [{ op: 'set_clip_blend', args: { clipId: c, mode } }], true), frame: 0 }) });
const maskVariants: [string, Partial<Mask>][] = [
  ['rect', { width: 0.6, height: 0.6 }], ['rounded rect', { width: 0.6, height: 0.6, radius: 0.5 }], ['ellipse', { shape: 'ellipse', width: 0.7, height: 0.7 }],
  ['feathered', { shape: 'ellipse', width: 0.7, height: 0.7, feather: 0.08 }], ['inverted', { shape: 'ellipse', width: 0.5, height: 0.5, invert: true }],
];
for (const [variant, m] of maskVariants) {
  const mask = { ...DEFAULT_MASK, ...m };
  tiles.push({ kind: 'mask', id: 'mask', variant, aspect: '16:9', params: mask, build: (s) => ({ doc: withClip(s, (c) => [{ op: 'set_clip_mask', args: { clipId: c, mask: m } }], true), frame: 0 }) });
}
const TFRAMES = 15;
const OFFSETS = [1, 4, 7, 10, 13];
/**
 * Transitions whose picture depends on the frame's shape (a whip pan moves a strip of the frame, a spin zooms about its centre,
 * a heart or star must cover all four corners, a page turns about its edge) are drawn in both shapes: the registry says which
 * (TransitionDef.shapeDependent, ADR-0012).
 */
for (const tr of TRANSITIONS as readonly TransitionDef[]) for (const aspect of tr.shapeDependent ? (['16:9', '9:16'] as const) : (['16:9'] as const)) {
  OFFSETS.forEach((off, i) => tiles.push({
    kind: 'transition', id: tr.id, variant: `step ${i + 1}/5 (frame +${off} of ${TFRAMES})`, aspect, params: { frames: TFRAMES }, strip: true,
    build: (s) => {
      const a = step(s.base, [clipOps(s, s.a, s.v1, 0, 60), clipOps(s, s.b, s.v1, 60, 60)]);
      const clipId = a.out[1]!.clipId as string;
      return { doc: step(a.doc, [{ op: 'set_transition', args: { clipId, type: tr.id, frames: TFRAMES } }]).doc, frame: 60 + off };
    },
  }));
}

// ---- page ----
const root = document.getElementById('root')!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {}, ...kids: (Node | string)[]) => {
  const { dataset, ...rest } = props as any;
  const n = Object.assign(document.createElement(tag), rest);
  Object.entries(dataset ?? {}).forEach(([k, v]) => (n.dataset[k] = v as string));
  n.append(...kids);
  return n as HTMLElementTagNameMap[K];
};
const counts = { effects: EFFECTS.length, blends: BLEND_MODES.length, transitions: TRANSITIONS.length };
const header = el('header', {}, el('h1', { textContent: S.title }), el('p', { textContent: S.what }), el('p', { textContent: S.same }),
  el('p', { dataset: { testid: 'lab-summary', effects: String(counts.effects), blends: String(counts.blends), transitions: String(counts.transitions) }, textContent: `${S.effects}: ${counts.effects} · ${S.blends}: ${counts.blends} · ${S.masks}: ${maskVariants.length} · ${S.transitions}: ${counts.transitions} (${S.entries})` }));
root.append(header);
const grids = {} as Record<Tile['kind'], HTMLElement>;
for (const [kind, title] of [['effect', S.effects], ['blend', S.blends], ['mask', S.masks], ['transition', S.transitions]] as const) {
  root.append(el('h2', { textContent: title, dataset: { kind } }));
  grids[kind] = el('div', { className: 'grid', dataset: { kind } });
  root.append(grids[kind]);
}
const name = (t: Tile) => (t.kind === 'effect' ? EFFECTS.find((e) => e.id === t.id)!.name[lang] : t.kind === 'transition' ? TRANSITIONS.find((x) => x.id === t.id)!.name[lang] : '');

async function main() {
  await ensureFonts();
  const scenes: Record<Aspect, Scene> = { '16:9': makeScene('16:9'), '9:16': makeScene('9:16') };
  let errors = 0;
  await initGpu(); // GPU effects are drawn for real when this browser has a working adapter, and labelled as unavailable otherwise
  for (const tile of tiles) {
    const s = scenes[tile.aspect];
    const [w, h] = SIZE[tile.aspect];
    const canvas = el('canvas', { width: w, height: h });
    const cap = el('figcaption', {}, el('b', { textContent: `${tile.id}${name(tile) ? ` (${name(tile)})` : ''}` }), ` · ${tile.variant} · ${tile.aspect}`, el('br'), JSON.stringify(tile.params));
    const fig = el('figure', { className: tile.strip ? 'strip' : '', dataset: { testid: 'lab-tile', kind: tile.kind, id: tile.id, variant: tile.variant, aspect: tile.aspect } }, canvas, cap);
    grids[tile.kind].append(fig);
    try {
      const { doc, frame } = tile.build(s);
      const g = evaluate(doc, f(frame));
      const provider = async (l: { assetId: string }): Promise<FrameImage | null> => {
        const pic = s.pics.get(l.assetId);
        return pic ? { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(pic, dx, dy, dw, dh) } : null;
      };
      const { missing, unavailableEffects } = await drawGraph(canvas.getContext('2d')!, g, provider);
      if (missing.length) throw new Error(`source picture missing for ${missing.join(', ')}`);
      // Not an error of the page: this browser cannot run the effect, so the tile shows the picture without it and says so.
      if (tile.pending) { fig.dataset.unavailable = '1'; cap.before(el('div', { className: 'tile-note', role: 'note', textContent: tile.pending })); }
      else if (unavailableEffects.length) { fig.dataset.unavailable = '1'; cap.before(el('div', { className: 'tile-note', role: 'note', textContent: `needs a graphics adapter (WebGPU): ${gpuStatus().reason}` })); }
    } catch (e) {
      errors++;
      cap.before(el('div', { className: 'tile-error', role: 'alert', textContent: e instanceof Error ? e.message : String(e) }));
    }
  }
  if (errors) document.body.dataset.errors = String(errors);
  document.body.dataset.ready = '1';
}
// ---- cost of the Canvas2D transitions (lab.html?bench=transitions; recorded by proof:trend-transitions T8, ADR-0012) ----
/** What the bench measured: per id, the time drawGraph takes for each frame of a 29-frame transition at 1080×1920. */
export interface LabBench { size: string; frames: number; raster: string; results: Record<string, { medianMs: number; meanMs: number; maxMs: number }> }
/**
 * Draws frames 60…88 (a 29-frame transition between two generated 1080×1920 pictures) with the same evaluate + drawGraph as
 * the render worker, on a canvas kept on the CPU raster path as the render page keeps it, once per transition id and once
 * with no transition (the cost of the plain layers), and times each frame including a one-pixel read-back (so the drawing
 * is really done). Diagnostics only: nothing is stored; the numbers go to window.__pfLabBench.
 */
async function benchTransitions(ids: readonly string[]): Promise<LabBench> {
  await ensureFonts();
  const W = 1080, H = 1920, N = 29;
  const asset = (name: string, hash: string) => ({
    kind: 'image' as const, name, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1),
    image: { width: W, height: H, codec: 'png', hasAlpha: false },
    provenance: { origin: 'fixture' as const, importedAt: '2026-01-01T00:00:00Z', importedBy: 'lab' },
  });
  const s0 = step(createProject({ id: 'prj_lab_bench', name: 'Lab bench', width: W, height: H, frameRate: RATE }), [{ op: 'import_asset', args: { asset: asset('bench-a', 'e') } }, { op: 'import_asset', args: { asset: asset('bench-b', 'f') } }], true);
  const [a, b] = [s0.out[0]!.assetId as string, s0.out[1]!.assetId as string];
  const v1 = s0.doc.sequences[s0.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
  const pics = new Map([[a, paint(W, H, 'a')], [b, paint(W, H, 'b')]]);
  const s1 = step(s0.doc, [{ op: 'add_clip', args: { assetId: a, trackId: v1, start: f(0), duration: f(60), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: b, trackId: v1, start: f(60), duration: f(60), withLinkedAudio: false } }]);
  const clipId = s1.out[1]!.clipId as string;
  const canvas = el('canvas', { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false, colorSpace: 'srgb' })!;
  const provider = async (l: { assetId: string }): Promise<FrameImage | null> => { const pic = pics.get(l.assetId); return pic ? { draw: (c, dx, dy, dw, dh) => c.drawImage(pic, dx, dy, dw, dh) } : null; };
  const results: LabBench['results'] = {};
  for (const id of ['none', ...ids]) {
    const doc = id === 'none' ? s1.doc : step(s1.doc, [{ op: 'set_transition', args: { clipId, type: id, frames: N } }]).doc;
    await drawGraph(ctx, evaluate(doc, f(59)), provider); // warm-up: the pictures and the scratch buffers of this size exist from here on
    const ms: number[] = [];
    for (let k = 60; k < 60 + N; k++) {
      const t0 = performance.now();
      const r = await drawGraph(ctx, evaluate(doc, f(k)), provider);
      ctx.getImageData(0, 0, 1, 1);
      ms.push(performance.now() - t0);
      if (r.missing.length || r.unavailableEffects.length) throw new Error(`${id}: frame ${k} could not be drawn`);
    }
    const sorted = [...ms].sort((x, y) => x - y);
    results[id] = { medianMs: +sorted[Math.floor(N / 2)]!.toFixed(2), meanMs: +(ms.reduce((x, y) => x + y, 0) / N).toFixed(2), maxMs: +sorted[N - 1]!.toFixed(2) };
  }
  return { size: `${W}x${H}`, frames: N, raster: 'canvas 2d, willReadFrequently (the render page\'s CPU raster path)', results };
}


// ---- opacity and dissolve at both qualities (lab.html?bench=opacity; driven by conformance:opacity, ADR-0005 amendment) ----
/**
 * What conformance:opacity asks this page for, on window.__pfLabOpacity. The draft picture is drawn only by the player while it
 * plays, never by a still, so the checks of the draft quality draw here with the same evaluate + drawGraph the player uses.
 * - frame(kind, value, quality): one 256×256 frame as packed RGB in base64. The bottom picture has R = x, G = y, the top one
 *   R = y, G = x (B mixes both), so a frame puts every (backdrop, source) byte pair through the composite. kind 'opacity:<blend>'
 *   draws the top clip at opacity `value` with that blend over the bottom one; 'dissolve' and 'dissolve-reveal' draw frame
 *   `value` of a 21-frame dissolve from the bottom picture to the top one (one track), or revealing the top one over the
 *   bottom one on the track below; the progress of that frame is returned with it.
 * - fadeArea(): for faded pictures placed at many sizes, positions and angles, the full picture with the fill limited to the
 *   placed box against the fill of the whole buffer (DrawOptions.fadeArea, diagnostics): differing bytes per placement.
 * Diagnostics only: nothing is stored.
 */
export interface LabOpacity {
  frame(kind: string, value: number, quality: 'draft' | 'full'): Promise<{ rgb: string; progress?: number }>;
  fadeArea(): Promise<{ placement: string; size: string; bytes: number; differing: number; filledShare: number }[]>;
}
function opacityBench(): LabOpacity {
  const N = 256;
  const image = (name: string, hash: string, w: number, h: number) => ({
    kind: 'image' as const, name, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO,
    image: { width: w, height: h, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-01-01T00:00:00Z', importedBy: 'lab' },
  });
  const pattern = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => { const id = new ImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const [r, g, b] = f(x, y); id.data[i] = r; id.data[i + 1] = g; id.data[i + 2] = b; id.data[i + 3] = 255; } return createImageBitmap(id); };
  const pics = new Map<string, Promise<ImageBitmap>>();
  const provider = async (l: { assetId: string }): Promise<FrameImage | null> => { const p = pics.get(l.assetId); const b = p ? await p : null; return b ? { draw: (c, dx, dy, dw, dh) => c.drawImage(b, dx, dy, dw, dh) } : null; };
  /** Two pictures as assets of a new project of the given size, with the bitmaps registered for the provider. */
  const project = (W: number, H: number, a: [number, number, (x: number, y: number) => [number, number, number]], b: [number, number, (x: number, y: number) => [number, number, number]]) => {
    const s0 = step(createProject({ id: 'prj_lab_opacity', name: 'Lab opacity', width: W, height: H, frameRate: RATE }), [{ op: 'import_asset', args: { asset: image('o-a', 'c', a[0], a[1]) } }, { op: 'import_asset', args: { asset: image('o-b', 'd', b[0], b[1]) } }], true);
    const [ia, ib] = [s0.out[0]!.assetId as string, s0.out[1]!.assetId as string];
    pics.set(ia, pattern(...a)); pics.set(ib, pattern(...b));
    return { doc: s0.doc, a: ia, b: ib, v1: s0.doc.sequences[s0.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id };
  };
  const bottom: [number, number, (x: number, y: number) => [number, number, number]] = [N, N, (x, y) => [x, y, (x * 7 + y * 13) & 255]];
  const top: [number, number, (x: number, y: number) => [number, number, number]] = [N, N, (x, y) => [y, x, (x * 11 + y * 5) & 255]];
  const canvas = el('canvas', { width: N, height: N });
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false, colorSpace: 'srgb' })!;
  const rgbOf = (c: CanvasRenderingContext2D, w: number, h: number) => { const d = c.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 3); for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]!; out[j + 1] = d[i + 1]!; out[j + 2] = d[i + 2]!; } let bin = ''; for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000)); return btoa(bin); };
  const scenes = new Map<string, { doc: ProjectDocument; clipId: string }>();
  const sceneOf = (kind: string) => {
    let sc = scenes.get(kind);
    if (sc) return sc;
    const p = project(N, N, bottom, top);
    if (kind.startsWith('opacity:')) {
      const s1 = step(p.doc, [{ op: 'add_clip', args: { assetId: p.a, trackId: p.v1, start: f(0), duration: f(30), withLinkedAudio: false } }, { op: 'add_track', args: { kind: 'video' } }]);
      const s2 = step(s1.doc, [{ op: 'add_clip', args: { assetId: p.b, trackId: s1.out[1]!.trackId as string, start: f(0), duration: f(30), withLinkedAudio: false } }]);
      const clipId = s2.out[0]!.clipId as string, blend = kind.slice('opacity:'.length);
      sc = { doc: blend === 'normal' ? s2.doc : step(s2.doc, [{ op: 'set_clip_blend', args: { clipId, mode: blend } }]).doc, clipId };
    } else {
      const reveal = kind === 'dissolve-reveal';
      const s1 = step(p.doc, [{ op: 'add_clip', args: { assetId: p.a, trackId: p.v1, start: f(0), duration: f(reveal ? 60 : 30), withLinkedAudio: false } }, ...(reveal ? [{ op: 'add_track', args: { kind: 'video' } } as OpCall] : [])]);
      const trackId = reveal ? (s1.out[1]!.trackId as string) : p.v1;
      const s2 = step(s1.doc, [{ op: 'add_clip', args: { assetId: p.b, trackId, start: f(30), duration: f(30), withLinkedAudio: false } }]);
      const clipId = s2.out[0]!.clipId as string;
      sc = { doc: step(s2.doc, [{ op: 'set_transition', args: { clipId, type: 'dissolve', frames: 21 } }]).doc, clipId };
    }
    scenes.set(kind, sc);
    return sc;
  };
  return {
    async frame(kind, value, quality) {
      const sc = sceneOf(kind);
      const doc = kind.startsWith('opacity:') ? step(sc.doc, [{ op: 'set_clip_transform', args: { clipId: sc.clipId, transform: { opacity: value } } }]).doc : sc.doc;
      const g = evaluate(doc, f(kind.startsWith('opacity:') ? 5 : value));
      const r = await drawGraph(ctx, g, provider, { quality });
      if (r.missing.length || r.unavailableEffects.length) throw new Error(`${kind} ${value}: could not be drawn`);
      const inc = g.layers.find((l) => l.kind !== 'caption' && l.kind !== 'adjust' && l.transition?.role === 'in');
      return { rgb: rgbOf(ctx, N, N), ...(inc && inc.kind !== 'caption' && inc.kind !== 'adjust' && inc.transition ? { progress: inc.transition.progress } : {}) };
    },
    async fadeArea() {
      const out: Awaited<ReturnType<LabOpacity['fadeArea']>> = [];
      // a 400×300 picture (another shape than the frame: contain leaves bars) with fine detail, over a full-frame one
      const detail = (x: number, y: number): [number, number, number] => [(x * 5 + y * 3) & 255, (x * y) & 255, ((x ^ y) * 7) & 255];
      const PLACEMENTS: [string, Record<string, number>, string?, boolean?][] = [
        ['scale 0.5, centred', { scale: 0.5 }], ['scale 0.37, rotated 17°, moved', { scale: 0.37, rotation: 17, x: 0.1, y: -0.2 }],
        ['scale 0.8, half off the right edge', { scale: 0.8, x: 0.45 }], ['scale 1.3 (larger than the frame)', { scale: 1.3 }],
        ['scale 0.6, rotated 90°', { scale: 0.6, rotation: 90 }], ['scale 0.05', { scale: 0.05, x: -0.3, y: 0.3 }],
        ['scale 0.7, rotated 45°, low', { scale: 0.7, rotation: 45, y: 0.4 }], ['scale 0.333, rotated -33.3°, at a fractional place', { scale: 0.333, rotation: -33.3, x: 0.1234, y: 0.0567 }],
        ['scale 0.5, multiply, a blur and a mask after the fade', { scale: 0.5, rotation: 8 }, 'multiply', true],
      ];
      for (const [W, H] of [[640, 360], [360, 640], [1920, 1080]] as const) {
        const p = project(W, H, [W, H, (x, y) => [(x * 3) & 255, (y * 5) & 255, (x + y) & 255]], [400, 300, detail]);
        const s1 = step(p.doc, [{ op: 'add_clip', args: { assetId: p.a, trackId: p.v1, start: f(0), duration: f(30), withLinkedAudio: false } }, { op: 'add_track', args: { kind: 'video' } }]);
        const s2 = step(s1.doc, [{ op: 'add_clip', args: { assetId: p.b, trackId: s1.out[1]!.trackId as string, start: f(0), duration: f(30), withLinkedAudio: false } }]);
        const clipId = s2.out[0]!.clipId as string;
        const c = el('canvas', { width: W, height: H }).getContext('2d', { willReadFrequently: true, alpha: false, colorSpace: 'srgb' })!;
        for (const [name, transform, blend, extras] of PLACEMENTS) for (const opacity of [0.3, 0.77]) {
          let doc = step(s2.doc, [{ op: 'set_clip_transform', args: { clipId, transform: { ...transform, opacity } } }]).doc;
          if (blend) doc = step(doc, [{ op: 'set_clip_blend', args: { clipId, mode: blend } }]).doc;
          if (extras) doc = step(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'set_clip_mask', args: { clipId, mask: { ...DEFAULT_MASK, shape: 'ellipse', width: 0.6, height: 0.6 } } }]).doc;
          const g = evaluate(doc, f(5));
          const draw = async (fadeArea: DrawOptions['fadeArea']) => { const r = await drawGraph(c, g, provider, { quality: 'full', fadeArea }); if (r.missing.length || r.unavailableEffects.length) throw new Error(`${name}: could not be drawn`); return c.getImageData(0, 0, W, H).data; };
          const box = await draw('box'), frame = await draw('frame');
          let differing = 0;
          for (let i = 0; i < box.length; i++) if (box[i] !== frame[i]) differing++;
          const top = g.layers.filter((l) => l.kind === 'image')[1];
          const area = top && top.kind === 'image' ? placedArea(g, top) : undefined;
          out.push({ placement: `${name}, opacity ${opacity}`, size: `${W}x${H}`, bytes: box.length, differing, filledShare: area ? +((area.w * area.h) / (W * H)).toFixed(3) : 1 });
        }
      }
      return out;
    },
  };
}

// ---- what a playing frame costs (lab.html?bench=playback; driven by pnpm bench:playback, ADR-0005 amendment) ----
/**
 * What bench:playback asks this page for, on window.__pfLabPlayback. Diagnostics only: nothing is stored.
 * - frames(spec): a project of `project` size with `opaque` clips at full opacity and, above them, `faded` clips at opacity
 *   0.6, one per track, every one fitted to the frame. Each frame is drawn the way the player's pump draws it: evaluate, then
 *   drawGraph onto an off-screen canvas of `size` (default: the player's own rule for a playing picture, pictureSize) with
 *   { alpha: false }, then one copy onto the visible canvas of that size, which the page scales to its layout. Timed per
 *   frame, with a one-pixel read-back of the visible canvas so that the drawing is really done. The pictures are given at
 *   `sourceSize`, as 'video' (a new I420 VideoFrame per frame and layer, BT.709 limited range: what the decoder gives for a
 *   proxy) or as 'bitmap' (an ImageBitmap: what a photo is), while the clips' assets are declared at `declared` size (default:
 *   the project's), as a proxy stands in for its original.
 * - raw(spec): no compositor, only `layers` drawImage calls of such pictures onto an { alpha: false } canvas of `size` with
 *   the given smoothing ('off': imageSmoothingEnabled = false), each filling the canvas. Where the time of one layer goes.
 */
export interface LabPlaybackTiming { size: string; frames: number; medianMs: number; minMs: number; maxMs: number }
export interface LabPlayback {
  frames(spec: { project: [number, number]; size?: [number, number]; source: 'video' | 'bitmap'; sourceSize: [number, number]; declared?: [number, number]; opaque: number; faded: number; quality?: 'draft' | 'full'; frames?: number }): Promise<LabPlaybackTiming & { quality: string }>;
  raw(spec: { size: [number, number]; source: 'video' | 'bitmap'; sourceSize: [number, number]; layers: number; smoothing: 'high' | 'medium' | 'low' | 'off'; frames?: number }): Promise<LabPlaybackTiming>;
}
function playbackBench(): LabPlayback {
  const WARM = 3;
  /** Planes of an I420 picture with some detail (a gradient and a pattern), different per layer. */
  const planes = (w: number, h: number, seed: number) => { const cw = (w + 1) >> 1, ch = (h + 1) >> 1, b = new Uint8Array(w * h + 2 * cw * ch); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[y * w + x] = 16 + (((x * 219) / w + ((x ^ y) & 31) + seed * 23) % 220); for (let i = w * h; i < b.length; i++) b[i] = 64 + ((i * 7 + seed * 31) & 127); return b; };
  const videoFrame = (b: Uint8Array, w: number, h: number) => new VideoFrame(b, { format: 'I420', codedWidth: w, codedHeight: h, timestamp: 0, colorSpace: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false } });
  const bitmap = (w: number, h: number, seed: number) => { const id = new ImageData(w, h); for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) { id.data[i] = ((x * 255) / w + seed * 40) & 255; id.data[i + 1] = (y * 255) / h; id.data[i + 2] = ((x ^ y) * 5 + seed * 70) & 255; id.data[i + 3] = 255; } return createImageBitmap(id); };
  /** `n` pictures of one kind and size: draw(k) is picture k for the frame being drawn; next() makes the pictures of the next frame (outside the timing). */
  const pictures = async (kind: 'video' | 'bitmap', [w, h]: [number, number], n: number) => {
    if (kind === 'bitmap') { const bs = await Promise.all(Array.from({ length: n }, (_, k) => bitmap(w, h, k))); return { next() {}, at: (k: number): CanvasImageSource => bs[k]!, close() { for (const b of bs) b.close(); } }; }
    const data = Array.from({ length: n }, (_, k) => planes(w, h, k));
    let now: VideoFrame[] = [];
    return { next() { for (const f of now) f.close(); now = data.map((b) => videoFrame(b, w, h)); }, at: (k: number): CanvasImageSource => now[k]!, close() { for (const f of now) f.close(); now = []; } };
  };
  const timing = (ms: number[], size: [number, number]): LabPlaybackTiming => { const t = ms.slice(WARM), sorted = [...t].sort((a, b) => a - b); return { size: `${size[0]}x${size[1]}`, frames: t.length, medianMs: +sorted[Math.floor(t.length / 2)]!.toFixed(2), minMs: +sorted[0]!.toFixed(2), maxMs: +sorted[t.length - 1]!.toFixed(2) }; };
  /** A visible canvas of this size, shown as the editor shows its preview: scaled by the page to its layout. */
  const visible = ([w, h]: [number, number]) => { const c = el('canvas', { width: w, height: h }); c.style.cssText = `display:block;inline-size:min(100%, ${Math.round((540 * w) / h)}px);aspect-ratio:${w} / ${h}`; root.replaceChildren(c); return c; };
  const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  return {
    async frames(spec) {
      const [W, H] = spec.project, n = spec.opaque + spec.faded, N = (spec.frames ?? 20) + WARM;
      const quality = spec.quality ?? 'draft';
      const rule = pictureSize({ width: W, height: H }, { playing: true });
      const size: [number, number] = spec.size ?? [rule.width, rule.height];
      const [dw, dh] = spec.declared ?? spec.project;
      const asset = (k: number) => ({
        kind: 'image' as const, name: `play-${k}`, contentHash: `sha256:${(k + 1).toString(16).repeat(64).slice(0, 64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1),
        image: { width: dw, height: dh, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-01-01T00:00:00Z', importedBy: 'lab' },
      });
      const s0 = step(createProject({ id: 'prj_lab_playback', name: 'Lab playback', width: W, height: H, frameRate: RATE }), Array.from({ length: n }, (_, k) => ({ op: 'import_asset', args: { asset: asset(k) } })), true);
      const ids = s0.out.map((o) => o.assetId as string);
      let doc = s0.doc;
      let track = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
      for (let k = 0; k < n; k++) {
        if (k > 0) { const a = step(doc, [{ op: 'add_track', args: { kind: 'video' } }]); doc = a.doc; track = a.out[0]!.trackId as string; }
        const c = step(doc, [{ op: 'add_clip', args: { assetId: ids[k]!, trackId: track, start: f(0), duration: f(150), withLinkedAudio: false } }]);
        doc = k < spec.opaque ? c.doc : step(c.doc, [{ op: 'set_clip_transform', args: { clipId: c.out[0]!.clipId as string, transform: { opacity: 0.6 } } }]).doc;
      }
      const pics = await pictures(spec.source, spec.sourceSize, n);
      const provider = async (l: { assetId: string }): Promise<FrameImage | null> => { const k = ids.indexOf(l.assetId); return k < 0 ? null : { draw: (c, dx, dy, dw2, dh2) => c.drawImage(pics.at(k), dx, dy, dw2, dh2) }; };
      const shown = visible(size);
      const back = el('canvas', { width: size[0], height: size[1] });
      const ms: number[] = [];
      try {
        for (let k = 0; k < N; k++) {
          pics.next();
          const t0 = performance.now();
          const g = evaluate(doc, f(k));
          const r = await drawGraph(back.getContext('2d', { alpha: false })!, { ...g, width: size[0], height: size[1] }, provider, { quality });
          const screen = shown.getContext('2d', { alpha: false })!;
          screen.drawImage(back, 0, 0);
          screen.getImageData(0, 0, 1, 1);
          ms.push(performance.now() - t0);
          if (r.missing.length || r.unavailableEffects.length || g.layers.length !== n) throw new Error(`playback bench: frame ${k} could not be drawn`);
          await nextPaint();
        }
      } finally { pics.close(); }
      return { ...timing(ms, size), quality };
    },
    async raw(spec) {
      const [w, h] = spec.size, N = (spec.frames ?? 12) + WARM;
      const pics = await pictures(spec.source, spec.sourceSize, spec.layers);
      const shown = visible(spec.size), ctx = shown.getContext('2d', { alpha: false })!;
      const ms: number[] = [];
      try {
        for (let k = 0; k < N; k++) {
          pics.next();
          const t0 = performance.now();
          ctx.imageSmoothingEnabled = spec.smoothing !== 'off';
          if (spec.smoothing !== 'off') ctx.imageSmoothingQuality = spec.smoothing;
          for (let l = 0; l < spec.layers; l++) ctx.drawImage(pics.at(l), 0, 0, w, h);
          ctx.getImageData(0, 0, 1, 1);
          ms.push(performance.now() - t0);
          await nextPaint();
        }
      } finally { pics.close(); }
      return timing(ms, spec.size);
    },
  };
}

const bench = new URLSearchParams(location.search).get('bench');
if (bench === 'opacity') {
  (window as unknown as { __pfLabOpacity: LabOpacity }).__pfLabOpacity = opacityBench();
  document.body.dataset.ready = '1';
} else if (bench === 'playback') {
  (window as unknown as { __pfLabPlayback: LabPlayback }).__pfLabPlayback = playbackBench();
  document.body.dataset.ready = '1';
} else if (bench === 'transitions') {
  // the trend-pack Canvas2D ids by default; ?ids=a,b picks others (non-GPU ids only)
  const asked = new URLSearchParams(location.search).get('ids')?.split(',').filter(Boolean);
  const ids = asked ?? (TRANSITIONS as readonly TransitionDef[]).filter((t) => !t.gpu && ['punch', 'blur', 'split', 'shape', 'block', 'slices'].includes(t.kernel)).map((t) => t.id);
  benchTransitions(ids).then((r) => { (window as unknown as { __pfLabBench: LabBench }).__pfLabBench = r; document.body.dataset.bench = JSON.stringify(r); }, (e) => {
    root.append(el('div', { className: 'tile-error', role: 'alert', textContent: `${S.errors}: ${e instanceof Error ? e.message : String(e)}` }));
    document.body.dataset.errors = '1';
  }).finally(() => { document.body.dataset.ready = '1'; });
} else main().catch((e) => {
  root.append(el('div', { className: 'tile-error', role: 'alert', textContent: `${S.errors}: ${e instanceof Error ? e.message : String(e)}` }));
  document.body.dataset.errors = '1';
  document.body.dataset.ready = '1';
});
