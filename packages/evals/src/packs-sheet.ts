/**
 * `pnpm packs:sheet` — a contact sheet for the owner (ADR-0022): every pack element and one still per pack template, written to
 * .artifacts/packs-sheet/ as PNG. It looks; it does not judge: the owner views it before more packs are made.
 *
 * Elements: each is drawn by the server's own rasteriser path (elementSvg, sizeSvg, elementFfmpegArgs: ffmpeg with librsvg) in its
 * default colours on a dark and a light tile, and its coverage (the share of its box the picture fills) is measured from the
 * pixels. Needs only ffmpeg. Written: elements-<category>.png (dark tiles), elements-<category>-light.png, elements.json (order,
 * names, coverage). Exit 1 when an element covers less than 2 or more than 90 percent of its box.
 * Template stills: needs `pnpm build` (the web bundle) and a headless browser, because they are drawn by the same render
 * route as every still. When that is missing the stills are skipped and said so; nothing is faked.
 *   pnpm packs:sheet [--elements-only]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ELEMENTS, elementSvg, PACKS, TEMPLATES } from '@pulseframe/core';
import { elementFfmpegArgs, sizeSvg } from '../../../apps/server/src/elements.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const out = path.join(root, '.artifacts/packs-sheet');
const tmp = path.join(out, '.tmp');
const TILE = 200, PAD = 14, COLS = 10;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 28 });

/** Draw one element at `side` px (long side) in its default colours; returns the width, height and RGBA bytes. */
function draw(id: string, side: number): { w: number; h: number; rgba: Buffer; png: string } {
  const svgFile = path.join(tmp, `${id}.svg`), png = path.join(tmp, `${id}.png`);
  fs.writeFileSync(svgFile, sizeSvg(elementSvg(id), id, side));
  execFileSync('ffmpeg', elementFfmpegArgs(svgFile, png, side), { timeout: 30_000 });
  const w = fs.readFileSync(png).readUInt32BE(16), h = fs.readFileSync(png).readUInt32BE(20);
  const rgba = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return { w, h, rgba, png };
}
/** The share of the box covered by visible pixels (alpha above 8 of 255). */
const coverage = (rgba: Buffer): number => { let k = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! > 8) k++; return k / (rgba.length / 4); };

function sheet(files: string[], background: string, file: string): void {
  const rows = Math.ceil(files.length / COLS);
  const inputs = files.flatMap((f) => ['-i', f]);
  const tiles = files.map((_, i) => `color=c=${background}:s=${TILE}x${TILE}:d=0.04:r=25[g${i}];[${i}:v]scale=${TILE - 2 * PAD}:${TILE - 2 * PAD}:force_original_aspect_ratio=decrease,format=rgba[s${i}];[g${i}][s${i}]overlay=(W-w)/2:(H-h)/2:shortest=1:format=auto,format=rgb24[t${i}]`).join(';');
  const filler = rows * COLS - files.length;
  const blanks = Array.from({ length: filler }, (_, i) => `color=c=${background}:s=${TILE}x${TILE}:d=0.04:r=25,format=rgb24[b${i}]`).join(';');
  const order = [...files.map((_, i) => `[t${i}]`), ...Array.from({ length: filler }, (_, i) => `[b${i}]`)].join('');
  const graph = [tiles, blanks, `${order}concat=n=${rows * COLS}:v=1:a=0,tile=${COLS}x${rows}`].filter(Boolean).join(';');
  ff([...inputs, '-filter_complex', graph, '-frames:v', '1', file]);
}

