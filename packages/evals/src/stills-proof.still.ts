/**
 * pnpm proof:stills, part «שמירת התמונה» (wave 8 cover W2): checks P1–P9 of stills-proof.ts STILLS_CHECKS, as one exported function
 * (runStillChecks) that the lead's driver calls; W3 wires it in. Stand-alone: `tsx packages/evals/src/stills-proof.still.ts`
 * (exit 0 = every check that could run passed, 1 = a check failed, 2 = something was blocked besides passes).
 *
 * WHAT RUNS: a real server (startServer on port 0, its own data directory under the system temp directory, removed at the end) with
 * the real render worker (headless Chromium, the built render page: needs `pnpm build`) and the real ffmpeg; every check talks REST
 * or MCP as the owner's own session (the launch key's cookie) or the agent token. Needs STILL_EXPORT_BUILT (the integrator flips
 * it); without it every check that saves a picture is BLOCKED, never passed.
 * FIXTURES: synthetic only, made here: F5 a 3000x2000 PNG whose pixels are a function of their coordinates (the low bits of x and y)
 * under a one-pixel checkerboard; a 3001x2001 PNG of the same rule; F6 the fixture generator's barcode video (1920x1080, every
 * frame carries its index); a 300x200 JPEG with an EXIF orientation-6 APP1 written by this file; an 8193x100 PNG; a flat
 * 6000x4100 PNG; a rotated and an HDR-tagged video (conformed at import). Nothing of the owner's. Exact pixel identity is asserted
 * only where a lossless reference exists (P1, P2, P4 against the server still); a 4:2:0 video frame is checked by its barcode only.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printFit, STILL_EXPORT_BUILT, STILLS_REFUSALS } from '@pulseframe/core';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { translateRefusal } from '../../i18n/src/refusals.ts';
import { COVER_EN, COVER_HE } from '../../i18n/src/cover.ts';
import { startServer } from '@pulseframe/server';
import { jpegSegments, pngChunks, stillChunkProblems } from '../../../apps/server/src/stillFile.ts';
import { makeApi, ownerApi, type Api } from './incremental-fixtures.ts';

export interface StillCheck { id: string; name: string; pass: boolean | null; numbers: Record<string, unknown>; blocked?: string }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------- pictures with known pixels ----------
const pix = (x: number, y: number): [number, number, number] => {
  const c = (x + y) & 1 ? 255 : 0;
  return [(x & 255) ^ c, (y & 255) ^ c, (((x >> 8) & 15) | (((y >> 8) & 15) << 4)) ^ (c & 0x55)];
};
function knownRgb(w: number, h: number, ox = 0, oy = 0): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = pix(x + ox, y + oy), o = (y * w + x) * 3; b[o] = p[0]; b[o + 1] = p[1]; b[o + 2] = p[2]; }
  return b;
}
function ff(args: string[], input?: Buffer): Buffer {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ').slice(0, 200)}: ${String(r.stderr).slice(-400)}`);
  return r.stdout as Buffer;
}
const rawPng = (file: string, w: number, h: number, rgb: Buffer) => { ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'png', file], rgb); return file; };
const decodeRgb = (file: string) => ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
function diff(a: Buffer, b: Buffer) { let n = 0, max = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = Math.abs(a[i]! - b[i]!); if (d) { n++; max = Math.max(max, d); } } return { bytes: [a.length, b.length], differing: n, maxDifference: max }; }
function psnr(a: Buffer, b: Buffer): number { let se = 0; for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2; return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / a.length)); }
function probe(file: string) {
  const j = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt:format_tags:stream_tags', '-of', 'json', file], { encoding: 'utf8' }).stdout);
  const s = j.streams?.[0] ?? {};
  const tags = [...Object.keys(j.format?.tags ?? {}).map((k: string) => `format:${k}`), ...(j.streams ?? []).flatMap((x: any, i: number) => Object.keys(x.tags ?? {}).map((k: string) => `stream${i}:${k}`))];
  return { codec: s.codec_name as string, width: s.width as number, height: s.height as number, pixFmt: s.pix_fmt as string, tags };
}
/** A JPEG with an EXIF APP1 right after SOI holding one IFD0 entry: Orientation (0x0112, SHORT) = `orientation`. */
function withOrientation(jpg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('MM\0*', 0, 'latin1'); tiff.writeUInt32BE(8, 4); tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(orientation, 18); tiff.writeUInt32BE(0, 22);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]); head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), head, body, jpg.subarray(2)]);
}
/** Mean RGB of a w×h box of a packed RGB picture. */
function meanBox(rgb: Buffer, width: number, x0: number, y0: number, w: number, h: number): [number, number, number] {
  const s = [0, 0, 0];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) for (let c = 0; c < 3; c++) s[c]! += rgb[(y * width + x) * 3 + c]!;
  return s.map((v) => Math.round(v / (w * h))) as [number, number, number];
}

