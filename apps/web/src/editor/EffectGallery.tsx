/**
 * Visual browser for the selected clip's looks: effects, colour looks, transitions and text styles, each as a live thumbnail.
 * Thumbnails go through the same evaluate + drawGraph as the preview (ADR-0005), one tile at a time. Picking a tile is an ordinary
 * registered op through editor.commit; nothing here keeps project state.
 * Tiles that move by themselves (motions, time effects, overlays, the strobe) and transition tiles animate while hovered or
 * focused, never under prefers-reduced-motion; every animated frame passes one FlashGuard per dialog (ADR-0009 decision 2),
 * like the player. Transitions are grouped by their registry category (ADR-0012).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import * as T from '@pulseframe/time';
import { adjustmentRefusal, applyTransaction, COLOR_LOOKS, createProject, EFFECTS, findClip, MOTION_PRESETS, TEXT_PRESETS, TRANSITIONS, type Clip, type OpCall, type ProjectDocument, switchFrame, TRANSITION_CATEGORIES, velocityNeeds } from '@pulseframe/core';
import { drawGraph, evaluate, FlashGuard, type FrameImage } from '@pulseframe/engine';
import { fillIn, type Key } from '@pulseframe/i18n';
import { ensureFonts } from '../fonts.ts';
import { useEditorState } from './store.ts';
import { GALLERY_STRINGS, SPREAD_STRINGS } from './gallery.strings.ts';
import { Star, X } from 'lucide-react';
import { Button, Tabs } from '../ds/index.ts';
import { CheckIcon, isolate } from '../ds/util.tsx';
import { DEFAULT_TRANSITION_FRAMES, isOn, pickCall, pickRefusal, thumbSize, transitionLength, transitionRoom } from './gallery.pick.ts';
import { singleFlight } from './oneAtATime.ts';
import { ADJUST_STRINGS } from './adjust.strings.ts';
import { TEMPLATE_TESTIDS as TID } from './templates.testids.ts';
import { wholeEditAdjustment } from './commands.ts';
import './effectGallery.css';

/** Where a look picked in the Look panel or the gallery goes (ADR-0016): this clip, or an adjustment layer over the whole edit. */
export type ApplyTo = 'clip' | 'edit';
/** The "apply to" radio group of the Look panel and the effects gallery: this clip / the whole edit. */
export function ApplyToGroup({ value, onChange }: { value: ApplyTo; onChange: (v: ApplyTo) => void }) {
  const { state } = useEditorState();
  const A = ADJUST_STRINGS[state.lang];
  const name = useId(), note = useId();
  return (
    <fieldset className="pf-apply-to" data-testid={TID.applyTo} aria-describedby={value === 'edit' ? note : undefined}>
      <legend>{A.applyTo}</legend>
      <label className="check"><input type="radio" name={name} value="clip" checked={value === 'clip'} data-testid={TID.applyToClip} onChange={() => onChange('clip')} /> {A.applyToClip}</label>
      <label className="check"><input type="radio" name={name} value="edit" checked={value === 'edit'} data-testid={TID.applyToEdit} onChange={() => onChange('edit')} /> {A.applyToEdit}</label>
      {value === 'edit' && <p id={note} className="muted">{A.applyToEditNote}</p>}
    </fieldset>
  );
}

type Kind = 'effect' | 'look' | 'transition' | 'text' | 'motion';
type TabId = 'effects' | 'looks' | 'transitions' | 'text' | 'motion';
const TAB_KIND: Record<TabId, Kind> = { effects: 'effect', looks: 'look', transitions: 'transition', text: 'text', motion: 'motion' };
const MOTION_GROUPS = ['in', 'out', 'loop', 'move'] as const;
const MOTION_FRAMES = 60;
const CATEGORIES = ['color', 'blur', 'light', 'stylize', 'digital', 'key', 'distort', 'motion', 'time', 'overlay'] as const;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const LONG_SIDE = 180;
const RATE = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, RATE);
const FRAME_AT = 12; // 0.4 s at 30 fps, so time-driven effects show something
const TRANSITION_FRAMES = 15;
/** A transition tile's scene: the outgoing clip at frames 0–60, the incoming one from 60 with the transition over 60–74. */
const TRANSITION_START = 60;
/** The loop a hovered transition tile plays: from a little before the transition to a little after it. */
const TRANSITION_LOOP = { from: 56, to: 78 } as const;
/**
 * The frame a transition tile shows at rest: the middle of the transition; for a zoom punch the switch frame (its strongest
 * moment), and for colour blocks two frames before it, where the bars are crossing (on the switch frame they cover all).
 */
function transitionStill(kernel: string | undefined): number {
  const sw = switchFrame(TRANSITION_FRAMES, null);
  // a dip or a flash is all one colour at its middle: its tile shows the frame before, where the picture is still there (no tile is black)
  return TRANSITION_START + (kernel === 'punch' ? sw : kernel === 'block' ? sw - 2 : kernel === 'dip' || kernel === 'flash' ? 4 : Math.floor(TRANSITION_FRAMES / 2));
}
/** Length of an effect tile's clip, and of its animation loop while hovered. */
const EFFECT_FRAMES = 150;
/** A time effect shows only on movement (ADR-0011): its tile's picture is made smaller and swings, through the same ops as any clip. */
const TIME_MOTION = 'motion.loop.pendulum';
/**
 * The frame an effect tile shows: the strobe one frame after its first flash (frame 0), while its light is still up (at frame 12
 * it is 0.4 s after a flash and has faded away); the stutter on frame 13, which holds the picture of frame 12.
 */
const effectFrame = (id: string) => (id === 'light.strobe' ? 1 : id === 'time.stutter' ? 13 : FRAME_AT);

