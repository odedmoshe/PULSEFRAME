/**
 * Trend pack (ADR-0012), step 0: the byte-identical regression baseline of what the pack must not change.
 *
 *   pnpm build && pnpm proof:trend-baseline           records docs/evidence/trend-baseline.json from this build
 *   pnpm build && pnpm proof:trend-baseline --check   renders everything again and fails on any difference
 *
 * Everything goes through the server API and its render worker, the same path as every still and export (ADR-0005).
 * - Transitions: the 51 transitions that existed before the pack (the ids are fixed below, not read from the catalogue, so
 *   new ids never enter the baseline), each at frames=29 between an outgoing clip at frames 0–60 and an incoming clip at
 *   60–120, on the gpu-proof blue fixture (red = column, green = row, blue 0 outgoing and 255 incoming), at 360×640 and
 *   640×360; frames 61, 74 and 87 (early, middle, late).
 * - Titles: the 40 text styles that existed before the pack on 'שָׁלוֹם עולם 2026' at 1080×1920, frame 10; and two more
 *   stills of the 'classic-outline' title at frame 40, one with the entrance rise by word over 20 frames (at rest by then)
 *   and one with no animation, as a check of the static path.
 * A hash is SHA-256 of the decoded RGBA pixels of the still (not of the PNG bytes), so it says "the same picture".
 *
 * When this machine's render worker has no WebGPU adapter, the GPU transitions are recorded as refused, with the reason,
 * and --check then expects the same refusal: it compares exactly what was recorded, and says how much of it is pixels.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/trend-baseline');
const evidence = path.join(root, 'docs/evidence/trend-baseline.json');
const CHECK = process.argv.includes('--check');
const PORT = 8883;
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** SHA-256 of the decoded RGBA pixels of a PNG. */
const pixelHash = (png: Buffer) => sha(ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png));

/** The transitions before the trend pack, in registry order (packages/core effects.ts at b6b5be9). */
export const LEGACY_TRANSITIONS = [
  'dissolve', 'dip-black', 'dip-white', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'push-left', 'push-right', 'push-up', 'push-down', 'zoom',
  'cross-zoom-in', 'cross-zoom-out', 'swirl-cw', 'swirl-ccw', 'wave-h', 'wave-v', 'glitch-cut', 'pixelate', 'clock-cw', 'clock-ccw',
  'soft-wipe-right', 'soft-wipe-left', 'soft-wipe-down', 'soft-wipe-up', 'soft-wipe-down-right', 'soft-wipe-down-left', 'soft-wipe-up-right', 'soft-wipe-up-left',
  'blinds-h', 'blinds-v', 'iris-open', 'iris-close', 'diamond-open', 'diamond-close', 'flash', 'luma-bright', 'luma-dark', 'squeeze-h', 'squeeze-v',
  'checker', 'bars-h', 'bars-v', 'ripple', 'whip-left', 'whip-right', 'whip-up', 'whip-down', 'spin-cw', 'spin-ccw',
] as const;
/** The 12 of them drawn by Canvas2D; the other 39 are WebGPU passes. */
export const LEGACY_CANVAS_TRANSITIONS = LEGACY_TRANSITIONS.slice(0, 12);
/** The text styles before the trend pack, in registry order (packages/core textPresets.ts at b6b5be9). */
export const LEGACY_TEXT_PRESETS = [
  'clean-white', 'classic-outline', 'bold-shadow', 'yellow-pop', 'black-box', 'white-box', 'yellow-box', 'red-alert', 'news-lower', 'subtitle-soft',
  'headline-serif', 'elegant-serif', 'book-quote', 'display-big', 'display-yellow', 'neon-pink', 'neon-cyan', 'neon-green', 'gold', 'comic',
  'comic-yellow', 'sticker-white', 'sticker-black', 'minimal-small', 'minimal-grey', 'caption-tiktok', 'caption-highlight', 'pink-box', 'green-box', 'purple-box',
  'orange-pop', 'sky', 'mint', 'rose-gold', 'title-card', 'end-card', 'price-tag', 'whisper', 'retro', 'ghost',
] as const;
const SHAPES = [[360, 640], [640, 360]] as const;
const FRAMES = [61, 74, 87] as const;
const SAMPLE = 'שָׁלוֹם עולם 2026';
const STATIC_STILLS = { 'classic-outline+rise-word-20@40': { in: 'rise', by: 'word', inFrames: 20 }, 'classic-outline+none@40': null } as const;

