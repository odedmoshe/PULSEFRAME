/**
 * The fixtures of proof:picmodels (wave 8 picmodels; lead pre-pass, W1 owns it after). SYNTHETIC ONLY, drawn at proof time into a
 * folder the proof deletes after the run (well under 2 MB): "faces" made of a beige rectangle and two 6×6 pure-magenta (#FF00FF)
 * squares (the eyes) at KNOWN positions on a textured green-grey background — never a photograph, never owner or family media. The
 * pixels are made here in Node and encoded losslessly by ffmpeg (PNG; the video as H.264 qp 0 4:4:4), so the ground truth is exact.
 *
 * Ground truth (the growing proof's rule): an eye square covers the pixels [X−3, X+3) × [Y−3, Y+3) for odd whole numbers X, Y, so its
 * centroid in continuous pixel coordinates (pixel i covers [i, i+1)) is exactly (X, Y), and its shown mark is (X / width, Y / height).
 * No other pixel is magenta: the background keeps green ≥ 60. The labelled fake adapter (fake_pf_picture.py) finds exactly these.
 * EXIF-rotated stills (makeExifStill, W1): the picture AS SHOWN is drawn as above, turned into the pixels a camera would store for
 * that EXIF orientation (storedFromShown, from the EXIF definition of where stored row 0 and column 0 are shown — independent of
 * ffmpeg), encoded as a JPEG at the highest quality with full chroma, and tagged with apps/server/src/captureMeta.fixtures.ts withExif.
 * JPEG is lossy: the drawn squares' centroids survive to well under a pixel (the fixture test measures it), not exactly.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { withExif } from '../../../apps/server/src/captureMeta.fixtures.ts';

export interface Pt { x: number; y: number }
export interface DrawnFace { a: Pt; b: Pt }
export interface StillFixture { name: string; file: string; width: number; height: number; faces: DrawnFace[]; decoys: Pt[] }
export interface PicmodelsFixtures {
  dir: string;
  stills: Record<'one' | 'two' | 'close' | 'none' | 'decoy' | 'nine', StillFixture>;
  /** 24 frames at 24 fps, 640×360; one face whose eyes are at x = 101 + 10n, 161 + 10n, y = 181 on frame n */
  video: { file: string; width: number; height: number; frames: number; fps: number; eyesAt: (frame: number) => DrawnFace };
}

const face = (cx: number, cy: number, d: number): DrawnFace => ({ a: { x: cx - d / 2, y: cy }, b: { x: cx + d / 2, y: cy } });
/** Every centre is odd by construction (cx odd, d a multiple of 4). */
const SPECS: Record<keyof PicmodelsFixtures['stills'], Omit<StillFixture, 'file'>> = {
  one: { name: 'one.png', width: 640, height: 480, faces: [face(321, 201, 80)], decoys: [] },
  two: { name: 'two.png', width: 640, height: 480, faces: [face(181, 221, 60), face(461, 181, 72)], decoys: [] },
  // two faces whose choice areas overlap (mids 100 px apart, reach 1.5 × 40 = 60): a click at (321, 241) is 50 px from both (E4 «closer»)
  close: { name: 'close.png', width: 640, height: 480, faces: [face(271, 241, 40), face(371, 241, 40)], decoys: [] },
  none: { name: 'none.png', width: 640, height: 480, faces: [], decoys: [] },
  decoy: { name: 'decoy.png', width: 640, height: 480, faces: [], decoys: [{ x: 301, y: 241 }] },
  nine: { name: 'nine.png', width: 960, height: 480, faces: Array.from({ length: 9 }, (_, k) => face(61 + 100 * k, 141 + 160 * (k % 2), 40)), decoys: [] },
};

