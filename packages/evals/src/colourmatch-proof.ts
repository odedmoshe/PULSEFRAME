/**
 * pnpm proof:colourmatch (ADR-0014): colour match «התאמת צבע» and automatic colour balance «איזון צבע אוטומטי» on the real server,
 * the real render worker (software WebGPU here) and the real editor, written to docs/evidence/colourmatch-proof.json.
 *
 *   M2 recovery     a reference graded with known values, matched from an ungraded copy of the same picture: values within ±0.05,
 *                   verified difference ≤ 1.5
 *   M3 cast         an ffmpeg colorbalance cast matched to the neutral picture: the verified difference falls by ≥ 60 %
 *   M4 extreme      a cast beyond the grade's reach (R/B about 2.3): limitedBy includes temperature, every value in range, the
 *                   remaining difference reported
 *   M5 match all    5 clips through MCP (match_colour, targets 'all'): one transaction, one undo restores all 5, each grade is
 *                   still editable with update_effect
 *   M6 within clip  a hard cut inside a clip: changes_within_clip (and not on a clip without one)
 *   M7 flash        the matched timeline's export passes the flash check (FlashAnalyser), failing area not above the unmatched one's
 *   M8 no adapter   PF_RENDER_GPU=off: `unavailable` carries the reason and nothing claims to be verified; a graded reference is a 503
 *   M9 balance      automatic balance of a warm cast on a grey scene: verified mid-tone a* and b* within 2 of 0
 *   M10 UI          the panel in Hebrew, right to left, reachable and usable by keyboard; tiles are still; «החל» adds exactly one
 *                   revision; with no adapter in the browser the panel is disabled and says why
 *   timing          seconds per target clip, reported
 *
 * Synthetic pictures only (ffmpeg's test pattern, blurred, with casts made by ffmpeg filters): this proves the measurement, the
 * fit, the op and the refusals, not that a match looks right on real footage. Nobody has compared the results by eye yet.
 *   pnpm build && pnpm proof:colourmatch       Exits 2 (blocked) when this machine's browser gives no WebGPU adapter.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { paramRange } from '@pulseframe/core';
import { statsDistance, type GradeParams, type PictureStats } from '@pulseframe/engine';
import { verdictOf } from '@pulseframe/engine/colourMatch.ts';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/colourmatch-proof');
const W = 640, H = 360, SECONDS = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 900)}` : ''}`); };
const KEYS = ['exposure', 'temperature', 'tint', 'contrast', 'saturation', 'shadows', 'highlights', 'fade'] as const;
const inRange = (p: GradeParams) => KEYS.every((k) => { const r = paramRange('color.grade', k)!; return p[k] >= r.min && p[k] <= r.max; });
const r2 = (v: number | null | undefined) => (v === null || v === undefined ? v : Number(v.toFixed(2)));
interface Target { clipId: string; params: GradeParams; residual: { model: number; verified: number | null }; verdict: string; limitedBy: string[]; warnings: string[]; statsBefore: PictureStats; statsAfter: PictureStats | null }
interface Match { revision: number; method: string; reference: { clipId: string; stats: PictureStats } | null; targets: Target[]; ops: { op: string; args: any }[]; unavailable: string | null; note: string }

/** The fixtures: ffmpeg's colour test pattern, blurred so its colours change smoothly, as 2 s H.264 clips; casts made by ffmpeg filters. */
function fixtures() {
  const scene = (out: string, filters: string, src = `testsrc2=size=${W}x${H}:rate=25`) => { const f = path.join(art, out); ff(['-f', 'lavfi', '-i', src, '-t', String(SECONDS), '-vf', `gblur=sigma=6${filters ? `,${filters}` : ''},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-an', f]); return f; };
  const cut = path.join(art, 'cut.mp4');
  ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=25:duration=1`, '-f', 'lavfi', '-i', `color=c=0x1d3a8a:size=${W}x${H}:rate=25:duration=1`, '-filter_complex', '[0:v]gblur=sigma=6[a];[a][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-an', cut]);
  return {
    neutral: scene('neutral.mp4', ''),
    warm: scene('warm.mp4', 'colorbalance=rm=0.22:gm=-0.04:bm=-0.22'),
    cool: scene('cool.mp4', 'colorbalance=rm=-0.18:bm=0.22'),
    dark: scene('dark.mp4', 'eq=brightness=-0.1:contrast=0.9'),
    bright: scene('bright.mp4', 'eq=brightness=0.08'),
    magenta: scene('magenta.mp4', 'colorbalance=gm=-0.14'),
    extreme: scene('extreme.mp4', 'colorchannelmixer=rr=1.45:bb=0.62'),
    greyWarm: scene('grey-warm.mp4', 'hue=s=0,colorbalance=rm=0.18:bm=-0.18'),
    cut,
  };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fx = fixtures();
  const dataDir = path.join(art, 'data');
  const measurements: Record<string, unknown> = {};
  const timing: { check: string; targets: number; seconds: number; secondsPerTarget: number }[] = [];
  delete process.env.PF_RENDER_GPU; // the render host finds a launch mode that gives a graphics device
  const s = await startServer({ port: 8885, dataDir });
  {
    const b = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
    const p = await b.newPage();
    await p.goto(`${s.url}/gpu.html`);
    const has = await p.evaluate(async () => !!(await (navigator as any).gpu?.requestAdapter()));
    await b.close();
    if (!has) { await s.close(); console.error('BLOCKED: the browser gives no WebGPU adapter on this machine, even with WebGPU enabled (see `pnpm probe:gpu`)'); process.exit(2); }
  }
  const api = (srv: { url: string; auth: { tokens: { agent: string } } }) => {
    const h = { authorization: `Bearer ${srv.auth.tokens.agent}`, connection: 'close' };
    const call = async (p: string, body?: unknown) => {
      const r = await fetch(`${srv.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null } as { status: number; body: any };
    };
    const tx = async (pid: string, ops: unknown[], extra: Record<string, unknown> = {}) => { const r = await call(`/projects/${pid}/transactions`, { ops, ...extra }); if (r.status !== 200) throw new Error(`transaction refused: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
    const upload = async (pid: string, file: string) => { const r = await fetch(`${srv.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) }); const b = (await r.json()) as any; if (!b.assetId) throw new Error(`upload failed: ${JSON.stringify(b).slice(0, 300)}`); return b.assetId as string; };
    const waitJob = async (jobId: string, limitMs = 15 * 60_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > limitMs) throw new Error(`job ${jobId} still ${j.status}`); await sleep(500); } };
    /** match_colour as a durable job (as the panel runs it): the result, its wall time, or the refusal. */
    const match = async (pid: string, body: Record<string, unknown>): Promise<{ ok: true; result: Match; seconds: number } | { ok: false; status: number; error: any }> => {
      const t0 = Date.now();
      const r = await call(`/projects/${pid}/analysis/colour-match`, { ...body, background: true });
      if (r.status !== 202) return { ok: false, status: r.status, error: r.body?.error };
      const j = await waitJob(r.body.jobId);
      if (j.status !== 'succeeded') return { ok: false, status: 0, error: j.error };
      return { ok: true, result: j.output.result as Match, seconds: (Date.now() - t0) / 1000 };
    };
    const project = async (name: string) => (await call('/projects', { name, width: W, height: H })).body.project.id as string;
    /** Clips one after another on the first video track, each its file's whole length. */
    const clips = async (pid: string, files: string[]) => {
      const out: string[] = [];
      for (const [i, file] of files.entries()) out.push((await tx(pid, [{ op: 'add_clip', args: { assetId: await upload(pid, file), start: T.rt(i * SECONDS, 1), duration: T.rt(SECONDS, 1) } }])).results[0].output.clipId as string);
      return out;
    };
    const doc = async (pid: string) => (await call(`/projects/${pid}`)).body as { project: any; revision: number };
    const clipOf = (d: any, id: string) => Object.values(d.sequences as Record<string, any>).flatMap((q: any) => q.tracks.flatMap((t: any) => t.clips)).find((c: any) => c.id === id);
    return { call, tx, upload, waitJob, match, project, clips, doc, clipOf, h };
  };
  const A = api(s);
  const gradeOf = (c: any) => c?.effects?.find((e: any) => e.type === 'color.grade');
  let m3Project = '', m2Project = '';
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
  const plain = await chromium.launch(); // no WebGPU, as an owner's browser without an adapter
  try {
    // ---------- M2 recovery ----------
    {
      const pid = (m2Project = await A.project('m2'));
      const [ref, target] = await A.clips(pid, [fx.neutral, fx.neutral]) as [string, string];
      const known: GradeParams = { exposure: 0.3, temperature: 0.35, tint: -0.2, contrast: 1.15, saturation: 0.85, shadows: 0.2, highlights: 0.1, fade: 0.05 };
      await A.tx(pid, [{ op: 'set_colour_grade', args: { clipId: ref, params: known } }]);
      const before = (await A.doc(pid)).revision;
      const m = await A.match(pid, { method: 'match', referenceClipId: ref, targetClipIds: [target] });
      const t = m.ok ? m.result.targets[0]! : null;
      const errs = t ? Object.fromEntries(KEYS.map((k) => [k, r2(Math.abs(t.params[k] - known[k]))])) : null;
      measurements.m2 = { known, found: t?.params, errors: errs, verified: r2(t?.residual.verified), model: r2(t?.residual.model), seconds: m.ok ? m.seconds : null };
      if (m.ok) timing.push({ check: 'M2', targets: 1, seconds: m.seconds, secondsPerTarget: m.seconds });
      check('M2 recovery: a reference graded with known values, matched from an ungraded copy: every value within ±0.05, verified difference ≤ 1.5, the revision unchanged', !!t && KEYS.every((k) => Math.abs(t.params[k] - known[k]) <= 0.05) && t.residual.verified !== null && t.residual.verified <= 1.5 && (await A.doc(pid)).revision === before, measurements.m2);
    }

    // ---------- M3 cast ----------
    {
      const pid = (m3Project = await A.project('m3'));
      const [ref, target] = await A.clips(pid, [fx.neutral, fx.warm]) as [string, string];
      const m = await A.match(pid, { method: 'match', referenceClipId: ref, targetClipIds: [target] });
      const t = m.ok ? m.result.targets[0]! : null;
      const before = m.ok && t ? statsDistance(t.statsBefore, m.result.reference!.stats) : null;
      const after = t?.residual.verified ?? null;
      measurements.m3 = { before: r2(before), after: r2(after), reduction: before && after !== null ? r2(1 - after / before) : null, params: t?.params, verdict: t?.verdict };
      if (m.ok) timing.push({ check: 'M3', targets: 1, seconds: m.seconds, secondsPerTarget: m.seconds });
      check('M3 cast: an ffmpeg colorbalance cast matched to the neutral picture: the verified difference falls by at least 60 %', before !== null && after !== null && after <= 0.4 * before, measurements.m3);
    }

    // ---------- M4 extreme cast ----------
    {
      const pid = await A.project('m4');
      const [ref, target] = await A.clips(pid, [fx.neutral, fx.extreme]) as [string, string];
      const m = await A.match(pid, { method: 'match', referenceClipId: ref, targetClipIds: [target] });
      const t = m.ok ? m.result.targets[0]! : null;
      measurements.m4 = { params: t?.params, limitedBy: t?.limitedBy, verdict: t?.verdict, model: r2(t?.residual.model), verified: r2(t?.residual.verified) };
      check('M4 extreme cast (R/B about 2.3): limitedBy includes temperature, every value in range, the remaining difference and verdict are reported, the verdict from the verified render', !!t && t.limitedBy.includes('temperature') && inRange(t.params) && Number.isFinite(t.residual.model) && t.residual.verified !== null && t.verdict === verdictOf(t.residual.verified), measurements.m4);
    }

    // ---------- M5 match all (MCP), M7 flash ----------
    {
      const pid = await A.project('m5');
      const ids = await A.clips(pid, [fx.neutral, fx.warm, fx.cool, fx.dark, fx.bright, fx.magenta]);
      const [ref, ...targets] = ids as [string, ...string[]];
      // M7 baseline: the export before matching
      const exportFlash = async () => { const j0 = await A.call(`/projects/${pid}/exports`, {}); const j = await A.waitJob(j0.body.jobId); return { status: j.status, ps: j.output?.photosensitivity as { verdict: string; ranges: { area: number }[] } | undefined, error: j.error }; };
      const flashBefore = await exportFlash();
      const mcp = new Client({ name: 'colourmatch-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } } }));
      const t0 = Date.now();
      const started = await mcp.callTool({ name: 'match_colour', arguments: { projectId: pid, method: 'match', referenceClipId: ref, targetClipIds: 'all', background: true } });
      const startedBody = JSON.parse(((started.content as any[]).find((c) => c.type === 'text')?.text as string | undefined) ?? '{}');
      if (started.isError || !startedBody.jobId) throw new Error(`match_colour over MCP was refused: ${JSON.stringify(startedBody).slice(0, 300)}`);
      const job = await A.waitJob(startedBody.jobId);
      await mcp.close();
      const result = job.output?.result as Match | undefined;
      const secs = (Date.now() - t0) / 1000;
      if (result) timing.push({ check: 'M5', targets: result.targets.length, seconds: secs, secondsPerTarget: secs / Math.max(1, result.targets.length) });
      const before = await A.doc(pid);
      const effectsBefore = Object.fromEntries(targets.map((id) => [id, JSON.stringify(A.clipOf(before.project, id).effects ?? [])]));
      let afterApply: any = null, afterUndo: any = null, edits: number[] = [], flashAfter: Awaited<ReturnType<typeof exportFlash>> | null = null;
      if (result) {
        await A.tx(pid, result.ops, { expectedRevision: result.revision });
        afterApply = await A.doc(pid);
        await A.call(`/projects/${pid}/undo`, {});
        afterUndo = await A.doc(pid);
        await A.call(`/projects/${pid}/redo`, {});
        const redone = await A.doc(pid);
        flashAfter = await exportFlash(); // M7: the matched timeline, before the edits below
        for (const id of targets) { const g = gradeOf(A.clipOf(redone.project, id)); const r = await A.call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_effect', args: { clipId: id, effectId: g?.id, params: { exposure: Math.min(2, (g?.params.exposure ?? 0) + 0.1) } } }] }); edits.push(r.status); }
      }
      const opsFor = new Set((result?.ops ?? []).map((o) => o.args.clipId));
      measurements.m5 = {
        targets: result?.targets.map((t) => ({ clipId: t.clipId, verdict: t.verdict, verified: r2(t.residual.verified), limitedBy: t.limitedBy, warnings: t.warnings })), ops: result?.ops.length,
        revisions: { before: before.revision, afterApply: afterApply?.revision, afterUndo: afterUndo?.revision }, updateEffect: edits,
      };
      check('M5 match all through MCP: 5 targets (every picture clip but the reference), one op each, applied as ONE transaction (one revision)', !!result && result.targets.length === 5 && targets.every((id) => opsFor.has(id)) && result.ops.length === 5 && !opsFor.has(ref) && afterApply?.revision === before.revision + 1 && targets.every((id) => JSON.stringify(gradeOf(A.clipOf(afterApply.project, id))?.params) === JSON.stringify(result.ops.find((o) => o.args.clipId === id)?.args.params)), measurements.m5);
      check('M5: one undo restores all 5 clips exactly; after redo every grade is still editable with update_effect', !!afterUndo && targets.every((id) => JSON.stringify(A.clipOf(afterUndo.project, id).effects ?? []) === effectsBefore[id]) && edits.length === 5 && edits.every((x) => x === 200), { updateEffect: edits });
      const area = (x: typeof flashBefore) => (x.ps?.ranges ?? []).reduce((a, r) => a + r.area, 0);
      measurements.m7 = { before: { status: flashBefore.status, verdict: flashBefore.ps?.verdict, failingArea: area(flashBefore), error: flashBefore.error }, after: flashAfter && { status: flashAfter.status, verdict: flashAfter.ps?.verdict, failingArea: area(flashAfter), error: flashAfter.error } };
      check('M7 flash: the export of the matched timeline passes the flash check, and its failing area is not above the unmatched export\'s', flashBefore.status === 'succeeded' && flashAfter?.status === 'succeeded' && flashAfter.ps?.verdict === 'pass' && area(flashAfter) <= area(flashBefore), measurements.m7);
    }

    // ---------- M6 within-clip cut ----------
    {
      const pid = await A.project('m6');
      const [ref, cut, plainClip] = await A.clips(pid, [fx.neutral, fx.cut, fx.warm]) as [string, string, string];
      const m = await A.match(pid, { method: 'match', referenceClipId: ref, targetClipIds: [cut, plainClip] });
      const w = (id: string) => (m.ok ? m.result.targets.find((t) => t.clipId === id)?.warnings : undefined);
      measurements.m6 = { cut: w(cut), plain: w(plainClip) };
      if (m.ok) timing.push({ check: 'M6', targets: 2, seconds: m.seconds, secondsPerTarget: m.seconds / 2 });
      check('M6 a hard cut inside a clip: changes_within_clip on that clip, not on a clip without a cut', !!w(cut)?.includes('changes_within_clip') && !w(plainClip)?.includes('changes_within_clip'), measurements.m6);
    }

    // ---------- M9 auto balance ----------
    {
      const pid = await A.project('m9');
      const [target] = await A.clips(pid, [fx.greyWarm]) as [string];
      const m = await A.match(pid, { method: 'balance', targetClipIds: [target] });
      const t = m.ok ? m.result.targets[0]! : null;
      measurements.m9 = { before: t && { a: r2(t.statsBefore.meanA), b: r2(t.statsBefore.meanB) }, after: t?.statsAfter && { a: r2(t.statsAfter.meanA), b: r2(t.statsAfter.meanB) }, params: t?.params, verdict: t?.verdict };
      if (m.ok) timing.push({ check: 'M9', targets: 1, seconds: m.seconds, secondsPerTarget: m.seconds });
      check('M9 auto balance of a warm cast on a grey scene: verified mid-tone a* and b* within 2 of 0 (the cast was larger before), no reference used', !!t?.statsAfter && Math.abs(t.statsAfter.meanA) <= 2 && Math.abs(t.statsAfter.meanB) <= 2 && Math.hypot(t.statsBefore.meanA, t.statsBefore.meanB) > 4 && m.ok && m.result.reference === null, measurements.m9);
    }

    // ---------- M10 the panel in the editor ----------
    {
      const pid = m3Project;
      const d0 = await A.doc(pid);
      const [ref, target] = d0.project.sequences[d0.project.mainSequenceId].tracks.find((t: any) => t.kind === 'video').clips.map((c: any) => c.id) as [string, string];
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.locator('.clip').first().waitFor();
      const openClip = async (p: Page, id: string) => {
        await p.getByTestId(`clip-${id}`).click();
        await p.getByTestId('inspector-tab-clip').click().catch(() => {});
        await p.getByTestId('sections-open-all').click().catch(() => {});
        await p.getByTestId('colour-match').waitFor({ timeout: 20_000 });
      };
      /** Tab from the panel's heading area until focus lands on `testid` (inside the panel); false when it never does. */
      const tabTo = async (p: Page, testid: string, max = 60) => {
        await p.getByTestId('colour-match').locator('h4').click();
        for (let i = 0; i < max; i++) {
          await p.keyboard.press('Tab');
          const at = await p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null);
          if (at === testid) return true;
        }
        return false;
      };
      await openClip(page, ref);
      const dir = await page.evaluate(() => ({ html: document.documentElement.dir, lang: document.documentElement.lang, panel: getComputedStyle(document.querySelector('[data-testid=colour-match]')!).direction }));
      // wait for this browser's adapter check: «מדוד» stays disabled until it has passed
      for (let i = 0; i < 100 && (await page.getByTestId('colour-match-unavailable').count()); i++) await sleep(200);
      const reachedRef = await tabTo(page, 'colour-match-set-reference');
      await page.keyboard.press('Space');
      const refText = await page.getByTestId('colour-match-reference').textContent();
      await openClip(page, target);
      const reachedRadio = await tabTo(page, 'colour-match-method-match');
      const reachedMeasure = await tabTo(page, 'colour-match-measure');
      const revBefore = (await A.doc(pid)).revision;
      await page.keyboard.press('Enter');
      const progressText = await page.getByTestId('colour-match-progress').textContent().catch(() => '');
      await page.getByTestId('colour-match-results').waitFor({ timeout: 10 * 60_000 });
      for (let i = 0; i < 150 && (await page.locator('[data-testid=colour-match-tile][data-state=drawing]').count()); i++) await sleep(200);
      const tiles = await page.locator('[data-testid=colour-match-tile]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.state));
      const shotA = await page.getByTestId('colour-match-results').screenshot();
      await sleep(800);
      const shotB = await page.getByTestId('colour-match-results').screenshot();
      // (the theme gives buttons a short colour transition on hover and focus; that is not motion, and it has settled by now)
      const motion = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid=colour-match]')!;
        const running = document.getAnimations().filter((a) => { const t = (a.effect as KeyframeEffect | null)?.target; return !!t && panel.contains(t as Node); }).length;
        const moving = [...panel.querySelectorAll('*')].filter((el) => { const st = getComputedStyle(el); return !!st.animationName && st.animationName !== 'none'; }).length;
        return { running, moving };
      });
      const names = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid=colour-match]')!;
        const nameOf = (el: HTMLElement) => el.getAttribute('aria-label') || el.closest('label')?.textContent?.trim() || el.textContent?.trim() || '';
        return [...panel.querySelectorAll<HTMLElement>('button, input, select')].map((el) => ({ testid: el.dataset.testid ?? el.tagName, name: nameOf(el) }));
      });
      const statusRole = await page.getByTestId('colour-match-progress').evaluate((el) => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live') }));
      const reachedApply = await tabTo(page, 'colour-match-apply');
      await page.keyboard.press('Enter');
      for (let i = 0; i < 100 && (await A.doc(pid)).revision === revBefore; i++) await sleep(200);
      await sleep(500);
      const afterApply = await A.doc(pid);
      const grade = gradeOf(A.clipOf(afterApply.project, target));
      measurements.m10 = { dir, reached: { setReference: reachedRef, radio: reachedRadio, measure: reachedMeasure, apply: reachedApply }, referenceText: refText, progressText, statusRole, tiles, sameTilePixels: shotA.equals(shotB), motion, revisions: { before: revBefore, after: afterApply.revision }, unnamed: names.filter((x) => !x.name), errors };
      check('M10 the panel in Hebrew, right to left; set reference, choose and measure by keyboard; the measuring status is a polite live region', dir.html === 'rtl' && dir.lang === 'he' && dir.panel === 'rtl' && reachedRef && reachedRadio && reachedMeasure && /[֐-׿]/.test(refText ?? '') && statusRole.role === 'status' && statusRole.live === 'polite' && names.every((x) => x.name) && errors.length === 0, measurements.m10);
      check('M10 the results show still tiles (drawn once, identical a moment later, nothing animated in the panel)', tiles.length >= 3 && tiles.every((x) => x === 'drawn') && shotA.equals(shotB) && motion.running === 0 && motion.moving === 0, { tiles, same: shotA.equals(shotB), motion });
      check('M10 «החל» by keyboard adds exactly one revision and gives the clip the proposed grade', reachedApply && afterApply.revision === revBefore + 1 && !!grade, { revisions: measurements.m10 && (measurements.m10 as any).revisions, grade: grade?.params });
      await page.close();
      // no adapter in the browser: the panel is disabled and says why
      const p2 = await plain.newPage({ viewport: { width: 1500, height: 950 } });
      await p2.goto(`${s.ownerUrl}&project=${pid}`);
      await p2.locator('.clip').first().waitFor();
      await openClip(p2, target);
      await sleep(1500);
      const noGpu = { reason: await p2.getByTestId('colour-match-unavailable').textContent().catch(() => null), measureDisabled: await p2.getByTestId('colour-match-measure').isDisabled() };
      check('M10 without a graphics adapter in the browser: the panel says why and «מדוד» is disabled', !!noGpu.reason && /[֐-׿]/.test(noGpu.reason) && noGpu.measureDisabled, noGpu);
      await p2.close();
    }
  } finally {
    await browser.close().catch(() => {});
    await plain.close().catch(() => {});
    await s.close();
  }

  // ---------- M8 no adapter in the render worker ----------
  process.env.PF_RENDER_GPU = 'off';
  const s2 = await startServer({ port: 8886, dataDir });
  try {
    const B = api(s2);
    const videoClips = (d: { project: any }) => d.project.sequences[d.project.mainSequenceId].tracks.find((x: any) => x.kind === 'video').clips.map((c: any) => c.id) as string[];
    const [ref, target] = videoClips(await B.doc(m3Project)) as [string, string];
    // the M10 apply gave the target a grade: the reference is still ungraded, so it can be measured without an adapter
    const m = await B.match(m3Project, { method: 'match', referenceClipId: ref, targetClipIds: [target] });
    const t = m.ok ? m.result.targets[0] : null;
    measurements.m8 = { unavailable: m.ok ? m.result.unavailable?.slice(0, 240) : null, verified: t?.residual.verified, statsAfter: t?.statsAfter ?? null, warnings: t?.warnings, ops: m.ok ? m.result.ops.length : null, note: m.ok ? m.result.note.slice(0, 300) : null, error: m.ok ? null : m.error };
    check('M8 PF_RENDER_GPU=off: `unavailable` gives the reason, no target claims a verified result (not_verified, verified null, no stats after), the ops are still offered', m.ok && !!m.result.unavailable && /graphics adapter/.test(m.result.unavailable) && m.result.targets.every((x) => x.residual.verified === null && x.statsAfter === null && x.warnings.includes('not_verified')) && m.result.ops.length === 1, measurements.m8);
    const [gradedRef, copy] = videoClips(await B.doc(m2Project)) as [string, string];
    const r = await B.call(`/projects/${m2Project}/analysis/colour-match`, { method: 'match', referenceClipId: gradedRef, targetClipIds: [copy] });
    check('M8: a reference that has a grade cannot be measured without an adapter: 503 with the reason, nothing returned as a result', r.status === 503 && /graphics adapter/.test(JSON.stringify(r.body)), { status: r.status, error: r.body?.error?.message?.slice(0, 240) });
  } finally {
    await s2.close();
    delete process.env.PF_RENDER_GPU;
  }

  measurements.timing = timing.map((x) => ({ ...x, seconds: r2(x.seconds), secondsPerTarget: r2(x.secondsPerTarget) }));
  console.log('timing (seconds per target clip):', JSON.stringify(measurements.timing));
  check('timing: seconds per target clip are reported for every match that ran', timing.length >= 5 && timing.every((x) => x.secondsPerTarget > 0), measurements.timing);
  const failed = checks.filter((x) => !x.ok);
  const report = {
    ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none: the WebGPU adapter here is a software one' },
    scope: 'Colour match and automatic colour balance (ADR-0014) on synthetic pictures (ffmpeg\'s test pattern, blurred, with casts made by ffmpeg filters) at 640x360, through the real server, render worker (software WebGPU) and editor. It proves the measurement, the fit, the verification, the op, the refusals and the panel; it does not show that a match looks right on real footage: nobody has compared the results by eye yet.',
    measurements, checks,
  };
  fs.writeFileSync(path.join(root, 'docs/evidence/colourmatch-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nColour match proof ${report.result}: ${report.passed}/${report.total}`);
  if (failed.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