/** A recorded still: its pixel hash, or the refusal the worker gave instead (`refused` = HTTP status and error code, compared by --check; `message` for the reader). */
type Entry = string | { refused: string; message: string };
interface Baseline {
  commit: string; recordedAt: string;
  machine: { platform: string; cpu: string | undefined; gpu: string };
  scope: string;
  /** transitions[id]['360x640' | '640x360'][frame] */
  transitions: Record<string, Record<string, Record<string, Entry>>>;
  /** text[presetId] at frame 10, plus the two static-path stills of 'classic-outline' at frame 40. */
  text: Record<string, Entry>;
  summary: { pixelHashes: number; refused: number; gpuTransitionsRendered: boolean };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const recorded: Baseline | null = CHECK ? (JSON.parse(fs.readFileSync(evidence, 'utf8')) as Baseline) : null;
  if (CHECK && !recorded) throw new Error(`no baseline at ${evidence}`);

  delete process.env.PF_RENDER_GPU; // as gpu-proof: the render host finds a launch mode that gives a graphics device, if this machine has one
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const upload = async (pid: string, file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
  /** One still: its pixel hash, or the refusal (status and error code/message) when the worker refuses it. */
  const still = async (pid: string, index: number): Promise<Entry> => {
    const r = await call(`/projects/${pid}/frame?index=${index}`);
    if (r.status === 200 && Buffer.isBuffer(r.body)) return pixelHash(r.body);
    const e = r.body?.error ?? {};
    return { refused: `${r.status} ${e.code ?? 'unknown'}`, message: String(e.message ?? '').slice(0, 200) };
  };

  const transitions: Baseline['transitions'] = {};
  const text: Baseline['text'] = {};
  let gpuOk = false;
  const started = Date.now();
  try {
    // ---------- transitions ----------
    const R30 = { num: 30, den: 1 };
    for (const [W, H] of SHAPES) {
      const shape = `${W}x${H}`;
      // the gpu-proof blue fixture (gpu-proof.ts mk): red = column, green = row, blue 0 in the outgoing and 255 in the incoming picture
      const mk = (name: string, blue: number) => { const raw = Buffer.alloc(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[i] = Math.round((255 * x) / (W - 1)); raw[i + 1] = Math.round((255 * y) / (H - 1)); raw[i + 2] = blue; } const f = path.join(art, `${shape}-${name}`); ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', f], raw); return f; };
      const tp = (await call('/projects', { name: `transitions ${shape}`, width: W, height: H })).body.project.id as string;
      const aOut = await upload(tp, mk('out.png', 0)), aIn = await upload(tp, mk('in.png', 255));
      await tx(tp, [{ op: 'add_clip', args: { assetId: aOut, start: T.rt(0, 1), duration: T.frameTime(60, R30) } }]);
      const inClip = (await tx(tp, [{ op: 'add_clip', args: { assetId: aIn, start: T.frameTime(60, R30), duration: T.frameTime(60, R30) } }])).results[0].output.clipId as string;
      for (const id of LEGACY_TRANSITIONS) {
        await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }]);
        const row: Record<string, Entry> = {};
        for (const f of FRAMES) row[String(f)] = await still(tp, f);
        (transitions[id] ??= {})[shape] = row;
        if (!LEGACY_CANVAS_TRANSITIONS.includes(id as never) && typeof row['74'] === 'string') gpuOk = true;
      }
      console.log(`  transitions ${shape}: ${LEGACY_TRANSITIONS.length} ids done (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }

    // ---------- titles ----------
    const W = 1080, H = 1920;
    const pp = (await call('/projects', { name: 'titles', width: W, height: H })).body.project.id as string;
    const title = (await tx(pp, [{ op: 'add_text', args: { text: SAMPLE, start: T.rt(0, 1), duration: T.frameTime(60, R30) } }])).results[0].output.clipId as string;
    for (const id of LEGACY_TEXT_PRESETS) {
      await tx(pp, [{ op: 'apply_text_preset', args: { clipId: title, presetId: id } }]);
      text[id] = await still(pp, 10);
    }
    await tx(pp, [{ op: 'apply_text_preset', args: { clipId: title, presetId: 'classic-outline' } }]);
    for (const [key, anim] of Object.entries(STATIC_STILLS)) {
      await tx(pp, [{ op: 'set_text_animation', args: { clipId: title, animation: anim } }]);
      text[key] = await still(pp, 40);
    }
    console.log(`  titles: ${Object.keys(text).length} stills done (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  } finally {
    await s.close();
  }

  const all: Entry[] = [...Object.values(transitions).flatMap((r) => Object.values(r).flatMap((x) => Object.values(x))), ...Object.values(text)];
  const current: Baseline = {
    commit, recordedAt: new Date().toISOString(),
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: gpuOk ? 'software WebGPU adapter in the render worker (no hardware adapter here)' : 'no WebGPU adapter in the render worker: the GPU transitions are recorded as refused' },
    scope: `Pixel hashes (SHA-256 of decoded RGBA) of server stills: ${LEGACY_TRANSITIONS.length} legacy transitions (frames=29, outgoing clip 0–60, incoming 60–120, blue fixture) at frames ${FRAMES.join(', ')} in ${SHAPES.map(([w, h]) => `${w}x${h}`).join(' and ')}; ${LEGACY_TEXT_PRESETS.length} legacy text styles on '${SAMPLE}' at 1080x1920 frame 10; 'classic-outline' at frame 40 with and without a word rise entrance of 20 frames. Same machine and build only: hashes from another machine's browser may differ.`,
    transitions, text,
    summary: { pixelHashes: all.filter((e) => typeof e === 'string').length, refused: all.filter((e) => typeof e !== 'string').length, gpuTransitionsRendered: gpuOk },
  };

  if (!CHECK) {
    fs.writeFileSync(evidence, JSON.stringify(current, null, 1) + '\n');
    console.log(`\ntrend baseline RECORDED at ${commit.slice(0, 7)}: ${current.summary.pixelHashes} pixel hashes, ${current.summary.refused} refused stills -> ${path.relative(root, evidence)}`);
    if (current.summary.refused) console.log('Refused stills are recorded with their reason; --check expects the same refusal.');
    return;
  }

  // ---------- --check: exactly what was recorded ----------
  const diffs: { what: string; recorded: Entry | undefined; now: Entry | undefined }[] = [];
  const same = (a: Entry | undefined, b: Entry | undefined) => (typeof a === 'string' || typeof b === 'string' ? a === b : !!a && !!b && a.refused === b.refused);
  for (const [id, shapes] of Object.entries(recorded!.transitions)) for (const [shape, frames] of Object.entries(shapes)) for (const [f, e] of Object.entries(frames)) {
    const now = current.transitions[id]?.[shape]?.[f];
    if (!same(e, now)) diffs.push({ what: `transition ${id} ${shape} frame ${f}`, recorded: e, now });
  }
  for (const [id, e] of Object.entries(recorded!.text)) if (!same(e, current.text[id])) diffs.push({ what: `text ${id}`, recorded: e, now: current.text[id] });
  const report = { checkedAt: current.recordedAt, commit, baselineCommit: recorded!.commit, result: diffs.length ? 'FAILED' : 'PASSED', compared: { pixelHashes: recorded!.summary.pixelHashes, refused: recorded!.summary.refused }, differences: diffs };
  fs.writeFileSync(path.join(art, 'check.json'), JSON.stringify(report, null, 1) + '\n');
  for (const d of diffs.slice(0, 40)) console.log(` FAIL  ${d.what}: ${JSON.stringify(d.recorded)} -> ${JSON.stringify(d.now)}`);
  console.log(`\ntrend baseline --check ${report.result} against ${recorded!.commit.slice(0, 7)}: ${recorded!.summary.pixelHashes} pixel hashes and ${recorded!.summary.refused} refusals compared, ${diffs.length} differ (report: ${path.relative(root, path.join(art, 'check.json'))})`);
  if (diffs.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