async function stills(): Promise<string> {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) return 'skipped: the web bundle is missing (run `pnpm build` first); no template still was made';
  const { startServer } = await import('@pulseframe/server');
  const dataDir = path.join(tmp, 'data');
  const s = await startServer({ port: 8885, dataDir });
  try {
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    const call = async (p: string, body?: unknown) => {
      const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
    };
    // warm, colourful in-house pictures (ffmpeg gradients), so the titles and elements are judged on something like a photo
    const pics: string[] = [];
    const looks = ['gradients=s=1080x1920:c0=0x23395B:c1=0xF2A65A:seed=3:d=1', 'gradients=s=1080x1920:c0=0x2E4057:c1=0xE07A5F:seed=8:d=1', 'gradients=s=1080x1920:c0=0x1B3A4B:c1=0xCDB4DB:seed=5:d=1', 'gradients=s=1080x1920:c0=0x3D405B:c1=0x81B29A:seed=11:d=1'];
    looks.forEach((src, i) => { const f = path.join(tmp, `pic${i}.png`); ff(['-f', 'lavfi', '-i', src, '-frames:v', '1', f]); pics.push(f); });
    const written: string[] = [];
    for (const t of TEMPLATES.filter((x) => x.pack)) {
      const pid = (await call('/projects', { name: t.id, width: 1080, height: 1920, frameRate: { num: 30, den: 1 } })).body.id as string;
      const ids: string[] = [];
      for (const f of pics) {
        const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(f) }, body: fs.readFileSync(f) });
        ids.push(((await r.json()) as any).assetId as string);
      }
      const media = Array.from({ length: 12 }, (_, i) => ids[i % ids.length]!);
      const applied = await call(`/projects/${pid}/templates/${t.id}/apply`, { params: { media, lang: 'he', fields: { name: 'נועה', name2: 'דניאל', age: '7', night: '3', place: 'הגינה של סבא', when: 'שישי בצהריים', date: '2026-12-06' }, motion: 'none' } });
      if (applied.status !== 200) { console.log(`no still for ${t.id}: ${applied.status} ${JSON.stringify(applied.body).slice(0, 160)}`); continue; }
      const doc = (await call(`/projects/${pid}`)).body.project;
      const texts = Object.values(doc.sequences).flatMap((sq: any) => sq.tracks.flatMap((tr: any) => tr.clips)).filter((c: any) => c.type === 'text');
      const fps = 30;
      const when = texts.length ? Math.round((Number(texts[0].start.value) / texts[0].start.timescale + Math.min(1.5, Number(texts[0].duration.value) / texts[0].duration.timescale / 2)) * fps) : 15;
      const r = await call(`/projects/${pid}/frame?index=${when}`);
      if (r.status !== 200) { console.log(`no still for ${t.id}: ${r.status}`); continue; }
      const file = path.join(out, `still-${t.id.replace(/^tpl\./, '')}.png`);
      fs.writeFileSync(file, r.body as Buffer);
      written.push(file);
    }
    return `${written.length} template stills written`;
  } finally { await s.close(); }
}

async function main() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const els = ELEMENTS.filter((e) => e.category === 'holiday' || e.category === 'party');
  const rows: { id: string; he: string; en: string; coverage: number; ok: boolean }[] = [];
  const drawn = els.map((e) => { const d = draw(e.id, 256); const cov = coverage(d.rgba); rows.push({ id: e.id, he: e.name.he, en: e.name.en, coverage: Number((cov * 100).toFixed(1)), ok: cov >= 0.02 && cov <= 0.9 }); return d; });
  for (const cat of ['holiday', 'party'] as const) {
    const files = els.map((e, i) => ({ e, i })).filter((x) => x.e.category === cat).map((x) => drawn[x.i]!.png);
    if (!files.length) continue;
    sheet(files, '0x16202c', path.join(out, `elements-${cat}.png`));
    sheet(files, '0xf3efe6', path.join(out, `elements-${cat}-light.png`));
  }
  fs.writeFileSync(path.join(out, 'elements.json'), JSON.stringify({ columns: COLS, order: 'row-major, right to left is NOT applied: the sheet is a plain grid', packs: PACKS.map((p) => p.id), elements: rows }, null, 1));
  const bad = rows.filter((r) => !r.ok);
  for (const r of bad) console.error(`coverage ${r.coverage}% out of 2..90: ${r.id}`);
  console.log(`${rows.length} elements drawn; coverage ${Math.min(...rows.map((r) => r.coverage))}..${Math.max(...rows.map((r) => r.coverage))} percent; sheets in ${path.relative(root, out)}`);
  if (!process.argv.includes('--elements-only')) console.log(`template stills: ${await stills().catch((e) => `failed: ${String((e as Error).message).slice(0, 200)}`)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
