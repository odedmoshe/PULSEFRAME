/**
 * Still-image matrix: ordinary image files through ingest, a rendered still and the editor preview.
 * Each fixture is the same picture — four coloured quadrants (top-left red, top-right green, bottom-left blue,
 * bottom-right yellow) at 640×360 — stored in a different way. A file is either refused at ingest with a typed error,
 * or it must be shown upright, unstretched and in the right colours. Fixtures are synthetic (made with Pillow).
 *   pnpm build && pnpm conformance:images
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { openCardMenu } from './editor-ui.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/image-matrix');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const W = 640, H = 360;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

const PY = String.raw`
import sys, os
from PIL import Image
out = sys.argv[1]
W, H = 640, 360
Q = {'tl': (220, 30, 30), 'tr': (30, 200, 30), 'bl': (30, 30, 220), 'br': (230, 210, 20)}
def base(mode='RGB'):
    im = Image.new('RGB', (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            px[x, y] = Q[('t' if y < H // 2 else 'b') + ('l' if x < W // 2 else 'r')]
    return im
b = base()
def save(name, im, **kw):
    try:
        im.save(os.path.join(out, name), **kw); print('built', name)
    except Exception as e:
        print('skip', name, str(e)[:80])
save('rgb.png', b)
rgba = b.convert('RGBA'); a = rgba.load()
for y in range(H // 2):
    for x in range(W // 2, W): a[x, y] = (30, 200, 30, 0)
save('alpha.png', rgba)
save('palette.png', b.convert('P', palette=Image.ADAPTIVE, colors=16))
save('gray.png', b.convert('L'))
try:
    import numpy as np
    arr = (np.asarray(b.convert('L')).astype('uint16') * 257)
    Image.fromarray(arr).save(os.path.join(out, 'gray16.png')); print('built gray16.png')
except Exception as e:
    print('skip gray16.png', str(e)[:80])
save('baseline.jpg', b, quality=95, subsampling=0)
save('progressive.jpg', b, quality=95, progressive=True, subsampling=0)
save('gray.jpg', b.convert('L'), quality=95)
save('cmyk.jpg', b.convert('CMYK'), quality=95)
# EXIF orientation: store the pixels rotated and tag them so that a correct reader shows the base picture
def exif(o):
    e = Image.Exif(); e[0x0112] = o; return e
save('exif6.jpg', b.transpose(Image.ROTATE_90), quality=95, subsampling=0, exif=exif(6))   # stored 360x640; tag says rotate 90 clockwise to view
save('exif3.jpg', b.transpose(Image.ROTATE_180), quality=95, subsampling=0, exif=exif(3))  # stored upside down
save('exif8.jpg', b.transpose(Image.ROTATE_270), quality=95, subsampling=0, exif=exif(8))
save('exif2.jpg', b.transpose(Image.FLIP_LEFT_RIGHT), quality=95, subsampling=0, exif=exif(2))  # mirrored
save('lossy.webp', b, quality=95)
save('lossless-alpha.webp', rgba, lossless=True)
save('animated.webp', b, save_all=True, append_images=[b.transpose(Image.ROTATE_180)], duration=500, loop=0)
save('static.gif', b.convert('P', palette=Image.ADAPTIVE, colors=16))
save('animated.gif', b.convert('P', palette=Image.ADAPTIVE, colors=16), save_all=True, append_images=[b.transpose(Image.ROTATE_180).convert('P', palette=Image.ADAPTIVE, colors=16)], duration=500, loop=0)
save('plain.bmp', b)
save('plain.tiff', b)
save('plain.avif', b, quality=90)
big = b.resize((6000, 3375), Image.NEAREST)
save('big-6000.jpg', big, quality=90)
tall = Image.new('RGB', (360, 640)); tp = tall.load()
for y in range(640):
    for x in range(360):
        tp[x, y] = Q[('t' if y < 320 else 'b') + ('l' if x < 180 else 'r')]
save('portrait.png', tall)
open(os.path.join(out, 'vector.svg'), 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="320" height="180" fill="#dc1e1e"/><script>alert(1)</script></svg>'); print('built vector.svg')
`;

interface Case { file: string; what: string; /** the picture is expected to be refused (typed error) rather than shown */ refuse?: boolean; gray?: boolean; transparentTopRight?: boolean; portrait?: boolean; firstFrameOnly?: boolean }

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const built = execFileSync('python3', ['-I', '-c', PY, art], { encoding: 'utf8' });
  const have = new Set(built.split('\n').filter((l) => l.startsWith('built ')).map((l) => l.slice(6).trim()));
  const skipped = built.split('\n').filter((l) => l.startsWith('skip '));
  const all: Case[] = [
    { file: 'rgb.png', what: 'PNG, 8-bit RGB' },
    { file: 'alpha.png', what: 'PNG with a transparent quadrant', transparentTopRight: true },
    { file: 'palette.png', what: 'PNG, indexed colours' },
    { file: 'gray.png', what: 'PNG, greyscale', gray: true },
    { file: 'gray16.png', what: 'PNG, 16-bit greyscale', gray: true },
    { file: 'baseline.jpg', what: 'JPEG, baseline' },
    { file: 'progressive.jpg', what: 'JPEG, progressive' },
    { file: 'gray.jpg', what: 'JPEG, greyscale', gray: true },
    { file: 'cmyk.jpg', what: 'JPEG, CMYK' },
    { file: 'exif6.jpg', what: 'JPEG stored sideways with orientation tag 6 (phone portrait/landscape)' },
    { file: 'exif3.jpg', what: 'JPEG stored upside down with orientation tag 3' },
    { file: 'exif8.jpg', what: 'JPEG stored sideways with orientation tag 8' },
    { file: 'exif2.jpg', what: 'JPEG stored mirrored with orientation tag 2' },
    { file: 'lossy.webp', what: 'WebP, lossy' },
    { file: 'lossless-alpha.webp', what: 'WebP, lossless with a transparent quadrant', transparentTopRight: true },
    { file: 'animated.webp', what: 'WebP, animated (two frames)', refuse: true },
    { file: 'static.gif', what: 'GIF, single frame' },
    { file: 'animated.gif', what: 'GIF, animated (two frames)', firstFrameOnly: true },
    { file: 'plain.bmp', what: 'BMP' },
    { file: 'plain.tiff', what: 'TIFF' },
    { file: 'plain.avif', what: 'AVIF' },
    { file: 'big-6000.jpg', what: 'JPEG, 6000×3375 (20 megapixels)' },
    { file: 'portrait.png', what: 'PNG, portrait 360×640 in a landscape project', portrait: true },
    { file: 'vector.svg', what: 'SVG containing a script', refuse: true },
  ];
  const cases = all.filter((c) => have.has(c.file));
  const s = await startServer({ port: 8823, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  // expected colours at the centre of each quadrant of the 640×360 frame
  const RGB: Record<string, number[]> = { tl: [220, 30, 30], tr: [30, 200, 30], bl: [30, 30, 220], br: [230, 210, 20] };
  const luma = (c: number[]) => Math.round(0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!);
  const PTS: Record<string, [number, number]> = { tl: [160, 90], tr: [480, 90], bl: [160, 270], br: [480, 270] };
  /** For a portrait picture shown whole in the landscape frame: it occupies the middle 202 px, bars left and right. */
  const PORTRAIT: Record<string, [number, number]> = { tl: [270, 90], tr: [370, 90], bl: [270, 270], br: [370, 270], barLeft: [60, 180], barRight: [580, 180] };
  const expectAt = (c: Case, k: string): number[] => {
    if (k.startsWith('bar')) return [0, 0, 0];
    if (c.transparentTopRight && k === 'tr') return [0, 0, 0]; // the project background shows through
    return c.gray ? Array(3).fill(luma(RGB[k]!)) : RGB[k]!;
  };
  const judge = (c: Case, px: (x: number, y: number) => number[]) => {
    const pts = c.portrait ? PORTRAIT : PTS;
    const got: Record<string, number[]> = {}, worst: number[] = [];
    for (const [k, [x, y]] of Object.entries(pts)) { got[k] = px(x, y); const want = expectAt(c, k); worst.push(Math.max(...got[k]!.map((v, i) => Math.abs(v - want[i]!)))); }
    return { got, worst: Math.max(...worst) };
  };
  const rows: any[] = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  try {
    const key = await context.newPage();
    await key.goto(`${s.ownerUrl}`);
    await key.waitForTimeout(500);
    await key.close();
    for (const c of cases) {
      const row: any = { case: c.what, file: c.file };
      rows.push(row);
      const pid = (await call('/projects', { name: c.file, width: W, height: H })).body.project.id;
      const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': c.file }, body: fs.readFileSync(path.join(art, c.file)) })).json();
      if (!up.assetId) { row.outcome = c.refuse ? 'refused-as-expected' : 'refused-at-ingest'; row.detail = `${up.error?.code}: ${String(up.error?.message).slice(0, 110)}`; row.typed = /^[a-z_]+$/.test(String(up.error?.code)); continue; }
      row.asset = { kind: up.asset.kind, image: up.asset.image ?? null, video: up.asset.video ? `${up.asset.video.codec} ${up.asset.video.width}x${up.asset.video.height}` : null, seconds: T.toSeconds(up.asset.duration), conformed: up.asset.conform?.reasons ?? false };
      if (c.refuse) { row.outcome = 'ACCEPTED-BUT-SHOULD-BE-REFUSED'; continue; }
      const add = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0), ...(up.asset.kind === 'image' ? { duration: f(30) } : {}) } }] });
      if (add.status !== 200) { row.outcome = 'ACCEPTED-BUT-CANNOT-BE-PLACED'; row.detail = `${add.body?.error?.code}: ${String(add.body?.error?.message).slice(0, 100)}`; continue; }
      const problems: string[] = [];
      // 1. a still rendered by the server (the export compositor)
      const still = await call(`/projects/${pid}/frame?index=3`);
      if (still.status !== 200) { row.outcome = 'ACCEPTED-BUT-RENDER-FAILED'; row.detail = `${still.body?.error?.code}: ${String(still.body?.error?.message).slice(0, 140)}`; continue; }
      const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'image2pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: still.body, maxBuffer: 1 << 28 });
      const sj = judge(c, (x, y) => { const o = (y * W + x) * 3; return [raw[o]!, raw[o + 1]!, raw[o + 2]!]; });
      row.still = sj;
      if (sj.worst > 24) problems.push('rendered still');
      // 2. the editor preview
      const page = await context.newPage();
      const errs: string[] = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      try {
        await page.goto(`${s.url}/?project=${pid}`);
        await page.waitForFunction(() => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return cv?.dataset.frame === '0' && cv?.dataset.quality === 'full'; }, undefined, { timeout: 30000 });
        await page.waitForTimeout(300);
        const shot = await page.evaluate(() => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height); return { w: cv.width, h: cv.height, data: Array.from(d.data) }; });
        const pj = judge(c, (x, y) => { const X = Math.round((x / W) * shot.w), Y = Math.round((y / H) * shot.h), o = (Y * shot.w + X) * 4; return [shot.data[o]!, shot.data[o + 1]!, shot.data[o + 2]!]; });
        row.preview = pj;
        // since the redesigned library the notices are in the card's ⋯ menu: open it (and see it open, so an empty list is read
        // from the open menu, not from a closed one) before reading them
        await openCardMenu(page, up.assetId);
        await page.locator(`[data-testid="more-${up.assetId}"][aria-expanded=true]`).waitFor({ timeout: 5000 });
        row.notices = await page.locator('[data-testid=asset-notice]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));
        if (pj.worst > 24) problems.push('preview');
        if (errs.length) { problems.push('page error'); row.errors = errs.slice(0, 2); }
      } catch (e) { problems.push('preview did not paint'); row.detail = String(e).slice(0, 140); }
      finally { await page.close(); }
      row.outcome = problems.length ? `ACCEPTED-BUT-WRONG (${problems.join(', ')})` : 'shown-correctly';
    }
    for (const r of rows) console.log(`${String(r.outcome).padEnd(36)} ${r.case}${r.detail ? `  — ${r.detail}` : ''}${/^ACCEPTED/.test(String(r.outcome)) ? `  — asset ${JSON.stringify(r.asset)} still ${JSON.stringify(r.still)} preview ${JSON.stringify(r.preview)}` : ''}`);
    if (skipped.length) console.log(`fixtures this Pillow could not write (not tried): ${skipped.map((x) => x.slice(5)).join('; ')}`);
    const bad = rows.filter((r) => /^ACCEPTED/.test(r.outcome));
    check(`no image is accepted and then shown wrongly, sideways, stretched or not at all (${rows.length} files tried)`, bad.length === 0, bad.map((r) => ({ case: r.case, outcome: r.outcome, detail: r.detail })));
    const converted = rows.filter((r) => r.asset?.conformed);
    check(`pictures converted at import say so in the library (${converted.length}: ${converted.map((r) => r.file).join(', ')}); the others show no notice`, converted.length >= 4 && rows.filter((r) => r.outcome === 'shown-correctly').every((r) => JSON.stringify(r.notices) === JSON.stringify(r.asset.conformed ? ['converted'] : [])), rows.filter((r) => r.notices?.length).map((r) => ({ file: r.file, notices: r.notices })));
    const refused = rows.filter((r) => /^refused/.test(r.outcome));
    check(`every refusal is a typed error (${refused.length} refusal(s))`, refused.every((r) => r.typed), refused.map((r) => ({ case: r.case, detail: r.detail })));
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const tally: Record<string, number> = {};
    for (const r of rows) { const k = String(r.outcome).replace(/ \(.*\)$/, ''); tally[k] = (tally[k] ?? 0) + 1; }
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'Synthetic four-quadrant pictures made with Pillow, each stored in a different way; checked at four points (six for the portrait picture) with a tolerance of 24 of 255 per channel, on a server-rendered still and on the editor preview. Not checked: fine detail, gradients, colour profiles (ICC), HDR, very large files beyond one 20-megapixel JPEG, real photographs.', passed: checks.length - failed.length, total: checks.length, tally, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/image-matrix.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nImage matrix ${report.result}: ${report.passed}/${report.total}  ${JSON.stringify(tally)}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
