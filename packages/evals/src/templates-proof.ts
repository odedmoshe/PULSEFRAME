/**
 * proof:templates (ADR-0016): every built-in template planned, applied, exported and measured through the real server, on
 * in-house fixtures only (barcode videos whose every frame carries its own index, still pictures drawn by ffmpeg, a 120 BPM
 * drum loop from beats.fixtures analysed through the analyze route). Writes docs/evidence/templates-proof.json.
 * For each built-in at 540×960, 30 fps:
 *   1. plan changes nothing (same revision);  2. apply adds exactly one revision;
 *   3. slot boundaries equal the expected beat frames of the placed music (0 errors) and are at least 11 frames apart;
 *   4. source truth: describe_moment's sourceFrameIndex at the middle frame of each video slot (0 errors), and the barcode pixels
 *      of every exported frame of each video slot outside its transition, in a second project with motion 'none' and the
 *      adjustment, title and element tracks hidden (0 errors);
 *   5. the exported frame count equals the predicted end (±0);  6. the export's flash check reports no failing range;
 *   7. one undo gives an equal creativeProjection, and replay equals the live document;
 *   8. a shuffle regeneration keeps one hand-edited slot and replaces the rest (counts recorded).
 * Also recorded: plan time (median and p95 over 20 runs per template), export seconds per template, and the MCP
 * plan_template / apply_template round trip (one revision). Rule-based; no model is used anywhere.
 *   pnpm build && pnpm proof:templates
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { creativeProjection, flashGapFrames, TEMPLATE_METHOD, TEMPLATES, type ProjectDocument, type TemplateDef } from '@pulseframe/core';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/templates-proof');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const W = 540, H = 960;
const GAP = flashGapFrames(30);
const fr = (t: T.RationalTime) => T.frameIndexAt(t, R);
const nf = (t: T.RationalTime) => T.nearestFrameIndex(t, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 30 });
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!; return { runs: s.length, median: Number(q(0.5).toFixed(2)), p95: Number(q(0.95).toFixed(2)), max: Number(s[s.length - 1]!.toFixed(2)) }; };

type Doc = ProjectDocument;
type Slot = { key: string; kind: string; clipId: string; beats?: { from: number; count: number; unit: 'beat' | 'bar' } };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');

  // ---------------------------------------------------------------- in-house fixtures
  const portrait = await generateBarcodeFixture({ out: path.join(art, 'barcode_360x640_30fps.mp4'), width: 360, height: 640, frames: 450 });
  const landscape = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps.mp4'), width: 640, height: 360, frames: 450 });
  // Calm videos for the main projects: the barcode strip changes every frame, which the flash check could count as flashing, so
  // the barcode videos are used only where pixels are read (4b), and the flash check (6) judges what the template does.
  const calm = (name: string, src: string) => { const file = path.join(art, name); ff(['-f', 'lavfi', '-t', '15', '-i', src, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', file]); return file; };
  const calmPortrait = calm('calm_360x640.mp4', 'mandelbrot=s=360x640:r=30'), calmLandscape = calm('calm_640x360.mp4', 'testsrc2=s=640x360:r=30');
  const still1 = path.join(art, 'still_square.png'), still2 = path.join(art, 'still_tall.png');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=1080x1080', '-frames:v', '1', still1]);
  ff(['-f', 'lavfi', '-i', 'smptebars=s=1080x1350', '-frames:v', '1', still2]);
  const loop = drumLoop(() => 120, 40, 0.5, 5, 4);
  const raw = path.join(art, 'music.f32');
  fs.writeFileSync(raw, Buffer.from(loop.x.buffer, loop.x.byteOffset, loop.x.byteLength));
  const musicFile = path.join(art, 'music_120bpm.wav');
  ff(['-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', raw, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', musicFile]);

  const s = await startServer({ port: 8879, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => { const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) }); const b = (await r.json()) as any; if (!b.assetId) throw new Error(`upload failed: ${JSON.stringify(b).slice(0, 300)}`); return b.assetId as string; };
  const get = async (pid: string, revision?: number) => (await call(`/projects/${pid}${revision === undefined ? '' : `?revision=${revision}`}`)).body as { project: Doc; revision: number };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(200); } };
  const exportMp4 = async (pid: string, name: string) => {
    const started = await call(`/projects/${pid}/exports`, {});
    if (started.status !== 202 && started.status !== 200) throw new Error(`export refused: ${JSON.stringify(started.body).slice(0, 400)}`);
    const job = await waitJob(started.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return { job, file };
  };
  const frameCount = (file: string) => ff(['-i', file, '-vf', 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).length / 256;

  /** A project at 540×960, 30 fps with both barcode videos, both stills and the music, its beats measured through the route. */
  const seed = async (name: string, videos: 'calm' | 'barcode' = 'calm') => {
    const pid = (await call('/projects', { name, width: W, height: H })).body.project.id as string;
    const media = { portrait: await upload(pid, videos === 'calm' ? calmPortrait : portrait.file), landscape: await upload(pid, videos === 'calm' ? calmLandscape : landscape.file), still1: await upload(pid, still1), still2: await upload(pid, still2) };
    const music = await upload(pid, musicFile);
    const an = await call(`/projects/${pid}/assets/${music}/analyze`, { kind: 'beats' });
    if (an.status !== 200) throw new Error(`beat analysis failed: ${JSON.stringify(an.body).slice(0, 300)}`);
    let barsBy = 'measured';
    const beats = (await get(pid)).project.analyses[music]!.beats!;
    if (!beats.downbeats?.length) { // the detector found no bar pattern: mark every fourth beat as a bar start, by hand, and say so
      await txs(pid, [{ op: 'edit_analysis', args: { assetId: music, kind: 'beats', downbeats: beats.beats.filter((_, i) => i % 4 === 0), meter: 4 } }]);
      barsBy = 'marked by hand (every 4th beat)';
    }
    return { pid, media, music, barsBy, bpm: beats.bpm, beatCount: beats.beats.length };
  };
  const paramsFor = (def: TemplateDef, m: { media: Record<string, string>; music: string }, extra: Record<string, unknown> = {}) => ({
    media: [m.media.portrait, m.media.landscape, m.media.still1, m.media.portrait, m.media.landscape, m.media.still2],
    musicAssetId: def.music.need === 'none' ? null : m.music, lang: 'he', ...extra,
  });
  const pictureSlots = (doc: Doc, runId: string) => (doc.recipeRuns[runId]!.slots ?? []).filter((x) => x.kind === 'picture') as Slot[];
  const clipOf = (doc: Doc, id: string) => { for (const t of doc.sequences[doc.mainSequenceId]!.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return { clip: c, track: t }; } return null; };

  const measurements: Record<string, unknown> = {};
  const perTemplate: Record<string, unknown> = {};
  const planMs: number[] = [];
  try {
    console.log('\n# the gallery');
    const listed = (await call('/templates')).body.templates as { id: string; available: boolean; method: string; unavailableReason: string | null; needs: { model: string | null } }[];
    const builtins = listed.filter((t) => t.method === TEMPLATE_METHOD);
    const gated = listed.filter((t) => t.needs.model !== null);
    check('the gallery lists the built-in templates (rule-based; no model) and then the model-gated ones as unavailable with their reason', builtins.length === TEMPLATES.length && builtins.length >= 6 && gated.length >= 2 && gated.every((g) => !g.available && /not installed/.test(g.unavailableReason ?? '')) && listed.slice(-gated.length).every((g) => g.needs.model !== null), { builtins: builtins.map((t) => t.id), gated: gated.map((t) => t.id) });
    const anyProject = (await call('/projects', { name: 'gated', width: W, height: H })).body.project.id;
    const gp = await call(`/projects/${anyProject}/templates/${gated[0]!.id}/plan`, { params: { media: [] } });
    check('planning a model-gated template is refused with 409 needs_capability and nothing is downloaded', gp.status === 409 && gp.body.error.code === 'needs_capability', gp.body.error);
    const unavailable = builtins.filter((t) => !t.available);
    check('every built-in template is available on this machine (graphic elements need an ffmpeg with librsvg)', unavailable.length === 0, unavailable.map((t) => ({ id: t.id, reason: t.unavailableReason })));

    for (const def of TEMPLATES) {
      console.log(`\n# ${def.id} (${def.name.en})`);
      const m = await seed(def.id);
      const params = paramsFor(def, m);
      const rec: Record<string, unknown> = { music: { bpm: m.bpm, beats: m.beatCount, bars: m.barsBy } };
      perTemplate[def.id] = rec;

      // 1. plan changes nothing; its time over 20 runs
      const rev0 = (await get(m.pid)).revision;
      const times: number[] = [];
      let plan: any = null;
      for (let i = 0; i < 20; i++) { const t0 = performance.now(); plan = await call(`/projects/${m.pid}/templates/${def.id}/plan`, { params }); times.push(performance.now() - t0); }
      planMs.push(...times);
      rec.planMs = stats(times);
      check(`${def.id}: plan answers with steps and no blocking item, at the current revision, and changes nothing`, plan.status === 200 && plan.body.revision === rev0 && plan.body.blocking.length === 0 && plan.body.steps.length > 0 && (await get(m.pid)).revision === rev0, { steps: plan.body.steps?.length, warnings: plan.body.warnings?.map((w: { code: string }) => w.code), operations: plan.body.operations });

      // 2. apply: one revision
      const before = await get(m.pid);
      const applied = await call(`/projects/${m.pid}/templates/${def.id}/apply`, { params, expectedRevision: plan.body.revision });
      const after = await get(m.pid);
      check(`${def.id}: apply adds exactly one revision`, applied.status === 200 && after.revision === rev0 + 1, applied.status === 200 ? { runId: applied.body.runId, created: applied.body.createdIds.length } : applied.body.error);
      if (applied.status !== 200) continue;
      const runId = applied.body.runId as string;
      const doc = after.project;
      const slots = pictureSlots(doc, runId);
      const clips = slots.map((x) => clipOf(doc, x.clipId)!.clip);
      const bounds = [fr(clips[0]!.start), ...clips.map((c) => fr(T.add(c.start, c.duration)))];

      // 3. boundaries on the beats of the music as it is placed (timeline = clip start + (beat − sourceIn)), at least GAP apart
      const musicClip = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media' && c.assetId === m.music);
      const an = doc.analyses[m.music]!.beats!;
      const onTimeline = (list: T.RationalTime[]) => (musicClip && musicClip.type === 'media' ? list.filter((b) => !T.lt(b, musicClip.sourceIn)).map((b) => nf(T.add(musicClip.start, T.sub(b, musicClip.sourceIn)))) : []);
      const beatFrames = onTimeline(an.beats), barFrames = onTimeline(an.downbeats ?? []);
      let boundaryErrors = 0, secondsAt = T.ZERO;
      const expected: number[] = [];
      slots.forEach((sl, i) => {
        const span = def.slots.find((x) => x.key === sl.key)!.span;
        let want: [number, number] | null = null;
        if (sl.beats) { const list = sl.beats.unit === 'beat' ? beatFrames : barFrames; const a = list[sl.beats.from], b = list[sl.beats.from + sl.beats.count]; want = a !== undefined && b !== undefined ? [a, b] : null; }
        else if ('seconds' in span) { const [num, den] = span.seconds.split('/'); const end = T.add(secondsAt, T.rt(BigInt(num!), Number(den ?? 1))); want = [nf(secondsAt), nf(end)]; secondsAt = end; }
        expected.push(...(want ?? [-1, -1]));
        if (!want || want[0] !== bounds[i] || want[1] !== bounds[i + 1]) boundaryErrors++;
      });
      const minGap = Math.min(...bounds.slice(1).map((b, i) => b - bounds[i]!));
      check(`${def.id}: slot boundaries equal the expected beat frames of the placed music (0 errors) and are at least ${GAP} frames apart`, boundaryErrors === 0 && (bounds.length < 3 || minGap >= GAP) && JSON.stringify(bounds) === JSON.stringify(plan.body.predicted.boundaries), { boundaries: bounds, boundaryErrors, minGap, slots: slots.length });

      // 4a. source truth through describe_moment at the middle of every video slot
      const mcp = new Client({ name: 'templates-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
      const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await mcp.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
      let momentErrors = 0, momentChecked = 0;
      for (const [i, sl] of slots.entries()) {
        const c = clips[i]!;
        if (c.type !== 'media' || doc.assets[c.assetId]!.kind !== 'video') continue;
        const start = bounds[i]!, mid = start + Math.floor((bounds[i + 1]! - start) / 2);
        const mo = await tool('describe_moment', { projectId: m.pid, frameIndex: mid });
        const layer = (mo.data.layers as { kind: string; clipId?: string; sourceFrameIndex?: number }[]).find((l) => l.kind === 'video' && l.clipId === sl.clipId);
        momentChecked++;
        if (!layer || layer.sourceFrameIndex !== fr(c.sourceIn) + (mid - start)) momentErrors++;
      }
      check(`${def.id}: describe_moment shows the planned source frame at the middle of every video slot (0 errors)`, momentErrors === 0 && momentChecked > 0, { checked: momentChecked, errors: momentErrors });

      // 5–6. export: frame count and flash check
      const ex = await exportMp4(m.pid, `${def.id}.mp4`);
      const frames = frameCount(ex.file);
      rec.exportSeconds = ex.job.output?.wallSeconds ?? null;
      check(`${def.id}: the exported file has exactly the predicted number of frames`, frames === plan.body.predicted.endFrame, { exported: frames, predicted: plan.body.predicted.endFrame });
      const flash = ex.job.output?.photosensitivity;
      check(`${def.id}: the export's flash check reports no failing range`, !!flash && flash.verdict === 'pass' && flash.ranges.length === 0, flash ? { verdict: flash.verdict, ranges: flash.ranges.length, frames: flash.frames } : 'no report');

      // 7. one undo restores the creative state; replay equals live
      const live = await get(m.pid);
      const replayed = await get(m.pid, live.revision);
      check(`${def.id}: replay of the history equals the live document`, JSON.stringify(replayed.project) === JSON.stringify(live.project));
      const undo = await call(`/projects/${m.pid}/undo`, {});
      const undone = await get(m.pid);
      check(`${def.id}: one undo gives an equal creativeProjection`, undo.status === 200 && creativeProjection(undone.project) === creativeProjection(before.project));
      await call(`/projects/${m.pid}/redo`, {});

      // 8. shuffle keeps a hand-edited slot and replaces the rest
      const handSlot = slots[1] ?? slots[0]!;
      await txs(m.pid, [{ op: 'set_clip_transform', args: { clipId: handSlot.clipId, transform: { rotation: 3 } } }]);
      const edited = clipOf((await get(m.pid)).project, handSlot.clipId)!.clip;
      const r0 = (await get(m.pid)).revision;
      const regen = await call(`/projects/${m.pid}/template-runs/${runId}/regenerate`, { params: { order: 'shuffle', seed: 2 } });
      const regenerated = await get(m.pid);
      const kept = clipOf(regenerated.project, handSlot.clipId)?.clip;
      const newSlots = pictureSlots(regenerated.project, runId);
      rec.shuffle = regen.status === 200 ? { replaced: regen.body.replaced, protected: regen.body.protected.length, slotsAfter: newSlots.length } : regen.body.error;
      check(`${def.id}: shuffle keeps the hand-edited slot exactly and replaces every untouched item, as one revision`, regen.status === 200 && regenerated.revision === r0 + 1 && JSON.stringify(regen.body.protected) === JSON.stringify([handSlot.clipId]) && regen.body.replaced > 0 && JSON.stringify(kept) === JSON.stringify(edited) && newSlots.filter((x) => x.key !== handSlot.key).every((x) => !slots.some((o) => o.clipId === x.clipId)), rec.shuffle);

      // 4b. barcode truth on exported pixels: motion none, adjustment, title and element tracks hidden
      const b = await seed(`${def.id}-barcode`, 'barcode');
      const bApplied = await call(`/projects/${b.pid}/templates/${def.id}/apply`, { params: paramsFor(def, b, { motion: 'none' }) });
      if (bApplied.status !== 200) { check(`${def.id}: barcode project applied`, false, bApplied.body.error); await mcp.close(); continue; }
      const bDoc = (await get(b.pid)).project;
      const bSlots = pictureSlots(bDoc, bApplied.body.runId);
      const slotTrack = clipOf(bDoc, bSlots[0]!.clipId)!.track.id;
      const hide = bDoc.sequences[bDoc.mainSequenceId]!.tracks.filter((t) => t.id !== slotTrack && t.kind !== 'audio' && t.kind !== 'caption' && t.clips.length);
      if (hide.length) await txs(b.pid, hide.map((t) => ({ op: 'update_track', args: { trackId: t.id, hidden: true } })));
      const bx = await exportMp4(b.pid, `${def.id}-barcode.mp4`);
      const half = { w: W / 2, h: H / 2 };
      const rgb = ff(['-i', bx.file, '-vf', `scale=${half.w}:${half.h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const fb = half.w * half.h * 3;
      let pixelErrors = 0, pixelChecked = 0;
      const firstErrors: unknown[] = [];
      for (const sl of bSlots) {
        const c = clipOf(bDoc, sl.clipId)!.clip;
        if (c.type !== 'media') continue;
        const a = bDoc.assets[c.assetId]!;
        if (a.kind !== 'video' || !a.video) continue;
        const k = Math.min(W / a.video.width, H / a.video.height);
        const rect = { x: (W - a.video.width * k) / 4, y: (H - a.video.height * k) / 4, w: (a.video.width * k) / 2, h: (a.video.height * k) / 2 };
        const start = fr(c.start), end = start + fr(c.duration), skip = c.transition?.frames ?? 0;
        for (let f = start + skip; f < end; f++) {
          const shown = readBarcode(rgb.subarray(f * fb, (f + 1) * fb), half.w, 3, rect);
          const want = fr(c.sourceIn) + (f - start);
          pixelChecked++;
          if (shown !== want) { pixelErrors++; if (firstErrors.length < 5) firstErrors.push({ slot: sl.key, frame: f, shown, want }); }
        }
      }
      check(`${def.id}: every exported frame of every video slot (outside its transition) shows the planned source frame by its barcode (0 errors)`, pixelErrors === 0 && pixelChecked > 0, { checked: pixelChecked, errors: pixelErrors, first: firstErrors, hidden: hide.map((t) => t.kind) });
      rec.barcodeExportSeconds = bx.job.output?.wallSeconds ?? null;
      await mcp.close();
    }

    // MCP round trip on a fresh project
    console.log('\n# agent (MCP)');
    const def = TEMPLATES.find((t) => t.music.need === 'beats') ?? TEMPLATES[0]!;
    const m = await seed('mcp');
    const c = new Client({ name: 'templates-proof-mcp', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
    const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
    const rev0 = (await get(m.pid)).revision;
    const mp = await tool('plan_template', { projectId: m.pid, templateId: def.id, params: paramsFor(def, m) });
    const rev1 = (await get(m.pid)).revision;
    const ma = await tool('apply_template', { projectId: m.pid, templateId: def.id, params: paramsFor(def, m), expectedRevision: mp.data.revision });
    const rev2 = (await get(m.pid)).revision;
    measurements.mcp = { template: def.id, planRevision: mp.data.revision, revisions: [rev0, rev1, rev2], runId: ma.data.runId ?? null };
    check('MCP: plan_template changes nothing and apply_template adds exactly one revision', !mp.isError && !ma.isError && rev1 === rev0 && rev2 === rev0 + 1, measurements.mcp);
    await c.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await s.close();
    measurements.planMs = planMs.length ? stats(planMs) : null;
    measurements.perTemplate = perTemplate;
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none (Canvas2D software rendering)' },
      scope: 'The built-in templates (ADR-0016) at 540×960, 30 fps on in-house fixtures: barcode videos (pixel truth), ffmpeg test videos and pictures (mandelbrot, testsrc2, smptebars) and a synthetic 120 BPM drum loop analysed by the product. Rule-based; no model. Not judged by a person: nobody has watched these edits for taste.',
      passed: checks.length - failed.length, total: checks.length, measurements, checks,
    };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/templates-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nTemplates proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
