import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as T from '@pulseframe/time';
import type { Asset } from '@pulseframe/core';
import { peaksForColumns, pickWaveformLevel, sampleIndexNearest, thumbnailIndexForSlot } from './clipVisuals.math.ts';
import { clipDerivativeKey, timelineDerivatives } from './clipVisuals.cache.ts';
import './clip-visuals.css';

/**
 * Filmstrip / waveform layer for a timeline clip, drawn only from the server's ingest derivatives (SPEC §7, §11).
 * The derivative is held once per file in a shared cache (clipVisuals.cache.ts): every clip of that file draws from it, and an
 * edit, a playback tick, a re-render or a derivative event of another file makes no request. The cache hears of derivative
 * events from the editor (store.ts), so this layer needs no refresh key.
 */

const dprNow = () => Math.min(2, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

export function ClipVisuals(props: {
  projectId: string;
  asset: Asset;
  kind: 'video' | 'audio';
  sourceIn: T.RationalTime;
  duration: T.RationalTime;
  widthPx: number;
  heightPx: number;
  /** The clip plays its source backwards: thumbnails run in the order the clip shows them. */
  reverse?: boolean;
}) {
  const { projectId, asset, kind, sourceIn, duration, widthPx, heightPx, reverse } = props;
  const want = kind === 'video' ? 'thumbnails' : 'waveform';
  const applicable = asset.kind !== 'image' && (kind === 'video' ? asset.kind === 'video' && !!asset.video : !!asset.audio);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const assetId = asset.id;
  const hash = asset.contentHash;
  const id = applicable ? clipDerivativeKey({ projectId, assetId, contentHash: hash, kind: want }) : null;
  // What the cache holds for this file now: the same object until it changes, so re-renders cost nothing.
  const value = useSyncExternalStore(timelineDerivatives.subscribe, () => (id ? timelineDerivatives.peek(id) : undefined));
  // This clip shows the derivative while it is on the timeline: the cache loads it if nothing is held or on its way.
  useEffect(() => {
    if (!applicable) return;
    return timelineDerivatives.use({ projectId, assetId, contentHash: hash, kind: want });
  }, [projectId, assetId, hash, want, applicable]);
  const layer = value?.state ?? null;

  // Draw. Rational math decides what is shown; only pixel positions are floats.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = layerRef.current;
    host?.removeAttribute('data-drawn');
    if (!canvas || !host || value?.state !== 'ready' || widthPx <= 0 || heightPx <= 0) return;
    const entry = value;
    const dpr = dprNow();
    const W = Math.max(1, Math.round(widthPx * dpr));
    const H = Math.max(1, Math.round(heightPx * dpr));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    try {
      if (entry.kind === 'thumbnails' && want === 'thumbnails') {
        const m = entry.meta;
        const rate = asset.video?.frameRate;
        if (!rate || entry.bitmap.width === 0) return;
        const tw = (heightPx * m.tileWidth) / m.tileHeight; // display tile width in CSS px
        const slots = Math.ceil(widthPx / tw);
        for (let j = 0; j < slots; j++) {
          const i = thumbnailIndexForSlot({ sourceIn, duration, widthPx, slotCentrePx: reverse ? Math.max(0, widthPx - (j * tw + tw / 2)) : j * tw + tw / 2, frameRate: rate, frameIndices: m.frameIndices });
          ctx.drawImage(entry.bitmap, (i % m.columns) * m.tileWidth, Math.floor(i / m.columns) * m.tileHeight, m.tileWidth, m.tileHeight, j * tw * dpr, 0, tw * dpr, H);
        }
      } else if (entry.kind === 'waveform' && want === 'waveform') {
        const m = entry.meta;
        const first = sampleIndexNearest(sourceIn, m.sampleRate);
        const count = Math.max(0, sampleIndexNearest(T.add(sourceIn, duration), m.sampleRate) - first);
        const level = pickWaveformLevel(m.levels, count, W);
        const peaks = peaksForColumns({ view: new DataView(entry.buffer), level, firstSample: first, sampleCount: count, columns: W });
        const mid = H / 2;
        const k = H / 2 / 32768;
        ctx.fillStyle = 'rgba(210, 225, 255, 0.85)';
        for (let x = 0; x < W; x++) {
          const mn = peaks[x * 2]!, mx = peaks[x * 2 + 1]!;
          if (mn === 0 && mx === 0 && first + Math.floor((x * count) / W) >= m.totalSamples) continue; // no data here
          const top = Math.max(0, mid - mx * k);
          const bottom = Math.min(H, mid - mn * k);
          ctx.fillRect(reverse ? W - 1 - x : x, top, 1, Math.max(1, bottom - top)); // a reversed clip: the wave runs the way it is heard
        }
      } else return;
      host.setAttribute('data-drawn', '1');
    } catch {
      // Nothing is drawn rather than anything invented (the cache never closes a picture a clip still shows).
    }
  }, [value, widthPx, heightPx, sourceIn.value, sourceIn.timescale, duration.value, duration.timescale, asset.video?.frameRate.num, asset.video?.frameRate.den, want, reverse]);

  // Not asked yet, or not applicable: nothing (the server has said nothing about it, so nothing is shown).
  if (!applicable || layer === null || layer === 'none') return null;
  const state = layer === 'ready' ? 'ready' : layer === 'failed' ? 'failed' : 'processing';
  return (
    <div ref={layerRef} className="clip-visual" data-testid="clip-visual" data-kind={kind} data-derivative-state={state} aria-hidden="true">
      {state === 'ready' && <canvas ref={canvasRef} />}
    </div>
  );
}
