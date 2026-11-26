/**
 * pnpm proof:voiceclean (ADR-0013): voice cleanup «ניקוי קול» end to end, checks C1–C10 of the plan (.artifacts/cleanup-plan.md
 * section 4), through a started server (REST and MCP), the server mix, the editor preview in headless Chromium and the browser
 * self-test page. Written to docs/evidence/voiceclean-proof.json.
 *
 *   C1  measure_voice: band floors, hum, pauses against the known truth; the revision is unchanged (REST and MCP agree)
 *   C2  clean_voice: one op set (REST, then MCP), the export, then one undo restores the document
 *   C3  a range of the mix equals that part of the full mix
 *   C4  sync: bursts with hard onsets, the cleaned mix against the dry mix. White-noise bursts show the latency (the place of the
 *       chain's impulse response); the carrier of the 1 kHz bursts shows the phase its filters have at 1 kHz by design
 *   C5  preview = export: four cleaned clips; the samples the preview schedules against the export, 50 ms windows of what is
 *       heard, priming, late starts, main-thread long tasks
 *   C6  each cleanup voice in Node at least 20× real time
 *   C7  the cleanup kernels in Chromium against Node within 1e-6
 *   C8  a split at a non-multiple of the STFT hop: the parts sum to the unsplit mix
 *   C9  honest states: a sound that keeps its pitch, a picture-only asset, the catalogue's look-ahead and limits
 *   C10 speed 2: hum heard at 100–400 Hz reduced
 *
 * Needs `pnpm build` (the server serves the built editor and self-test page), FFmpeg and Playwright's Chromium; CPU only. Every
 * signal is synthetic and deterministic (voiceclean-fixtures.ts). Nobody has listened: these are measurements, not a verdict on
 * how the cleanup sounds.
 *   pnpm build && tsx packages/evals/src/voiceclean-proof.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { audioEffectParams, cleanVoiceEffects, CLEANUP_TYPES, encodeNoiseProfile, timeOriginSeconds, type AudioFxParams, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, fillPlayingOrder, openClipVoice, soundEnd } from '@pulseframe/engine';
import { denoiseFraming } from '@pulseframe/engine/audiofx/design.ts';
import { fxFixture, renderFx } from '@pulseframe/engine/audiofx/kernels/index.ts';
import { startServer, type RunningServer } from '@pulseframe/server';
import { mixToRaw } from '@pulseframe/server/audiomix.ts';
import { readStereo } from './voicefx-fixtures.ts';
import { band, between, burstRecording, cleanupPhaseDelay, coverage, lagAndMatch, lineOver, rmsDbOver, voiceRecording, VC_SR, writeWavF32, type Span } from './voiceclean-fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/voiceclean');
const SR = VC_SR, FPS = 30, SPF = SR / FPS;
const f = (n: number) => T.frameTime(n, { num: FPS, den: 1 });
const sec = (s: number) => f(Math.round(s * FPS));
const LSB = 1 / 32768;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r2 = (x: number) => Number(x.toFixed(2)), r3 = (x: number) => Number(x.toFixed(3));
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const measurements: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 700)}` : ''}`); };
/** The golden-hash variants of kernels.test.ts for the cleanup kernels (the second parameter set of the runtime comparison). */
const VARIANTS: Record<string, AudioFxParams> = {
  'cleanup.dehum': { mainsHz: '60', harmonics: 8, width: 1 },
  'cleanup.denoise': { reductionDb: 30, sensitivityDb: 10, profile: encodeNoiseProfile(Array(24).fill(-40)) },
  'cleanup.speech': { lowCutHz: 150, presence: 1, levelDb: 15, targetDb: -12, ceilingDb: -6 },
};
const maxDiff = (a: Float32Array, aFrom: number, b: Float32Array, bFrom: number, frames: number) => { let m = 0; for (let i = 0; i < frames * 2; i++) m = Math.max(m, Math.abs((a[aFrom * 2 + i] ?? 0) - (b[bFrom * 2 + i] ?? 0))); return m; };
const identical = (a: Float32Array, aFrom: number, b: Float32Array, bFrom: number, frames: number) => { for (let i = 0; i < frames * 2; i++) if (!Object.is(a[aFrom * 2 + i], b[bFrom * 2 + i])) return false; return true; };
const peakOf = (x: Float32Array) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };
/** Peak of the LEFT channel over [from, to) seconds: what the preview's measurement tap hears (pf-onset-tap.js reads channel 0). */
const peakLeftOver = (pcm: Float32Array, from: number, to: number) => { let p = 0; for (let i = Math.max(0, Math.round(from * SR)); i < Math.min(pcm.length / 2, Math.round(to * SR)); i++) p = Math.max(p, Math.abs(pcm[i * 2]!)); return p; };
/** Strip what changes with every revision, to compare documents. */
const docKey = (d: ProjectDocument) => JSON.stringify({ sequences: d.sequences, assets: d.assets, settings: d.settings });

