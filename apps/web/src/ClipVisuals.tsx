import { useEffect, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import type { Asset } from '@pulseframe/core';
import { peaksForColumns, pickWaveformLevel, sampleIndexNearest, thumbnailIndexForSlot, type WaveformLevel } from './clipVisuals.math.ts';
import './clip-visuals.css';

/** Filmstrip / waveform layer for a timeline clip, drawn only from the server's ingest derivatives (SPEC §7, §11). */

interface ThumbMeta { tileWidth: number; tileHeight: number; columns: number; rows: number; count: number; frameIndices: number[] }
interface WaveMeta { sampleRate: number; totalSamples: number; levels: WaveformLevel[] }
type Entry = { kind: 'thumbnails'; bitmap: ImageBitmap } | { kind: 'waveform'; buffer: ArrayBuffer };
type Status = 'queued' | 'running' | 'ready' | 'failed' | 'not-applicable';
type LayerState = 'processing' | 'ready' | 'failed' | 'none';

// ---- bounded LRU cache (spec: bounded caches), keyed by content hash + kind ----
const CACHE_LIMIT = 24;
const cache = new Map<string, Entry>();
function cacheGet(key: string): Entry | undefined {
  const e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); }
  return e;
}
function cachePut(key: string, e: Entry) {
  const old = cache.get(key);
  if (old && old !== e && old.kind === 'thumbnails') old.bitmap.close();
  cache.delete(key);
  cache.set(key, e);
  while (cache.size > CACHE_LIMIT) {
    const [k, v] = cache.entries().next().value as [string, Entry];
    cache.delete(k);
    if (v.kind === 'thumbnails') v.bitmap.close();
  }
}

const isThumbMeta = (m: any): m is ThumbMeta =>
  !!m && [m.tileWidth, m.tileHeight, m.columns, m.rows].every((n) => Number.isInteger(n) && n > 0) && Array.isArray(m.frameIndices) && m.frameIndices.length > 0 && m.frameIndices.every(Number.isInteger);
const isWaveMeta = (m: any): m is WaveMeta =>
  !!m && Number.isInteger(m.sampleRate) && m.sampleRate > 0 && Number.isInteger(m.totalSamples) && Array.isArray(m.levels) && m.levels.length > 0 &&
  m.levels.every((l: any) => Number.isInteger(l?.samplesPerBucket) && l.samplesPerBucket > 0 && Number.isInteger(l.buckets) && Number.isInteger(l.byteOffset));

interface Loaded { key: string; meta: ThumbMeta | WaveMeta }
const dprNow = () => Math.min(2, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

export function ClipVisuals(props: {
  projectId: string;
  asset: Asset;
  kind: 'video' | 'audio';
  sourceIn: T.RationalTime;
  duration: T.RationalTime;
  widthPx: number;
  heightPx: number;
  refreshKey: number;
}) {
  const { projectId, asset, kind, sourceIn, duration, widthPx, heightPx, refreshKey } = props;
  const want = kind === 'video' ? 'thumbnails' : 'waveform';
  const applicable = asset.kind !== 'image' && (kind === 'video' ? asset.kind === 'video' && !!asset.video : !!asset.audio);
  const [layer, setLayer] = useState<LayerState>('none');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const assetId = asset.id;
  const hash = asset.contentHash;

  // Load the derivative list once per (project, content hash, refreshKey), then the blob if ready.
  useEffect(() => {
    if (!applicable) { setLayer('none'); setLoaded(null); return; }
    const ac = new AbortController();
    const base = `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/derivatives`;
    const init: RequestInit = { credentials: 'same-origin', signal: ac.signal };
    (async () => {
      try {
        const r = await fetch(base, init);
        if (!r.ok) throw new Error(`derivatives ${r.status}`);
        const list = (await r.json()) as { derivatives: { kind: string; status: Status; meta: unknown }[] };
        const row = list.derivatives.find((d) => d.kind === want);
        if (!row || row.status === 'not-applicable') { setLayer('none'); setLoaded(null); return; }
        if (row.status === 'queued' || row.status === 'running') { setLayer('processing'); setLoaded(null); return; }
        if (row.status === 'failed') { setLayer('failed'); setLoaded(null); return; }
        const meta = row.meta;
        const key = `${hash}|${want}`;
        const valid = want === 'thumbnails' ? isThumbMeta(meta) : isWaveMeta(meta);
        if (!valid) { setLayer('failed'); setLoaded(null); return; }
        if (!cacheGet(key)) {
          const b = await fetch(`${base}/${want}`, init);
          if (!b.ok) throw new Error(`derivative blob ${b.status}`);
          if (want === 'thumbnails') cachePut(key, { kind: 'thumbnails', bitmap: await createImageBitmap(await b.blob()) });
          else cachePut(key, { kind: 'waveform', buffer: await b.arrayBuffer() });
        }
        if (ac.signal.aborted) return;
        setLoaded({ key, meta: meta as ThumbMeta | WaveMeta });
        setLayer('ready');
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
        setLayer('failed');
        setLoaded(null);
      }
    })();
    return () => ac.abort();
  }, [projectId, assetId, hash, want, applicable, refreshKey, reload]);

  // Draw. Rational math decides what is shown; only pixel positions are floats.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = layerRef.current;
    host?.removeAttribute('data-drawn');
    if (!canvas || !host || layer !== 'ready' || !loaded || widthPx <= 0 || heightPx <= 0) return;
    const entry = cacheGet(loaded.key);
    if (!entry) { setReload((n) => n + 1); return; } // evicted meanwhile: fetch again
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
        const m = loaded.meta as ThumbMeta;
        const rate = asset.video?.frameRate;
        if (!rate || entry.bitmap.width === 0) return;
        const tw = (heightPx * m.tileWidth) / m.tileHeight; // display tile width in CSS px
        const slots = Math.ceil(widthPx / tw);
        for (let j = 0; j < slots; j++) {
          const i = thumbnailIndexForSlot({ sourceIn, duration, widthPx, slotCentrePx: j * tw + tw / 2, frameRate: rate, frameIndices: m.frameIndices });
          ctx.drawImage(entry.bitmap, (i % m.columns) * m.tileWidth, Math.floor(i / m.columns) * m.tileHeight, m.tileWidth, m.tileHeight, j * tw * dpr, 0, tw * dpr, H);
        }
      } else if (entry.kind === 'waveform' && want === 'waveform') {
        const m = loaded.meta as WaveMeta;
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
          ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
      } else return;
      host.setAttribute('data-drawn', '1');
    } catch {
      // A bitmap closed by eviction mid-draw: reload instead of showing anything invented.
      setReload((n) => n + 1);
    }
  }, [layer, loaded, widthPx, heightPx, sourceIn.value, sourceIn.timescale, duration.value, duration.timescale, asset.video?.frameRate.num, asset.video?.frameRate.den, want]);

  if (!applicable || layer === 'none') return null;
  const state = layer === 'ready' ? 'ready' : layer === 'failed' ? 'failed' : 'processing';
  return (
    <div ref={layerRef} className="clip-visual" data-testid="clip-visual" data-kind={kind} data-derivative-state={state} aria-hidden="true">
      {state === 'ready' && <canvas ref={canvasRef} />}
    </div>
  );
}
