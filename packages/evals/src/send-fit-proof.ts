/**
 * pnpm proof:send — size-fit export (wave 7, track send; .artifacts/wave7/send-decisions.md §4, C4–C8, C16). Worker B.
 * Every check talks to a server started here with startServer on its own port and data directory (removed at the end), through
 * the REST API only. Fixtures are synthetic: the barcode video of @pulseframe/fixtures (every frame carries its index; a 1 kHz
 * beep starts every whole second) under the grain effect (so the full-quality file is far over the targets), a still made with
 * ffmpeg lavfi. Nothing of the owner's.
 *
 * Exit codes: 0 = every check that could run passed; 1 = a check failed (its numbers are printed, never relaxed); 2 = something
 * is blocked (a check could not run here: it is listed with its reason and proves nothing).
 *
 * Checks (each can fail):
 *  S1 F1 (12 s 640x360 30 fps barcode + grain + beeps) at a 1,500,000-byte target: the downloaded file is <= target and >= 85 % of it
 *  S2 it has exactly the planned frames at the exact rate (packet times), every barcode in order, beep offset <= 1 ms
 *  S3 fitFault overshoot-once (startServer deps): two attempts, the second <= target, the output labelled TEST
 *  S4 fitFault overshoot-always: the job fails size_fit_missed with both byte counts; the output route answers 409; no file and no work directory remain
 *  S5 plan only, a 20-minute document of one generated still: 1,000,000 is refused size_fit_too_small with minBytes; minBytes plans clean; minBytes - 1 is refused
 *  S6 half size. CORRECTED (the decisions' "F1 at 600,000" cannot be made: 600,000 is under the schema floor of 1,000,000 and F1
 *     keeps full size down to about 413,000 bytes): F1's video in a 1280x720 project at 1,000,000: fit.scale 0.5, probed 640x360, frames exact
 *  S7 F1 at 500 MB: already_fits, one encode (no attempts), fit.scale and the pixel size stated
 *  S8 fast export: a second target at the same scale renders 0 segments; after a one-clip edit only the changed segment renders; all files <= their targets
 *  S9 the flash and picture-check reports of a fit export equal those of the plain export at that scale
 *  S10 cancel during pass 2 ends within 2 s with nothing published
 *  S11 single-pass, segmented and fit outputs carry only ALLOWED_OUTPUT_TAGS
 *  S12 the browser route refuses sizeFit and a limiter with unsupported_in_browser_export
 *  S13 editor: tile -> typed 16 -> the fitted picture size shown before export; Hebrew stages; the card shows the bytes and «לא אומת»; the too-small refusal in Hebrew with the minimum
 *      (BLOCKED here: the editor's send controls are builder C's; this script does not drive the editor)
 *  S14 peak disk use <= 1.5 GB and the data directory removed at the end
 */
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { f, makeApi, makeSource, sleep, type Api } from './incremental-fixtures.ts';

const execP = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/send-fit');
const dataDir = path.join(art, 'data');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8951);

// ---- expected numbers, typed here (never computed by the code under test) ----
const W = 640, H = 360, FRAMES = 360, TARGET = 1_500_000, FLOOR_SHARE = 0.85, HALF_TARGET = 1_000_000, BIG_TARGET = 500_000_000;
const SECOND_TARGET = 1_200_000, LONG_FRAMES = 20 * 60 * 30, LONG_TARGET = 1_000_000;
/** 30 fps in MP4: timescale 15360, one frame = 512 ticks (exportSegments trackTimescale: k = 512). */
const FRAME_TICKS = 512;
const ALLOWED = ['major_brand', 'minor_version', 'compatible_brands', 'encoder', 'language', 'handler_name', 'vendor_id'];
const DISK_CEILING = 1_500_000_000, CANCEL_MS = 2000, BEEP_MS = 1;