interface PreviewRun { stats: any; longTasks: { start: number; ms: number }[]; wallMs: number; scheduled: { buffers: number; offGrid: number; frames: number; base64: string } | null }

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fxDir = path.join(art, 'fixtures');
  fs.mkdirSync(fxDir, { recursive: true });
  // ---- fixtures ----
  console.log('# fixtures');
  const rec = voiceRecording({ seconds: 30, seed: 1301 });
  const recFile = path.join(fxDir, 'recording.wav');
  writeWavF32(recFile, rec.pcm);
  const bursts = burstRecording(12, 1302);
  const burstFile = path.join(fxDir, 'bursts.wav');
  writeWavF32(burstFile, bursts.pcm);
  const picture = path.join(fxDir, 'picture.png');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3366aa:s=320x180', '-frames:v', '1', picture]);
  const speechSpans = between(rec.pauses, rec.seconds);
  measurements.fixture = { seconds: rec.seconds, pauses: rec.pauses.length, pauseShare: r3(rec.pauses.reduce((s, p) => s + p.end - p.start, 0) / rec.seconds), truthBandsDb: rec.truth.bandsDb.map(r2), noiseDb: rec.truth.noiseDb, speechDb: rec.truth.speechDb, hum: rec.truth.hum };

  const s: RunningServer = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[], extra: Record<string, unknown> = {}) => { const r = await call(`/projects/${pid}/transactions`, { ops, ...extra }); if (r.status !== 200) throw new Error(`transaction refused: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const newProject = async (name: string) => (await call('/projects', { name, width: 320, height: 180 })).body.project.id as string;
  const upload = async (pid: string, file: string) => {
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json();
    if (!up.assetId) throw new Error(`upload failed: ${JSON.stringify(up).slice(0, 300)}`);
    return up.assetId as string;
  };
  const addClip = async (pid: string, assetId: string, start: number, duration?: number) => {
    const trackId = (await tx(pid, [{ op: 'add_track', args: { kind: 'audio' } }])).results[0].output.trackId as string;
    const out = (await tx(pid, [{ op: 'add_clip', args: { assetId, trackId, start: f(start), ...(duration !== undefined ? { duration: f(duration) } : {}) } }])).results[0].output;
    return (out.audioClipId ?? out.clipId) as string;
  };
  const docOf = async (pid: string) => { const r = (await call(`/projects/${pid}`)).body; return { doc: r.project as ProjectDocument, revision: r.revision as number }; };
  const exportJob = async (pid: string, name: string, options: Record<string, unknown> = {}) => {
    const r = await call(`/projects/${pid}/exports`, { format: 'wav', ...options });
    if (!r.body.jobId) throw new Error(`export refused: ${JSON.stringify(r.body).slice(0, 400)}`);
    let job: any;
    for (;;) { job = (await call(`/jobs/${r.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
    if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${r.body.jobId}/output`)).body);
    return readStereo(file, SR);
  };
  /** The server mix of the current document in floating point, [first, first + count) samples (what export encodes). */
  const floatMix = async (pid: string, first = 0, count?: number) => {
    const { doc } = await docOf(pid);
    const plan = audioPlan(doc);
    const raw = path.join(art, `float_${pid}_${first}_${Date.now()}.f32`);
    await mixToRaw(plan, (id) => s.store.blobPath(doc.assets[id]!.contentHash), first, count ?? plan.totalSamples - first, raw, undefined, (id) => timeOriginSeconds(doc.assets[id]), (id) => doc.assets[id]?.audio?.channels === 1);
    const b = fs.readFileSync(raw);
    fs.rmSync(raw);
    return { pcm: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(), plan, doc };
  };
  const measure = async (pid: string, body: Record<string, unknown>) => call(`/projects/${pid}/analysis/voice`, body);
  /** A project with the recording as one sound clip at 0. */
  const recordingProject = async (name: string, file = recFile) => { const pid = await newProject(name); const assetId = await upload(pid, file); const clipId = await addClip(pid, assetId, 0); return { pid, assetId, clipId }; };

  const mcpClient = new Client({ name: 'voiceclean-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: h.authorization } } }));
  const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await mcpClient.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };

  let browser: Browser | null = null;
  const pageErrors: string[] = [];
  const section = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.error(e); check(`${name}: the block ran to its end`, false, String((e as Error)?.stack ?? e).slice(0, 800)); } };
  try {
    // ============================== C1 measure ==============================
    console.log('# C1 measure_voice');
    const A = await recordingProject('voice cleanup C1/C2');
    let restCheck: any = null, mcpCheck: any = null;
    await section('C1', async () => {
      const before = (await docOf(A.pid)).revision;
      const r = await measure(A.pid, { clipId: A.clipId, strength: 0.6 });
      if (r.status !== 200) throw new Error(`measure_voice: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
      restCheck = r.body;
      const m = await tool('measure_voice', { projectId: A.pid, clipId: A.clipId, strength: 0.6 });
      mcpCheck = m.data;
      const after = (await docOf(A.pid)).revision;
      const rep = restCheck.report, bands: number[] = rep.noise.bandsDb;
      const errs = bands.map((v, j) => r2(v - rec.truth.bandsDb[j]!));
      const cov = coverage(rep.noise.ranges as Span[], rec.pauses);
      measurements.C1 = { bandErrorsDb: errs, worstBandErrorDb: r2(Math.max(...errs.map(Math.abs))), hum: rep.hum, pauseCoverage: r3(cov), quietSeconds: rep.noise.quietSeconds, confidence: rep.noise.confidence, warning: rep.noise.warning, speech: rep.speech, recommendedStrength: restCheck.recommendedStrength, ops: restCheck.ops, revision: { before, reported: restCheck.revision, after }, mcpSameReport: JSON.stringify(mcpCheck?.report) === JSON.stringify(restCheck.report) && JSON.stringify(mcpCheck?.ops) === JSON.stringify(restCheck.ops) };
      check('C1 measure_voice on the 30 s recording: every noise band within ±2 dB of the truth; hum at 50 Hz; the quiet ranges found cover at least 80 % of the true pauses; the revision is unchanged; MCP returns the same report and ops',
        errs.every((e) => Math.abs(e) <= 2) && rep.hum?.hz === 50 && cov >= 0.8 && before === after && restCheck.revision === before && !m.isError && (measurements.C1 as any).mcpSameReport, measurements.C1);
    });

    // ============================== C2 clean_voice ==============================
    console.log('# C2 clean_voice');
    await section('C2', async () => {
      if (!restCheck) throw new Error('C1 gave no candidate ops');
      const dryDoc = await docOf(A.pid), dry = await floatMix(A.pid);
      const applied = await tx(A.pid, restCheck.ops, { expectedRevision: restCheck.revision });
      const wet = await floatMix(A.pid);
      const effects = (wet.doc.sequences[wet.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === A.clipId) as any)?.audioFx?.map((x: any) => x.type) ?? [];
      // noise in the pauses above 400 Hz (the hum lines, at most 200 Hz, are 24 dB down there), hum lines in the pauses, the vowel band in the phrases
      const noiseDry = rmsDbOver(band(dry.pcm, 0, 400, null), rec.pauses), noiseWet = rmsDbOver(band(wet.pcm, 0, 400, null), rec.pauses);
      const humDrop = [50, 100, 150, 200].map((hz) => r2(db(lineOver(dry.pcm, 0, hz, rec.pauses)) - db(lineOver(wet.pcm, 0, hz, rec.pauses))));
      const vowelDry = rmsDbOver(band(dry.pcm, 0, 300, 3400), speechSpans), vowelWet = rmsDbOver(band(wet.pcm, 0, 300, 3400), speechSpans);
      // report only: the same measurements with dehum + denoise alone (the engine in this process, no speech enhancer), to tell the stages apart
      let alone: Float32Array = dry.pcm;
      const a0 = restCheck.ops[0].args;
      for (const e of cleanVoiceEffects({ strength: a0.strength, profile: a0.profile, source: a0.source, mainsHz: a0.mainsHz ?? null, speech: false })) alone = renderFx(e.type, e.params, alone, { sampleRate: SR });
      const withoutSpeechEnhancer = { noiseReductionDb: r2(noiseDry - rmsDbOver(band(alone, 0, 400, null), rec.pauses)), humLineReductionDb: [50, 100, 150, 200].map((hz) => r2(db(lineOver(dry.pcm, 0, hz, rec.pauses)) - db(lineOver(alone, 0, hz, rec.pauses)))), vowelBandChangeDb: r2(rmsDbOver(band(alone, 0, 300, 3400), speechSpans) - vowelDry) };
      const undo = await call(`/projects/${A.pid}/undo`, {});
      const back = await docOf(A.pid);
      // the same through MCP: apply the MCP candidate ops in one apply_transaction, the same mix, one MCP undo
      const mApply = await tool('apply_transaction', { projectId: A.pid, expectedRevision: back.revision, ops: mcpCheck.ops });
      const mixMcp = await floatMix(A.pid);
      const mUndo = await tool('undo', { projectId: A.pid });
      const back2 = await docOf(A.pid);
      measurements.C2 = {
        strength: restCheck.ops[0]?.args?.strength, effects, revisions: { applied: applied.revision, undone: back.revision },
        noiseInPausesDbfs: { dry: r2(noiseDry), cleaned: r2(noiseWet), reductionDb: r2(noiseDry - noiseWet) },
        humLineReductionDb: humDrop, vowelBandDbfs: { dry: r2(vowelDry), cleaned: r2(vowelWet), changeDb: r2(vowelWet - vowelDry) }, withoutSpeechEnhancer,
        oneOpSet: restCheck.ops.length === 1 && restCheck.ops[0].op === 'clean_voice', undoRestores: undo.status === 200 && docKey(back.doc) === docKey(dryDoc.doc),
        mcp: { applied: !mApply.isError, sameMixAsRest: !mApply.isError && maxDiff(mixMcp.pcm, 0, wet.pcm, 0, wet.pcm.length / 2) === 0, undo: !mUndo.isError, undoRestores: docKey(back2.doc) === docKey(dryDoc.doc) },
      };
      check('C2 clean_voice at strength 0.6, applied as the ONE candidate op in one transaction with expectedRevision: noise in the pauses (above 400 Hz) at least 10 dB lower; each hum line at least 30 dB lower; the vowel band (300–3400 Hz) of the phrases within 1.5 dB; one undo restores the document; MCP applies the same op to the same mix and its undo restores it too',
        (measurements.C2 as any).oneOpSet && restCheck.ops[0].args.strength === 0.6 && noiseDry - noiseWet >= 10 && humDrop.every((d) => d >= 30) && Math.abs(vowelWet - vowelDry) <= 1.5 && (measurements.C2 as any).undoRestores && Object.values((measurements.C2 as any).mcp).every(Boolean), measurements.C2);
      // leave the project cleaned for C3
      await tx(A.pid, restCheck.ops);
    });

    // ============================== C3 range = full ==============================
    console.log('# C3 range = full');
    await section('C3', async () => {
      const full = await floatMix(A.pid);
      const peak = peakOf(full.pcm);
      const { doc } = await docOf(A.pid);
      const v = audioPlan(doc).clips.find((c) => c.clipId === A.clipId)!.voice!;
      const ranges = [{ from: 0, n: 2 * SR }, { from: 7 * SR + 333, n: 2 * SR }, { from: 20 * SR, n: 2 * SR }];
      const res: unknown[] = [];
      let ok = true;
      for (const r of ranges) {
        const part = (await floatMix(A.pid, r.from, r.n)).pcm;
        const md = maxDiff(part, 0, full.pcm, r.from, r.n), exact = identical(part, 0, full.pcm, r.from, r.n);
        const bitExactExpected = r.from <= v.warmRing;
        res.push({ fromSample: r.from, maxDifference: md, identical: exact, boundRelative: r3(md / peak / 2 ** -17) });
        ok &&= bitExactExpected ? exact : md <= 2 ** -17 * peak;
      }
      // the same through the WAV export: frames 60–120 and 600–660 against the full export (16-bit: within one step)
      const wavFull = await exportJob(A.pid, 'c3-full.wav'), wavPart = await exportJob(A.pid, 'c3-range.wav', { range: { startFrame: 0, endFrame: 60 } }), wavMid = await exportJob(A.pid, 'c3-mid.wav', { range: { startFrame: 600, endFrame: 660 } });
      const wav = { fromStartIdentical: identical(wavPart, 0, wavFull, 0, 60 * SPF), midMaxDifference: maxDiff(wavMid, 0, wavFull, 600 * SPF, 60 * SPF) };
      measurements.C3 = { warmRing: v.warmRing, warmWindow: v.warmWindow, aheadWindow: v.aheadWindow, peak: r3(peak), floatRanges: res, wav };
      check('C3 a 2 s range of the cleaned mix against the full mix: bit-exact from the start (from ≤ warmRing), within 2^-17 of the peak elsewhere; the WAV range export from the start is identical and a mid range within one 16-bit step', ok && wav.fromStartIdentical && wav.midMaxDifference <= LSB, measurements.C3);
    });

    // ============================== C4 sync ==============================
    console.log('# C4 sync');
    await section('C4', async () => {
      const B = await recordingProject('voice cleanup C4', burstFile);
      const dry = (await floatMix(B.pid)).pcm;
      const m = await measure(B.pid, { clipId: B.clipId, strength: 0.6 });
      await tx(B.pid, m.body.ops, { expectedRevision: m.body.revision });
      const cleaned = await floatMix(B.pid), wet = cleaned.pcm;
      const effects: { type: string; params: AudioFxParams }[] = ((cleaned.doc.sequences[cleaned.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === B.clipId) as any)?.audioFx ?? []).map((x: any) => ({ type: x.type, params: x.params }));
      const at = (onsets: number[]) => onsets.map((n0) => lagAndMatch(dry, wet, n0 - 240, 0.05 * SR));
      // Broadband bursts: the cross-correlation peaks where the impulse response of dry → cleaned is largest, so its lag IS the latency.
      const bb = at(bursts.noiseOnsets), broadband = bb.map((x) => x.lag);
      // 1 kHz bursts: the lag of a tone is its phase at 1 kHz in samples: the latency PLUS the phase the chain's minimum-phase filters
      // turn (low cut, presence, hum notches: they lead a 1 kHz tone and delay nothing). Compared with that phase by design.
      const tn = at(bursts.onsets), tone = tn.map((x) => x.lag), designed = cleanupPhaseDelay(effects, 1000);
      // a lag counts only where the cleaned burst is the dry burst (normalised correlation; silence or a broken mix matches nothing)
      const weakest = Math.min(...bb.map((x) => x.match), ...tn.map((x) => x.match));
      measurements.C4 = {
        effects: effects.map((e) => e.type), broadbandBursts: broadband.length, broadbandLagsSamples: broadband,
        toneBursts: tone.length, toneCarrierLagsSamples: tone, designedPhaseDelayAt1kHzSamples: r3(designed),
        designedPhaseDelayPerEffect: Object.fromEntries(effects.map((e) => [e.type, r3(cleanupPhaseDelay([e], 1000))])),
        toneAgainstDesignSamples: tone.map((l) => r3(l - designed)), weakestNormalisedCorrelation: r3(weakest), cleanVoice: m.body.ops[0]?.args,
      };
      check('C4 bursts with hard onsets through the cleanup (dehum, denoise, speech enhancer), the cleaned mix against the dry mix by cross-correlation (every burst correlates at 0.9 or more): every white-noise burst lines up within 1 sample (the chain delays nothing); the carrier of every 1 kHz burst sits within 1 sample of the phase delay the chain\'s filters have at 1 kHz by design (the low cut, the presence EQ and the hum notches turn the phase of a tone; that is not a delay)',
        effects.length === 3 && CLEANUP_TYPES.every((t) => effects.some((e) => e.type === t)) && weakest >= 0.9 && broadband.length >= 10 && broadband.every((l) => Math.abs(l) <= 1) && tone.length >= 10 && tone.every((l) => Math.abs(l - designed) < 1), measurements.C4);
    });

    // ============================== C6 speed in Node ==============================
    console.log('# C6 each cleanup voice in Node');
    await section('C6', async () => {
      const pid = await newProject('voice cleanup C6');
      const assetId = await upload(pid, recFile);
      const clipIds: string[] = [];
      for (const type of CLEANUP_TYPES) { const clipId = await addClip(pid, assetId, 0); clipIds.push(clipId); await tx(pid, [{ op: 'add_audio_effect', args: { clipId, type } }]); }
      const all = await addClip(pid, assetId, 0);
      await tx(pid, restCheck ? [{ op: 'clean_voice', args: { ...restCheck.ops[0].args, clipId: all } }] : [{ op: 'clean_voice', args: { clipId: all, mainsHz: '50' } }]);
      const { doc } = await docOf(pid);
      const plan = audioPlan(doc), native = readStereo(recFile, SR), cost: { effects: string; realtime: number }[] = [];
      for (const c of plan.clips) {
        if (!c.voice) continue;
        const t = performance.now();
        const v = openClipVoice(c, SR, c.voice.sourceRate, 0, soundEnd(c) - c.at);
        const P = new Float32Array((v.input.last - v.input.first) * 2);
        fillPlayingOrder(P, v.input.first, v.input, { start: 0, data: native });
        let out = 0;
        for (let i = 0; i < P.length; i += 8192) out += v.push(P.subarray(i, Math.min(P.length, i + 8192))).length >> 1;
        out += v.finish().length >> 1;
        cost.push({ effects: c.voice.chain.map((x) => x.type).join(' + '), realtime: Math.round(out / SR / ((performance.now() - t) / 1000)) });
      }
      measurements.C6 = cost;
      check('C6 each cleanup voice (dehum, denoise, speech enhancer, and the three together as clean_voice sets them) runs at least 20 times faster than real time in Node (whole voice: time map, effect, gains), on 30 s of sound', cost.length === 4 && cost.every((x) => x.realtime >= 20), cost);
    });

    // ============================== C8 split ==============================
    console.log('# C8 split');
    await section('C8', async () => {
      const C = await recordingProject('voice cleanup C8');
      const m = await measure(C.pid, { clipId: C.clipId, strength: 0.6 });
      await tx(C.pid, m.body.ops, { expectedRevision: m.body.revision });
      const whole = (await floatMix(C.pid)).pcm;
      const atFrame = 31, H = denoiseFraming(SR).hop; // 31 frames = 49600 samples = 193.75 hops of 256
      await tx(C.pid, [{ op: 'split_clip', args: { clipId: C.clipId, at: f(atFrame) } }]);
      const { doc } = await docOf(C.pid);
      const parts = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c: any) => c.audioFx?.length);
      const cut = (await floatMix(C.pid)).pcm;
      const peak = peakOf(whole), md = maxDiff(cut, 0, whole, 0, whole.length / 2);
      measurements.C8 = { splitAtSample: atFrame * SPF, hop: H, offGrid: (atFrame * SPF) % H, parts: parts.length, maxDifference: md, relativeTo2pow17Peak: r3(md / (2 ** -17 * peak)), bitEqual: md === 0 && cut.length === whole.length };
      check('C8 splitting a cleaned clip at a sample that is not a multiple of the STFT hop (49600 = 193.75 × 256): both parts carry the cleanup and the mix stays within 2^-17 of the peak of the unsplit mix (bit equality reported)', parts.length === 2 && (atFrame * SPF) % H !== 0 && cut.length === whole.length && md <= 2 ** -17 * peak, measurements.C8);
    });

    // ============================== C9 honest states ==============================
    console.log('# C9 honest states');
    await section('C9', async () => {
      const D = await recordingProject('voice cleanup C9');
      await tx(D.pid, [{ op: 'set_clip_speed', args: { clipId: D.clipId, speed: 1.5 } }, { op: 'set_clip_pitch', args: { clipId: D.clipId, keepPitch: true } }]);
      const refused = await call(`/projects/${D.pid}/transactions`, { ops: [{ op: 'clean_voice', args: { clipId: D.clipId, strength: 0.6 } }] });
      const pic = await upload(D.pid, picture);
      const vtrack = (await tx(D.pid, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId;
      const picClip = (await tx(D.pid, [{ op: 'add_clip', args: { assetId: pic, trackId: vtrack, start: f(0), duration: f(60) } }])).results[0].output.clipId;
      const noAudio = await measure(D.pid, { clipId: picClip });
      const cat = (await call('/catalog')).body;
      const rows = (cat.audioEffects as any[]).filter((e) => (CLEANUP_TYPES as readonly string[]).includes(e.id));
      const cleanupRows = rows.map((e) => ({ id: e.id, aheadMs: e.aheadMs, latency: e.latency, limits: e.limits }));
      const latencyOk = rows.length === 3 && rows.every((e) => (e.aheadMs > 0 ? new RegExp(`reads up to ${e.aheadMs} ms ahead`).test(e.latency) : /none \(0 samples\)/.test(e.latency))) && rows.find((e) => e.id === 'cleanup.denoise')?.aheadMs === 50;
      const limitsOk = rows.every((e) => /not yet listened to by the owner/i.test(e.limits));
      measurements.C9 = { keepPitch: { status: refused.status, code: refused.body?.error?.code, message: refused.body?.error?.message, hint: refused.body?.error?.hint }, pictureOnly: { status: noAudio.status, code: noAudio.body?.error?.code }, catalogue: cleanupRows };
      check('C9 honest states: clean_voice on a sound that keeps its pitch at speed 1.5 is refused with a hint; measure_voice on a picture-only asset gives 422 no_audio; the catalogue states each cleanup effect\'s look-ahead in ms and that nobody has listened yet',
        refused.status >= 400 && refused.body?.error?.code === 'incompatible' && !!refused.body?.error?.hint && noAudio.status === 422 && noAudio.body?.error?.code === 'no_audio' && latencyOk && limitsOk, measurements.C9);
    });

    // ============================== C10 speed 2 ==============================
    console.log('# C10 speed 2');
    await section('C10', async () => {
      const E = await recordingProject('voice cleanup C10');
      await tx(E.pid, [{ op: 'set_clip_speed', args: { clipId: E.clipId, speed: 2 } }]);
      const dry = (await floatMix(E.pid)).pcm;
      const m = await measure(E.pid, { clipId: E.clipId, strength: 0.6 });
      await tx(E.pid, m.body.ops, { expectedRevision: m.body.revision });
      const wet = (await floatMix(E.pid)).pcm;
      const pauses = rec.pauses.map((p) => ({ start: p.start / 2, end: p.end / 2 })).filter((p) => p.end - p.start >= 0.3);
      const drop = [100, 200, 300, 400].map((hz) => r2(db(lineOver(dry, 0, hz, pauses, 0.03)) - db(lineOver(wet, 0, hz, pauses, 0.03))));
      measurements.C10 = { mainsHz: m.body.ops[0]?.args?.mainsHz, humLineReductionDb: drop, pausesUsed: pauses.length };
      check('C10 a clip at speed 2 (pitch follows speed): the 50 Hz hum is heard at 100, 200, 300 and 400 Hz, and clean_voice reduces each line by at least 30 dB', m.body.ops[0]?.args?.mainsHz === '50' && drop.every((d) => d >= 30), measurements.C10);
    });

    // ============================== browser: C5 preview and C7 runtimes ==============================
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const openEditor = async (pid: string): Promise<Page> => {
      const page = await browser!.newPage({ viewport: { width: 1500, height: 950 } });
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.addInitScript(() => {
        (window as any).__pfAudioTap = true;
        (window as any).__pfLongTasks = [];
        // Every buffer the player schedules, as it is handed to the audio device (kept only while a run asks for it): the samples
        // of the preview themselves, whatever the clock does afterwards.
        (window as any).__pfScheduled = null;
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, when?: number, offset?: number, duration?: number) {
          const cap = (window as any).__pfScheduled as unknown[] | null, b = this.buffer;
          if (cap && b) cap.push({ when: when ?? 0, offset: offset ?? 0, l: b.getChannelData(0).slice(), r: (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice() });
          return start.call(this, when, offset, duration);
        };
        try { new PerformanceObserver((list) => { for (const e of list.getEntries()) (window as any).__pfLongTasks.push({ start: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no long-task timing in this browser */ }
      });
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
      await page.waitForFunction(() => !!(window as any).__pfPlayer?.doc, undefined, { timeout: 30000 });
      return page;
    };
    /** Play `seconds` from `from`. With `capture`, also the mix of every buffer scheduled, on the timeline from sample 0 (interleaved stereo float, base64). */
    const playFor = (page: Page, from: number, seconds: number, bypass = false, capture = false): Promise<PreviewRun> => page.evaluate(async ({ from, seconds, bypass, capture, fps, sr }) => {
      const p = (window as any).__pfPlayer;
      p.setBypassAudioFx(bypass);
      p.seek(Math.round(from * fps));
      (window as any).__pfLongTasks.length = 0;
      (window as any).__pfScheduled = capture ? [] : null;
      const t = performance.now();
      await p.play();
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const stats = p.syncStats();
      p.pause();
      const run = { stats, longTasks: [...(window as any).__pfLongTasks], wallMs: performance.now() - t, scheduled: null as PreviewRun['scheduled'] };
      const cap = (window as any).__pfScheduled as { when: number; offset: number; l: Float32Array; r: Float32Array }[] | null;
      (window as any).__pfScheduled = null;
      if (cap) {
        // timeline sample n plays at device frame K + n; the picture clock's origin is device frame K + (the sample of `from`)
        const originClock = p.origin?.clock;
        if (typeof originClock !== 'number') throw new Error('the player no longer exposes its clock origin (origin.clock)');
        const K = Math.round(originClock * sr) - Math.round(from * sr), frames = Math.round((from + seconds) * sr), mix = new Float32Array(frames * 2);
        let offGrid = 0;
        for (const c of cap) {
          const at = c.when * sr, skip = Math.round(c.offset * sr); // a late buffer starts `offset` seconds in: what it skips is not heard
          if (Math.abs(at - Math.round(at)) > 1e-3 || Math.abs(c.offset * sr - skip) > 1e-3) offGrid++;
          for (let i = skip, n = Math.round(at) - K; i < c.l.length; i++, n++) if (n >= 0 && n < frames) { mix[n * 2] = mix[n * 2]! + c.l[i]!; mix[n * 2 + 1] = mix[n * 2 + 1]! + c.r[i]!; }
        }
        const u8 = new Uint8Array(mix.buffer);
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        run.scheduled = { buffers: cap.length, offGrid, frames, base64: btoa(bin) };
      }
      return run;
    }, { from, seconds, bypass, capture, fps: FPS, sr: SR });
    const effectsRan = (run: PreviewRun, voices: number) => run.stats.clock === 'audio' && run.stats.fxVoices === voices && Object.keys(run.stats.unavailableAudioFx ?? {}).length === 0;

    console.log('# C5 preview = export');
    await section('C5', async () => {
      const pid = await newProject('voice cleanup C5');
      const assetId = await upload(pid, recFile);
      const ids: string[] = [];
      for (const at of [0, 0.5, 1, 1.5]) { const clipId = await addClip(pid, assetId, Math.round(at * FPS), 20 * FPS); ids.push(clipId); await tx(pid, [{ op: 'set_clip_gain', args: { clipId, gain: 0.3 } }]); }
      const m = await measure(pid, { clipId: ids[0], strength: 0.6, scope: 'asset' });
      await tx(pid, m.body.ops, { expectedRevision: m.body.revision });
      const exp = await exportJob(pid, 'c5-export.wav'), serverMix = (await floatMix(pid)).pcm;
      const load = () => os.loadavg().map(r2);
      const loadBefore = load();
      const page = await openEditor(pid);
      const run = await playFor(page, 0, 12.3, false, true);
      const prime = await playFor(page, 10, 2);
      const withFx = await playFor(page, 0, 15);
      const baseline = await playFor(page, 0, 15, true);
      await page.close();
      // (a) the samples: every buffer the preview scheduled, summed on the timeline, against the export (16 bit) and the server's float mix
      const upTo = 12 * SR;
      let scheduled: Record<string, unknown> = { captured: false }, samplesOk = false;
      if (run.scheduled) {
        const buf = Buffer.from(run.scheduled.base64, 'base64'), prev = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        const dExport = maxDiff(prev, 0, exp, 0, upTo), dFloat = maxDiff(prev, 0, serverMix, 0, upTo);
        samplesOk = prev.length >= upTo * 2 && run.scheduled.buffers >= 4 && run.scheduled.offGrid === 0 && dExport <= LSB;
        scheduled = { captured: true, buffers: run.scheduled.buffers, notOnTheSampleGrid: run.scheduled.offGrid, comparedSeconds: upTo / SR, maxDifferenceFromExportIn16BitSteps: r3(dExport / LSB), maxDifferenceFromServerFloatMix: dFloat, peak: r3(peakOf(serverMix.subarray(0, upTo * 2))) };
      }
      // (b) what is heard: the tap's 50 ms windows (left channel, timeline seconds exact to the sample) against the same windows of the export
      const windows = (run.stats.audioLevels ?? []).filter((l: { t: number; peak: number }) => l.t >= 0.2 && l.t <= 12 && peakLeftOver(exp, l.t, l.t + 0.05) > 10 ** (-40 / 20)).map((l: { t: number; peak: number }) => ({ t: l.t, previewDb: r2(db(l.peak)), exportDb: r2(db(peakLeftOver(exp, l.t, l.t + 0.05))) }));
      const worst = windows.reduce((mx: number, x: { previewDb: number; exportDb: number }) => Math.max(mx, Math.abs(x.previewDb - x.exportDb)), 0);
      const worstWindow = windows.find((x: { previewDb: number; exportDb: number }) => Math.abs(x.previewDb - x.exportDb) === worst) ?? null;
      const firstWindow = (run.stats.audioLevels ?? [])[0]?.t;
      const total = (r: PreviewRun) => Math.round(r.longTasks.reduce((a, x) => a + x.ms, 0));
      const conditions: Record<string, boolean> = {
        'four ops applied': m.body.ops.length === 4,
        'the compared run played four voices on the audio clock': effectsRan(run, 4),
        'the compared run scheduled nothing late': run.stats.fxLateStarts === 0 && run.stats.fxLateSkips === 0,
        'the scheduled samples are the export within one 16-bit step': samplesOk,
        'at least 100 windows above -40 dBFS': windows.length >= 100,
        'every window within 0.5 dB': worst <= 0.5,
        'from 10 s: four voices, primed within 500 ms, no late start': effectsRan(prime, 4) && prime.stats.fxPrimeTimedOut === false && prime.stats.fxPrimeMs <= 500 && prime.stats.fxLateStarts === 0,
        'the 15 s run with effects started nothing late': withFx.stats.fxLateStarts === 0,
        'the bypassed run played no effect voice': baseline.stats.fxVoices === 0,
        'long tasks at most twice the bypassed run (100 ms allowed over a near-zero baseline)': total(withFx) <= Math.max(2 * total(baseline), total(baseline) + 100),
      };
      const failing = Object.entries(conditions).filter(([, ok]) => !ok).map(([name]) => name);
      measurements.C5 = { failing, opsApplied: m.body.ops.length, machineLoad: { cores: os.cpus().length, loadAverageBefore: loadBefore, loadAverageAfter: load() }, comparedRun: { fxVoices: run.stats.fxVoices, fxPrimeMs: run.stats.fxPrimeMs, fxLateStarts: run.stats.fxLateStarts, fxLateSkips: run.stats.fxLateSkips, firstWindowAtSeconds: firstWindow }, scheduledSamples: scheduled, windows: windows.length, worstWindowDb: r2(worst), worstWindow, sample: windows.filter((_: unknown, i: number) => i % 20 === 0), prime: { fxPrimeMs: prime.stats.fxPrimeMs, fxPrimeTimedOut: prime.stats.fxPrimeTimedOut, fxLateStarts: prime.stats.fxLateStarts }, cost: { withEffects: { fxVoices: withFx.stats.fxVoices, fxLateStarts: withFx.stats.fxLateStarts, fxLateSkips: withFx.stats.fxLateSkips, longTaskMs: total(withFx), longTasks: withFx.longTasks.length }, bypassed: { fxVoices: baseline.stats.fxVoices, longTaskMs: total(baseline), longTasks: baseline.longTasks.length } } };
      check('C5 four clips cleaned in one transaction (scope asset), played in the editor preview with nothing scheduled late: the samples the preview schedules are the export within one 16-bit step; every 50 ms window above -40 dBFS, as heard at the output (left channel), within 0.5 dB of the export; starting 10 s in, the voices are primed within 500 ms with no late start; main-thread long tasks at most twice the bypassed playback (100 ms allowed over a near-zero baseline)',
        failing.length === 0, measurements.C5);
    });

    console.log('# C7 kernels in Chromium against Node');
    await section('C7', async () => {
      const st = await browser!.newPage();
      st.on('pageerror', (e) => pageErrors.push(String(e)));
      await st.goto(`${s.url}/selftest.html`);
      await st.waitForFunction(() => document.body.dataset.ready === '1' && typeof (window as any).__pfFxRun === 'function', undefined, { timeout: 60000 });
      const input = fxFixture(SR), runtimes: { type: string; params: string; maxAbsDiff: number; bitEqual: boolean; chromiumMs: number }[] = [];
      for (const type of CLEANUP_TYPES) for (const params of [{}, VARIANTS[type] ?? {}]) {
        const r: { base64: string; ms: number } = await st.evaluate(([t, p]) => (window as any).__pfFxRun(t, p), [type, params] as const);
        const buf = Buffer.from(r.base64, 'base64'), chrome = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        const node = renderFx(type, audioEffectParams(type, params), input, { sampleRate: SR });
        let diff = chrome.length === node.length ? 0 : Infinity;
        if (diff === 0) for (let i = 0; i < node.length; i++) diff = Math.max(diff, Math.abs(chrome[i]! - node[i]!));
        runtimes.push({ type, params: JSON.stringify(params).slice(0, 80), maxAbsDiff: diff, bitEqual: diff === 0 && Buffer.from(node.buffer, node.byteOffset, node.byteLength).equals(buf), chromiumMs: r.ms });
      }
      await st.close();
      measurements.C7 = runtimes;
      check('C7 each cleanup kernel (defaults and the golden-hash variant) gives the same output in Chromium as in Node within 1e-6 on the fixed 3 s fixture (bit equality reported, not promised)', runtimes.length === 6 && runtimes.every((x) => x.maxAbsDiff <= 1e-6), { bitEqual: runtimes.filter((x) => x.bitEqual).length, of: runtimes.length, worst: runtimes.reduce((m, x) => Math.max(m, x.maxAbsDiff), 0) });
    });
    check('no page errors in the preview or self-test pages', pageErrors.length === 0, pageErrors.slice(0, 5));
  } catch (e) {
    console.error(e);
    check('run completed', false, String((e as Error)?.stack ?? e).slice(0, 800));
  } finally {
    await browser?.close().catch(() => {});
    await mcpClient.close().catch(() => {});
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, gpu: 'none' },
      scope: 'One deterministic synthetic recording (speech-like formant pulses at -20 dBFS RMS with 30 % pauses, noise of a known 24-band spectrum at -48 dBFS, 50 Hz hum k = 1..4 at -40 dBFS in total), 1 kHz bursts for sync, 48 kHz projects, the server mix and export, the editor preview and the self-test page in headless Chromium. No real speech, no recorded room, nobody has listened: this shows the cleanup measures, cleans, stays in sync and sounds the same on every route, not that it sounds good.',
      passed: checks.length - failed.length, total: checks.length, checks, measurements,
    };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/voiceclean-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nVoice cleanup proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