function canvas(w: number, h: number): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 3 * (y * w + x), tex = ((x >> 3) + (y >> 3)) % 2 ? 12 : 0;
    b[i] = 40 + Math.floor((150 * x) / w) + tex; b[i + 1] = 60 + Math.floor((120 * y) / h); b[i + 2] = 50 + tex;
  }
  return b;
}
function rect(b: Buffer, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]): void {
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) { const i = 3 * (y * w + x); b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; }
}
/** Draw faces (a beige rectangle around the eyes, then the two magenta squares) and lone decoy squares. Exported for tests. */
export function drawFaces(w: number, h: number, faces: readonly DrawnFace[], decoys: readonly Pt[] = []): Buffer {
  const b = canvas(w, h);
  for (const f of faces) {
    const cx = (f.a.x + f.b.x) / 2, cy = (f.a.y + f.b.y) / 2, r = Math.max(Math.abs(f.b.x - f.a.x), 12);
    rect(b, w, h, Math.round(cx - r), Math.round(cy - r * 0.9), Math.round(cx + r), Math.round(cy + r * 1.3), [225, 190, 150]);
  }
  for (const p of [...faces.flatMap((f) => [f.a, f.b]), ...decoys]) rect(b, w, h, p.x - 3, p.y - 3, p.x + 3, p.y + 3, [255, 0, 255]);
  return b;
}
const encode = (args: string[], input: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { input, maxBuffer: 64 << 20 });

