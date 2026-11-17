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
import { synth, SynthFailure, type Synth, type SynthLane } from './sfx.ts';
import { assertStorageRoom } from './storage.ts';
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

/**
 * The decoder hands back cairo's pixels, whose colour is already multiplied by alpha; a PNG stores colour that is not. Written
 * as they come, every partly transparent pixel would be darkened (a white edge drawn as grey). So the colour is divided by alpha
 * before encoding. The alpha plane is taken out first and put back untouched, and the division uses that copy: letting the
 * filter convert the picture to a planar format with alpha would change alpha by one step for half of the values.
 */
const STRAIGHT_ALPHA = 'format=bgra,split[c][a];[a]alphaextract,split[m1][m2];[c]format=gbrp[c3];[c3][m1]unpremultiply[u];[u][m2]alphamerge,format=rgba';
/** ffmpeg arguments that turn an SVG file into a PNG with alpha whose longer side is `longSide` pixels (the SVG's own width and height must already be that size: see sizeSvg). */
export const elementFfmpegArgs = (svgFile: string, pngFile: string, longSide: number): string[] => [
  '-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-f', 'svg_pipe', '-i', svgFile,
  '-frames:v', '1', '-vf', `scale='if(gte(iw,ih),${longSide},-2)':'if(gte(iw,ih),-2,${longSide})',${STRAIGHT_ALPHA}`,
  '-c:v', 'png', '-pix_fmt', 'rgba', '-bitexact', '-fflags', '+bitexact', pngFile,
];

/**
 * The SVG with its width and height attributes set so the longer side is `longSide` pixels (the viewBox is unchanged, so the picture is drawn sharp at that size, not scaled up afterwards).
 * The shorter side is made even here (up, or down when it would pass the longer side), which is a size the scale step in elementFfmpegArgs
 * leaves alone: given an odd one that step would resample the drawn picture by one row or column, which blurs it and shifts the colour of its edge pixels.
 */
export function sizeSvg(svg: string, id: string, longSide: number): string {
  const def = ELEMENTS.find((e) => e.id === id)!;
  const k = longSide / Math.max(def.width, def.height);
  const even = (n: number) => (n % 2 === 0 ? n : n < longSide ? n + 1 : n - 1);
  const w = def.width >= def.height ? longSide : even(Math.max(1, Math.round(def.width * k)));
  const h = def.height > def.width ? longSide : even(Math.max(1, Math.round(def.height * k)));
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

/**
 * The PNG bytes of one element in these colours at this size. Drawing goes through the queue shared with the sound effects
 * (sfx.ts): the same picture asked for twice at once is drawn once, and the few most recent pictures are held in memory.
 */
async function render(tmpDir: string, id: string, o: Opts, queue: Synth, lane: SynthLane): Promise<Buffer> {
  const v = validate(id, o);
  if (!(await canRasteriseSvg())) throw new ApiError(501, 'element_rasteriser_missing', 'this ffmpeg cannot read SVG, so graphic elements cannot be turned into pictures', { needs: 'ffmpeg built with librsvg (decoder "librsvg")' }, 'Install an ffmpeg build with --enable-librsvg (for example the full build from your distribution), then restart the server.');
  return queue.bytes('element', JSON.stringify([id, v.color, v.color2, v.longSide]), async (ffmpeg) => {
    const base = path.join(tmpDir, `el_${randomBytes(6).toString('hex')}`);
    const svgFile = `${base}.svg`, png = `${base}.png`;
    try {
      fs.writeFileSync(svgFile, v.svg);
      await ffmpeg(elementFfmpegArgs(svgFile, png, v.longSide));
      return fs.readFileSync(png);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(500, 'element_render_failed', 'the element could not be drawn', { id, ...(e instanceof SynthFailure ? { reason: e.reason } : {}) });
    } finally {
      fs.rmSync(svgFile, { force: true });
      fs.rmSync(png, { force: true });
    }
  }, lane);
}

const ceilings = new WeakMap<Store, number>();
/**
 * The storage ceiling (bytes; 0 = none) that element pictures stored in `store` must respect. The HTTP app sets it once from its
 * configuration; makeElement reads it, so the editor's route and the agent tool are held to the same limit.
 */
export function setElementStorageCeiling(store: Store, maxStorageBytes: number): void { ceilings.set(store, maxStorageBytes); }

/** Render one element and return it as an image asset (blob stored, not yet attached to a project). */
export async function makeElement(store: Store, id: string, options: Opts, actor: string, queue: Synth = synth): Promise<Omit<Asset, 'id'>> {
  const def = ELEMENTS.find((e) => e.id === id);
  const bytes = await render(store.tmpDir, id, options, queue, 'add'); // what is being added to a project does not wait behind previews (see createSynth)
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  // The colours are the caller's choice, so there is no end to the distinct pictures that can be asked for: a new one needs room
  // under the storage ceiling, like an upload. A picture that is already stored needs none.
  if (!fs.existsSync(store.blobPath(contentHash))) assertStorageRoom(store, ceilings.get(store) ?? 0, bytes.length, 'store this element');
  const png = path.join(store.tmpDir, `el_${randomBytes(6).toString('hex')}.png`);
  try {
    fs.writeFileSync(png, bytes);
    const meta = await describeMedia(png);
    store.putBlob(contentHash, png, bytes.length, meta.mimeType);
    // provenance.procedural allows only id, version and generator, so the colours and size are not recorded there.
    return { ...meta, name: `${def!.name.en}.png`, contentHash, byteSize: bytes.length, provenance: { origin: 'generated', importedAt: new Date().toISOString(), importedBy: actor, procedural: { id: def!.id, version: def!.version, generator: GENERATOR } } };
  } finally {
    fs.rmSync(png, { force: true });
  }
}

/** PNG bytes for looking at an element before adding it. Held in memory for the most recent few; nothing is stored. */
export async function elementPreview(tmpDir: string, id: string, options: Opts, queue: Synth = synth): Promise<Buffer> {
  return render(tmpDir, id, options, queue, 'preview');
}
