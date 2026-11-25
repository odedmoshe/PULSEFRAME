/**
 * Library SVG to PNG (wave 7 library track, worker A; plan §4.2). Third-party SVG is untrusted input:
 *   1. its bytes are read through paths.ts (containment, size/hash checks), at most SVG_MAX_BYTES, decoded as strict UTF-8;
 *      an Iconify icon is built as `<svg viewBox …>` around its body from the checked set file;
 *   2. core sanitiseSvg refuses (never repairs) anything unsafe: 422 svg_unsafe, and ffmpeg is never started;
 *   3. width and height of the root are set so the long side is the size asked for (the short side even, as elements.ts does);
 *      `currentColor` becomes the chosen #RRGGBB; the result is checked again;
 *   4. elements.ts rasteriseCheckedSvg draws it in a private empty folder through the shared queue.
 * `libraryRasterRuns` counts step 4 (the proof checks that an unsafe SVG never gets there).
 */
import { createHash } from 'node:crypto';
import { sanitiseSvg, SVG_MAX_BYTES } from '@pulseframe/core';
import { rasteriseCheckedSvg } from '../elements.ts';
import type { SynthLane } from '../sfx.ts';
import { libraryError, MAX_METADATA_BYTES } from './contract.ts';
import type { IndexedRow } from './index.ts';
import { readChecked } from './paths.ts';

export let libraryRasterRuns = 0;

const svgUnsafe = (why: string) => libraryError('svgUnsafe', {}, why);
/** The checked SVG text of a row (a file, or an icon of a set file), with the SHA-256 of the bytes it came from. */
export async function svgOfRow(rootReal: string, ix: IndexedRow): Promise<{ svg: string; sourceSha256: string }> {
  if (ix.member === null) {
    if (ix.bytes > SVG_MAX_BYTES) throw svgUnsafe(`it is larger than ${SVG_MAX_BYTES} bytes`);
    const { bytes, sha256 } = await readChecked(rootReal, ix, SVG_MAX_BYTES);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw svgUnsafe('it is not plain UTF-8 text'); }
    const c = sanitiseSvg(text);
    if (!c.ok) throw svgUnsafe(c.why);
    return { svg: c.svg, sourceSha256: sha256 };
  }
  const { bytes } = await readChecked(rootReal, ix, MAX_METADATA_BYTES);
  let set: { icons?: Record<string, { body?: unknown; width?: unknown; height?: unknown; left?: unknown; top?: unknown }>; width?: unknown; height?: unknown; left?: unknown; top?: unknown };
  try { set = JSON.parse(bytes.toString('utf8')); } catch { throw libraryError('changedSinceIndex', { reason: 'the icon set is not JSON' }); }
  const icon = set.icons && Object.hasOwn(set.icons, ix.member) ? set.icons[ix.member] : undefined;
  if (!icon || typeof icon.body !== 'string') throw libraryError('changedSinceIndex', { reason: 'the icon is not in its set' });
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const w = n(icon.width, n(set.width, 16)), h = n(icon.height, n(set.height, 16)), l = n(icon.left, n(set.left, 0)), t = n(icon.top, n(set.top, 0));
  if (w <= 0 || h <= 0) throw svgUnsafe('it has no size');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${l} ${t} ${w} ${h}" width="${w}" height="${h}">${icon.body}</svg>`;
  const c = sanitiseSvg(svg);
  if (!c.ok) throw svgUnsafe(c.why);
  return { svg: c.svg, sourceSha256: createHash('sha256').update(svg).digest('hex') };
}

const ROOT_TAG = /<((?:[A-Za-z_][\w.-]*:)?svg)(\s[^>]*?)?(\/?)>/;
const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']*)\\1`).exec(tag)?.[2];
/** The SVG with the root's width and height set so its long side is `longSide` (short side even), and currentColor replaced. */
export function sizedSvg(svg: string, longSide: number, color?: string): string {
  const m = ROOT_TAG.exec(svg);
  if (!m) throw svgUnsafe('it does not start with an svg element');
  const attrs = m[2] ?? '';
  const vb = attr(attrs, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  const num = (v?: string) => (v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? parseFloat(v) : NaN);
  let w = vb && vb.length === 4 ? vb[2]! : num(attr(attrs, 'width'));
  let h = vb && vb.length === 4 ? vb[3]! : num(attr(attrs, 'height'));
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) throw svgUnsafe('it has no size');
  const k = longSide / Math.max(w, h);
  const even = (x: number) => (x % 2 === 0 ? x : x < longSide ? x + 1 : x - 1);
  const W = w >= h ? longSide : even(Math.max(1, Math.round(w * k)));
  const H = h > w ? longSide : even(Math.max(1, Math.round(h * k)));
  w = W; h = H;
  const rest = attrs.replace(/\s(width|height)\s*=\s*(["'])[^"']*\2/g, '');
  const viewBox = attr(attrs, 'viewBox') === undefined ? ` viewBox="0 0 ${num(attr(attrs, 'width'))} ${num(attr(attrs, 'height'))}"` : '';
  let out = svg.replace(ROOT_TAG, `<${m[1]}${rest}${viewBox} width="${w}" height="${h}"${m[3]}>`);
  if (color) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw libraryError('svgUnsafe', {}, 'the colour is not #RRGGBB');
    out = out.replace(/currentColor/g, color);
  }
  const c = sanitiseSvg(out);
  if (!c.ok) throw svgUnsafe(c.why);
  return c.svg;
}

/** PNG bytes of a library SVG row at `longSide` (default colour for currentColor: black). */
export async function rasteriseRow(tmpDir: string, rootReal: string, ix: IndexedRow, longSide: number, color: string | undefined, lane: SynthLane): Promise<{ png: Buffer; sourceSha256: string }> {
  const { svg, sourceSha256 } = await svgOfRow(rootReal, ix);
  const sized = sizedSvg(svg, longSide, color ?? '#000000');
  libraryRasterRuns++;
  const png = await rasteriseCheckedSvg(tmpDir, sized, longSide, createHash('sha256').update(sized).digest('hex'), lane);
  return { png, sourceSha256 };
}