interface Check { id: string; name: string; pass: boolean | null; numbers: unknown; blocked?: string }
const checks: Check[] = [];
function check(id: string, name: string, pass: boolean, numbers: unknown = {}) { checks.push({ id, name, pass, numbers }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${JSON.stringify(numbers).slice(0, pass ? 300 : 1200)}`); }
function blocked(id: string, name: string, why: string) { checks.push({ id, name, pass: null, numbers: {}, blocked: why }); console.log(`BLOCKED  ${id}  ${name}: ${why}`); }

// ---- disk use, sampled while the proof runs ----
let peakDisk = 0;
async function du(): Promise<number> { try { const { stdout } = await execP('du', ['-sb', dataDir]); return Number(stdout.split('\t')[0]); } catch { return 0; } }
const diskTimer = setInterval(() => { void du().then((b) => { peakDisk = Math.max(peakDisk, b); }); }, 1000);

// ---- media helpers ----
function probe(file: string) { return JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }).stdout) as { streams: any[]; format: any }; }
function packetPts(file: string): number[] { return spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts', '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.split('\n').filter(Boolean).map((l) => Number(l.replace(/,$/, ''))).sort((a, b) => a - b); }
function tags(file: string): string[] {
  const j = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', file], { encoding: 'utf8' }).stdout);
  return [...Object.keys(j.format?.tags ?? {}).map((k) => `format:${k}`), ...(j.streams ?? []).flatMap((s: any, i: number) => Object.keys(s.tags ?? {}).map((k) => `stream${i}:${k}`))];
}
const notAllowed = (file: string) => tags(file).filter((t) => !ALLOWED.includes(t.split(':')[1]!));
/** Every decoded frame's barcode, in presentation order. */
function barcodes(file: string, w: number, h: number): number[] {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const buf = r.stdout as Buffer, size = w * h * 3, out: number[] = [];
  for (let o = 0; o + size <= buf.length; o += size) out.push(readBarcode(buf.subarray(o, o + size), w, 3, { x: 0, y: 0, w, h }));
  return out;
}
/** Offsets (ms) of each beep onset after second 1 from its whole second: the first sample of each second's window over 0.25 of full scale. */
function beepOffsets(file: string, seconds: number): number[] {
  const pcm = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 }).stdout as Buffer;
  const s = (i: number) => pcm.readInt16LE(i * 2), n = pcm.length / 2, out: number[] = [];
  for (let k = 1; k < seconds; k++) {
    for (let i = k * 48000 - 2400; i < Math.min(n, k * 48000 + 4800); i++) if (Math.abs(s(i)) > 0.25 * 32767) { out.push((i - k * 48000) / 48); break; }
  }
  return out;
}

async function exportJob(api: Api, pid: string, options: unknown): Promise<{ status: number; body: any }> { return api.call(`/projects/${pid}/exports`, options); }
async function exportAndWait(api: Api, pid: string, options: unknown) {
  const r = await exportJob(api, pid, options);
  if (r.status !== 202) throw new Error(`export refused ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  return api.waitJob(r.body.jobId, 20 * 60_000);
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const source = await makeSource(path.join(art, 'barcode-360.mp4'), FRAMES);
  const stillPng = path.join(art, 'still.png');
  spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1', stillPng]);
  const webBuilt = fs.existsSync(path.join(root, 'apps/web/dist/render.html'));

  let s = await startServer({ port: PORT, dataDir });
  let api = makeApi(s.url, s.auth.tokens.agent);
  const f1 = async (name: string, size = { width: W, height: H }) => {
    const pid = (await api.call('/projects', { name, ...size })).body.project.id as string;
    const { assetId } = await api.upload(pid, source);
    const added = await api.tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(0), duration: f(FRAMES) } }]);
    await api.tx(pid, [{ op: 'add_effect', args: { clipId: added.results[0].output.clipId, type: 'stylize.grain', params: {} } }]);
    return pid;
  };

  // ---- S5: plan only, 20 minutes of one still ----
  {
    const pid = (await api.call('/projects', { name: 'long-still', width: W, height: H })).body.project.id as string;
    const { assetId } = await api.upload(pid, stillPng);
    await api.tx(pid, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(LONG_FRAMES) } }]);
    const fitOf = (b: any) => (b.blockers ?? []).filter((x: any) => String(x.code).startsWith('size_fit'));
    const a = (await api.call(`/projects/${pid}/exports/plan`, { sizeFit: { targetBytes: LONG_TARGET } })).body;
    const refusal = fitOf(a)[0];
    const min = refusal?.minBytes as number | undefined;
    const atMin = min ? fitOf((await api.call(`/projects/${pid}/exports/plan`, { sizeFit: { targetBytes: min } })).body) : null;
    const below = min ? fitOf((await api.call(`/projects/${pid}/exports/plan`, { sizeFit: { targetBytes: min - 1 } })).body) : null;
    check('S5', 'plan only: 1,000,000 refused with minBytes; minBytes plans clean; minBytes − 1 refused', refusal?.code === 'size_fit_too_small' && typeof min === 'number' && min > LONG_TARGET && atMin?.length === 0 && below?.length === 1 && below[0].code === 'size_fit_too_small',
      { refusal, atMin, below: below?.map((x: any) => x.code) });
  }
  // ---- S12: the browser route ----
  {
    const pid = await f1('browser');
    const a = await api.call(`/projects/${pid}/exports/browser`, { sessionId: 'session-send-proof', sizeFit: { targetBytes: TARGET } });
    await api.tx(pid, [{ op: 'set_master_limiter', args: { ceiling: -1 } }]);
    const b = await api.call(`/projects/${pid}/exports/browser`, { sessionId: 'session-send-proof' });
    check('S12', 'the browser route refuses sizeFit and a limiter (409 unsupported_in_browser_export)', a.status === 409 && a.body.error?.code === 'unsupported_in_browser_export' && b.status === 409 && b.body.error?.code === 'unsupported_in_browser_export', { a: [a.status, a.body.error?.code], b: [b.status, b.body.error?.code] });
  }
  blocked('S13', 'editor: fitted size before export, Hebrew stages, card bytes and «לא אומת», Hebrew too-small refusal', 'the editor\'s send controls are builder C\'s (SendSize, ExportSheet); their rows go in editor-interactions-proof');

  if (!webBuilt) {
    for (const [id, name] of [['S1', 'fit at 1,500,000'], ['S2', 'frames, barcodes, beeps'], ['S3', 'overshoot-once'], ['S4', 'overshoot-always'], ['S6', 'half size'], ['S7', 'already fits'], ['S8', 'fast export'], ['S9', 'reports equal'], ['S10', 'cancel in pass 2'], ['S11', 'tags']] as const) blocked(id, name, 'the web bundle is not built here (run pnpm build): no export can render');
  } else {
    const pidF1 = await f1('F1');
    // ---- S1 / S2 ----
    const j1 = await exportAndWait(api, pidF1, { sizeFit: { targetBytes: TARGET } });
    const file1 = j1.status === 'succeeded' ? await api.download(j1.id, path.join(art, 'fit-1500000.mp4')) : null;
    const bytes1 = file1 ? fs.statSync(file1).size : null;
    check('S1', 'F1 at 1,500,000: file <= target and >= 85 % of it', !!file1 && bytes1! <= TARGET && bytes1! >= FLOOR_SHARE * TARGET && j1.output?.fit?.bytes === bytes1, { status: j1.status, error: j1.error, bytes: bytes1, fit: j1.output?.fit && { ...j1.output.fit, method: undefined } });
    if (file1) {
      const pts = packetPts(file1);
      const deltas = [...new Set(pts.slice(1).map((v, i) => v - pts[i]!))];
      const codes = barcodes(file1, W, H);
      const inOrder = codes.length === FRAMES && codes.every((c, i) => c === i);
      const beeps = beepOffsets(file1, FRAMES / 30);
      check('S2', 'exact frames at the exact rate, barcodes in order, beep offsets <= 1 ms', pts.length === FRAMES && pts[0] === 0 && deltas.length === 1 && deltas[0] === FRAME_TICKS && inOrder && beeps.length === FRAMES / 30 - 1 && beeps.every((b) => Math.abs(b) <= BEEP_MS),
        { packets: pts.length, firstPts: pts[0], deltas, decoded: codes.length, firstWrong: codes.findIndex((c, i) => c !== i), beepsMs: beeps });
    } else blocked('S2', 'frames, barcodes, beeps', 'S1 produced no file');
    // ---- S9: the reports of the fit export equal the plain export's at that scale ----
    const plain = await exportAndWait(api, pidF1, { quality: 'high', scale: j1.output?.fit?.scale ?? 1 });
    const plainFile = plain.status === 'succeeded' ? await api.download(plain.id, path.join(art, 'plain.mp4')) : null;
    check('S9', 'flash and picture-check reports of the fit export equal the plain export\'s', plain.status === 'succeeded' && JSON.stringify(plain.output?.photosensitivity) === JSON.stringify(j1.output?.photosensitivity) && JSON.stringify(plain.output?.checks?.picture) === JSON.stringify(j1.output?.checks?.picture) && j1.output?.checks?.picture?.status === 'measured',
      { fit: { flash: j1.output?.photosensitivity?.verdict, picture: j1.output?.checks?.picture }, plain: { flash: plain.output?.photosensitivity?.verdict, picture: plain.output?.checks?.picture } });
    // ---- S6: half size ----
    const pidBig = await f1('F1-720p', { width: 1280, height: 720 });
    const j6 = await exportAndWait(api, pidBig, { sizeFit: { targetBytes: HALF_TARGET } });
    const file6 = j6.status === 'succeeded' ? await api.download(j6.id, path.join(art, 'fit-half.mp4')) : null;
    const v6 = file6 ? probe(file6).streams.find((x) => x.codec_type === 'video') : null;
    check('S6', '1280x720 at 1,000,000: fit.scale 0.5, probed 640x360, frames exact, <= target', !!file6 && j6.output?.fit?.scale === 0.5 && v6?.width === 640 && v6?.height === 360 && packetPts(file6).length === FRAMES && fs.statSync(file6).size <= HALF_TARGET,
      { status: j6.status, error: j6.error, fit: j6.output?.fit && { ...j6.output.fit, method: undefined }, probed: v6 && [v6.width, v6.height] });
    // ---- S7: already fits ----
    const j7 = await exportAndWait(api, pidF1, { sizeFit: { targetBytes: BIG_TARGET } });
    check('S7', 'F1 at 500 MB: already_fits, no fitting attempt, scale and size stated', j7.status === 'succeeded' && j7.output?.fit?.result === 'already_fits' && j7.output.fit.attempts.length === 0 && j7.output.fit.scale === 1 && j7.output.fit.width === W && j7.output.fit.height === H && j7.output.bytes <= BIG_TARGET,
      { status: j7.status, fit: j7.output?.fit && { ...j7.output.fit, method: undefined } });
    // ---- S8: fast export ----
    const inc1 = await exportAndWait(api, pidF1, { mode: 'incremental', sizeFit: { targetBytes: TARGET } });
    if (inc1.status !== 'succeeded' && /incremental|render_cache/.test(JSON.stringify(inc1.error ?? ''))) blocked('S8', 'fast export with a target', `the fast export is not available here: ${JSON.stringify(inc1.error).slice(0, 300)}`);
    else {
      const inc2 = await exportAndWait(api, pidF1, { mode: 'incremental', sizeFit: { targetBytes: SECOND_TARGET } });
      await api.tx(pidF1, [{ op: 'add_text', args: { text: 'שינוי אחד', start: f(70), duration: f(30) } }]);
      const inc3 = await exportAndWait(api, pidF1, { mode: 'incremental', sizeFit: { targetBytes: SECOND_TARGET } });
      const segs = [inc1, inc2, inc3].map((j) => j.output?.segments && { total: j.output.segments.total, rendered: j.output.segments.rendered, reused: j.output.segments.reused });
      const within = [[inc1, TARGET], [inc2, SECOND_TARGET], [inc3, SECOND_TARGET]].every(([j, t]) => (j as any).status === 'succeeded' && (j as any).output.bytes <= (t as number));
      check('S8', 'fast export: second target renders 0 segments; after a one-title edit 1 segment renders; all <= targets', within && segs[1]?.rendered === 0 && segs[2]?.rendered === 1, { segs, status: [inc1.status, inc2.status, inc3.status], bytes: [inc1.output?.bytes, inc2.output?.bytes, inc3.output?.bytes], error: inc3.error ?? inc2.error ?? inc1.error });
      // ---- S11: tags of the three kinds of output ----
      const segPlain = await exportAndWait(api, pidF1, { mode: 'incremental', quality: 'high' });
      const segFile = segPlain.status === 'succeeded' ? await api.download(segPlain.id, path.join(art, 'segmented.mp4')) : null;
      const problems = { single: plainFile ? notAllowed(plainFile) : ['no file'], segmented: segFile ? notAllowed(segFile) : ['no file'], fit: file1 ? notAllowed(file1) : ['no file'] };
      check('S11', 'single-pass, segmented and fit outputs carry only the allowed tags', Object.values(problems).every((p) => p.length === 0), problems);
    }
    // ---- S10: cancel during pass 2 ----
    {
      const r = await exportJob(api, pidF1, { sizeFit: { targetBytes: SECOND_TARGET } });
      let stage = '', canceledAt = 0;
      for (const t0 = Date.now(); Date.now() - t0 < 10 * 60_000;) {
        const j = (await api.call(`/jobs/${r.body.jobId}`)).body;
        stage = j.stage ?? '';
        if (String(stage).startsWith('fitting size 2/2')) { canceledAt = Date.now(); await api.call(`/jobs/${r.body.jobId}/cancel`, {}); break; }
        if (['succeeded', 'failed', 'canceled'].includes(j.status)) break;
        await sleep(20);
      }
      if (!canceledAt) blocked('S10', 'cancel during pass 2', `the job never showed stage "fitting size 2/2" while polled every 20 ms (last stage "${stage}")`);
      else {
        const j = await api.waitJob(r.body.jobId, 60_000);
        const ms = Date.now() - canceledAt;
        const out = await api.call(`/jobs/${r.body.jobId}/output`);
        const leftovers = fs.readdirSync(path.join(dataDir, 'out')).filter((n) => n.startsWith(r.body.jobId));
        check('S10', 'cancel in pass 2 ends within 2 s, nothing published', j.status === 'canceled' && ms <= CANCEL_MS && out.status === 409 && leftovers.length === 0, { status: j.status, ms, output: out.status, leftovers });
      }
    }
    // ---- S3 / S4: the labelled test fault (a server restarted with startServer deps) ----
    await s.close();
    for (const fault of ['overshoot-once', 'overshoot-always'] as const) {
      s = await startServer({ port: PORT, dataDir }, { fitFault: fault });
      api = makeApi(s.url, s.auth.tokens.agent);
      const j = await exportAndWait(api, pidF1, { sizeFit: { targetBytes: TARGET } });
      if (fault === 'overshoot-once') {
        const a = j.output?.fit?.attempts ?? [];
        check('S3', 'overshoot-once: two attempts, the second <= target, labelled TEST', j.status === 'succeeded' && a.length === 2 && a[1].bytes <= TARGET && j.output.bytes === a[1].bytes && /^TEST fault/.test(j.output.fit.test ?? ''), { status: j.status, attempts: a, test: j.output?.fit?.test, error: j.error });
      } else {
        const out = await api.call(`/jobs/${j.id}/output`);
        const files = fs.readdirSync(path.join(dataDir, 'out')).filter((n) => n.startsWith(j.id));
        const work = fs.existsSync(path.join(dataDir, 'tmp')) ? fs.readdirSync(path.join(dataDir, 'tmp')).filter((n) => n.startsWith(j.id)) : [];
        const e = j.error ?? {};
        check('S4', 'overshoot-always: size_fit_missed with both byte counts; output 409; no file, no work directory', j.status === 'failed' && e.code === 'size_fit_missed' && e.details?.attempts?.length === 2 && e.details?.countedBytes?.length === 2 && out.status === 409 && files.length === 0 && work.length === 0,
          { status: j.status, error: { code: e.code, message: e.message, attempts: e.details?.attempts, countedBytes: e.details?.countedBytes }, output: out.status, files, work });
      }
      await s.close();
    }
    s = null as never;
  }
  if (s) await s.close();
  clearInterval(diskTimer);
  peakDisk = Math.max(peakDisk, await du());
  fs.rmSync(dataDir, { recursive: true, force: true });
  check('S14', 'peak disk use of the data directory <= 1.5 GB, and the data directory removed', peakDisk <= DISK_CEILING && !fs.existsSync(dataDir), { peakDiskBytes: peakDisk, sampledEverySeconds: 1 });

  fs.writeFileSync(path.join(art, 'evidence.json'), JSON.stringify({ when: new Date().toISOString(), checks }, null, 2));
  const failed = checks.filter((c) => c.pass === false), held = checks.filter((c) => c.pass === null);
  console.log(`\nsend-fit-proof: ${checks.filter((c) => c.pass).length} passed, ${failed.length} failed, ${held.length} blocked (one sample each; evidence ${path.relative(root, art)}/evidence.json)`);
  process.exit(failed.length ? 1 : held.length ? 2 : 0);
}

main().catch((e) => { clearInterval(diskTimer); console.error(e); process.exit(1); });
