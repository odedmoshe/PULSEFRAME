/**
 * Render-worker page. Loaded only by the server's headless Chromium with a single-purpose token.
 * Draws every frame of an immutable snapshot with the SAME evaluator + compositor as the editor
 * and streams raw RGBA to the server. A 2D context with willReadFrequently keeps the canvas on the
 * CPU raster path, so output does not depend on a GPU.
 */
import './strictPage.ts';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { GPU_EFFECT_IDS, GPU_TRANSITION_IDS } from '@pulseframe/core';
import { drawGraph, evaluate, gpuStatus, initGpu } from '@pulseframe/engine';
import { ensureFonts } from './fonts.ts';
import { MediaPool } from './media.ts';

const token = new URLSearchParams(location.hash.slice(1)).get('token');
const base = `/api/v1/render/${token}`;
let doc: ProjectDocument;
let frameCount = 0;
let firstFrame = 0;
let outWidth = 0;
let outHeight = 0;
let ctx: CanvasRenderingContext2D;
// Export always decodes the ORIGINAL bytes (never a proxy), read by HTTP range requests.
// 12 decoders: two echo-5 clips under a transition, plus room (ADR-0005 budget, to be amended for ADR-0011 decode lanes).
const pool = new MediaPool({ assetUrl: (assetId) => `${base}/assets/${assetId}`, maxDecoders: 12 });

async function draw(index: number) {
  // `index` is relative to the exported range. Layout is resolution-independent, so a scaled output only changes the raster size.
  const g = evaluate(doc, T.frameTime(firstFrame + index, doc.settings.frameRate));
  const { missing, missingReasons, unavailableEffects, unavailableReasons } = await drawGraph(ctx, { ...g, width: outWidth, height: outHeight }, pool.frames);
  // Final renders never substitute black for media that failed to decode, and never leave out an effect that could not run.
  if (missing.length) throw new Error(`frame ${index}: source frame unavailable for clips ${missing.map((id) => (missingReasons?.[id] ? `${id} (${missingReasons[id]})` : id)).join(', ')}`);
  // An effect whose own material is missing (a colour table that could not be loaded) says so; the others need the adapter.
  const told = unavailableEffects.filter((id) => unavailableReasons?.[id]);
  const adapter = unavailableEffects.filter((id) => !unavailableReasons?.[id]);
  if (adapter.length) throw new Error(`gpu_effect_unavailable: frame ${index} uses ${adapter.join(', ')}, which needs a graphics adapter in the render worker; ${gpuStatus().reason}${told.map((id) => `; ${id}: ${unavailableReasons![id]}`).join('')}`);
  if (told.length) throw new Error(`effect_unavailable: frame ${index} cannot be drawn faithfully: ${told.map((id) => `${id}: ${unavailableReasons![id]}`).join('; ')}`);
}

const page = {
  /** Decoder counts of this page's pool (diagnostics and proofs: ADR-0011 decode lanes). */
  stats: () => pool.stats(),
  ready: (async () => {
    if (!token) throw new Error('missing render token');
    const r = await fetch(`${base}/snapshot`);
    if (!r.ok) throw new Error(`snapshot: HTTP ${r.status}`);
    ({ doc, frameCount, firstFrame, outWidth, outHeight } = await r.json());
    await ensureFonts();
    // Only when the project uses a GPU effect: the adapter check costs time and a GPU device.
    if (JSON.stringify(doc.sequences).match(new RegExp([...GPU_EFFECT_IDS, ...GPU_TRANSITION_IDS].map((id) => `"${id.replace('.', '\\.')}"`).join('|')))) await initGpu();
    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false, colorSpace: 'srgb' })!;
    document.body.append(canvas);
    return { frameCount };
  })(),
  async renderPng(index: number) {
    await draw(index);
    const blob: Blob = await new Promise((res, rej) => ctx.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  async exportAll() {
    const width = outWidth;
    const height = outHeight;
    const frameBytes = width * height * 4;
    const perBatch = Math.max(1, Math.min(16, Math.floor((24 << 20) / frameBytes)));
    let batch = new Uint8Array(frameBytes * perBatch);
    let n = 0;
    let first = 0;
    const ms = { draw: 0, readback: 0, upload: 0 };
    let mark = performance.now();
    const lap = (k: keyof typeof ms) => { const n = performance.now(); ms[k] += n - mark; mark = n; };
    const flush = async () => {
      if (!n) return;
      // Measured in Chromium 153: a Blob body uploads ~13x faster than a typed-array body (docs/BENCHMARKS.md).
      // Awaiting each POST gives end-to-end backpressure: the server answers only after the encoder accepted the bytes.
      const r = await fetch(`${base}/frames?first=${first}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Blob([batch.subarray(0, n * frameBytes)]) });
      if (!r.ok) throw new Error(`frame upload failed: HTTP ${r.status} ${await r.text()}`);
      first += n;
      n = 0;
      lap('upload');
    };
    for (let i = 0; i < frameCount; i++) {
      await draw(i);
      lap('draw');
      batch.set(ctx.getImageData(0, 0, width, height).data, n * frameBytes);
      lap('readback');
      if (++n === perBatch) await flush();
    }
    await flush();
    const media = pool.stats();
    await pool.dispose();
    const stats = { frames: frameCount, stageMs: { draw: Math.round(ms.draw), readback: Math.round(ms.readback), upload: Math.round(ms.upload) }, decoders: { peak: media.peakDecoders, max: media.maxDecoders, opened: media.opened, disposed: media.disposed, refused: media.refused } };
    return stats;
  },
};
window.__pf = page;
