/**
 * Visual browser for the selected clip's looks: effects, colour looks, transitions and text styles, each as a live thumbnail.
 * Thumbnails go through the same evaluate + drawGraph as the preview (ADR-0005), one tile at a time. Picking a tile is an ordinary
 * registered op through editor.commit; nothing here keeps project state.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import * as T from '@pulseframe/time';
import { applyTransaction, COLOR_LOOKS, createProject, EFFECTS, MOTION_PRESETS, TEXT_PRESETS, TRANSITIONS, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { drawGraph, evaluate, type FrameImage } from '@pulseframe/engine';
import type { Key } from '@pulseframe/i18n';
import { ensureFonts } from '../fonts.ts';
import { useEditorState } from './store.ts';
import { GALLERY_STRINGS } from './gallery.strings.ts';
import './effectGallery.css';

type Kind = 'effect' | 'look' | 'transition' | 'text' | 'motion';
type TabId = 'effects' | 'looks' | 'transitions' | 'text' | 'motion';
const TAB_KIND: Record<TabId, Kind> = { effects: 'effect', looks: 'look', transitions: 'transition', text: 'text', motion: 'motion' };
const MOTION_GROUPS = ['in', 'out', 'loop', 'move'] as const;
const MOTION_FRAMES = 60;
const CATEGORIES = ['color', 'blur', 'light', 'stylize', 'digital', 'key', 'distort', 'motion'] as const;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const LONG_SIDE = 180;
const RATE = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, RATE);
const FRAME_AT = 12; // 0.4 s at 30 fps, so time-driven effects show something
const TRANSITION_FRAMES = 15;

interface Item { key: string; kind: Kind; id: string; he: string; en: string; gpu: boolean; category?: string; mkind?: (typeof MOTION_GROUPS)[number]; mframes?: number }
const ITEMS: Item[] = [
  ...EFFECTS.map((e) => ({ key: `effect:${e.id}`, kind: 'effect' as const, id: e.id, he: e.name.he, en: e.name.en, gpu: e.cost === 'gpu', category: e.category })),
  ...COLOR_LOOKS.map((l) => ({ key: `look:${l.id}`, kind: 'look' as const, id: l.id, he: l.name.he, en: l.name.en, gpu: true })),
  ...TRANSITIONS.map((x) => ({ key: `transition:${x.id}`, kind: 'transition' as const, id: x.id, he: x.name.he, en: x.name.en, gpu: x.gpu })),
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
    const a = step(s.base, [addPicture(s, s.a, 0, 60), addPicture(s, s.b, 60, 60)]);
    const clipId = a.out[1]!.clipId as string;
    return { doc: step(a.doc, [{ op: 'set_transition', args: { clipId, type: it.id, frames: TRANSITION_FRAMES } }]).doc, frame: 60 + Math.floor(TRANSITION_FRAMES / 2) };
  }
  if (it.kind === 'text') {
    const doc = { ...s.base, settings: { ...s.base.settings, background: '#2b2b2b' } };
    const a = step(doc, [{ op: 'add_text', args: { text: GALLERY_STRINGS.he.sample, start: f(0), duration: f(150) } }]);
    return { doc: step(a.doc, [{ op: 'apply_text_preset', args: { clipId: a.out[0]!.clipId as string, presetId: it.id } }]).doc, frame: FRAME_AT };
  }
  const a = step(s.base, [addPicture(s, s.a, 0, 150)]);
  const clipId = a.out[0]!.clipId as string;
  const op: OpCall = it.kind === 'look' ? { op: 'apply_look', args: { clipId, lookId: it.id } } : { op: 'add_effect', args: { clipId, type: it.id } };
  return { doc: step(a.doc, [op]).doc, frame: FRAME_AT };
}

const sameParams = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(b).every((k) => a[k] === b[k]);
function pressed(clip: Clip, it: Item): boolean {
  if (it.kind === 'transition') return clip.type === 'media' && clip.transition?.type === it.id;
  if (it.kind === 'text' || it.kind === 'motion') return false;
  const fx = clip.type === 'caption' ? [] : clip.effects ?? [];
  if (it.kind === 'effect') return fx.some((e) => e.type === it.id);
  const look = COLOR_LOOKS.find((l) => l.id === it.id)!;
  return fx.some((e) => e.type === 'color.grade' && sameParams(e.params as Record<string, unknown>, look.params));
}

export function EffectGalleryButton({ clip, trackKind }: { clip: Clip; trackKind: string }) {
  const { state } = useEditorState();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const G = GALLERY_STRINGS[state.lang];
  return (
    <>
      <button ref={btn} type="button" data-testid="gallery-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>{G.open}</button>
      {open && <EffectGallery clip={clip} trackKind={trackKind} onClose={() => { setOpen(false); setTimeout(() => btn.current?.focus(), 0); }} />}
    </>
  );
}

function EffectGallery({ clip, trackKind, onClose }: { clip: Clip; trackKind: string; onClose: () => void }) {
  const { editor, state, t } = useEditorState();
  const lang = state.lang;
  const G = GALLERY_STRINGS[lang];
  const gpuOk = !!state.gpu?.available;
  const isText = clip.type === 'text';
  const media = clip.type === 'media' && trackKind === 'video';
  const tabs = useMemo<TabId[]>(() => [...(isText || media ? (['effects', 'looks'] as TabId[]) : []), ...(media ? (['transitions'] as TabId[]) : []), ...(isText ? (['text'] as TabId[]) : []), ...(isText || media ? (['motion'] as TabId[]) : [])], [isText, media]);
  const [tab, setTab] = useState<TabId>(tabs[0] ?? 'effects');
  const [query, setQuery] = useState('');
  const [snap, setSnap] = useState<{ bitmap: ImageBitmap; dim: ImageBitmap; w: number; h: number } | null | undefined>(undefined);
  const [rendered, setRendered] = useState<ReadonlySet<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const done = useRef(new Set<string>());
  const running = useRef<Promise<void>>(Promise.resolve());
  const [hot, setHot] = useState<string | null>(null);
  const motionDocs = useRef(new Map<string, { doc: ProjectDocument; frame: number }>());
  const motionDoc = (it: Item) => {
    let d = motionDocs.current.get(it.key);
    if (!d) { d = buildDoc(motionScene, it, isText); motionDocs.current.set(it.key, d); }
    return d;
  };
  const settings = editor.doc?.settings;
  const aspect = settings ? settings.width / settings.height : 16 / 9;
  const [tw, th] = aspect >= 1 ? [LONG_SIDE, Math.max(16, Math.round(LONG_SIDE / aspect))] : [Math.max(16, Math.round(LONG_SIDE * aspect)), LONG_SIDE];

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
        setSnap({ bitmap, dim, w: tw, h: th });
      } catch { if (!dead) setSnap(null); }
    })();
    return () => { dead = true; made.forEach((b) => b.close()); };
  }, [tw, th]);

  const tabItems = useMemo(() => ITEMS.filter((i) => i.kind === TAB_KIND[tab]), [tab]);
  const q = query.trim().toLowerCase();
  const matches = (i: Item) => !q || i.he.toLowerCase().includes(q) || i.en.toLowerCase().includes(q);
  const visibleKey = tabItems.filter(matches).map((i) => i.key).join('|');

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
          setRendered(new Set(done.current));
        } catch { /* this tile stays blank and unmarked */ }
        await new Promise((r) => setTimeout(r));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, visibleKey, snap, gpuOk, tw, th]);

  // Animate only the hot motion tile: one drawGraph at a time, about 30 fps, stopped on leave / blur / tab change / close.
  useEffect(() => { setHot(null); }, [tab]);
  useEffect(() => {
    if (!hot || tab !== 'motion') return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const it = ITEMS.find((i) => i.key === hot);
    const canvas = canvases.current.get(hot);
    if (!it || !canvas || (!isText && !snap)) return;
    const { doc, frame } = motionDoc(it);
    const provider = async (): Promise<FrameImage | null> => (snap ? { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(snap.bitmap, dx, dy, dw, dh) } : null);
    const ctx = canvas.getContext('2d')!;
    let stop = false;
    let busy: Promise<unknown> = Promise.resolve();
    let startAt = 0, last = -1, raf = 0;
    const tick = (now: number) => {
      if (stop) return;
      raf = requestAnimationFrame(tick);
      if (!startAt) startAt = now;
      const n = Math.floor(((now - startAt) * 30) / 1000) % MOTION_FRAMES;
      if (n === last || inflight) return;
      last = n;
      inflight = true;
      busy = drawGraph(ctx, evaluate(doc, f(n)), provider).catch(() => undefined).finally(() => { inflight = false; });
    };
    let inflight = false;
    const prev = running.current;
    void prev.then(() => { if (!stop) raf = requestAnimationFrame(tick); });
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      void busy.then(() => { if (canvases.current.get(it.key) === canvas) return drawGraph(ctx, evaluate(doc, f(frame)), provider); }).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hot, tab, snap]);

  const commit = (it: Item) => {
    const clipId = clip.id;
    const call: OpCall = it.kind === 'effect' ? { op: 'add_effect', args: { clipId, type: it.id } }
      : it.kind === 'look' ? { op: 'apply_look', args: { clipId, lookId: it.id } }
      : it.kind === 'transition' ? { op: 'set_transition', args: { clipId, type: it.id } }
      : it.kind === 'motion' ? { op: 'apply_motion_preset', args: { clipId, presetId: it.id } }
      : { op: 'apply_text_preset', args: { clipId, presetId: it.id } };
    void editor.commit([call], `Gallery: ${it.id}`);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // keys typed here are not editor shortcuts
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Tab') {
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0]!, last = nodes[nodes.length - 1]!, at = document.activeElement;
      if (e.shiftKey && (at === first || !dialogRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
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

  const tileOf = (it: Item) => {
    const unavailable = it.gpu && !gpuOk;
    const name = lang === 'he' ? it.he : it.en;
    return (
      <button key={it.key} type="button" className="pf-gal-tile" data-testid="gallery-tile" data-kind={it.kind} data-id={it.id}
        data-rendered={rendered.has(it.key) ? '1' : undefined} data-unavailable={unavailable ? '1' : undefined}
        disabled={unavailable} aria-pressed={pressed(clip, it)} hidden={!matches(it)} onClick={() => commit(it)}
        onPointerEnter={it.kind === 'motion' ? () => setHot(it.key) : undefined} onPointerLeave={it.kind === 'motion' ? () => setHot((h) => (h === it.key ? null : h)) : undefined}
        onFocus={it.kind === 'motion' ? () => setHot(it.key) : undefined} onBlur={it.kind === 'motion' ? () => setHot((h) => (h === it.key ? null : h)) : undefined}>
        <canvas ref={(c) => { if (c) canvases.current.set(it.key, c); else canvases.current.delete(it.key); }} width={tw} height={th} aria-hidden="true" style={{ ['--pf-gal-aspect' as string]: `${tw} / ${th}` }} />
        <span className="pf-gal-name"><bdi>{name}</bdi></span>
        {unavailable && <span className="pf-gal-unavail">{G.needsGpu}</span>}
      </button>
    );
  };

  const panel = (id: TabId) => {
    const items = ITEMS.filter((i) => i.kind === TAB_KIND[id]);
    const shown = id === tab ? items.filter(matches).length : 0;
    return (
      <div key={id} id={`pf-gal-panel-${id}`} role="tabpanel" aria-labelledby={`pf-gal-tab-${id}`} hidden={id !== tab} data-testid={`gallery-panel-${id}`}>
        {id === 'effects'
          ? CATEGORIES.map((c) => {
            const group = items.filter((i) => i.category === c);
            if (!group.some(matches)) return null;
            return (
              <section key={c} aria-labelledby={`pf-gal-cat-${c}`}>
                <h3 className="pf-gal-heading" id={`pf-gal-cat-${c}`}>{t(`look.cat.${c}` as Key)}</h3>
                <div className="pf-gal-grid">{group.map(tileOf)}</div>
              </section>
            );
          })
          : id === 'motion'
            ? MOTION_GROUPS.map((g) => {
              const group = items.filter((i) => i.mkind === g);
              if (!group.some(matches)) return null;
              return (
                <section key={g} aria-labelledby={`pf-gal-mot-${g}`}>
                  <h3 className="pf-gal-heading" id={`pf-gal-mot-${g}`} data-testid={`gallery-motion-group-${g}`}>{G.motionGroups[g]}</h3>
                  <div className="pf-gal-grid">{group.map(tileOf)}</div>
                </section>
              );
            })
            : <div className="pf-gal-grid">{items.map(tileOf)}</div>}
        {id === tab && shown === 0 && <div className="pf-gal-empty" role="status">{G.empty}</div>}
      </div>
    );
  };

  return createPortal(
    <div className="pf-gal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="pf-gal-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-gal-title" dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} data-testid="effect-gallery" onKeyDown={onKey}>
        <div className="pf-gal-head">
          <h2 className="pf-gal-title" id="pf-gal-title">{G.title}</h2>
          <input ref={searchRef} className="pf-gal-search" type="search" data-testid="gallery-search" aria-label={G.search} placeholder={G.searchPlaceholder} autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" data-testid="gallery-close" onClick={onClose}>{G.close}</button>
        </div>
        <div className="pf-gal-tabs" role="tablist" aria-label={G.tabs}>
          {tabs.map((id) => (
            <button key={id} type="button" role="tab" id={`pf-gal-tab-${id}`} className="pf-gal-tab" data-testid={`gallery-tab-${id}`} aria-selected={id === tab} aria-controls={`pf-gal-panel-${id}`} tabIndex={id === tab ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab(id)}>{G[id]}</button>
          ))}
        </div>
        <div className="pf-gal-body">
          <p className="pf-gal-note" role="status">{tab !== 'text' && snap === null ? G.noFrame : G.thumbNote}</p>
          {tab === 'motion' && <p className="pf-gal-note pf-gal-note-small" data-testid="gallery-motion-note">{G.motionNote}</p>}
          {tabs.map(panel)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
