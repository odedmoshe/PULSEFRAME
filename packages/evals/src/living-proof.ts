/**
 * pnpm proof:living — «תמונה חיה» (wave 8 living track; .artifacts/wave8/living-plan.md §5 as corrected by living-verify.md and the
 * lead's decisions: the model end is cut, so checks 8, 10 and the model parts of 11 are gone; check 4 refuses rotation (rotated
 * picture-in-picture is cut); check 12 compares the calm version with the master (stir 'none', C12); new checks C2, C3, C7, C13).
 * LEAD: the entry point and the check list, numbered as in the plan with the verifier's additions as 17–20. Built in parts:
 * living-proof.engine.ts (W2: 1–7, 9, 12, 17, 19) and living-proof.ui.ts (W3: 14–16, 18 in the editor), and the core/server rows
 * (W1: 11, 13, 20); the integration step imports them here and sets LIVING_PROOF_BUILT.
 * Runs on the SOFTWARE WebGPU adapter of headless Chromium (--enable-unsafe-webgpu), at 640×360, needs `pnpm build`; exits 2 (blocked)
 * when the browser gives no adapter, exactly as gpu-proof.ts does, and until it is built — never a pass.
 * Fixtures are SYNTHETIC only, made at proof time with ffmpeg from raw bytes and deleted at the end (under 1 MB): the coordinate photo
 * 640×360 PNG (R = x mod 256, G = y mod 256, B = 64·⌊x/256⌋; pixels within 2 px of a wrap column are skipped), a hand disc depth
 * (base flat, one near dab of size 300) and a ramp depth (horizon 400); a 640×360, 30 fps project with the photo on 3 s (90 frames).
 * Nobody here can look: every check is a measurement against core and the JS model (livingModel), none says how anything looks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { LIVING_EN, LIVING_HE } from '../../i18n/src/index.ts';
import { startServer } from '@pulseframe/server';
import { LIVING_PROOF_CORE, runLivingCore } from './living-proof.core.ts';
import { LIVING_PROOF_ENGINE, runLivingEngine } from './living-proof.engine.ts';
import { runLivingUi } from './living-proof.ui.ts';

export const LIVING_PROOF_BUILT = true;
export const LIVING_CHECKS: Readonly<Record<string, string>> = {
  1: 'slide, amount 1, the still at the last frame: pixels well outside the disc decode to source x shifted by the amount for m = −f, well inside by m = 1 − f, each within 1 px of livingModel',
  2: '300 random pixels of a still at travel 0.5 decode to livingModel\'s source within 1 px, skipping pixels within ⌈A⌉+2 px of a depth edge (C14 e); for the ramp, each row\'s shift is proportional to (y − h)/(1 − h) within 1 px',
  3: 'the band beside the disc\'s trailing edge is at most ⌈A⌉ + 2 px wide, every band pixel decodes to a source outside the disc (the far side), and no pixel inside the picture is transparent',
  4: 'a rotated photo (rotation 10°): set_living_picture refuses living_rotated; a living picture rotated afterwards is reported unavailable (preview notice, still refused naming the clip), never drawn flat',
  5: 'the effect disabled: the still equals the still without the effect byte for byte',
  6: 'the paused editor preview equals render_frame byte for byte at frames 0, 45 and 89 (gpu-proof.ts method)',
  7: 'export (MP4): the disc\'s decoded centre at frames 0, 22, 45, 67, 89 follows the ease-in-out keys within 1.5 px; every exported frame within 36 dB PSNR of its still',
  9: 'the page\'s depthGrid digest equals Node\'s for the hand disc and the ramp',
  11: 'an agent token: set_clip_depth and set_living_picture work as ordinary edits (hand depth is document data, LD4); render_frame shows the moved disc; add_effect depth.living is refused living_use_op',
  12: 'the calm audience version: the still at frame 89 equals the master\'s (stir none, C12)',
  13: 'set_living_picture on a 2-second clip at amount 1 → living_too_fast with max = livingMaxAmount; update_effect raising the amount past it is refused; keys made faster by replace_effect_keyframes → preflight living_too_fast with the clip id',
  14: 'PF_RENDER_GPU=off: the still is refused with the GPU reason; the block shows «דורש כרטיס מסך» (living-gpu-note)',
  15: 'editor, keyboard only: select the photo, the Motion tab, «הפכו לתמונה חיה» (Enter) opens the depth dialog with the ramp, «שמירה» commits ONE set_living_picture carrying the depth (C13), arrow to «גלישה הצידה»; the preview differs between frames 0 and 89; one Ctrl+Z restores the clip exactly (entity diff empty)',
  16: 'the dialog: open, move the horizon with the arrow keys, one pointer stroke «קרוב», «שמירה» = exactly one set_clip_depth in history; Escape on a second open saves nothing and returns focus to living-depth-open',
  17: 'C2: a photo at Ken Burns scale 1.18 (larger than the frame): the outer 2% of rows and columns decode to sources inside the frame (no edge smear)',
  18: 'C3: on a clip with Ken Burns in, set_living_picture removes the motion.move keys in the same transaction; the block shows «התנועה הקודמת הוחלפה בתמונה חיה»; one undo brings both back',
  19: 'C7: the pass\'s step count K is the same for the paused preview at 640×360, a still at 1280×720 and export at 640×360 (read back from the uniforms the page sends)',
  20: 'C6: set_clip_depth null with a living picture on the clip is refused («קודם הסירו את התמונה החיה»); a document with an enabled living picture and no depth: still refused naming the clip, preview notice, export plan blocked',
};


if (!LIVING_PROOF_BUILT) {
  console.error(`living-proof: not built yet; ${Object.keys(LIVING_CHECKS).length} checks pending (${Object.keys(LIVING_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/living-proof');
const GPU_ARGS = ['--enable-unsafe-webgpu'];
/** A check may be measured in parts (14: the block and the still; 20: the server and the preview notice); each part is pass, fail or blocked. */
type Part = { name: string; ok: boolean; blocked?: string; detail?: unknown };
const parts = new Map<number, Part[]>();
const check = (id: number, name: string, ok: boolean, detail?: unknown) => {
  const blocked = detail && typeof detail === 'object' && 'blocked' in detail ? String((detail as { blocked: unknown }).blocked === true ? name : (detail as { blocked: unknown }).blocked) : undefined;
  (parts.get(id) ?? parts.set(id, []).get(id)!).push({ name, ok, ...(blocked ? { blocked } : {}), detail });
  console.log(`${ok ? '  ok  ' : blocked ? ' BLOCK' : ' FAIL '} ${id}. ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 900)}` : ''}`);
};

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  delete process.env.PF_RENDER_GPU; // the render host finds a launch mode that gives a graphics device
  const dataDir = path.join(art, 'data');
  let s = await startServer({ port: 0, dataDir });
  {
    const b = await chromium.launch({ args: GPU_ARGS });
    const p = await b.newPage();
    await p.goto(`${s.url}/gpu.html`);
    const has = await p.evaluate(async () => !!(await (navigator as any).gpu?.requestAdapter()));
    await b.close();
    if (!has) { await s.close(); fs.rmSync(art, { recursive: true, force: true }); console.error('BLOCKED: the browser gives no WebGPU adapter on this machine, even with WebGPU enabled (see `pnpm probe:gpu`)'); process.exit(2); }
  }
  let browser: Browser | null = null, plain: Browser | null = null;
  let noDepth: { pid: string; clipId: string } | null = null;
  const started = Date.now();
  try {
    browser = await chromium.launch({ args: GPU_ARGS });
    const dir = (n: string) => { const d = path.join(art, n); fs.mkdirSync(d, { recursive: true }); return d; };
    await runLivingEngine({ url: s.url, ownerUrl: s.ownerUrl, agentToken: s.auth.tokens.agent, browser, art: dir('engine'), check })
      .catch((e) => { for (const id of LIVING_PROOF_ENGINE.checks) if (!parts.has(id)) check(id, 'engine part threw before this check', false, { error: String(e?.stack ?? e).slice(0, 400) }); });
    await runLivingCore({ url: s.url, agentToken: s.auth.tokens.agent, art: dir('core'), check, noDepthProject: (pid, clipId) => { noDepth = { pid, clipId }; } })
      .catch((e) => { for (const id of LIVING_PROOF_CORE.checks) if (!parts.has(id)) check(id, 'core part threw before this check', false, { error: String(e?.stack ?? e).slice(0, 400) }); });
    // 20, the editor part: the imported project with an enabled living picture and no depth shows the notice naming the reason
    {
      const nd = noDepth as { pid: string; clipId: string } | null;
      if (!nd) check(20, 'preview notice: not run (the core part made no imported project)', false, { blocked: 'no imported project from the core part' });
      else {
        const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
        try {
          await page.goto(`${s.ownerUrl}&project=${nd.pid}`);
          await page.locator('.clip').first().waitFor({ timeout: 15000 });
          const notice = await page.getByTestId('effect-unavailable').textContent({ timeout: 15000 }).catch(() => null);
          const words = [LIVING_HE['living.unavailable.no_depth'], LIVING_EN['living.unavailable.no_depth']];
          check(20, 'preview: the editor shows the notice over the preview with the reason «no drawn depth» in the interface language (never drawn flat)', !!notice && words.some((w) => notice.includes(w)), { notice: notice?.slice(0, 300) ?? null });
        } finally { await page.close(); }
      }
    }
    // the editor checks 14, 15, 16, 18 (owner session); 14 in a browser without WebGPU
    plain = await chromium.launch();
    const page: Page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    await page.goto(s.ownerUrl); await page.getByTestId('timecode').waitFor({ timeout: 15000 }).catch(() => {});
    const noGpuPage: Page = await plain.newPage({ viewport: { width: 1500, height: 950 } });
    await noGpuPage.goto(s.ownerUrl); await noGpuPage.getByTestId('timecode').waitFor({ timeout: 15000 }).catch(() => {});
    for (const r of await runLivingUi({ page, noGpuPage })) check(r.id, LIVING_CHECKS[r.id] ?? `check ${r.id}`, r.ok, { ...r.detail, ...(r.blocked ? { blocked: r.blocked } : {}) });
  } finally {
    await plain?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await s.close();
  }
  // 14, the server part: a render worker without an adapter refuses the still of a living picture with the reason
  process.env.PF_RENDER_GPU = 'off';
  s = await startServer({ port: 0, dataDir });
  try {
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    const pid = ((await (await fetch(`${s.url}/api/v1/projects`, { headers: h })).json()) as any).projects.find((p: any) => p.name === 'living-disc')?.id as string | undefined;
    if (!pid) check(14, 'still without an adapter: not run (the engine part made no living project)', false, { blocked: 'no living-disc project' });
    else {
      const r = await fetch(`${s.url}/api/v1/projects/${pid}/frame?index=45`, { headers: h });
      const body = r.headers.get('content-type')?.includes('json') ? ((await r.json()) as any) : null;
      check(14, 'PF_RENDER_GPU=off: the still of a living picture is refused with the graphics-adapter reason (not delivered flat)', r.status >= 400 && /gpu_effect_unavailable|graphics adapter/.test(JSON.stringify(body)) && /depth\.living/.test(JSON.stringify(body)), { status: r.status, error: String(body?.error?.message ?? '').slice(0, 300) });
    }
  } finally { await s.close(); delete process.env.PF_RENDER_GPU; }

  const rows = Object.keys(LIVING_CHECKS).map(Number).map((id) => {
    const ps = parts.get(id) ?? [];
    const status = ps.length === 0 ? 'not run' : ps.some((p) => !p.ok && !p.blocked) ? 'fail' : ps.some((p) => p.blocked) ? 'blocked' : 'pass';
    return { id, check: LIVING_CHECKS[id], status, parts: ps };
  });
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const result = count('fail') + count('not run') ? 'FAILED' : count('blocked') ? 'BLOCKED IN PART' : 'PASSED';
  const report = {
    ranAt: new Date().toISOString(), result, passed: count('pass'), failed: count('fail'), blocked: count('blocked'), notRun: count('not run'), total: rows.length,
    secondsOneSample: Math.round((Date.now() - started) / 1000),
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none: the WebGPU adapter here is a software one' },
    scope: '«תמונה חיה» on synthetic pictures only (a coordinate photo, a disc, a gradient; hand depths: a disc and a ramp) at 640×360 on a software WebGPU adapter: measurements against core and the JavaScript model of the pass (livingModel), the operations, preflight, the export plan and the editor. No hardware adapter, no real photo, no model depth; nobody has looked at the result.',
    checks: rows,
  };
  fs.writeFileSync(path.join(root, 'docs/evidence/living-proof.json'), JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(art, { recursive: true, force: true });
  console.log(`\nliving proof ${result}: ${report.passed} passed, ${report.failed} failed, ${report.blocked} blocked, ${report.notRun} not run, of ${report.total}`);
  for (const r of rows) console.log(`  ${String(r.id).padStart(2)} ${r.status}`);
  if (result === 'FAILED') process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
