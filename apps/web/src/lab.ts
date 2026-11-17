/**
 * Lab page: every registered effect, blend mode, mask and transition drawn by the shared evaluate + drawGraph.
 * No server data. Pictures are generated here; the in-memory project goes through the real ops.
 */
import './lab.css';
import './strictPage.ts';
import * as T from '@pulseframe/time';
import { applyTransaction, BLEND_MODES, createProject, DEFAULT_MASK, describeCatalog, EFFECTS, TRANSITIONS, type Mask, type TransitionDef, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { drawGraph, evaluate, gpuStatus, initGpu, type FrameImage } from '@pulseframe/engine';
import { ensureFonts } from './fonts.ts';

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
interface Tile { kind: 'effect' | 'blend' | 'mask' | 'transition'; id: string; variant: string; aspect: Aspect; params: unknown; build: (s: Scene) => { doc: ProjectDocument; frame: number }; strip?: boolean }
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
for (const e of EFFECTS) {
  const defaults = catalog.effects.find((x) => x.id === e.id)!.defaults;
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
      if (unavailableEffects.length) { fig.dataset.unavailable = '1'; cap.before(el('div', { className: 'tile-note', role: 'note', textContent: `needs a graphics adapter (WebGPU): ${gpuStatus().reason}` })); }
    } catch (e) {
      errors++;
      cap.before(el('div', { className: 'tile-error', role: 'alert', textContent: e instanceof Error ? e.message : String(e) }));
    }
  }
  if (errors) document.body.dataset.errors = String(errors);
  document.body.dataset.ready = '1';
}
main().catch((e) => {
  root.append(el('div', { className: 'tile-error', role: 'alert', textContent: `${S.errors}: ${e instanceof Error ? e.message : String(e)}` }));
  document.body.dataset.errors = '1';
  document.body.dataset.ready = '1';
});
