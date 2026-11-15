/**
 * Phase 12 gate, provider-free part (SPEC §19.8, §19.14): linked output formats whose overrides survive master edits,
 * safe-area guides, creative preflight with mechanical fixes, batch export of formats.
 * Not covered: publishing connectors, thumbnails/metadata studio, provenance manifests, MCP App (not built).
 *   pnpm build && pnpm proof:phase12
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase12');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, input });
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const measurements: Record<string, unknown> = {};
const psnr = (a: Buffer, b: Buffer) => { let se = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const d = a[i]! - b[i]!; se += d * d; } const mse = se / n; return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse); };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4'), frames: 240 });
  const s = await startServer({ port: 8801, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(150); } };
  /** Still as raw RGB plus its size, optionally for a variant. */
  const still = async (pid: string, index: number, variant?: string, name?: string) => {
    const png = (await call(`/projects/${pid}/frame?index=${index}${variant ? `&variant=${variant}` : ''}`)).body as Buffer;
    if (name) fs.writeFileSync(path.join(art, `${name}.png`), png);
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-i', 'pipe:0'], { input: png, encoding: 'utf8' })).streams[0];
    return { png, w: info.width as number, h: info.height as number, rgb: ff(['-f', 'image2pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) };
  };
  const px = (img: { rgb: Buffer; w: number }, x: number, y: number) => { const i = (y * img.w + x) * 3; return [img.rgb[i]!, img.rgb[i + 1]!, img.rgb[i + 2]!]; };
  const dark = (c: number[]) => c[0]! + c[1]! + c[2]! < 12;
  const pre = async (pid: string, q = '') => (await call(`/projects/${pid}/preflight${q}`)).body;
  const codes = (r: any) => r.issues.map((i: any) => i.code).sort();
  const browser = await chromium.launch();
  try {
    const pid = (await call('/projects', { name: 'phase12', width: 640, height: 360 })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const base = await txs(pid, [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(240), transform: { y: 0.3 }, style: { color: '#00FF00', stroke: null, background: null } } }]);
    const clipId = base.results[0].output.clipId, titleId = base.results[1].output.clipId;

    console.log('\n# linked formats');
    const cat = (await call('/catalog')).body.formatProfiles;
    const v = await txs(pid, [{ op: 'add_variant', args: { name: 'Vertical', width: 360, height: 640, fit: 'cover', safeArea: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.12 } } }, { op: 'add_variant', args: { name: 'Vertical bars', width: 360, height: 640, fit: 'contain' } }, { op: 'add_variant', args: { name: 'Square', width: 360, height: 360 } }]);
    const [vert, bars, square] = v.results.map((r: any) => r.output.variantId);
    const m0 = await still(pid, 20, undefined, 'master');
    const vc = await still(pid, 20, vert, 'vertical-cover'), vb = await still(pid, 20, bars, 'vertical-contain');
    // expected "cover": the centre 202.5 px wide column of the master, scaled to 360x640 (title hidden for this comparison)
    await txs(pid, [{ op: 'set_variant_override', args: { variantId: vert, clipId: titleId, hidden: true } }]);
    const coverNoTitle = await still(pid, 20, vert);
    const hiddenTx = await txs(pid, [{ op: 'set_clip_transform', args: { clipId: titleId, transform: { opacity: 0 } } }]);
    void hiddenTx;
    const masterNoTitle = await still(pid, 20);
    const expected = ff(['-f', 'image2pipe', '-i', '-', '-vf', 'crop=202.5:360:218.75:0,scale=360:640:flags=bicubic', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], masterNoTitle.png);
    await txs(pid, [{ op: 'set_clip_transform', args: { clipId: titleId, transform: { opacity: 1 } } }, { op: 'set_variant_override', args: { variantId: vert, clipId: titleId, hidden: false } }]);
    const coverPsnr = psnr(coverNoTitle.rgb, expected);
    measurements.coverVsCrop = { psnrDb: Number(coverPsnr.toFixed(2)), note: 'variant frame vs the master frame cropped and scaled by ffmpeg (different resampling filters, so not identical)' };
    check('catalog offers format profiles; a 9:16 variant renders at its own size; "cover" fills the frame with the centre of the picture, "contain" shows the whole picture with bars', cat.length >= 4 && cat.every((p: any) => p.safeArea && /not a platform specification/.test(p.note)) && vc.w === 360 && vc.h === 640 && !dark(px(vc, 180, 200)) && !dark(px(vc, 180, 600)) && dark(px(vb, 180, 30)) && dark(px(vb, 180, 620)) && !dark(px(vb, 180, 320)) && coverPsnr > 28 && m0.w === 640, measurements.coverVsCrop);

    await txs(pid, [{ op: 'set_variant_override', args: { variantId: vert, clipId: titleId, transform: { y: -0.3, scale: 1.5 } } }]);
    const m1 = await still(pid, 20), vc1 = await still(pid, 20, vert, 'vertical-override'), sq1 = await still(pid, 20, square);
    const green = (img: { rgb: Buffer; w: number; h: number }, y0: number, y1: number) => { let n = 0; for (let y = Math.round(y0 * img.h); y < Math.round(y1 * img.h); y++) for (let x = 0; x < img.w; x++) { const c = px(img, x, y); if (c[0]! < 90 && c[1]! > 170 && c[2]! < 90) n++; } return n; };
    check('an override moves the title in that format only: master and the other formats are byte-identical to before', sha(m1.rgb) === sha(m0.rgb) && green(vc1, 0, 0.4) > 100 && green(vc1, 0.6, 1) === 0 && green(vc, 0.6, 1) > 50 && green(sq1, 0.6, 1) > 50, { titleTopAfter: green(vc1, 0, 0.4), titleBottomBefore: green(vc, 0.6, 1) });

    await txs(pid, [{ op: 'cut_range', args: { start: f(60), end: f(120) } }, { op: 'update_text', args: { clipId: titleId, text: 'כותרת חדשה' } }]);
    const d1 = (await call(`/projects/${pid}`)).body.project;
    const titlePieces = d1.sequences.seq_main.tracks.find((t: any) => t.kind === 'text').clips;
    const vAfter = await still(pid, 100, vert, 'vertical-after-master-edit');
    check('master edits reach the variant and the override survives them: after a ripple cut and a text change, both title pieces in the variant are still at the overridden position', titlePieces.length === 2 && titlePieces.every((c: any) => d1.variants[vert].overrides[c.id]?.transform.y === -0.3) && green(vAfter, 0, 0.4) > 100 && green(vAfter, 0.6, 1) === 0, { pieces: titlePieces.length });

    console.log('\n# captions per format');
    const cp = (await call('/projects', { name: 'phase12-captions', width: 640, height: 360 })).body.project.id;
    const cv = (await txs(cp, [
      { op: 'add_caption_track', args: { mode: 'manual', style: { preset: 'classic', sizeFrac: 0.06, position: 'bottom', color: '#FFFFFF', stroke: null, background: null } } },
      { op: 'add_cue', args: { start: f(0), duration: f(60), text: 'HELLO' } },
      { op: 'add_variant', args: { name: 'Tall', width: 360, height: 640 } },
    ])).results[2].output.variantId as string;
    /** Rows of the frame that contain caption (bright) pixels: first row, last row, as fractions of the height. */
    const band = (img: { rgb: Buffer; w: number; h: number }) => {
      let top = -1, bottom = -1;
      for (let y = 0; y < img.h; y++) { let lit = false; for (let x = 0; x < img.w && !lit; x++) { const c = px(img, x, y); lit = c[0]! + c[1]! + c[2]! > 600; } if (lit) { if (top < 0) top = y; bottom = y; } }
      return { top: Number((top / img.h).toFixed(3)), bottom: Number((bottom / img.h).toFixed(3)), height: Number(((bottom - top + 1) / img.h).toFixed(4)) };
    };
    const capMaster0 = band(await still(cp, 10));
    const capTall0 = band(await still(cp, 10, cv));
    await txs(cp, [{ op: 'update_variant', args: { variantId: cv, captionStyle: { position: 'top', sizeFrac: 0.12 } } }]);
    const capMaster1 = band(await still(cp, 10));
    const capTall1 = band(await still(cp, 10, cv, 'captions-tall-override'));
    await txs(cp, [{ op: 'update_variant', args: { variantId: cv, captionStyle: null } }]);
    const capTall2 = band(await still(cp, 10, cv));
    measurements.captionsPerFormat = { master: capMaster0, tall: capTall0, tallWithOwnStyle: capTall1, tallAfterReset: capTall2 };
    check('captions per format: with a format-only style (top, twice the size) the tall version draws the caption in the top half at about twice the height, while the master frame draws its caption in exactly the same rows as before; clearing it returns the tall version to the master style', capMaster0.top > 0.5 && capTall0.top > 0.5 && capTall1.bottom < 0.5 && capTall1.height > capTall0.height * 1.7 && capTall1.height < capTall0.height * 2.3 && JSON.stringify(capMaster1) === JSON.stringify(capMaster0) && JSON.stringify(capTall2) === JSON.stringify(capTall0), measurements.captionsPerFormat);

    console.log('\n# export of formats');
    const job = await waitJob((await call(`/projects/${pid}/exports`, { variantId: vert, range: { startFrame: 0, endFrame: 30 } })).body.jobId);
    await txs(pid, [{ op: 'set_variant_override', args: { variantId: vert, clipId: titlePieces[0].id, transform: { y: 0.3 } } }]); // change after the job was created
    const file = path.join(art, 'vertical.mp4');
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_packets', file], { encoding: 'utf8' })).streams.find((x: any) => x.codec_type === 'video');
    const frame20 = ff(['-i', file, '-vf', 'select=eq(n\\,20)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    await txs(pid, [{ op: 'set_variant_override', args: { variantId: vert, clipId: titlePieces[0].id, transform: { y: -0.3 } } }]);
    const ref20 = await still(pid, 20, vert);
    const expPsnr = psnr(frame20, ref20.rgb);
    check('exporting a format gives a file at that size from an immutable snapshot: 360×640, 30 frames, matches the still of the same frame, unaffected by an override changed after the job started', job.status === 'succeeded' && probe.width === 360 && probe.height === 640 && Number(probe.nb_read_packets) === 30 && expPsnr > 30 && job.options.variantId === vert, { psnrDb: Number(expPsnr.toFixed(2)) });
    const batch = await call(`/projects/${pid}/exports/batch`, { variantIds: [vert, square], options: { range: { startFrame: 0, endFrame: 15 }, quality: 'draft' } });
    const done = await Promise.all(batch.body.jobs.map((j: any) => waitJob(j.jobId)));
    const sizes = await Promise.all(done.map(async (j: any) => { const b = (await call(`/jobs/${j.id}/output`)).body as Buffer; const fp = path.join(art, `batch-${j.id}.mp4`); fs.writeFileSync(fp, b); const st = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', fp], { encoding: 'utf8' })).streams.find((x: any) => x.codec_type === 'video'); return `${st.width}x${st.height}`; }));
    const badBatch = await call(`/projects/${pid}/exports/batch`, { variantIds: [vert, 'var_missing'] });
    const jobsAfter = (await call(`/projects/${pid}/exports/batch`, { variantIds: [] })).status;
    check('batch export: one job per format with the right sizes; a batch naming a missing format creates no job at all', batch.status === 202 && done.every((j: any) => j.status === 'succeeded') && JSON.stringify(sizes) === JSON.stringify(['360x640', '360x360']) && badBatch.status === 404 && jobsAfter === 400, { sizes, bad: badBatch.body.error?.code });

    console.log('\n# creative preflight');
    const pp = (await call('/projects', { name: 'phase12-preflight', width: 640, height: 360 })).body.project.id;
    const pu: any = await (await fetch(`${s.url}/api/v1/projects/${pp}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const pc = (await txs(pp, [{ op: 'add_clip', args: { assetId: pu.assetId, start: f(0) } }, { op: 'set_loudness_target', args: { target: -14 } }])).results[0].output.clipId;
    const clean = await pre(pp);
    check('a clean project passes with no issues', clean.ok === true && clean.issues.length === 0 && /Not checked/.test(clean.scope), clean.issues);
    // build problems on purpose
    const pv = (await txs(pp, [{ op: 'add_variant', args: { name: 'Tall', width: 1080, height: 1920, fit: 'cover', safeArea: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.12 } } }])).results[0].output.variantId;
    const built = await txs(pp, [
      { op: 'move_clip', args: { clipId: pc, start: f(30) } },                                              // nothing on screen for the first second
      { op: 'set_loudness_target', args: { target: null } },
      { op: 'add_text', args: { text: 'כותרת תחתונה ארוכה', start: f(30), duration: f(60), transform: { y: 0.45 } } }, // hugging the bottom edge
      { op: 'add_cue', args: { start: f(30), duration: f(15), text: 'זו כתובית ארוכה מאוד שאי אפשר לקרוא בחצי שנייה בשום אופן' } },
    ]);
    const lowTitle = built.results[2].output.clipId, capTrack = built.results[3].output.trackId;
    await txs(pp, [{ op: 'set_caption_style', args: { trackId: capTrack, style: { marginFrac: 0.03 } } }]);
    const r1 = await pre(pp, `?variant=${pv}`);
    const want = ['captions_outside_safe_area', 'captions_too_fast', 'empty_picture', 'no_loudness_target', 'outside_safe_area', 'upscaled'];
    check('preflight of a format reports each planted problem with the objects involved: empty picture, missing loudness target, title and captions outside the safe area, captions too fast, soft upscaled picture', JSON.stringify(codes(r1)) === JSON.stringify(want) && r1.ok === true && r1.issues.find((i: any) => i.code === 'outside_safe_area').ids.includes(lowTitle) && r1.issues.find((i: any) => i.code === 'empty_picture').range.endFrame === 30, { found: codes(r1), warnings: r1.warnings, notes: r1.notes });
    const rMaster = await pre(pp);
    check('the same edit checked as the master has no safe-area or upscaling issues (those belong to the format); a looser reading-speed setting clears that warning', !codes(rMaster).some((c: string) => /safe_area|upscaled/.test(c)) && !codes(await pre(pp, `?variant=${pv}&maxCharsPerSecond=200`)).includes('captions_too_fast'), codes(rMaster));
    // apply every offered fix, one transaction each, and check again
    const titleBefore = (await call(`/projects/${pp}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === lowTitle).transform.y;
    let report = r1, applied: string[] = [];
    for (let guard = 0; guard < 8; guard++) {
      const next = report.issues.find((i: any) => i.fix);
      if (!next) break;
      await txs(pp, next.fix.ops);
      applied.push(next.code);
      report = await pre(pp, `?variant=${pv}`);
    }
    const after = (await call(`/projects/${pp}`)).body.project;
    const titleNow = after.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.text?.startsWith('כותרת'));
    check('applying the offered fixes clears those issues; the title fix is a format-only override (master position unchanged); what remains needs judgement', JSON.stringify(codes(report)) === JSON.stringify(['captions_too_fast', 'upscaled']) && titleNow.transform.y === titleBefore && after.variants[pv].overrides[titleNow.id]?.transform.y < titleBefore && after.settings.loudness?.target === -14, { applied, remaining: codes(report) });
    await txs(pp, [{ op: 'set_caption_style', args: { trackId: capTrack, style: { fontFamily: 'Missing Font' } } }]);
    const blocked = await pre(pp, `?variant=${pv}`);
    check('a render blocker (font that is not bundled) makes preflight not ok', blocked.ok === false && blocked.blockers === 1 && blocked.issues.some((i: any) => i.severity === 'blocker' && i.code === 'missing_font'));
    await txs(pp, [{ op: 'set_caption_style', args: { trackId: capTrack, style: { fontFamily: 'Heebo' } } }]);
    // transition whose handle disappears after the fact
    const tp = (await call('/projects', { name: 'phase12-transition', width: 640, height: 360 })).body.project.id;
    const tu: any = await (await fetch(`${s.url}/api/v1/projects/${tp}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const a1 = (await txs(tp, [{ op: 'add_clip', args: { assetId: tu.assetId, start: f(0), duration: f(60) } }])).results[0].output.clipId;
    const b1 = (await txs(tp, [{ op: 'add_clip', args: { assetId: tu.assetId, start: f(235), sourceIn: f(100), duration: f(60) } }])).results[0].output.clipId;
    await txs(tp, [{ op: 'move_clip', args: { clipId: b1, start: f(60) } }, { op: 'set_transition', args: { clipId: b1, type: 'dissolve', frames: 20 } }]);
    const okT = await pre(tp);
    // now move A so that it shows the end of its source (source 180..240) and B follows it: no handle left
    await txs(tp, [{ op: 'delete_clip', args: { clipId: a1 } }]);
    const a2 = (await txs(tp, [{ op: 'add_clip', args: { assetId: tu.assetId, start: f(0), sourceIn: f(180), duration: f(60) } }])).results[0].output.clipId;
    void a2;
    const frozen = await pre(tp);
    const fz = frozen.issues.find((i: any) => i.code === 'transition_freeze');
    if (fz) await txs(tp, fz.fix.ops);
    check('a transition that lost its source handle through later edits is reported with both clips, and its fix removes the freeze', !codes(okT).includes('transition_freeze') && !!fz && fz.ids.includes(b1) && !codes(await pre(tp)).includes('transition_freeze'), { fix: fz?.fix.label });

    console.log('\n# agent (MCP)');
    const c = new Client({ name: 'phase12-script', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
    const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
    const av = await tool('add_variant', { projectId: tp, profileId: 'square-1x1' });
    const sum = await tool('get_summary', { projectId: tp });
    const pf = await tool('preflight', { projectId: tp, variantId: av.data.results?.[0]?.output?.variantId });
    const ex = await tool('export_project', { projectId: tp, variantId: av.data.results?.[0]?.output?.variantId, range: { startFrame: 0, endFrame: 10 }, quality: 'draft', scale: 0.25 });
    const exJob = ex.data.jobId ? await waitJob(ex.data.jobId) : null;
    check('agent adds a format from a profile, sees it in the summary, runs preflight for it, and exports it', !av.isError && sum.data.variants.length === 1 && !pf.isError && Array.isArray(pf.data.issues) && exJob?.status === 'succeeded', { preflight: pf.data.issues?.map((i: any) => i.code), job: exJob?.status });
    await c.close();

    console.log('\n# editor: format switcher, safe area, preflight');
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 2600 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('deliver-panel').waitFor();
    const ratio = async () => page.getByTestId('preview').evaluate((c) => (c as HTMLCanvasElement).width / (c as HTMLCanvasElement).height);
    // Wait for the first painted frame: before it the canvas still has the browser's default size (300×150, ratio 2), which this check once measured by mistake.
    await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame !== undefined, undefined, { timeout: 15000 });
    const masterRatio = await ratio();
    await page.getByTestId('format-switch').selectOption(vert);
    await page.getByTestId('format-badge').waitFor();
    await page.getByTestId('safe-area').waitFor();
    await page.waitForFunction(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return c.width / c.height < 1; });
    const variantRatio = await ratio();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(art, 'editor-format.png') });
    const variantsBefore = Object.keys((await call(`/projects/${pid}`)).body.project.variants).length;
    await page.locator('[data-testid=format-add][data-profile-id="portrait-4x5"]').click();
    let variantsAfter = variantsBefore;
    for (let i = 0; i < 80 && variantsAfter === variantsBefore; i++) { variantsAfter = Object.keys((await call(`/projects/${pid}`)).body.project.variants).length; await sleep(100); }
    await page.getByTestId('preflight-run').click();
    await page.locator('[data-testid=preflight-summary][data-ok]').waitFor({ timeout: 30000 });
    const shownCodes = await page.locator('[data-testid=preflight-issue]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));
    const fixBtn = page.locator('[data-testid=preflight-issue][data-code=no_loudness_target] [data-testid=preflight-fix]');
    const hadFix = (await fixBtn.count()) === 1;
    if (hadFix) await fixBtn.click();
    let target: number | undefined;
    for (let i = 0; i < 80 && target === undefined; i++) { target = (await call(`/projects/${pid}`)).body.project.settings.loudness?.target; await sleep(100); }
    check('editor: choosing a format changes the preview to its shape with a format badge and the safe-area guide; a profile button adds a format; preflight lists issues for the viewed format and its fix button applies the fix', Math.abs(masterRatio - 640 / 360) < 0.01 && Math.abs(variantRatio - 360 / 640) < 0.01 && variantsAfter === variantsBefore + 1 && shownCodes.includes('no_loudness_target') && hadFix && target === -14 && errors.length === 0, { masterRatio: Number(masterRatio.toFixed(3)), variantRatio: Number(variantRatio.toFixed(3)), shownCodes, target, errors: errors.slice(0, 3) });
    // project frame and library entries from the editor
    await page.getByTestId('format-switch').selectOption('');
    const pf0 = (await call(`/projects/${pid}`)).body;
    await page.getByTestId('frame-width').fill('481');
    const oddBlocked = await page.getByTestId('frame-apply').isDisabled() && (await page.getByTestId('frame-error').count()) === 1;
    await page.getByTestId('frame-width').fill('480');
    await page.getByTestId('frame-height').fill('480');
    await page.getByTestId('frame-background').fill('#204060');
    await page.getByTestId('frame-apply').click();
    let pf1: any = pf0;
    for (let i = 0; i < 80; i++) { pf1 = (await call(`/projects/${pid}`)).body; if (pf1.project.settings.width === 480) break; await sleep(100); }
    const sq480 = await still(pid, 20);
    const corner = px(sq480, 2, 2); // the 16:9 picture is fitted inside the square frame, so the corners are background
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+KeyZ');
    let pf2: any = pf1;
    for (let i = 0; i < 80; i++) { pf2 = (await call(`/projects/${pid}`)).body; if (pf2.project.settings.width === pf0.project.settings.width) break; await sleep(100); }
    const usedAsset = Object.keys(pf2.project.assets)[0]!;
    const usedDisabled = await page.getByTestId(`remove-${usedAsset}`).isDisabled();
    const extra: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'x-filename': 'unused.png' }, body: fs.readFileSync(path.join(root, 'docs/evidence/baselines/phase3-palette-en.png')) })).json();
    await page.getByTestId(`remove-${extra.assetId}`).waitFor({ timeout: 10000 });
    await page.getByTestId(`remove-${extra.assetId}`).click();
    let pf3: any = pf2;
    for (let i = 0; i < 80; i++) { pf3 = (await call(`/projects/${pid}`)).body; if (!pf3.project.assets[extra.assetId]) break; await sleep(100); }
    check('editor: the project frame form refuses an odd size, changes size and background in one transaction (the server still is 480×480 with the new colour in its corners), Ctrl+Z restores the old frame; a library file in use cannot be removed, an unused one is removed from the library', oddBlocked && pf1.revision === pf0.revision + 1 && sq480.w === 480 && sq480.h === 480 && Math.abs(corner[0]! - 0x20) <= 2 && Math.abs(corner[1]! - 0x40) <= 2 && Math.abs(corner[2]! - 0x60) <= 2 && pf2.project.settings.width === pf0.project.settings.width && pf2.project.settings.background === pf0.project.settings.background && usedDisabled && !!extra.assetId && !pf3.project.assets[extra.assetId], { oddBlocked, size: `${sq480.w}x${sq480.h}`, corner, restored: pf2.project.settings.width, usedDisabled, removed: !pf3.project.assets[extra.assetId] });
    // captions per format from the editor: while a format is viewed, position/size edits go to that format only
    const cpage = await page.context().newPage();
    await cpage.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const cErrors: string[] = [];
    cpage.on('pageerror', (e) => cErrors.push(String(e)));
    cpage.on('console', (m) => m.type() === 'error' && cErrors.push(m.text()));
    await cpage.goto(`${s.url}/?project=${cp}`);
    await cpage.getByTestId('caption-position').waitFor();
    await cpage.getByTestId('format-switch').selectOption(cv);
    await cpage.getByTestId('caption-scope').waitFor();
    await cpage.getByTestId('caption-position').selectOption('center');
    let cdoc: any;
    for (let i = 0; i < 80; i++) { cdoc = (await call(`/projects/${cp}`)).body.project; if (cdoc.variants[cv].captionStyle?.position === 'center') break; await sleep(100); }
    const masterPos = cdoc.sequences.seq_main.tracks.find((t: any) => t.kind === 'caption').caption.style.position;
    const formatPos = cdoc.variants[cv].captionStyle?.position;
    await cpage.locator('[data-testid=caption-reset-format]:not([disabled])').click();
    for (let i = 0; i < 80; i++) { cdoc = (await call(`/projects/${cp}`)).body.project; if (!cdoc.variants[cv].captionStyle) break; await sleep(100); }
    check('editor: with a format selected, changing the caption position is stored for that format only (master stays "bottom"); "follow the master again" clears it; no page errors', formatPos === 'center' && masterPos === 'bottom' && !cdoc.variants[cv].captionStyle && cErrors.length === 0, { formatPos, masterPos, errors: cErrors.slice(0, 3) });
    // cue wording per format, from the editor, checked on rendered frames (format `cv` is still selected)
    const cueOf = (d: any) => d.sequences.seq_main.tracks.find((t: any) => t.kind === 'caption').clips[0];
    const cueId = cueOf(cdoc).id as string;
    const w0 = { master: (await still(cp, 10)).png, tall: (await still(cp, 10, cv)).png };
    await cpage.locator(`.clip[data-clip-id="${cueId}"]`).click();
    await cpage.getByTestId('cue-text').fill('HI');
    await cpage.getByTestId('cue-text').blur();
    for (let i = 0; i < 80; i++) { cdoc = (await call(`/projects/${cp}`)).body.project; if (cdoc.variants[cv].overrides[cueId]?.text === 'HI') break; await sleep(100); }
    const w1 = { master: (await still(cp, 10)).png, tall: (await still(cp, 10, cv)).png, masterText: cueOf(cdoc).text, bandTall: band(await still(cp, 10, cv)) };
    await cpage.getByTestId('cue-format-reset').click();
    for (let i = 0; i < 80; i++) { cdoc = (await call(`/projects/${cp}`)).body.project; if (!cdoc.variants[cv].overrides[cueId]) break; await sleep(100); }
    const w2tall = (await still(cp, 10, cv)).png;
    // and on the master view the same field edits the cue itself
    await cpage.getByTestId('format-switch').selectOption('');
    await cpage.waitForFunction(() => !document.querySelector('[data-testid=cue-format-note]'), undefined, { timeout: 5000 }).catch(() => {});
    await cpage.getByTestId('cue-text').fill('HELLO AGAIN');
    await cpage.getByTestId('cue-text').blur();
    for (let i = 0; i < 80; i++) { cdoc = (await call(`/projects/${cp}`)).body.project; if (cueOf(cdoc).text === 'HELLO AGAIN') break; await sleep(100); }
    check('editor: a caption cue\'s text can be edited; with a format selected the new wording applies to that format only (its rendered frame changes, the master frame is byte-identical and the cue keeps its text), "back to the master text" restores the format\'s frame byte for byte, and on the master view the field edits the cue itself', w1.masterText === 'HELLO' && !w1.tall.equals(w0.tall) && w1.master.equals(w0.master) && w2tall.equals(w0.tall) && cueOf(cdoc).text === 'HELLO AGAIN' && cErrors.length === 0, { masterTextDuringOverride: w1.masterText, tallChanged: !w1.tall.equals(w0.tall), masterSame: w1.master.equals(w0.master), restored: w2tall.equals(w0.tall), finalText: cueOf(cdoc).text, errors: cErrors.slice(0, 3) });
    // a new cue from the editor: at the playhead, selected, its text typed in the Inspector
    await txs(cp, [{ op: 'add_text', args: { text: 'spacer', start: f(0), duration: f(150), transform: { opacity: 0 } } }]); // an invisible title makes the timeline 150 frames long, so the playhead can stand after the first cue
    await cpage.waitForFunction((n) => Number(document.querySelector('[data-testid=revision]')?.textContent?.replace(/\D+/g, '')) >= n, (await call(`/projects/${cp}`)).body.revision, { timeout: 8000 }).catch(() => {});
    await cpage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await cpage.keyboard.press('Home');
    for (let i = 0; i < 9; i++) await cpage.keyboard.press('Shift+ArrowRight'); // frame 90
    await cpage.getByTestId('cue-add').click();
    for (let i = 0; i < 80; i++) { cdoc = (await call(`/projects/${cp}`)).body.project; if (cdoc.sequences.seq_main.tracks.find((t: any) => t.kind === 'caption').clips.length === 2) break; await sleep(100); }
    const newCue = cdoc.sequences.seq_main.tracks.find((t: any) => t.kind === 'caption').clips.find((c: any) => c.id !== cueId);
    await cpage.getByTestId('cue-text').waitFor();
    await cpage.getByTestId('cue-text').fill('שורה שנייה');
    await cpage.getByTestId('cue-text').blur();
    for (let i = 0; i < 80; i++) { cdoc = (await call(`/projects/${cp}`)).body.project; if (cdoc.sequences.seq_main.tracks.find((t: any) => t.kind === 'caption').clips.find((c: any) => c.id === newCue?.id)?.text === 'שורה שנייה') break; await sleep(100); }
    const cue2 = cdoc.sequences.seq_main.tracks.find((t: any) => t.kind === 'caption').clips.find((c: any) => c.id === newCue?.id);
    const capAt100 = band(await still(cp, 100)), capAt70 = band(await still(cp, 70));
    check('editor: "new caption at the playhead" adds a two-second cue at frame 90, selects it, and the text typed in the Inspector is what the cue says; a caption is drawn at frame 100 and nothing at frame 70, between the two cues', !!cue2 && Number(cue2.start.value) / cue2.start.timescale === 3 && Number(cue2.duration.value) / cue2.duration.timescale === 2 && cue2.text === 'שורה שנייה' && capAt100.top >= 0 && capAt70.top < 0 && cErrors.length === 0, { start: cue2?.start, duration: cue2?.duration, text: cue2?.text, captionTopAt100: capAt100.top, captionTopAt70: capAt70.top, errors: cErrors.slice(0, 3) });
    await cpage.close();
    await page.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Linked formats, safe-area guides (generic, not platform specifications), preflight and batch export on one synthetic fixture. No publishing, thumbnails or metadata.', measurements, passed: checks.length - failed.length, total: checks.length, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/phase12-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nPhase 12 proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
