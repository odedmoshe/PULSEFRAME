/**
 * A radiogroup of style tiles drawn by the shared evaluate + compositor path (ADR-0005), used by the text styles and the caption
 * looks (UX_REDESIGN §4.4). Each tile is a small in-memory project built through the real ops and drawn over the dimmed frame on
 * screen; it is never a CSS fake. One tile is drawn at a time and the drawn tiles are kept for the same picture, so reopening
 * a panel does not draw them again. Until a tile is drawn it shows the dimmed frame, never black.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { drawGraph, evaluate, type FrameImage } from '@pulseframe/engine';
import type { ProjectDocument } from '@pulseframe/core';
import { ensureFonts } from '../fonts.ts';
import { useEditorState } from './store.ts';
import { thumbSize } from './gallery.pick.ts';
import { nextTileIndex, tabStopIndex } from './styleTiles.nav.ts';
import { f, makeScene, type Scene } from './EffectGallery.tsx';
import { CheckIcon } from '../ds/util.tsx';
import './styleTiles.css';

export interface StyleItem { id: string; name: string; hint?: string; build: (scene: Scene, bg: string) => { doc: ProjectDocument; frame: number } }
interface Snap { bitmap: ImageBitmap; dim: ImageBitmap; key: string }

const cache = new Map<string, ImageBitmap>();
const CAP = 200;
const put = (k: string, bm: ImageBitmap) => { cache.get(k)?.close(); cache.delete(k); cache.set(k, bm); while (cache.size > CAP) { const o = cache.keys().next().value as string; cache.get(o)?.close(); cache.delete(o); } };

/** The picture on screen, once, at the tile size, with a dimmed copy to draw the styles over. null: the preview shows no picture. */
function useDimFrame(tw: number, th: number): Snap | null | undefined {
  const { editor, state } = useEditorState();
  const [snap, setSnap] = useState<Snap | null | undefined>(undefined);
  const frame = editor.frame;
  useEffect(() => {
    let dead = false;
    let made: ImageBitmap[] = [];
    const timer = window.setTimeout(() => void (async () => {
      let preview = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
      // The preview may not have drawn its first picture yet (the editor is still starting): look again a few times, and take the
      // picture only once it has something in it; a picture that really is black is taken after the last look.
      const hasPicture = async (c: HTMLCanvasElement) => {
        try {
          const probe = new OffscreenCanvas(8, 8); const g = probe.getContext('2d')!;
          g.drawImage(c, 0, 0, 8, 8);
          return g.getImageData(0, 0, 8, 8).data.some((v, i) => i % 4 !== 3 && v > 12);
        } catch { return true; }
      };
      for (let i = 0; i < 12 && !dead; i++) {
        if (preview && preview.width && preview.height && (await hasPicture(preview))) break;
        await new Promise((r) => setTimeout(r, 400));
        preview = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
      }
      if (dead) return;
      if (!preview || !preview.width || !preview.height) { setSnap(null); return; }
      try {
        const bitmap = await createImageBitmap(preview, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'medium' });
        const c = new OffscreenCanvas(tw, th);
        const g = c.getContext('2d')!;
        g.filter = 'grayscale(1) brightness(0.4)';
        g.drawImage(bitmap, 0, 0);
        const dim = await createImageBitmap(c);
        made = [bitmap, dim];
        if (dead) { made.forEach((b) => b.close()); return; }
        setSnap({ bitmap, dim, key: `${state.doc?.id}:${state.revision}:${frame}:${tw}x${th}` });
      } catch { if (!dead) setSnap(null); }
    })(), editor.player?.playing ? 1500 : 250); // a moving picture is not re-taken at every frame
    return () => { dead = true; window.clearTimeout(timer); made.forEach((b) => b.close()); };
  }, [tw, th, state.revision, frame]); // eslint-disable-line react-hooks/exhaustive-deps
  return snap;
}