interface Item { key: string; kind: Kind; id: string; he: string; en: string; gpu: boolean; category?: string; kernel?: string; mkind?: (typeof MOTION_GROUPS)[number]; mframes?: number }
/** Tiles whose picture moves by itself, so they animate while hovered or focused; and every transition. */
const animates = (it: Item) => it.kind === 'motion' || it.kind === 'transition' || (it.kind === 'effect' && (it.category === 'time' || it.category === 'overlay' || it.id === 'light.strobe'));
const ITEMS: Item[] = [
  ...EFFECTS.map((e) => ({ key: `effect:${e.id}`, kind: 'effect' as const, id: e.id, he: e.name.he, en: e.name.en, gpu: e.cost === 'gpu', category: e.category })),
  ...COLOR_LOOKS.map((l) => ({ key: `look:${l.id}`, kind: 'look' as const, id: l.id, he: l.name.he, en: l.name.en, gpu: true })),
  ...TRANSITIONS.map((x) => ({ key: `transition:${x.id}`, kind: 'transition' as const, id: x.id, he: x.name.he, en: x.name.en, gpu: x.gpu, category: x.category, kernel: x.kernel })),
  ...TEXT_PRESETS.map((p) => ({ key: `text:${p.id}`, kind: 'text' as const, id: p.id, he: p.name.he, en: p.name.en, gpu: false })),
  ...MOTION_PRESETS.map((m) => ({ key: `motion:${m.id}`, kind: 'motion' as const, id: m.id, he: m.name.he, en: m.name.en, gpu: false, mkind: m.kind as (typeof MOTION_GROUPS)[number], mframes: m.defaultFrames })),
];

// ---- thumbnail documents (same approach as the Look Lab: a small in-memory project through the real ops) ----
let seq = 0;
const step = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => {
  const r = applyTransaction(doc, ops, { idSeed: `gal${seq++}_`, actor: 'gallery', allowInternal });
  return { doc: r.doc, out: r.results.map((x) => x.output ?? {}) as Record<string, any>[] };
};
interface Scene { w: number; h: number; base: ProjectDocument; a: string; b: string; v1: string }
function makeScene(w: number, h: number): Scene {
  const asset = (name: string, c: string) => ({
    kind: 'image' as const, name, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1),
    image: { width: w, height: h, codec: 'png', hasAlpha: false },
    provenance: { origin: 'fixture' as const, importedAt: '2026-01-01T00:00:00Z', importedBy: 'gallery' },
  });
  const s = step(createProject({ id: 'prj_gallery', name: 'Gallery', width: w, height: h, frameRate: RATE }), [
    { op: 'import_asset', args: { asset: asset('gallery-a', 'a') } },
    { op: 'import_asset', args: { asset: asset('gallery-b', 'b') } },
  ], true);
  const v1 = s.doc.sequences[s.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
  return { w, h, base: s.doc, a: s.out[0]!.assetId as string, b: s.out[1]!.assetId as string, v1 };
}
const addPicture = (s: Scene, assetId: string, start: number, dur: number): OpCall => ({ op: 'add_clip', args: { assetId, trackId: s.v1, start: f(start), duration: f(dur), withLinkedAudio: false } });
/** A frame where the motion is visible: a third into an entrance, two thirds into an exit, a quarter period of a loop, the end of a move. */
function motionStaticFrame(it: Item): number {
  const n = it.mframes || 0;
  if (it.mkind === 'in') return Math.max(1, Math.floor(n / 3));
  if (it.mkind === 'out') return Math.min(MOTION_FRAMES - 1, MOTION_FRAMES - n + Math.floor((2 * n) / 3));
  if (it.mkind === 'loop') return Math.max(1, Math.floor(n / 4));
  return MOTION_FRAMES - 1;
}
function buildDoc(s: Scene, it: Item, isText = false): { doc: ProjectDocument; frame: number } {
  if (it.kind === 'motion') {
    const frame = motionStaticFrame(it);
    if (isText) {
      const doc = { ...s.base, settings: { ...s.base.settings, background: '#2b2b2b' } };
      const a = step(doc, [{ op: 'add_text', args: { text: GALLERY_STRINGS.he.sample, start: f(0), duration: f(MOTION_FRAMES) } }]);
      return { doc: step(a.doc, [{ op: 'apply_motion_preset', args: { clipId: a.out[0]!.clipId as string, presetId: it.id } }]).doc, frame };
    }
    const a = step(s.base, [addPicture(s, s.a, 0, MOTION_FRAMES)]);
    return { doc: step(a.doc, [{ op: 'apply_motion_preset', args: { clipId: a.out[0]!.clipId as string, presetId: it.id } }]).doc, frame };
  }
  if (it.kind === 'transition') {
    const a = step(s.base, [addPicture(s, s.a, 0, TRANSITION_START), addPicture(s, s.b, TRANSITION_START, 60)]);
    const clipId = a.out[1]!.clipId as string;
    return { doc: step(a.doc, [{ op: 'set_transition', args: { clipId, type: it.id, frames: TRANSITION_FRAMES } }]).doc, frame: transitionStill(it.kernel) };
  }
  if (it.kind === 'text') {
    const doc = { ...s.base, settings: { ...s.base.settings, background: '#2b2b2b' } };
    const a = step(doc, [{ op: 'add_text', args: { text: GALLERY_STRINGS.he.sample, start: f(0), duration: f(150) } }]);
    return { doc: step(a.doc, [{ op: 'apply_text_preset', args: { clipId: a.out[0]!.clipId as string, presetId: it.id } }]).doc, frame: FRAME_AT };
  }
  const a = step(s.base, [addPicture(s, s.a, 0, EFFECT_FRAMES)]);
  const clipId = a.out[0]!.clipId as string;
  if (it.kind === 'look') return { doc: step(a.doc, [{ op: 'apply_look', args: { clipId, lookId: it.id } }]).doc, frame: FRAME_AT };
  const moving: OpCall[] = it.category === 'time' ? [{ op: 'set_clip_transform', args: { clipId, transform: { scale: 0.6 } } }, { op: 'apply_motion_preset', args: { clipId, presetId: TIME_MOTION } }] : [];
  return { doc: step(a.doc, [...moving, { op: 'add_effect', args: { clipId, type: it.id } }]).doc, frame: effectFrame(it.id) };
}


