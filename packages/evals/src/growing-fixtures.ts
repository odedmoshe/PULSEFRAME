/**
 * The fixtures of proof:growing (wave 8 growing; W2). SYNTHETIC ONLY, made at proof time in a folder the proof deletes after the
 * run: drawn "faces" — a textured gradient, a beige disc outline and two 6×6 #FF00FF squares (the eyes) at KNOWN positions — never a
 * photograph, never owner or family media. Python with Pillow draws the stills (as image-matrix.ts does); ffmpeg encodes the video.
 *
 * Ground truth: an eye square covers the pixels [X−3, X+3) × [Y−3, Y+3) for whole numbers X, Y (X, Y odd, so a square starts on an
 * even pixel and lines up with 4:2:0 chroma), so its centroid in continuous pixel coordinates (pixel i covers [i, i+1)) is exactly
 * (X, Y), and the mark is (u, v) = (X / width, Y / height) of the picture as shown. Eye A is the one the owner would click first
 * (it goes on the frame's LEFT target), B second. Positions come from this file's own formula, never from the code under test.
 * - ten faces: angles of the eye line −40°, −10°, 0°, 25°, 80° (counter-clockwise as seen), sizes 640×480, 480×640, 1280×720,
 *   320×240, eye distances from 12 to 140 px;
 * - two JPEGs stored turned with EXIF orientation 6 and 3 (the shown picture is 640×480; marks are in shown coordinates, C4);
 * - a 2 s 30 fps 640×360 video whose eyes drift by (+2, +2) px per frame and whose top-left strip carries the frame number as an
 *   8-bit barcode (16×8 px blocks, white = 1, most significant first);
 * - black and white 640×360 stills for the flash check.
 * No pixel outside the eyes is magenta: the background keeps green ≥ 60, the disc is beige.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface FaceFixture { name: string; file: string; width: number; height: number; angle: number; distance: number; a: { x: number; y: number }; b: { x: number; y: number }; exif: 0 | 3 | 6 }
export interface GrowingFixtures {
  dir: string; faces: FaceFixture[]; video: { file: string; width: number; height: number; frames: number; fps: number; eyesAt: (frame: number) => { a: { x: number; y: number }; b: { x: number; y: number } } };
  black: string; white: string;
}
/** Nearest odd whole number (the eye centre rule above). */
const odd = (x: number) => { const r = Math.round(x); return r % 2 === 0 ? r + (x >= r ? 1 : -1) : r; };
/** Eye A and B of a face: centre (cx, cy), the eye line turned `angle` degrees counter-clockwise as seen (y grows downwards). */
export function eyePositions(cx: number, cy: number, distance: number, angle: number) {
  const t = (angle * Math.PI) / 180, dx = (distance / 2) * Math.cos(t), dy = (distance / 2) * Math.sin(t);
  return { a: { x: odd(cx - dx), y: odd(cy + dy) }, b: { x: odd(cx + dx), y: odd(cy - dy) } };
}
const SPECS: { name: string; width: number; height: number; angle: number; distance: number }[] = [
  { name: 'f01.png', width: 640, height: 480, angle: 0, distance: 80 },
  { name: 'f02.png', width: 480, height: 640, angle: -10, distance: 60 },
  { name: 'f03.png', width: 1280, height: 720, angle: 25, distance: 140 },
  { name: 'f04.png', width: 320, height: 240, angle: -40, distance: 12 },
  { name: 'f05.png', width: 640, height: 480, angle: 80, distance: 50 },
  { name: 'f06.png', width: 480, height: 640, angle: 0, distance: 100 },
  { name: 'f07.png', width: 1280, height: 720, angle: -10, distance: 90 },
  { name: 'f08.png', width: 320, height: 240, angle: 25, distance: 30 },
  { name: 'f09.png', width: 640, height: 480, angle: -40, distance: 70 },
  { name: 'f10.png', width: 480, height: 640, angle: 80, distance: 40 },
];