export interface StyleTilesProps {
  items: readonly StyleItem[];
  /** the id of the item that is on the object now, if any */
  value: string | null;
  onPick: (id: string) => void;
  label: string;
  testId: string;
  /** when set, tiles are shown but cannot be applied, and this says why */
  disabledReason?: string;
  /** distinguishes drawn tiles of different words/looks in the cache */
  cacheTag: string;
  appliedLabel: string;
}
export function StyleTiles({ items, value, onPick, label, testId, disabledReason, cacheTag, appliedLabel }: StyleTilesProps) {
  const { editor } = useEditorState();
  const settings = editor.viewDoc?.settings;
  const [tw, th] = thumbSize(settings?.width ?? 16, settings?.height ?? 9, 150);
  const snap = useDimFrame(tw, th);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(new Set());
  const key = useMemo(() => items.map((i) => i.id).join('|'), [items]);

  // poster first: the dimmed frame, so no tile is ever black
  useEffect(() => {
    if (!snap) return;
    for (const [id, c] of canvases.current) { if (drawn.has(id)) continue; c.getContext('2d')?.drawImage(snap.dim, 0, 0, c.width, c.height); }
  }, [snap, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (snap === undefined) return;
    let stop = false;
    setDrawn(new Set());
    void (async () => {
      await ensureFonts();
      const scene = makeScene(tw, th);
      const bitmaps = new Map<string, ImageBitmap>();
      if (snap) { bitmaps.set(scene.a, snap.dim); bitmaps.set(scene.b, snap.bitmap); }
      const provider = async (l: { assetId: string }): Promise<FrameImage | null> => { const bm = bitmaps.get(l.assetId); return bm ? { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bm, dx, dy, dw, dh) } : null; };
      const done = new Set<string>();
      for (const it of items) {
        if (stop) return;
        const c = canvases.current.get(it.id);
        if (!c) continue;
        const ck = `${snap?.key ?? 'none'}|${cacheTag}|${it.id}`;
        const hit = cache.get(ck);
        const g = c.getContext('2d')!;
        if (hit) { g.clearRect(0, 0, c.width, c.height); g.drawImage(hit, 0, 0, c.width, c.height); done.add(it.id); setDrawn(new Set(done)); continue; }
        try {
          const { doc, frame } = it.build(scene, '#202020');
          const r = await drawGraph(g, evaluate(doc, f(frame)), provider);
          if (stop) return;
          if (r.missing.length || r.unavailableEffects.length) continue;
          done.add(it.id); setDrawn(new Set(done));
          void createImageBitmap(c).then((bm) => put(ck, bm)).catch(() => undefined);
        } catch { /* this tile keeps its poster */ }
        await new Promise((r) => setTimeout(r));
      }
    })();
    return () => { stop = true; };
  }, [snap, key, cacheTag, tw, th]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = tabStopIndex(items.map((i) => i.id), value);
  const gridRef = useRef<HTMLDivElement>(null);
  /** arrows move focus between the tiles (one Tab stop for the group); Space and Enter choose, so moving never edits the project */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('button[role=radio]') ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const first = tiles[0]?.getBoundingClientRect().top;
    const columns = tiles.filter((t) => t.getBoundingClientRect().top === first).length;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const next = nextTileIndex(e.key, at, tiles.length, columns, rtl);
    if (next === null) return;
    e.preventDefault();
    tiles[next]?.focus();
  };
  return (
    <div ref={gridRef} className="pf-ds pf-st-grid" role="radiogroup" aria-label={label} data-testid={testId} onKeyDown={onKeyDown}>
      {items.map((it, idx) => {
        const on = value === it.id;
        return (
          <button key={it.id} type="button" role="radio" aria-checked={on} tabIndex={idx === stop ? 0 : -1} className={`pf-st-tile${on ? ' is-on' : ''}${disabledReason ? ' is-locked' : ''}`} data-value={it.id} data-drawn={drawn.has(it.id) ? '1' : undefined}
            aria-disabled={disabledReason ? true : undefined} title={disabledReason ?? it.hint} onClick={() => { if (!disabledReason) onPick(it.id); }}>
            <span className="pf-st-img" aria-hidden="true">
              <canvas width={tw} height={th} style={{ aspectRatio: `${tw} / ${th}` }} ref={(c) => { if (c) canvases.current.set(it.id, c); else canvases.current.delete(it.id); }} />
              {!drawn.has(it.id) && <i className="pf-st-shimmer" />}
              {on && <span className="pf-st-check"><CheckIcon size={14} strokeWidth={2.5} /></span>}
            </span>
            <span className="pf-st-name"><bdi>{it.name}</bdi></span>
            {on && <span className="pf-st-sr">{appliedLabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