// ---- favourites, recents and a tile cache: per-viewer conveniences, never project state ----
const FAV_KEY = 'pf.gallery.fav.v1', RECENT_KEY = 'pf.gallery.recent.v1';
const readList = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const writeList = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: the lists last for this session */ } };
/**
 * A drawn tile, kept so that opening the gallery again on the same picture does not draw it again. The key names the picture it
 * was drawn over (project, revision, frame, size), so a changed picture never shows a stale tile. Oldest are dropped past the cap.
 */
const TILE_CACHE_CAP = 360;
const tileCache = new Map<string, ImageBitmap>();
function cachePut(key: string, bm: ImageBitmap) {
  const old = tileCache.get(key);
  if (old) { old.close(); tileCache.delete(key); }
  tileCache.set(key, bm);
  while (tileCache.size > TILE_CACHE_CAP) { const k = tileCache.keys().next().value as string; tileCache.get(k)?.close(); tileCache.delete(k); }
}
const clockOf = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(0).padStart(2, '0')}`;
const stripExt = (n: string) => n.replace(/\.[A-Za-z0-9]{2,4}$/, '');

export function EffectGalleryButton({ clip, trackKind, applyTo = 'clip', onApplyTo }: { clip: Clip; trackKind: string; applyTo?: ApplyTo; onApplyTo?: (v: ApplyTo) => void }) {
  const { state } = useEditorState();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const G = GALLERY_STRINGS[state.lang];
  return (
    <>
      <button ref={btn} type="button" data-testid="gallery-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>{G.open}</button>
      {open && <EffectGallery clip={clip} trackKind={trackKind} applyTo={applyTo} onApplyTo={onApplyTo} onClose={() => { setOpen(false); setTimeout(() => btn.current?.focus(), 0); }} />}
    </>
  );
}

function EffectGallery({ clip, trackKind, onClose, applyTo: initialApplyTo, onApplyTo }: { clip: Clip; trackKind: string; onClose: () => void; applyTo: ApplyTo; onApplyTo?: (v: ApplyTo) => void }) {
  const { editor, state, t } = useEditorState();
  const lang = state.lang;
  const G = GALLERY_STRINGS[lang];
  const A = ADJUST_STRINGS[lang];
  const gpuOk = !!state.gpu?.available;
  const isText = clip.type === 'text';
  const media = clip.type === 'media' && trackKind === 'video';
  // An adjustment clip (ADR-0016) takes effects and looks only; for a picture or a title, effects and looks may go on an
  // adjustment layer over the whole edit instead ("apply to").
  const adjustment = clip.type === 'adjustment';
  const [applyTo, setApplyToState] = useState<ApplyTo>(adjustment ? 'clip' : initialApplyTo);
  const setApplyTo = (v: ApplyTo) => { setApplyToState(v); onApplyTo?.(v); };
  const tabs = useMemo<TabId[]>(() => [...(isText || media || adjustment ? (['effects', 'looks'] as TabId[]) : []), ...(media ? (['transitions'] as TabId[]) : []), ...(isText ? (['text'] as TabId[]) : []), ...(isText || media ? (['motion'] as TabId[]) : [])], [isText, media, adjustment]);
  const [tab, setTab] = useState<TabId>(tabs[0] ?? 'effects');
  const [query, setQuery] = useState('');
  const [snap, setSnap] = useState<{ bitmap: ImageBitmap; dim: ImageBitmap; w: number; h: number; key: string } | null | undefined>(undefined);
  const [rendered, setRendered] = useState<ReadonlySet<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const done = useRef(new Set<string>());
  const running = useRef<Promise<void>>(Promise.resolve());
  const [hot, setHot] = useState<string | null>(null);
  const SP = SPREAD_STRINGS[lang];
  const [favs, setFavs] = useState<ReadonlySet<string>>(() => new Set(readList(FAV_KEY)));
  const [recents, setRecents] = useState<string[]>(() => readList(RECENT_KEY));
  const [cat, setCat] = useState<string>('all');
  const [picked, setPicked] = useState<string | null>(null);
  /** A tile is also drawn in the sections above the full list ("fits this cut", "used recently"): those canvases are copies of the main one. */
  const mirrors = useRef(new Map<string, Set<HTMLCanvasElement>>());
  const mirror = (key: string) => {
    const src = canvases.current.get(key);
    if (!src) return;
    for (const c of mirrors.current.get(key) ?? []) { const g = c.getContext('2d'); if (g && c.width && c.height) { g.clearRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height); } }
  };
  const toggleFav = (key: string) => setFavs((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); writeList(FAV_KEY, [...n]); return n; });
  // One guard for every animated tile of this dialog: a strobe's light may rise on screen at most once in a third of a second
  // of real time, whichever tile shows it and however the pointer moves between tiles (ADR-0009 decision 2).
  const [guard] = useState(() => new FlashGuard());
  const showHeld = () => dialogRef.current?.setAttribute('data-flashes-held', String(guard.leftOut));
  const motionDocs = useRef(new Map<string, { doc: ProjectDocument; frame: number }>());
  const motionDoc = (it: Item) => {
    let d = motionDocs.current.get(it.key);
    if (!d) { d = buildDoc(motionScene, it, isText); motionDocs.current.set(it.key, d); }
    return d;
  };
  // The snapshot below is taken from the preview, which shows the VIEWED format: the tiles take that format's shape, not the master's.
  const settings = editor.viewDoc?.settings;
  const [tw, th] = thumbSize(settings?.width ?? 16, settings?.height ?? 9, LONG_SIDE);
  // One pick at a time, and what became of the last one, said inside the dialog (the editor's error bar is behind the backdrop).
  const [flight] = useState(singleFlight);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'error' | 'info'; text: string; reason?: string } | null>(null);

  const motionScene = useMemo(() => makeScene(tw, th), [tw, th]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // One snapshot of the frame on screen, taken when the dialog opens.
  useEffect(() => {
    let dead = false;
    let made: ImageBitmap[] = [];
    (async () => {
      const preview = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
      if (!preview || preview.width === 0 || preview.height === 0) { if (!dead) setSnap(null); return; }
      try {
        const bitmap = await createImageBitmap(preview, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'medium' });
        const c = new OffscreenCanvas(tw, th);
        const g = c.getContext('2d')!;
        g.filter = 'grayscale(1) brightness(0.45)';
        g.drawImage(bitmap, 0, 0);
        const dim = await createImageBitmap(c);
        made = [bitmap, dim];
        if (dead) { made.forEach((b) => b.close()); return; }
        setSnap({ bitmap, dim, w: tw, h: th, key: `${editor.doc?.id}:${editor.getState().revision}:${editor.viewDoc === editor.doc ? 'm' : editor.getState().viewVariantId}:${editor.frame}:${tw}x${th}` });
      } catch { if (!dead) setSnap(null); }
    })();
    return () => { dead = true; made.forEach((b) => b.close()); };
  }, [tw, th]);

  useEffect(() => setCat('all'), [tab]);
  const tabItems = useMemo(() => ITEMS.filter((i) => i.kind === TAB_KIND[tab]), [tab]);
  const q = query.trim().toLowerCase();
  const catMatch = (i: Item) => cat === 'all' || (cat === 'fav' ? favs.has(i.key) : (i.kind === 'motion' ? i.mkind : i.category) === cat);
  const matches = (i: Item) => catMatch(i) && (!q || i.he.toLowerCase().includes(q) || i.en.toLowerCase().includes(q));
  const visibleKey = tabItems.filter(matches).map((i) => i.key).join('|');

  // Never black: until a tile is drawn it shows the frozen frame (dimmed, from the same snapshot) or the surface colour.
  useEffect(() => {
    for (const [key, c] of canvases.current) {
      if (done.current.has(key)) continue;
      const g = c.getContext('2d');
      if (!g) continue;
      g.clearRect(0, 0, c.width, c.height);
      if (snap) g.drawImage(snap.dim, 0, 0, c.width, c.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, tab, query, cat, rendered.size]);

  // Draw tiles of the visible tab one after another; stop when the tab, the filter or the dialog changes.
  useEffect(() => {
    if (!tabs.includes(tab)) return;
    const needsSnap = tab !== 'text' && !(tab === 'motion' && isText);
    if (needsSnap && !snap) return;
    let cancelled = false;
    const prev = running.current;
    running.current = (async () => {
      await prev;
      if (cancelled) return;
      await ensureFonts();
      const scene = makeScene(tw, th);
      const bitmaps = new Map<string, ImageBitmap>();
      if (snap) { bitmaps.set(scene.a, tab === 'transitions' ? snap.dim : snap.bitmap); bitmaps.set(scene.b, snap.bitmap); }
      for (const it of tabItems.filter(matches)) {
        if (cancelled) return;
        if (done.current.has(it.key) || (it.gpu && !gpuOk)) continue;
        const canvas = canvases.current.get(it.key);
        if (!canvas) continue;
        const ck = `${snap?.key ?? 'text'}|${isText ? 'T' : 'M'}|${it.key}`;
        const hit = tileCache.get(ck);
        if (hit) {
          const g = canvas.getContext('2d')!;
          g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(hit, 0, 0, canvas.width, canvas.height);
          done.current.add(it.key); mirror(it.key); setRendered(new Set(done.current));
          continue;
        }
        try {
          const { doc, frame } = buildDoc(scene, it, isText);
          const provider = async (l: { assetId: string }): Promise<FrameImage | null> => {
            const bm = bitmaps.get(l.assetId);
            return bm ? { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bm, dx, dy, dw, dh) } : null;
          };
          const r = await drawGraph(canvas.getContext('2d')!, evaluate(doc, f(frame)), provider);
          if (cancelled) return;
          if (r.missing.length || r.unavailableEffects.length) continue;
          done.current.add(it.key);
          mirror(it.key);
          void createImageBitmap(canvas).then((bm) => cachePut(ck, bm)).catch(() => undefined);
          setRendered(new Set(done.current));
        } catch { /* this tile stays blank and unmarked */ }
        await new Promise((r) => setTimeout(r));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, visibleKey, snap, gpuOk, tw, th]);

  // Animate only the hot tile (a motion, a time effect, an overlay or the strobe): one drawGraph at a time, about 30 fps, stopped
  // on leave / blur / tab change / close. Every frame it draws, and the still frame it puts back, passes the dialog's flash guard
  // with the real time of drawing, as the player does (apps/web/src/player.ts).
  useEffect(() => { setHot(null); }, [tab]);
  useEffect(() => {
    if (!hot) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const it = ITEMS.find((i) => i.key === hot);
    const canvas = canvases.current.get(hot);
    if (!it || !animates(it) || it.kind !== TAB_KIND[tab] || !canvas || ((it.kind !== 'motion' || !isText) && !snap) || (it.gpu && !gpuOk)) return;
    const { doc, frame } = motionDoc(it);
    // a transition plays frames 56..78 around its window; everything else loops from frame 0
    const [first, loop] = it.kind === 'transition' ? [TRANSITION_LOOP.from, TRANSITION_LOOP.to - TRANSITION_LOOP.from + 1] : [0, it.kind === 'motion' ? MOTION_FRAMES : EFFECT_FRAMES];
    // the outgoing side of a transition tile is the dimmed snapshot, as in its still (the incoming one is the snapshot itself)
    const provider = async (l: { assetId: string }): Promise<FrameImage | null> => {
      const bm = snap ? (it.kind === 'transition' && l.assetId === motionScene.a ? snap.dim : snap.bitmap) : null;
      return bm ? { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bm, dx, dy, dw, dh) } : null;
    };
    const ctx = canvas.getContext('2d')!;
    const draw = (n: number) => drawGraph(ctx, guard.apply(evaluate(doc, f(n)), performance.now() / 1000), provider).finally(() => { showHeld(); mirror(it.key); });
    let stop = false;
    let busy: Promise<unknown> = Promise.resolve();
    let startAt = 0, last = -1, raf = 0;
    const tick = (now: number) => {
      if (stop) return;
      raf = requestAnimationFrame(tick);
      if (!startAt) startAt = now;
      const n = first + (Math.floor(((now - startAt) * 30) / 1000) % loop);
      if (n === last || inflight) return;
      last = n;
      inflight = true;
      busy = draw(n).catch(() => undefined).finally(() => { inflight = false; });
    };
    let inflight = false;
    const prev = running.current;
    void prev.then(() => { if (!stop) raf = requestAnimationFrame(tick); });
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      void busy.then(() => { if (canvases.current.get(it.key) === canvas) return draw(frame); }).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hot, tab, snap, gpuOk]);

  /** The tile just applied goes to the front of "used recently" (per viewer, six kept). */
  const remember = (it: Item) => {
    setRecents((cur) => { const n = [it.key, ...cur.filter((k) => k !== it.key)].slice(0, 6); writeList(RECENT_KEY, n); return n; });
    if (it.kind === 'transition') setPicked(it.id);
  };
  /** Every cut after the first clip of this clip's track that has room for a transition: the clips a transition may go on. */
  const cuts = (): { id: string; room: NonNullable<ReturnType<typeof transitionRoom>> }[] => {
    const d = editor.doc;
    if (!d) return [];
    const f = findClip(d, clip.id);
    if (!f) return [];
    return f.track.clips.flatMap((c) => { const room = c.type === 'media' ? transitionRoom(d, c.id) : null; return room && room.maxFrames >= 1 ? [{ id: c.id, room }] : []; });
  };
  const applyAll = async (type: string, shuffle: boolean) => {
    if (flight.busy || !editor.doc) return;
    const list = cuts();
    if (!list.length) return;
    const pool = ITEMS.filter((i) => i.kind === 'transition' && (!i.gpu || gpuOk));
    const calls: OpCall[] = list.map((c) => {
      const id = shuffle ? pool[Math.floor(Math.random() * pool.length)]!.id : type;
      const wanted = DEFAULT_TRANSITION_FRAMES;
      return { op: 'set_transition', args: { clipId: c.id, type: id, frames: transitionLength(c.room, wanted) || c.room.maxFrames } };
    });
    setBusyKey('all');
    try {
      const done = await flight.run(() => editor.commit(calls, shuffle ? 'Gallery: shuffle transitions' : `Gallery: ${type} on all cuts`));
      if (done.dropped) return;
      if (done.value) {
        const skipped = (editor.doc ? (findClip(editor.doc, clip.id)?.track.clips.filter((c) => c.type === 'media').length ?? 0) - 1 : 0) - list.length;
        const nm = ITEMS.find((i) => i.kind === 'transition' && i.id === type);
        setStatus({ kind: 'info', text: (shuffle ? SP.shuffled(list.length) : SP.appliedAll(nm ? (lang === 'he' ? nm.he : nm.en) : type, list.length)) + (skipped > 0 ? SP.skippedNoRoom(skipped) : '') });
      } else {
        const why = pickRefusal(editor.getState());
        setStatus({ kind: 'error', text: G.refused(shuffle ? SP.shuffle : type), reason: why.reason ?? (why.conflict ? G.conflict : G.noReason) });
      }
    } finally { setBusyKey(null); }
  };

  const commit = async (it: Item) => {
    if (flight.busy) return; // a pick is on its way: this activation (the second half of a double-click) is not a second edit
    const name = lang === 'he' ? it.he : it.en;
    const live = (editor.doc && findClip(editor.doc, clip.id)?.clip) || clip; // the clip as it is now, not as it was when the tile was drawn
    // A transition is asked for at a length the op accepts: the clip's current length (or the default), cut to what the clips
    // allow (gallery.pick.ts transitionRoom). When nothing fits, nothing is sent and the status says what to do.
    // The transition's options are kept on the new type (set_transition, ADR-0012), so the room counts a velocity ramp's needs.
    let frames: number | undefined;
    let short: { frames: number; limit: 'clip' | 'previous' | 'start' | 'max'; velocity?: 2 | 3 | 4 } | null = null;
    if (it.kind === 'transition' && editor.doc) {
      const room = transitionRoom(editor.doc, live.id);
      if (room) {
        const wanted = live.type === 'media' && live.transition ? live.transition.frames : DEFAULT_TRANSITION_FRAMES;
        frames = transitionLength(room, wanted);
        // only the kept beat lock's minimum (3 frames) stands in the way: the op is asked, and its refusal says why
        if (frames < 1 && room.maxFrames >= 1) frames = room.maxFrames;
        else if (frames < 1) { setStatus({ kind: 'error', text: G.refused(name), reason: room.limit === 'previous' ? G.noHandle : G.noRoom }); return; }
        if (frames < wanted) short = { frames, limit: room.limit, ...(room.velocity ? { velocity: room.velocity } : {}) };
      }
    }
    const toEdit = wholeEdit && (it.kind === 'effect' || it.kind === 'look');
    const onEdit = toEdit && editor.doc ? wholeEditAdjustment(editor.doc)?.clip : undefined;
    // the whole edit: on its adjustment layer (made by the same transaction when there is none yet), never twice the same effect
    const call = toEdit ? (onEdit && it.kind === 'effect' && isOn(onEdit, it) ? null : 'edit') : pickCall(live, it, frames);
    if (!call) { setStatus({ kind: 'info', text: G.alreadyOn(name) }); return; }
    setBusyKey(it.key);
    try {
      const done = await flight.run(() => (call === 'edit'
        ? editor.applyToWholeEdit(it.kind === 'effect' ? { kind: 'effect', type: it.id } : { kind: 'look', lookId: it.id }, `Gallery: ${it.id} (whole edit)`)
        : editor.commit([call], `Gallery: ${it.id}`)));
      if (done.dropped) return;
      if (done.value) {
        remember(it);
        if (!short) setStatus({ kind: 'info', text: G.applied(name) });
        else if (!short.velocity) setStatus({ kind: 'info', text: G.appliedShort(name, short.frames, short.limit === 'previous') });
        else {
          // shortened so that the kept velocity ramp has the source it reads on both sides
          const need = velocityNeeds(short.frames, short.velocity);
          setStatus({ kind: 'info', text: short.limit === 'previous' ? G.appliedShort(name, short.frames, true) : G.applied(name), reason: `${t('look.transition.frames')}: ${short.frames} · ${t('look.transition.velocity')} ×${short.velocity}: ${fillIn(t('look.transition.velocity.need'), { out: need.outFrames, head: need.headFrames })}` });
        }
        return;
      }
      const why = pickRefusal(editor.getState());
      setStatus({ kind: 'error', text: G.refused(name), reason: why.reason ?? (why.conflict ? G.conflict : G.noReason) });
    } finally { setBusyKey(null); }
  };

  // "apply to the whole edit" holds for effects and looks; the tiles are pressed by what the whole-edit layer carries
  const wholeEdit = !adjustment && applyTo === 'edit' && (tab === 'effects' || tab === 'looks');
  const pressedOn: Clip | null = wholeEdit ? (editor.doc ? wholeEditAdjustment(editor.doc)?.clip ?? null : null) : clip;

  // the clips as they are now: is there room for any transition at the start of this clip?
  const room = media && editor.doc ? transitionRoom(editor.doc, clip.id) : null;
  const noTransitionRoom = !!room && room.maxFrames < 1 && room.limit === 'previous';

  const focusables = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((n) => n.offsetParent !== null);
  // Escape and Tab must work wherever focus is: a click on a disabled tile or outside any control can leave focus on the page
  // body, where the dialog's own key handler below never hears the key.
  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      const dlg = dialogRef.current;
      if (!dlg) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab' && !dlg.contains(document.activeElement)) {
        const nodes = focusables();
        if (!nodes.length) return;
        e.preventDefault(); e.stopPropagation();
        (e.shiftKey ? nodes[nodes.length - 1]! : nodes[0]!).focus();
      }
    };
    document.addEventListener('keydown', onDocKey, true);
    return () => document.removeEventListener('keydown', onDocKey, true);
  }, [onClose]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // keys typed here are not editor shortcuts
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Tab') {
      const nodes = focusables();
      if (!nodes.length) return;
      // the dialog itself takes focus when a heading, a note or the gap between tiles is clicked: Shift+Tab from there wraps too
      const first = nodes[0]!, last = nodes[nodes.length - 1]!, at = document.activeElement;
      if (e.shiftKey && (at === first || at === dialogRef.current || !dialogRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !dialogRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
    }
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.indexOf(tab);
    const step_ = e.key === 'ArrowRight' ? (lang === 'he' ? -1 : 1) : e.key === 'ArrowLeft' ? (lang === 'he' ? 1 : -1) : 0;
    if (!step_) return;
    e.preventDefault();
    const next = tabs[(i + step_ + tabs.length) % tabs.length]!;
    setTab(next);
    document.getElementById(`pf-gal-tab-${next}`)?.focus();
  };

  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wanted = clip.type === 'media' && clip.transition ? clip.transition.frames : DEFAULT_TRANSITION_FRAMES;
  const fps = editor.rate.num / editor.rate.den;
  /** What a transition tile says about this cut: it fits as it is, it would be shortened (by how much), or there is no material for it. */
  const fitOf = (it: Item): { kind: 'fits' } | { kind: 'shortens'; secs: string } | { kind: 'none' } | null => {
    if (it.kind !== 'transition' || !room) return null;
    const n = transitionLength(room, wanted);
    if (n >= wanted) return { kind: 'fits' };
    return n > 0 ? { kind: 'shortens', secs: ((wanted - n) / fps).toFixed(1) } : { kind: 'none' };
  };

  const tileOf = (it: Item, section?: 'fit' | 'recent') => {
    // an adjustment (this clip, or the layer over the whole edit) refuses time effects, the chroma key and the shadow
    const refused = it.kind === 'effect' && (adjustment || wholeEdit) && !!adjustmentRefusal(it.id);
    const unavailable = (it.gpu && !gpuOk) || refused;
    const name = lang === 'he' ? it.he : it.en;
    const main = !section;
    const pressed = pressedOn ? isOn(pressedOn, it) : false;
    const fit = fitOf(it);
    const fav = favs.has(it.key);
    const isRendered = rendered.has(it.key);
    return (
      <div key={`${section ?? 'all'}:${it.key}`} className={`pf-gal-cell${pressed ? ' is-applied' : ''}${unavailable ? ' is-off' : ''}`} hidden={!matches(it)}>
        <button type="button" className="pf-gal-tile" data-testid={main ? 'gallery-tile' : 'gallery-pick'} data-kind={it.kind} data-id={it.id} data-value={it.id}
          data-rendered={main && isRendered ? '1' : undefined} data-unavailable={unavailable ? '1' : undefined}
          disabled={unavailable} aria-pressed={pressed} aria-busy={busyKey === it.key || undefined} hidden={!matches(it)} onClick={() => void commit(it)}
          onPointerEnter={animates(it) ? () => setHot(it.key) : undefined} onPointerLeave={animates(it) ? () => setHot((h) => (h === it.key ? null : h)) : undefined}
          onFocus={animates(it) ? () => setHot(it.key) : undefined} onBlur={animates(it) ? () => setHot((h) => (h === it.key ? null : h)) : undefined}>
          <span className="pf-gal-img" aria-hidden="true">
            <canvas width={tw} height={th} style={{ ['--pf-gal-aspect' as string]: `${tw} / ${th}` }}
              ref={(c) => {
                if (!c) { if (main) canvases.current.delete(it.key); return; }
                if (main) { canvases.current.set(it.key, c); return; }
                let set = mirrors.current.get(it.key);
                if (!set) mirrors.current.set(it.key, (set = new Set()));
                for (const x of [...set]) if (!x.isConnected && x !== c) set.delete(x);
                set.add(c);
                if (done.current.has(it.key)) queueMicrotask(() => mirror(it.key));
                else if (snap) { const g = c.getContext('2d'); g?.drawImage(snap.dim, 0, 0, c.width, c.height); }
              }} />
            {!isRendered && !unavailable && <i className="pf-gal-shimmer" />}
            {hot === it.key && !reduced && <span className="pf-gal-unsaved">{SP.notSaved}</span>}
            {pressed && <span className="pf-gal-check"><CheckIcon size={14} strokeWidth={2.5} /></span>}
            {unavailable && <span className="pf-gal-off"><span>{refused ? A.notOnAdjustment : SP.needsGpuTile}</span><small>{refused ? '' : SP.gpuWhy}</small></span>}
          </span>
          <span className="pf-gal-name"><bdi>{name}</bdi></span>
          {fit && !unavailable && (
            <span className={`pf-gal-fit is-${fit.kind}`}>
              {fit.kind === 'fits' ? <>{SP.fits} <CheckIcon size={12} strokeWidth={2.5} /></> : fit.kind === 'shortens' ? SP.shortens(fit.secs) : SP.noRoom}
            </span>
          )}
          {pressed && <span className="pf-sr">{SP.checkMark}</span>}
        </button>
        {!unavailable && <button type="button" className={`pf-gal-star${fav ? ' is-on' : ''}`} aria-pressed={fav} aria-label={`${fav ? SP.unfavourite : SP.favourite}: ${name}`} onClick={() => toggleFav(it.key)}><Star size={14} strokeWidth={1.75} fill={fav ? 'currentColor' : 'none'} aria-hidden="true" /></button>}
      </div>
    );
  };

  const catOf = (i: Item) => (i.kind === 'motion' ? i.mkind : i.category);
  const catName = (c: string): string => (tab === 'motion' ? G.motionGroups[c as (typeof MOTION_GROUPS)[number]] : tab === 'transitions' ? t(`look.trcat.${c}` as Key) : t(`look.cat.${c}` as Key));
  const cats: readonly string[] = tab === 'effects' ? CATEGORIES : tab === 'transitions' ? TRANSITION_CATEGORIES : tab === 'motion' ? MOTION_GROUPS : [];
  const tabAll = ITEMS.filter((i) => i.kind === TAB_KIND[tab]);
  const catCount = (c: string) => tabAll.filter((i) => catOf(i) === c).length;
  const filtered = cat !== 'all' || q !== '';
  const fitting = tab === 'transitions' && room && !filtered ? tabAll.filter((i) => !i.gpu || gpuOk).filter((i) => fitOf(i)?.kind === 'fits').slice(0, 6) : [];
  const recentItems = filtered ? [] : recents.map((k) => tabAll.find((i) => i.key === k)).filter((i): i is Item => !!i && (!i.gpu || gpuOk));

  const panel = (id: TabId) => {
    const items = ITEMS.filter((i) => i.kind === TAB_KIND[id]);
    const shown = id === tab ? items.filter(matches).length : 0;
    const active = id === tab;
    return (
      <div key={id} id={`pf-gal-panel-${id}`} role="tabpanel" aria-labelledby={`pf-gal-panel-tab-${id}`} hidden={!active} data-testid={`gallery-panel-${id}`}>
        {id === 'transitions' && noTransitionRoom && <p className="pf-gal-note pf-gal-room" role="note" data-testid="gallery-transition-room">{G.noHandle}</p>}
        {active && fitting.length > 0 && (
          <section aria-labelledby="pf-gal-fit-h" className="pf-gal-sec">
            <h3 className="pf-gal-heading" id="pf-gal-fit-h">{SP.fitsHere} <small>{SP.fitsBasis}</small></h3>
            <div className="pf-gal-grid">{fitting.map((i) => tileOf(i, 'fit'))}</div>
          </section>
        )}
        {active && recentItems.length > 0 && (
          <section aria-labelledby="pf-gal-rec-h" className="pf-gal-sec">
            <h3 className="pf-gal-heading" id="pf-gal-rec-h">{SP.recent}</h3>
            <div className="pf-gal-grid">{recentItems.map((i) => tileOf(i, 'recent'))}</div>
          </section>
        )}
        {active && (fitting.length > 0 || recentItems.length > 0) && <h3 className="pf-gal-heading pf-gal-all">{SP.all(SP.allWord[id], items.length)}</h3>}
        {id === 'effects' || id === 'transitions' || id === 'motion'
          ? (id === 'effects' ? CATEGORIES : id === 'transitions' ? TRANSITION_CATEGORIES : MOTION_GROUPS).map((c) => {
            const group = items.filter((i) => (id === 'motion' ? i.mkind : i.category) === c);
            if (!group.some(matches)) return null;
            const label = id === 'motion' ? G.motionGroups[c as (typeof MOTION_GROUPS)[number]] : id === 'transitions' ? t(`look.trcat.${c}` as Key) : t(`look.cat.${c}` as Key);
            return (
              <section key={c} aria-labelledby={`pf-gal-${id}-${c}`} data-testid={id === 'transitions' ? `gallery-transition-group-${c}` : undefined}>
                <h3 className="pf-gal-heading" id={`pf-gal-${id}-${c}`} data-testid={id === 'motion' ? `gallery-motion-group-${c}` : undefined}>{label}</h3>
                <div className="pf-gal-grid">{group.map((i) => tileOf(i))}</div>
              </section>
            );
          })
          : <div className="pf-gal-grid">{items.map((i) => tileOf(i))}</div>}
        {active && shown === 0 && <div className="pf-gal-empty" role="status">{cat === 'fav' ? SP.favEmpty : G.empty}</div>}
      </div>
    );
  };

  // the cut the transition tiles are drawn on: "A ← B 0:08"
  const prevClip = (() => { const d = editor.doc; const f = d ? findClip(d, clip.id) : undefined; if (!d || !f || clip.type !== 'media') return null; const i = f.track.clips.findIndex((c) => c.id === clip.id); const p = i > 0 ? f.track.clips[i - 1] : null; return p && p.type === 'media' ? p : null; })();
  const nameOfClip = (c: Clip) => (c.type === 'media' ? stripExt(editor.doc?.assets[c.assetId]?.name ?? c.id) : c.type === 'text' ? c.text.slice(0, 24) : c.id);
  const chipText = tab === 'transitions' && prevClip ? SP.cutChip(nameOfClip(prevClip), nameOfClip(clip), clockOf(T.toSeconds(clip.start))) : SP.clipChip(nameOfClip(clip));
  const total = tabAll.length;
  const cutList = tab === 'transitions' ? cuts() : [];
  const pickedId = picked ?? (clip.type === 'media' ? clip.transition?.type ?? null : null);
  const applyReason = cutList.length === 0 ? SP.applyAllNone : !pickedId ? SP.applyAllNeedsPick : undefined;

  return createPortal(
    <div className="pf-ds pf-gal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="pf-gal-dialog pf-gal-spread" role="dialog" aria-modal="true" aria-labelledby="pf-gal-title" dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} data-testid="effect-gallery" data-flashes-held={guard.leftOut} tabIndex={-1} onKeyDown={onKey}>
        <div className="pf-gal-head">
          <h2 className="pf-gal-title" id="pf-gal-title">{G[tab]} <span className="num pf-gal-total">{total}</span></h2>
          <span className="pf-gal-chip" data-testid="gallery-cut-chip">{isolate(chipText)}</span>
          <input ref={searchRef} className="pf-gal-search" type="search" data-testid="gallery-search" aria-label={G.search} placeholder={G.searchPlaceholder} autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className="pf-gal-close" data-testid="gallery-close" aria-label={G.close} title={G.close} onClick={onClose}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
        <Tabs label={G.tabs} value={tab} onChange={(id) => setTab(id as TabId)} panelPrefix="pf-gal-panel" tabs={tabs.map((id) => ({ id, label: G[id], testId: `gallery-tab-${id}` }))} />
        {(cats.length > 0 || true) && (
          <div className="pf-gal-filters" role="group" aria-label={G.tabs}>
            <button type="button" className="pf-gal-fchip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>{SP.filterAll} <span className="num">{total}</span></button>
            <button type="button" className="pf-gal-fchip" aria-pressed={cat === 'fav'} onClick={() => setCat('fav')}>{SP.filterFav} <span className="num">{tabAll.filter((i) => favs.has(i.key)).length}</span></button>
            {cats.map((c) => <button key={c} type="button" className="pf-gal-fchip" aria-pressed={cat === c} onClick={() => setCat(c)}>{catName(c)} <span className="num">{catCount(c)}</span></button>)}
          </div>
        )}
        <div className="pf-gal-body">
          {!adjustment && (tab === 'effects' || tab === 'looks') && <ApplyToGroup value={applyTo} onChange={setApplyTo} />}
          <p className="pf-gal-note" role="status">{tab !== 'text' && snap === null ? G.noFrame : G.thumbNote}</p>
          {tab === 'motion' && <p className="pf-gal-note pf-gal-note-small" data-testid="gallery-motion-note">{G.motionNote}</p>}
          {tabs.map(panel)}
        </div>
        {/* always present, outside the scrolling list, so what became of a pick is on screen wherever the list is scrolled to */}
        <p className="pf-gal-status" role="status" data-testid="gallery-status" data-kind={status?.kind}>
          {status && <>{status.text}{status.reason && <> <bdi dir="auto" data-testid="gallery-status-reason">{status.reason}</bdi></>}</>}
        </p>
        <div className="pf-gal-foot">
          <span className="pf-gal-hint">{SP.hint}</span>
          {tab === 'transitions' && (
            <>
              <Button variant="ghost" size="md" disabledReason={cutList.length === 0 ? SP.shuffleWhy : undefined} onClick={() => void applyAll('', true)} data-testid="gallery-shuffle">{SP.shuffle}</Button>
              <Button variant="primary" size="md" disabledReason={applyReason} onClick={() => pickedId && void applyAll(pickedId, false)} data-testid="gallery-apply-all">{SP.applyAll(cutList.length)}</Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
