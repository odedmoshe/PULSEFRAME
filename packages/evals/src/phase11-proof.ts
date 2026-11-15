/**
 * Phase 11 gate, model-free part (SPEC §23, §24): rule-based recipes that are editable, grounded in project data,
 * applied as one undoable step, offer alternatives, and keep hand-edited results when regenerated.
 * Not covered: the natural-language Director, Prompt-to-Draft, Long-to-Shorts, hooks, B-roll, brand kits (need a language
 * model and/or providers; not built).
 *   pnpm build && pnpm proof:phase11
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase11');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const fr = (t: any) => T.frameIndexAt(t, R);

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const { x, beats } = drumLoop(() => 120, 16, 0.5, 5);
  const raw = path.join(art, 'm.f32');
  fs.writeFileSync(raw, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  const musicFile = path.join(art, 'music.wav');
  ff(['-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', raw, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', musicFile]);
  const vid = (name: string, src: string) => { const file = path.join(art, name); ff(['-f', 'lavfi', '-t', '6', '-i', `${src}=s=640x360:r=30`, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', file]); return file; };
  const aFile = vid('a.mp4', 'testsrc2'), bFile = vid('b.mp4', 'mandelbrot');
  const speech = await generateBarcodeFixture({ out: path.join(art, 'speech.mp4'), frames: 240 });

  const s = await startServer({ port: 8802, dataDir: path.join(art, 'data') });
  const bearer = (t: string) => ({ authorization: `Bearer ${t}`, connection: 'close' });
  const h = bearer(s.auth.tokens.agent);
  const call = async (p: string, body?: unknown, headers: Record<string, string> = h) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const get = async (pid: string) => (await call(`/projects/${pid}`)).body as { project: any; revision: number };
  const vclips = (d: any) => d.sequences.seq_main.tracks.filter((t: any) => t.kind === 'video').flatMap((t: any) => t.clips).sort((p: any, q: any) => fr(p.start) - fr(q.start));
  const browser = await chromium.launch();
  try {
    console.log('\n# catalog');
    const cat = (await call('/catalog')).body.recipes;
    check('three recipes are listed with parameter schemas and state plainly that no language model is used', cat.length === 3 && cat.every((r: any) => r.paramsSchema?.type === 'object' && /no language model/.test(r.method) && r.name.he), cat.map((r: any) => r.id));

    console.log('\n# beat montage: grounded, one step, alternatives');
    const pid = (await call('/projects', { name: 'phase11', width: 640, height: 360 })).body.project.id;
    const music = await upload(pid, musicFile), A = await upload(pid, aFile), B = await upload(pid, bFile);
    const mc = (await txs(pid, [{ op: 'add_clip', args: { assetId: music.assetId, start: f(0) } }])).results[0].output;
    const musicClipId = mc.audioClipId ?? mc.clipId;
    const params = { musicClipId, assetIds: [A.assetId, B.assetId], everyBeats: 4 };
    const early = await call(`/projects/${pid}/recipes/beat-montage/plan`, { params });
    await call(`/projects/${pid}/assets/${music.assetId}/analyze`, { kind: 'beats' });
    const rev0 = (await get(pid)).revision;
    const plan = await call(`/projects/${pid}/recipes/beat-montage/plan`, { params });
    check('without beat data the recipe refuses and says what to run first; with it, the plan lists steps, the data it rests on (tempo, confidence, method) and alternatives — and changes nothing', early.status === 409 && early.body.error.code === 'needs_analysis' && /analyze_asset/.test(early.body.error.hint) && plan.status === 200 && plan.body.steps.length >= 1 && /BPM/.test(plan.body.basis[0]) && plan.body.alternatives.length >= 4 && (await get(pid)).revision === rev0, { steps: plan.body.steps, basis: plan.body.basis });
    const applied = await call(`/projects/${pid}/recipes/beat-montage/apply`, { params });
    let d = (await get(pid));
    const clips = vclips(d.project);
    const bars = beats.filter((_, i) => i % 4 === 0);
    const worst = Math.max(...clips.map((c: any) => Math.min(...bars.map((b) => Math.abs(b - T.toSeconds(c.start))))));
    const alternating = clips.every((c: any, i: number) => c.assetId === (i % 2 === 0 ? A.assetId : B.assetId));
    check('apply: one revision; picture cuts fall on bar lines of the real beat grid (within one frame), alternating between the chosen assets; the run is recorded', applied.status === 200 && d.revision === rev0 + 1 && clips.length >= 6 && worst <= 1 / 30 + 0.012 && alternating && clips.every((c: any) => d.project.recipeRuns[applied.body.runId].createdIds.includes(c.id)), { clips: clips.length, worstMs: Number((worst * 1000).toFixed(1)) });
    await call(`/projects/${pid}/undo`, {});
    const undone = await get(pid);
    await call(`/projects/${pid}/redo`, {});
    check('whole-task undo: one undo removes every clip the recipe placed and its run record; redo brings them back', vclips(undone.project).length === 0 && Object.keys(undone.project.recipeRuns).length === 0 && vclips((await get(pid)).project).length === clips.length);

    console.log('\n# regeneration keeps what was edited by hand');
    const runId = applied.body.runId;
    const edited1 = clips[1], edited2 = clips[2];
    await txs(pid, [{ op: 'trim_clip', args: { clipId: edited1.id, edge: 'end', to: f(fr(edited1.start) + 20) } }]);
    await txs(pid, [{ op: 'add_effect', args: { clipId: edited2.id, type: 'color.grayscale' } }]);
    const before = await get(pid);
    const regen = await call(`/projects/${pid}/recipe-runs/${runId}/regenerate`, { params: { ...params, everyBeats: 2, order: 'reverse' } });
    d = await get(pid);
    const after = vclips(d.project);
    const keep1 = after.find((c: any) => c.id === edited1.id), keep2 = after.find((c: any) => c.id === edited2.id);
    const b1 = vclips(before.project).find((c: any) => c.id === edited1.id), b2 = vclips(before.project).find((c: any) => c.id === edited2.id);
    const untouchedOld = clips.filter((c: any) => ![edited1.id, edited2.id].includes(c.id)).map((c: any) => c.id);
    const overlaps = after.some((c: any, i: number) => i > 0 && after[i - 1].trackId === c.trackId && fr(after[i - 1].start) + fr(after[i - 1].duration) > fr(c.start));
    check('regenerate with new settings: the two hand-edited clips are kept byte-for-byte (trim and effect intact), every untouched clip is replaced, the new cut is denser, nothing overlaps, one revision', regen.status === 200 && JSON.stringify(regen.body.protected.sort()) === JSON.stringify([edited1.id, edited2.id].sort()) && JSON.stringify(keep1) === JSON.stringify(b1) && JSON.stringify(keep2) === JSON.stringify(b2) && untouchedOld.every((id: string) => !after.some((c: any) => c.id === id)) && after.length > clips.length && !overlaps && d.revision === before.revision + 1, { replaced: regen.body.replaced, protected: regen.body.protected.length, clipsBefore: clips.length, clipsAfter: after.length });
    await call(`/projects/${pid}/undo`, {});
    check('one undo of the regeneration restores the previous cut exactly', JSON.stringify((await get(pid)).project) === JSON.stringify(before.project));
    const stale = await call(`/projects/${pid}/recipes/beat-montage/apply`, { params, expectedRevision: rev0 });
    const obs = await call(`/projects/${pid}/recipes/beat-montage/apply`, { params }, bearer(s.auth.tokens.observer));
    check('a plan made for an older revision is refused; an observer cannot apply a recipe', stale.status === 409 && obs.status === 403, { stale: stale.body.error?.code, observer: obs.body.error?.code });

    console.log('\n# social pack and tidy speech');
    const sp = (await call('/projects', { name: 'phase11-social', width: 640, height: 360 })).body.project.id;
    const su = await upload(sp, speech.file);
    await txs(sp, [{ op: 'add_clip', args: { assetId: su.assetId, start: f(0) } }]);
    const pack = await call(`/projects/${sp}/recipes/social-pack/apply`, {});
    d = await get(sp);
    const again = await call(`/projects/${sp}/recipes/social-pack/apply`, {});
    check('social pack: adds three formats and a loudness target in one step, says no captions were added because there is no transcript, and refuses to run twice with nothing left to do', pack.status === 200 && Object.keys(d.project.variants).length === 3 && d.project.settings.loudness?.target === -14 && pack.body.basis.some((b: string) => /no transcript/.test(b)) && again.status === 409 && again.body.error.code === 'nothing_to_do', { steps: pack.body.steps });
    await txs(sp, [{ op: 'set_transcript', args: { assetId: su.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(8, 1), text: 'שלום עולם' }] } }]);
    const capPlan = await call(`/projects/${sp}/recipes/social-pack/plan`, {});
    check('after a transcript exists the same recipe plans only the missing part (captions)', capPlan.status === 200 && capPlan.body.operations === 1 && /captions/.test(capPlan.body.steps[0]), capPlan.body.steps);
    const framesBefore = Math.max(...d.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips.map((c: any) => fr(c.start) + fr(c.duration))));
    const tidy = await call(`/projects/${sp}/recipes/tidy-speech/apply`, { params: { assetId: su.assetId } });
    d = await get(sp);
    const framesAfter = Math.max(...d.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips.map((c: any) => fr(c.start) + fr(c.duration))));
    const tidyRev = d.revision;
    await call(`/projects/${sp}/undo`, {});
    const back = await get(sp);
    check('tidy speech: measured pauses are removed from every track, captions from the transcript are shown, loudness set to -16 — one step, one undo', tidy.status === 200 && framesAfter < framesBefore * 0.5 && d.project.sequences.seq_main.tracks.some((t: any) => t.kind === 'caption') && d.project.settings.loudness.target === -16 && Math.max(...back.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips.map((c: any) => fr(c.start) + fr(c.duration)))) === framesBefore && back.revision === tidyRev + 1, { framesBefore, framesAfter, steps: tidy.body.steps });

    console.log('\n# agent (MCP)');
    const c = new Client({ name: 'phase11-script', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
    const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
    const mp = await tool('plan_recipe', { projectId: pid, recipeId: 'beat-montage', params: { ...params, everyBeats: 8 } });
    const cur = await get(pid);
    const mr = await tool('regenerate_recipe', { projectId: pid, runId, params: { ...params, everyBeats: 8 } });
    const sum = await tool('get_summary', { projectId: pid });
    check('agent previews a recipe, regenerates the existing run with other settings (protected clips reported), and sees the run in the summary', !mp.isError && mp.data.steps.length > 0 && !mr.isError && mr.data.protected.length === 2 && sum.data.recipeRuns.length === 1 && (await get(pid)).revision === cur.revision + 1, { plan: mp.data.steps, replaced: mr.data.replaced });
    await c.close();

    console.log('\n# editor: recipes panel');
    const ep = (await call('/projects', { name: 'phase11-editor', width: 640, height: 360 })).body.project.id;
    const em = await upload(ep, musicFile); const eA = await upload(ep, aFile); await upload(ep, bFile);
    void eA;
    await txs(ep, [{ op: 'add_clip', args: { assetId: em.assetId, start: f(0) } }]);
    await call(`/projects/${ep}/assets/${em.assetId}/analyze`, { kind: 'beats' });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 3000 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/409|Conflict/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${s.url}/?project=${ep}`);
    await page.getByTestId('recipes-panel').waitFor();
    const card = page.locator('[data-testid=recipe-card][data-recipe-id="beat-montage"]');
    await card.getByTestId('recipe-plan').click();
    await card.getByTestId('recipe-steps').waitFor({ timeout: 30000 });
    const stepsText = await card.getByTestId('recipe-steps').textContent();
    const alts = await card.getByTestId('recipe-alternative').count();
    await card.getByTestId('recipe-apply').click();
    let placed = 0;
    for (let i = 0; i < 100 && placed === 0; i++) { placed = vclips((await get(ep)).project).length; if (!placed) await sleep(100); }
    await page.locator('[data-testid=recipe-run]').first().waitFor();
    const first = vclips((await get(ep)).project)[0];
    await txs(ep, [{ op: 'add_effect', args: { clipId: first.id, type: 'color.sepia' } }]);
    await card.getByTestId('recipe-every').selectOption('2');
    await page.locator('[data-testid=recipe-run] [data-testid=recipe-regenerate]').first().click();
    await page.locator('[data-testid=recipe-regenerate-result][data-protected]').waitFor({ timeout: 30000 });
    const prot = Number(await page.getByTestId('recipe-regenerate-result').getAttribute('data-protected'));
    const afterRegen = vclips((await get(ep)).project);
    await page.keyboard.press('Control+z');
    let restored = 0;
    for (let i = 0; i < 100 && restored !== placed; i++) { restored = vclips((await get(ep)).project).length; if (restored !== placed) await sleep(100); }
    await page.screenshot({ path: path.join(art, 'editor-recipes.png') });
    check('editor: preview shows steps and alternatives; apply places the clips; after a hand edit, regenerate with another setting keeps that clip (shown as 1 protected) and re-cuts the rest; Ctrl+Z undoes the regeneration', /\d/.test(stepsText ?? '') && alts >= 3 && placed >= 6 && prot === 1 && afterRegen.length > placed && afterRegen.some((c: any) => c.id === first.id && c.effects?.[0]?.type === 'color.sepia') && restored === placed && errors.length === 0, { placed, afterRegen: afterRegen.length, protectedShown: prot, restored, errors: errors.slice(0, 3) });
    await page.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Three rule-based recipes on synthetic material. No language-model Director and no generative steps.', passed: checks.length - failed.length, total: checks.length, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/phase11-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nPhase 11 proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