let rpc = 0;
async function tool(url: string, token: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const r = await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) });
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, text: msg.result.content[0].text as string };
}

/**
 * P1–P9. Returns one row per check; a row with pass null is BLOCKED (its reason in `blocked`) and proves nothing.
 * `opts.dataRoot`: where the temporary data directory goes (default the system temp directory); everything made is removed.
 */
export async function runStillChecks(opts: { dataRoot?: string; log?: (line: string) => void } = {}): Promise<StillCheck[]> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const out: StillCheck[] = [];
  const check = (id: string, name: string, pass: boolean, numbers: Record<string, unknown> = {}) => { out.push({ id, name, pass, numbers }); log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${JSON.stringify(numbers).slice(0, pass ? 400 : 1600)}`); };
  const blocked = (id: string, name: string, why: string) => { out.push({ id, name, pass: null, numbers: {}, blocked: why }); log(`BLOCKED  ${id}  ${name}: ${why}`); };
  const guard = async (id: string, name: string, f: () => Promise<void>) => { try { await f(); } catch (e: any) { check(id, name, false, { error: String(e?.stack ?? e).slice(0, 1200) }); } };

  // P5 is pure: it runs whatever else can run
  {
    const table: [number, number, '10x15' | '13x18' | 'a4', 'portrait' | 'landscape', number, string][] = [
      [1620, 1080, '10x15', 'landscape', 270, 'usual'], [1527, 1080, 'a4', 'landscape', 130, 'soft'], [3055, 2160, 'a4', 'landscape', 261, 'usual'],
      [1200, 1800, '10x15', 'portrait', 300, 'dense'], [1800, 1200, '10x15', 'landscape', 300, 'dense'], [2480, 3508, 'a4', 'portrait', 299, 'usual'],
      [1500, 2100, '13x18', 'portrait', 300, 'dense'], [1000, 1400, '13x18', 'portrait', 200, 'usual'], [600, 900, '10x15', 'portrait', 150, 'borderline'],
      [599, 899, '10x15', 'portrait', 149, 'soft'], [1080, 1512, '13x18', 'portrait', 216, 'usual'], [800, 1131, 'a4', 'portrait', 96, 'soft'],
    ];
    const wrong = table.map(([w, h, p, o, ppi, tier]) => ({ w, h, p, o, want: { ppi, tier }, got: printFit({ w, h }, p, o) })).filter((r) => r.got.ppi !== r.want.ppi || r.got.tier !== r.want.tier);
    const ruleHe = COVER_HE['cover.rule'], ruleEn = COVER_EN['cover.rule'];
    const tiersSay = [COVER_HE['cover.tier.dense'], COVER_HE['cover.tier.usual'], COVER_HE['cover.tier.borderline'], COVER_HE['cover.tier.soft'], COVER_EN['cover.tier.dense'], COVER_EN['cover.tier.usual']];
    check('P5', 'printFit hand table (12 rows) and the tiers labelled a rule of thumb, never good', wrong.length === 0 && ruleHe.includes('כלל אצבע') && /rule of thumb/i.test(ruleEn) && tiersSay.every((s) => !/טוב|good|sharp|safe/i.test(s)), { rows: table.length, wrong, ruleHe, ruleEn });
  }

  const webBuilt = fs.existsSync(path.join(ROOT, 'apps/web/dist/render.html'));
  const NEED = ['P1', 'P2', 'P3', 'P4', 'P6', 'P7', 'P8', 'P9'];
  if (!STILL_EXPORT_BUILT || !webBuilt) {
    const why = !STILL_EXPORT_BUILT ? 'STILL_EXPORT_BUILT is false in this build (the integrator flips it); nothing was saved' : 'the render page is not built (run `pnpm build`)';
    for (const id of NEED) blocked(id, 'needs the still export and the render page', why);
    return out;
  }

  const tmp = fs.mkdtempSync(path.join(opts.dataRoot ?? os.tmpdir(), 'pf-stills-proof-still-'));
  const F = (n: string) => path.join(tmp, n);
  const s = await startServer({ port: 0, dataDir: F('data') });
  try {
    const owner = await ownerApi(s.url, s.auth.tokens.owner);
    const agent: Api = makeApi(s.url, s.auth.tokens.agent);
    const newProject = async (name: string, width = 1280, height = 720) => (await owner.call('/projects', { name, width, height })).body.project.id as string;
    const save = async (pid: string, options: Record<string, unknown>) => {
      const r = await owner.call(`/projects/${pid}/exports`, options);
      if (r.status !== 202) throw new Error(`export refused ${r.status}: ${JSON.stringify(r.body).slice(0, 800)}`);
      const t0 = Date.now();
      const j = await owner.waitJob(r.body.jobId, 10 * 60_000);
      if (j.status !== 'succeeded') throw new Error(`job ${j.status}: ${JSON.stringify(j.error).slice(0, 800)}`);
      const file = F(`out-${j.id}${path.extname(j.output.file)}`);
      await owner.download(j.id, file);
      return { job: j, file, ms: Date.now() - t0 };
    };
    const written: { what: string; file: string; format: 'png' | 'jpeg'; w: number; h: number }[] = [];

    // ---------- F5: 3000x2000 ----------
    const f5 = rawPng(F('f5-3000x2000.png'), 3000, 2000, knownRgb(3000, 2000));
    const p5 = await newProject('P1');
    const a5 = (await owner.upload(p5, f5, 'F5.png')).assetId;
    const crop = { x: 37, y: 21, w: 1620, h: 1080 };
    await guard('P1', 'F5 10x15 landscape crop at (37, 21): PNG pixel-identical; JPEG PSNR >= 40 dB', async () => {
      const png = await save(p5, { format: 'png', still: { assetId: a5, sourceFrame: 0, crop, paper: '10x15', orientation: 'landscape' } });
      const want = knownRgb(1620, 1080, 37, 21);
      const d = diff(decodeRgb(png.file), want);
      const jpg = await save(p5, { format: 'jpeg', still: { assetId: a5, sourceFrame: 0, crop } });
      const db = psnr(decodeRgb(jpg.file), want);
      written.push({ what: 'P1 png', file: png.file, format: 'png', w: 1620, h: 1080 }, { what: 'P1 jpeg', file: jpg.file, format: 'jpeg', w: 1620, h: 1080 });
      check('P1', 'F5 10x15 landscape crop at (37, 21): PNG pixel-identical; JPEG PSNR >= 40 dB', d.differing === 0 && d.bytes[0] === d.bytes[1] && db >= 40 && png.job.output.still.print?.ppi === 270,
        { png: d, jpegPsnrDb: Number(db.toFixed(2)), still: png.job.output.still, oneSampleMs: { png: png.ms, jpeg: jpg.ms } });
    });
    await guard('P2', 'an odd-sized PNG (3001x2001) saved whole: exactly 3001x2001, pixel-identical', async () => {
      const f = rawPng(F('odd-3001x2001.png'), 3001, 2001, knownRgb(3001, 2001));
      const pid = await newProject('P2');
      const a = (await owner.upload(pid, f, 'odd.png')).assetId;
      const r = await save(pid, { format: 'png', still: { assetId: a, sourceFrame: 0 } });
      const p = probe(r.file), d = diff(decodeRgb(r.file), knownRgb(3001, 2001));
      written.push({ what: 'P2 png', file: r.file, format: 'png', w: 3001, h: 2001 });
      check('P2', 'an odd-sized PNG (3001x2001) saved whole: exactly 3001x2001, pixel-identical', p.width === 3001 && p.height === 2001 && d.differing === 0, { probe: p, pixels: d, oneSampleMs: r.ms });
    });

    // ---------- F6: barcode video 1920x1080 in a 1280x720 project ----------
    let vid: { pid: string; assetId: string } | null = null;
    await guard('P3', 'F6 barcode 1920x1080 in a 1280x720 project: the still is 1920x1080 and reads the asked source frame', async () => {
      const file = F('f6-barcode-1920.mp4');
      await generateBarcodeFixture({ out: file, width: 1920, height: 1080, frames: 60 });
      const pid = await newProject('P3', 1280, 720);
      const assetId = (await owner.upload(pid, file, 'F6.mp4')).assetId;
      vid = { pid, assetId };
      const read: Record<number, number> = {};
      let size: [number, number] = [0, 0];
      for (const frame of [0, 37, 59]) {
        const r = await save(pid, { format: 'png', still: { assetId, sourceFrame: frame } });
        const p = probe(r.file);
        size = [p.width, p.height];
        read[frame] = readBarcode(decodeRgb(r.file), 1920, 3, { x: 0, y: 0, w: 1920, h: 1080 });
        if (frame === 37) written.push({ what: 'P3 png', file: r.file, format: 'png', w: 1920, h: 1080 });
      }
      check('P3', 'F6 barcode 1920x1080 in a 1280x720 project: the still is 1920x1080 and reads the asked source frame', size[0] === 1920 && size[1] === 1080 && read[0] === 0 && read[37] === 37 && read[59] === 59, { size, barcodes: read });
    });

    // ---------- a JPEG photo with EXIF orientation 6 ----------
    await guard('P4', 'a JPEG with EXIF orientation 6 is saved turned (200x300), equal to the server still of the same one-clip document', async () => {
      const W = 300, H = 200, rgb = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; const red = x < 60 && y < 60; rgb[o] = red ? 230 : 40; rgb[o + 1] = red ? 20 : 120; rgb[o + 2] = red ? 20 : 160; }
      const plain = F('p4-plain.jpg');
      ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${W}x${H}`, '-i', 'pipe:0', '-vf', 'setsar=1,format=yuvj444p', '-c:v', 'mjpeg', '-q:v', '2', '-flags', '+bitexact', '-frames:v', '1', '-f', 'image2', '-update', '1', plain], rgb);
      const turnedFile = F('p4-orientation6.jpg');
      fs.writeFileSync(turnedFile, withOrientation(fs.readFileSync(plain), 6));
      const pid = await newProject('P4', 200, 300);
      const up = await owner.upload(pid, turnedFile, 'IMG_ORIENT6.jpg');
      const r = await save(pid, { format: 'png', still: { assetId: up.assetId, sourceFrame: 0 } });
      const still = decodeRgb(r.file), p = probe(r.file);
      // the server still of the same one-clip document: a project of the file's size and rate with the picture at 0 (fit contain, default transform)
      await owner.tx(pid, [{ op: 'add_clip', args: { assetId: up.assetId, start: { value: '0', timescale: 1 }, duration: { value: '1', timescale: 30 } } }]);
      const frame = await owner.call(`/projects/${pid}/frame?index=0`);
      fs.writeFileSync(F('p4-server-still.png'), frame.body as Buffer);
      const d = diff(still, decodeRgb(F('p4-server-still.png')));
      // turned: orientation 6 shows the stored top-left corner at the top RIGHT
      const topRight = meanBox(still, 200, 150, 5, 40, 40), topLeft = meanBox(still, 200, 5, 5, 40, 40);
      written.push({ what: 'P4 png', file: r.file, format: 'png', w: 200, h: 300 });
      check('P4', 'a JPEG with EXIF orientation 6 is saved turned (200x300), equal to the server still of the same one-clip document',
        up.asset?.image?.width === 200 && up.asset?.image?.height === 300 && p.width === 200 && p.height === 300 && d.differing === 0 && frame.status === 200 && topRight[0] > 180 && topRight[1] < 80 && topLeft[0] < 100,
        { assetImage: up.asset?.image, probe: { width: p.width, height: p.height }, againstServerStill: d, topRight, topLeft });
    });

    // ---------- P6: what every written picture carries ----------
    {
      const rows = written.map((w) => { const p = probe(w.file), bytes = fs.readFileSync(w.file); return { what: w.what, codec: p.codec, width: p.width, height: p.height, tags: p.tags, problems: stillChunkProblems(bytes, w.format), parts: w.format === 'png' ? [...new Set(pngChunks(bytes))] : jpegSegments(bytes).map((s) => s.marker.toString(16) + (s.id ? `(${s.id})` : '')), exifBytes: bytes.includes(Buffer.from('Exif')), want: [w.w, w.h] }; });
      check('P6', 'every saved picture: codec png/mjpeg, size = the crop, no format or stream tags, no chunk or segment outside the allow-list, no EXIF',
        rows.length >= 5 && rows.every((r) => r.codec === (r.what.endsWith('jpeg') ? 'mjpeg' : 'png') && r.width === r.want[0] && r.height === r.want[1] && r.tags.length === 0 && r.problems.length === 0 && !r.exifBytes), { rows });
    }

    // ---------- P7: agents ----------
    await guard('P7', 'agents: 403 owner_required at POST …/exports, export_project, export_batch, REST retry, retry_job; the browser route 409 for the owner', async () => {
      const still = { assetId: a5, sourceFrame: 0 };
      const rest = await agent.call(`/projects/${p5}/exports`, { format: 'png', still });
      const batch = await agent.call(`/projects/${p5}/exports/batch`, { items: [{}], options: { format: 'png', still } });
      const mp = await tool(s.url, s.auth.tokens.agent, 'export_project', { projectId: p5, format: 'png', still });
      const mb = await tool(s.url, s.auth.tokens.agent, 'export_batch', { projectId: p5, items: [{}], options: { format: 'png', still } });
      // an owner's still job to retry: started and canceled at once (a retry needs a failed or canceled job)
      const started = await owner.call(`/projects/${p5}/exports`, { format: 'png', still });
      await owner.call(`/jobs/${started.body.jobId}/cancel`, {});
      const ended = await owner.waitJob(started.body.jobId, 5 * 60_000);
      const retry = ended.status === 'succeeded' ? null : await agent.call(`/jobs/${ended.id}/retry`, {});
      const rj = ended.status === 'succeeded' ? null : await tool(s.url, s.auth.tokens.agent, 'retry_job', { jobId: ended.id });
      const browser = await owner.call(`/projects/${p5}/exports/browser`, { sessionId: 'proof-tab-1', format: 'png', still });
      const codeOf = (t: { text: string } | null) => (t ? JSON.parse(t.text).error?.code : null);
      const numbers = { rest: [rest.status, rest.body.error?.code], batch: [batch.status, batch.body.error?.code], exportProject: [mp.isError, codeOf(mp)], exportBatch: [mb.isError, codeOf(mb)], ownerJob: ended.status, retry: retry && [retry.status, retry.body.error?.code], retryJob: rj && [rj.isError, codeOf(rj)], browser: [browser.status, browser.body.error?.code] };
      if (ended.status === 'succeeded') { blocked('P7', 'agents refused everywhere', `the owner's job finished before the cancel arrived, so no retry could be tried: ${JSON.stringify(numbers)}`); return; }
      check('P7', 'agents: 403 owner_required at POST …/exports, export_project, export_batch, REST retry, retry_job; the browser route 409 for the owner',
        rest.status === 403 && rest.body.error?.code === 'owner_required' && batch.status === 403 && codeOf(mp) === 'owner_required' && codeOf(mb) === 'owner_required' && retry!.status === 403 && retry!.body.error?.code === 'owner_required' && codeOf(rj) === 'owner_required' && browser.status === 409 && browser.body.error?.code === 'unsupported_in_browser_export', numbers);
    });

    // ---------- P8: sizes and frames ----------
    await guard('P8', 'over 8192 on a side still_too_large with its Hebrew; over 24 MP labelled untried; a frame outside the file out_of_bounds', async () => {
      const pid = await newProject('P8');
      const wide = F('wide-8193x100.png');
      ff(['-f', 'lavfi', '-i', 'color=c=0x336699:s=8193x100', '-frames:v', '1', wide]);
      const aw = (await owner.upload(pid, wide, 'wide.png')).assetId;
      const tooBig = await owner.call(`/projects/${pid}/exports`, { format: 'png', still: { assetId: aw, sourceFrame: 0 } });
      const blocker = tooBig.body.error?.details?.blockers?.[0];
      const he = blocker ? translateRefusal('he', blocker.message) : undefined;
      const flat = F('flat-6000x4100.png');
      ff(['-f', 'lavfi', '-i', 'color=c=0x808080:s=6000x4100', '-frames:v', '1', flat]);
      const af = (await owner.upload(pid, flat, 'flat.png')).assetId;
      let untried: unknown = null, untriedMs = 0, untriedError: string | null = null;
      try { const r = await save(pid, { format: 'png', still: { assetId: af, sourceFrame: 0, crop: { x: 100, y: 100, w: 64, h: 64 } } }); untried = r.job.output.still.untriedSize; untriedMs = r.ms; } catch (e: any) { untriedError = String(e?.message ?? e).slice(0, 600); }
      const outside = vid ? await owner.call(`/projects/${(vid as { pid: string }).pid}/exports`, { format: 'png', still: { assetId: (vid as { assetId: string }).assetId, sourceFrame: 60 } }) : null;
      const outsideCode = outside?.body.error?.details?.blockers?.[0]?.code;
      check('P8', 'over 8192 on a side still_too_large with its Hebrew; over 24 MP labelled untried; a frame outside the file out_of_bounds',
        tooBig.status === 422 && blocker?.code === 'still_too_large' && blocker?.message === STILLS_REFUSALS.stillTooLarge.message(8193, 100) && !!he?.includes('8192') && untried === true && outsideCode === 'out_of_bounds',
        { tooBig: [tooBig.status, blocker?.code], hebrew: he, over24mp: { untriedSize: untried, oneSampleMs: untriedMs, error: untriedError, pixels: 6000 * 4100 }, outside: [outside?.status, outsideCode] });
    });

    // ---------- P9: conformed files ----------
    await guard('P9', 'a conformed file\'s still records source.conformed (rotation; hdr), and the wording says so («הומר מ־HDR»)', async () => {
      const pid = await newProject('P9');
      const base = F('p9-base.mp4');
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30', '-frames:v', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', base]);
      const rotated = F('p9-rotated.mp4');
      ff(['-display_rotation', '90', '-i', base, '-c', 'copy', rotated]);
      const hdr = F('p9-hdr.mp4');
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30', '-frames:v', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', hdr]);
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const [name, file, reason] of [['rotated', rotated, 'rotation'], ['hdr', hdr, 'hdr']] as const) {
        const up = await owner.upload(pid, file, `${name}.mp4`);
        const reasons = up.asset?.conform?.reasons ?? null;
        if (!reasons?.includes(reason)) { rows[name] = { reasons, note: 'not conformed at import as expected' }; ok = false; continue; }
        const r = await save(pid, { format: 'png', still: { assetId: up.assetId, sourceFrame: 3 } });
        rows[name] = { reasons, conformed: r.job.output.still.source.conformed, size: [r.job.output.still.width, r.job.output.still.height] };
        ok &&= JSON.stringify(r.job.output.still.source.conformed) === JSON.stringify(reasons);
      }
      const words = { he: COVER_HE['cover.conformed'], hdr: COVER_HE['cover.conformedHdr'], browser: COVER_HE['cover.browserReading'] };
      check('P9', 'a conformed file\'s still records source.conformed (rotation; hdr), and the wording says so («הומר מ־HDR»)', ok && words.hdr === 'הומר מ־HDR' && words.he.includes('{reasons}'), { rows, words });
    });
  } finally {
    await s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = await runStillChecks();
  const failed = rows.filter((r) => r.pass === false).length, held = rows.filter((r) => r.pass === null).length;
  console.log(`stills-proof.still: ${rows.filter((r) => r.pass).length} passed, ${failed} failed, ${held} blocked of ${rows.length}`);
  process.exit(failed ? 1 : held ? 2 : 0);
}