/** Make every fixture in `dir` (created if absent). The caller deletes `dir`. */
export function makePicmodelsFixtures(dir: string): PicmodelsFixtures {
  fs.mkdirSync(dir, { recursive: true });
  const stills = {} as PicmodelsFixtures['stills'];
  for (const [k, s] of Object.entries(SPECS) as [keyof PicmodelsFixtures['stills'], Omit<StillFixture, 'file'>][]) {
    const file = path.join(dir, s.name);
    encode(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${s.width}x${s.height}`, '-i', 'pipe:0', '-frames:v', '1', file], drawFaces(s.width, s.height, s.faces, s.decoys));
    stills[k] = { ...s, file };
  }
  const W = 640, H = 360, N = 24, fps = 24;
  const eyesAt = (n: number): DrawnFace => ({ a: { x: 101 + 10 * n, y: 181 }, b: { x: 161 + 10 * n, y: 181 } });
  const frames = Buffer.concat(Array.from({ length: N }, (_, n) => drawFaces(W, H, [eyesAt(n)])));
  const file = path.join(dir, 'move.mp4');
  encode(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${W}x${H}`, '-framerate', String(fps), '-i', 'pipe:0', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', '-movflags', '+faststart', file], frames);
  return { dir, stills, video: { file, width: W, height: H, frames: N, fps, eyesAt } };
}

/**
 * The pixels a camera stores for a picture SHOWN as `shown` (w × h, rgb24) when it tags EXIF orientation `o` (1–8). From the EXIF
 * definition (where stored row 0 / column 0 are shown): the stored pixel (c, r) is shown at
 *   1 (c, r) · 2 (Ws−1−c, r) · 3 (Ws−1−c, Hs−1−r) · 4 (c, Hs−1−r) · 5 (r, c) · 6 (Hs−1−r, c) · 7 (Hs−1−r, Ws−1−c) · 8 (r, Ws−1−c).
 */
export function storedFromShown(shown: Buffer, w: number, h: number, o: number): { rgb: Buffer; width: number; height: number } {
  const turned = o >= 5;
  const Ws = turned ? h : w, Hs = turned ? w : h;
  const out = Buffer.alloc(Ws * Hs * 3);
  for (let r = 0; r < Hs; r++) for (let c = 0; c < Ws; c++) {
    const [x, y] = ({
      1: [c, r], 2: [Ws - 1 - c, r], 3: [Ws - 1 - c, Hs - 1 - r], 4: [c, Hs - 1 - r],
      5: [r, c], 6: [Hs - 1 - r, c], 7: [Hs - 1 - r, Ws - 1 - c], 8: [r, Ws - 1 - c],
    } as Record<number, [number, number]>)[o] ?? [c, r];
    shown.copy(out, 3 * (r * Ws + c), 3 * (y * w + x), 3 * (y * w + x) + 3);
  }
  return { rgb: out, width: Ws, height: Hs };
}
/** A JPEG whose picture AS SHOWN has these faces, stored for EXIF orientation `o` and tagged so. */
export function makeExifStill(dir: string, name: string, o: number, w: number, h: number, faces: readonly DrawnFace[]): StillFixture {
  fs.mkdirSync(dir, { recursive: true });
  const s = storedFromShown(drawFaces(w, h, faces), w, h, o);
  const jpeg = encode(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${s.width}x${s.height}`, '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'mjpeg', '-pix_fmt', 'yuvj444p', '-q:v', '1', '-f', 'image2pipe', 'pipe:1'], s.rgb);
  const file = path.join(dir, name);
  fs.writeFileSync(file, withExif(jpeg, { orientation: o, date: null }));
  return { name, file, width: w, height: h, faces: [...faces], decoys: [] };
}
/** The two EXIF stills of check E3 (shown 640 × 480; one face off-centre so a wrong turn moves it). */
export const EXIF_FACE: DrawnFace = face(201, 141, 80);

/** The checks of proof:picmodels (verify-corrected; each sentence is what the check must show). */
export const PICMODELS_CHECKS: Record<string, string> = {
  E1: 'without PF_TOOLS_PYTHON the button is disabled with the setup words (engine_not_configured); no request is sent; hand marking still places two points',
  E2: 'one.png: one face, each point within 1.5 shown px of the drawn centre; Enter accepts through placePoint (the order rule), the mark is done and «סומנו 1 מתוך 2» moves',
  E3: 'EXIF-6 and EXIF-3 JPEGs: the points come back at the SHOWN positions; for all 8 orientations the decoded size equals asset.image',
  E4: 'two.png: two faces, nothing chosen; a click near face ב chooses ב; ] then Enter, Enter accepts the other by keyboard only; on close.png (two faces whose reaches overlap) a click as far from one as from the other chooses none and says «לחצו קרוב יותר לפנים הרצויות»; while a proposal is shown Enter does not place a point and Escape drops it (C12)',
  E5: 'none.png and decoy.png: outcome none and «לא נמצאו פנים…»; nothing is drawn',
  E6: 'move.mp4 frame 12: the points match frame 12\'s drawn positions, not frame 0\'s',
  E7: 'nothing stored: around 20 proposals whose fake answers carry a planted coordinate; the planted value is in no table, event, job row, file of the data or tmp folder, and no line of server output; row counts of jobs, transactions, outbox, derivatives unchanged',
  E8: 'every agent credential gets 403 owner_required with a body that would be invalid; MCP tools/list names no eyes tool; GET /picture-models as an agent has no yunet row and only codes and numbers; peopleSurfaces classifies the route owner-only',
  E9: 'an accepted proposal goes through growing plan/apply exactly as hand marks; proof:growing\'s no-coordinate checks stay green',
  E10: 'closing the dialog (or «עצרו») during a slow fake answer aborts the request and kills the worker process (its pid is gone); nothing is shown afterwards; the next request starts a fresh process',
  E11: 'a fake crash → «הצעת העיניים נכשלה» with the hand path usable; a box, a score, a landmark, a count, a third point, u = 1.2 or NaN in the worker line → 502 eyes_engine_failed, nothing shown, nothing printed',
  E12: 'nine.png (nine drawn faces): outcome too_many with no point and «יש בתמונה יותר מדי פנים…» (C9: no ranking of people)',
  R1: 'setup order per model: licence not allowed → licence_blocked; changed worker byte → engine_unverified; PF_TOOLS_PYTHON unset → engine_not_configured; probe missing onnxruntime → engine_not_working naming it; library unset / item absent / other sha / size off by one → model_missing with the exact bytes; ready on cpu; depth and matte rows not_built',
  R2: 'the right file at the right path but absent from the ledger is model_missing; a ledger item that links out of the library folder is model_missing and nothing outside is opened',
  U1: 'the eyes flows by keyboard only, he and en, at 1280 and 1440 px; the new states in audit:a11y; the ids in audit:testids',
};