const PY = String.raw`
import sys, json, os
from PIL import Image, ImageDraw
spec = json.loads(sys.argv[1]); out = sys.argv[2]
def face(w, h, a, b, seed):
    im = Image.new('RGB', (w, h)); px = im.load()
    for y in range(h):
        for x in range(w):
            tex = ((x // 8 + y // 8 + seed) % 2) * 12
            px[x, y] = (40 + (150 * x) // w + tex, 60 + (120 * y) // h, 50 + tex)
    d = ImageDraw.Draw(im)
    cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    r = max(abs(b[0] - a[0]), abs(b[1] - a[1]), 10) * 1.3
    d.ellipse([cx - r, cy - r * 1.2, cx + r, cy + r * 1.3], fill=(225, 190, 150), outline=(120, 90, 60), width=2)
    for (x, y) in (a, b):
        for yy in range(y - 3, y + 3):
            for xx in range(x - 3, x + 3):
                if 0 <= xx < w and 0 <= yy < h: px[xx, yy] = (255, 0, 255)
    return im
def exif(o):
    e = Image.Exif(); e[0x0112] = o; return e
for i, f in enumerate(spec['faces']):
    im = face(f['width'], f['height'], tuple(f['a']), tuple(f['b']), i)
    p = os.path.join(out, f['name'])
    if f['exif'] == 6: im.transpose(Image.ROTATE_90).save(p, quality=97, subsampling=0, exif=exif(6))
    elif f['exif'] == 3: im.transpose(Image.ROTATE_180).save(p, quality=97, subsampling=0, exif=exif(3))
    else: im.save(p)
v = spec['video']
with open(os.path.join(out, 'video.rgb'), 'wb') as raw:
    for n in range(v['frames']):
        a, b = v['eyes'][n]
        im = face(v['width'], v['height'], tuple(a), tuple(b), 0)
        d = ImageDraw.Draw(im)
        for k in range(8):
            bit = (n >> (7 - k)) & 1
            d.rectangle([k * 16, 0, k * 16 + 15, 7], fill=(255, 255, 255) if bit else (0, 0, 0))
        raw.write(im.tobytes())
Image.new('RGB', (640, 360), (0, 0, 0)).save(os.path.join(out, 'black.png'))
Image.new('RGB', (640, 360), (255, 255, 255)).save(os.path.join(out, 'white.png'))
print('ok')
`;

/** Makes every fixture in `dir` (created; the caller deletes it). About 2 MB. */
export function makeGrowingFixtures(dir: string): GrowingFixtures {
  fs.mkdirSync(dir, { recursive: true });
  const faces: FaceFixture[] = SPECS.map((s) => ({ ...s, file: path.join(dir, s.name), exif: 0 as const, ...eyePositions(s.width / 2 + 7, s.height * 0.45, s.distance, s.angle) }));
  // the EXIF pair: shown 640×480, stored turned (orientation 6: stored 480×640; 3: stored upside down)
  for (const [name, exif, angle] of [['exif6.jpg', 6, 10], ['exif3.jpg', 3, -25]] as const) faces.push({ name, file: path.join(dir, name), width: 640, height: 480, angle, distance: 90, exif, ...eyePositions(331, 211, 90, angle) });
  const fps = 30, frames = 60, vw = 640, vh = 360;
  const eyesAt = (n: number) => ({ a: { x: 271 + 2 * n, y: 161 + 2 * n }, b: { x: 351 + 2 * n, y: 161 + 2 * n } });
  const spec = { faces: faces.map((f) => ({ name: f.name, width: f.width, height: f.height, a: [f.a.x, f.a.y], b: [f.b.x, f.b.y], exif: f.exif })), video: { width: vw, height: vh, frames, eyes: Array.from({ length: frames }, (_, n) => { const e = eyesAt(n); return [[e.a.x, e.a.y], [e.b.x, e.b.y]]; }) } };
  execFileSync('python3', ['-I', '-c', PY, JSON.stringify(spec), dir], { encoding: 'utf8', maxBuffer: 2 ** 26 });
  const raw = path.join(dir, 'video.rgb'), video = path.join(dir, 'video.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${vw}x${vh}`, '-r', String(fps), '-i', raw, '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p', video]);
  fs.rmSync(raw);
  return { dir, faces, video: { file: video, width: vw, height: vh, frames, fps, eyesAt }, black: path.join(dir, 'black.png'), white: path.join(dir, 'white.png') };
}

/** The 8-bit frame number of the barcode strip of a picture in shown coordinates (rgb24, width w), or null when unreadable. */
export function readBarcode(rgb: Buffer, w: number): number | null {
  let n = 0;
  for (let k = 0; k < 8; k++) {
    let s = 0;
    for (let y = 2; y < 6; y++) for (let x = k * 16 + 4; x < k * 16 + 12; x++) s += rgb[(y * w + x) * 3 + 1]!;
    const mean = s / 32;
    if (mean > 60 && mean < 190) return null;
    n = (n << 1) | (mean >= 190 ? 1 : 0);
  }
  return n;
}
/** Magenta pixels (R ≥ 170, B ≥ 170, G ≤ 100) split by the nearer of two expected points; each group's centroid in continuous px. */
export function magentaCentroids(rgb: Buffer, w: number, h: number, near: readonly [{ x: number; y: number }, { x: number; y: number }], radius = 60): ({ x: number; y: number; n: number } | null)[] {
  const acc = [{ x: 0, y: 0, n: 0 }, { x: 0, y: 0, n: 0 }];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (rgb[i]! < 170 || rgb[i + 2]! < 170 || rgb[i + 1]! > 100) continue;
    const px = x + 0.5, py = y + 0.5;
    const d = near.map((p) => Math.hypot(px - p.x, py - p.y));
    const k = d[0]! <= d[1]! ? 0 : 1;
    if (d[k]! > radius) continue;
    acc[k]!.x += px; acc[k]!.y += py; acc[k]!.n++;
  }
  return acc.map((a) => (a.n ? { x: a.x / a.n, y: a.y / a.n, n: a.n } : null));
}
