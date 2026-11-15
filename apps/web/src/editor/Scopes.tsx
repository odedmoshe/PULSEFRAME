/**
 * Scopes for the Color workspace: an RGB histogram and a luma waveform of the frame the preview is showing, with a few
 * numbers (darkest, brightest and average luma, and how much of the picture is crushed or clipped).
 * Read from the preview canvas itself — the same pixels export encodes (ADR-0005) — scaled down to 192 pixels wide, each
 * time the preview paints. Display only: nothing here changes the project.
 */
import { useEffect, useRef, useState } from 'react';
import { useEditorState } from './store.ts';

const W = 192, HIST_H = 64, WAVE_H = 96;
export interface ScopeStats { min: number; max: number; mean: number; crushedPct: number; clippedPct: number }

/** Histogram (three channels), luma waveform columns and summary numbers of RGBA pixels. Exported for tests. */
export function analyse(data: Uint8ClampedArray, width: number, height: number) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const wave = new Uint16Array(width * 256); // per column: how many pixels have each luma
  let min = 255, max = 0, sum = 0, crushed = 0, clipped = 0;
  const n = width * height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    hist[0]![r]!++; hist[1]![g]!++; hist[2]![b]!++;
    const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b); // BT.709, on the encoded values
    wave[x * 256 + luma]!++;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
    sum += luma;
    if (luma <= 4) crushed++;
    if (luma >= 251) clipped++;
  }
  const stats: ScopeStats = { min: n ? min : 0, max, mean: n ? Math.round((sum / n) * 10) / 10 : 0, crushedPct: n ? Math.round((crushed / n) * 1000) / 10 : 0, clippedPct: n ? Math.round((clipped / n) * 1000) / 10 : 0 };
  return { hist, wave, stats };
}

export function Scopes() {
  const { t } = useEditorState();
  const histRef = useRef<HTMLCanvasElement>(null), waveRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<(ScopeStats & { frame: string }) | null>(null);
  useEffect(() => {
    const preview = document.querySelector<HTMLCanvasElement>('[data-testid=preview]');
    if (!preview) return;
    const small = document.createElement('canvas');
    const draw = () => {
      if (!preview.width || !preview.height) return;
      const h = Math.max(1, Math.round((W * preview.height) / preview.width));
      small.width = W; small.height = h;
      const sctx = small.getContext('2d', { willReadFrequently: true })!;
      sctx.drawImage(preview, 0, 0, W, h);
      const { hist, wave, stats: st } = analyse(sctx.getImageData(0, 0, W, h).data, W, h);
      setStats({ ...st, frame: preview.dataset.frame ?? '' });
      const hc = histRef.current?.getContext('2d'), wc = waveRef.current?.getContext('2d');
      if (hc) {
        hc.clearRect(0, 0, 256, HIST_H);
        hc.globalCompositeOperation = 'lighter';
        // the tallest bin of everything but the two ends sets the scale, so a black or white background does not flatten the rest
        let top = 1;
        for (const ch of hist) for (let v = 2; v < 254; v++) top = Math.max(top, ch[v]!);
        ['#e0483c', '#3cc85a', '#4a82f0'].forEach((colour, c) => {
          hc.fillStyle = colour;
          for (let v = 0; v < 256; v++) { const bar = Math.min(HIST_H, Math.round((hist[c]![v]! / top) * HIST_H)); if (bar) hc.fillRect(v, HIST_H - bar, 1, bar); }
        });
        hc.globalCompositeOperation = 'source-over';
      }
      if (wc) {
        const img = wc.createImageData(W, WAVE_H);
        for (let x = 0; x < W; x++) for (let v = 0; v < 256; v++) {
          const count = wave[x * 256 + v]!;
          if (!count) continue;
          const y = WAVE_H - 1 - Math.round((v / 255) * (WAVE_H - 1)), i = (y * W + x) * 4, a = Math.min(255, 60 + count * 40);
          img.data[i] = 120; img.data[i + 1] = 230; img.data[i + 2] = 200; img.data[i + 3] = Math.max(img.data[i + 3]!, a);
        }
        wc.putImageData(img, 0, 0);
      }
    };
    draw();
    // the preview marks each painted frame on itself; redraw when that changes
    const mo = new MutationObserver(draw);
    mo.observe(preview, { attributes: true, attributeFilter: ['data-frame', 'data-quality', 'width', 'height'] });
    return () => mo.disconnect();
  }, []);
  return (
    <fieldset className="scopes" data-testid="scopes" data-frame={stats?.frame} data-min={stats?.min} data-max={stats?.max} data-mean={stats?.mean} data-crushed={stats?.crushedPct} data-clipped={stats?.clippedPct}>
      <legend>{t('scopes.title')}</legend>
      <figure>
        <canvas ref={histRef} width={256} height={HIST_H} className="scope" role="img" aria-label={t('scopes.histogram')} data-testid="scope-histogram" />
        <figcaption className="muted">{t('scopes.histogram')}</figcaption>
      </figure>
      <figure>
        <canvas ref={waveRef} width={W} height={WAVE_H} className="scope" role="img" aria-label={t('scopes.waveform')} data-testid="scope-waveform" />
        <figcaption className="muted">{t('scopes.waveform')}</figcaption>
      </figure>
      {stats && (
        <dl className="scope-stats">
          <dt>{t('scopes.range')}</dt><dd><bdi dir="ltr">{stats.min}–{stats.max}</bdi></dd>
          <dt>{t('scopes.mean')}</dt><dd><bdi dir="ltr">{stats.mean}</bdi></dd>
          <dt>{t('scopes.crushed')}</dt><dd><bdi dir="ltr">{stats.crushedPct}%</bdi></dd>
          <dt>{t('scopes.clipped')}</dt><dd><bdi dir="ltr">{stats.clippedPct}%</bdi></dd>
        </dl>
      )}
      <p className="muted">{t('scopes.note')}</p>
    </fieldset>
  );
}
