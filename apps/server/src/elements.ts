/**
 * Graphic elements as image assets. The SVG comes from a formula in @pulseframe/core (no third-party artwork); ffmpeg's
 * librsvg decoder rasterises it to a PNG with transparency, which is stored as a normal content-addressed image asset.
 * If this ffmpeg has no SVG decoder the feature reports that honestly (501) rather than substituting anything.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ELEMENT_IDS, ELEMENTS, elementSvg, type Asset } from '@pulseframe/core';
import { describeMedia } from './ingest.ts';
import { ApiError, type Store } from './store.ts';

const exec = promisify(execFile);
const GENERATOR = 'svg by formula, rasterised by ffmpeg librsvg; no third-party content';
const COLOUR = /^#[0-9A-Fa-f]{6}$/;

let rasteriser: Promise<boolean> | undefined;
/** True when the installed ffmpeg can read SVG (it has the librsvg decoder). Checked once and remembered. */
export function canRasteriseSvg(): Promise<boolean> {
  rasteriser ??= exec('ffmpeg', ['-hide_banner', '-v', 'error', '-decoders'], { timeout: 15_000, maxBuffer: 1 << 20 }).then(({ stdout }) => /\blibrsvg\b/.test(stdout), () => false);
  return rasteriser;
}

/** ffmpeg arguments that turn an SVG file into a PNG with alpha whose longer side is `longSide` pixels (the SVG's own width and height must already be that size: see sizeSvg). */
export const elementFfmpegArgs = (svgFile: string, pngFile: string, longSide: number): string[] => [
  '-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-f', 'svg_pipe', '-i', svgFile,
  '-frames:v', '1', '-vf', `scale='if(gte(iw,ih),${longSide},-2)':'if(gte(iw,ih),-2,${longSide})',format=rgba`,
  '-c:v', 'png', '-pix_fmt', 'rgba', '-bitexact', '-fflags', '+bitexact', pngFile,
];

/** The SVG with its width and height attributes set so the longer side is `longSide` pixels (the viewBox is unchanged, so the picture is drawn sharp at that size, not scaled up afterwards). */
export function sizeSvg(svg: string, id: string, longSide: number): string {
  const def = ELEMENTS.find((e) => e.id === id)!;
  const k = longSide / Math.max(def.width, def.height);
  const w = def.width >= def.height ? longSide : Math.max(1, Math.round(def.width * k));
  const h = def.height > def.width ? longSide : Math.max(1, Math.round(def.height * k));
  return svg.replace(`width="${def.width}" height="${def.height}"`, `width="${w}" height="${h}"`);
}

interface Opts { color?: string; color2?: string; longSide?: number }
function validate(id: string, o: Opts): { svg: string; longSide: number; color: string; color2: string } {
  if (!ELEMENTS.some((e) => e.id === id)) throw new ApiError(404, 'not_found', `element "${id}" does not exist`, { available: ELEMENT_IDS }, 'Call list_catalog.');
  const longSide = o.longSide ?? 1024;
  if (!Number.isInteger(longSide) || longSide < 64 || longSide > 2048) throw new ApiError(400, 'invalid_option', 'longSide must be a whole number from 64 to 2048', { longSide });
  const color = o.color ?? '#FFFFFF', color2 = o.color2 ?? '#3DE0C8';
  for (const [k, v] of [['color', color], ['color2', color2]] as const) if (typeof v !== 'string' || !COLOUR.test(v)) throw new ApiError(400, 'invalid_option', `${k} must be a colour like #RRGGBB`, { [k]: v });
  return { svg: sizeSvg(elementSvg(id, { color, color2 }), id, longSide), longSide, color, color2 };
}

async function render(tmpDir: string, id: string, o: Opts): Promise<{ png: string; longSide: number; color: string; color2: string }> {
  const v = validate(id, o);
  if (!(await canRasteriseSvg())) throw new ApiError(501, 'element_rasteriser_missing', 'this ffmpeg cannot read SVG, so graphic elements cannot be turned into pictures', { needs: 'ffmpeg built with librsvg (decoder "librsvg")' }, 'Install an ffmpeg build with --enable-librsvg (for example the full build from your distribution), then restart the server.');
  const base = path.join(tmpDir, `el_${randomBytes(6).toString('hex')}`);
  const svgFile = `${base}.svg`, png = `${base}.png`;
  try {
    fs.writeFileSync(svgFile, v.svg);
    await exec('ffmpeg', elementFfmpegArgs(svgFile, png, v.longSide), { timeout: 30_000 });
  } catch (e) {
    fs.rmSync(png, { force: true });
    if (e instanceof ApiError) throw e;
    throw new ApiError(500, 'element_render_failed', 'the element could not be drawn', { id });
  } finally {
    fs.rmSync(svgFile, { force: true });
  }
  return { png, longSide: v.longSide, color: v.color, color2: v.color2 };
}

/** Render one element and return it as an image asset (blob stored, not yet attached to a project). */
export async function makeElement(store: Store, id: string, options: Opts, actor: string): Promise<Omit<Asset, 'id'>> {
  const def = ELEMENTS.find((e) => e.id === id);
  const r = await render(store.tmpDir, id, options);
  try {
    const bytes = fs.readFileSync(r.png);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const meta = await describeMedia(r.png);
    store.putBlob(contentHash, r.png, bytes.length, meta.mimeType);
    // provenance.procedural allows only id, version and generator, so the colours and size are not recorded there.
    return { ...meta, name: `${def!.name.en}.png`, contentHash, byteSize: bytes.length, provenance: { origin: 'generated', importedAt: new Date().toISOString(), importedBy: actor, procedural: { id: def!.id, version: def!.version, generator: GENERATOR } } };
  } finally {
    fs.rmSync(r.png, { force: true });
  }
}

const previews = new Map<string, Buffer>();
/** PNG bytes for looking at an element before adding it. Held in memory for the most recent few; nothing is stored. */
export async function elementPreview(tmpDir: string, id: string, options: Opts): Promise<Buffer> {
  const key = JSON.stringify([id, options.color ?? '', options.color2 ?? '', options.longSide ?? 1024]);
  validate(id, options);
  const hit = previews.get(key);
  if (hit) return hit;
  const r = await render(tmpDir, id, options);
  try {
    const bytes = fs.readFileSync(r.png);
    previews.set(key, bytes);
    if (previews.size > 24) previews.delete(previews.keys().next().value!);
    return bytes;
  } finally {
    fs.rmSync(r.png, { force: true });
  }
}
