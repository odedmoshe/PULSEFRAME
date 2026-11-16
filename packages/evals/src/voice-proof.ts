/**
 * Local narration (text to speech), end to end through the product: setup state, owner-approved verified model download,
 * narration jobs in Hebrew with the built-in voice, the result as a normal audio asset with its recipe, placement, the rules
 * around a reference voice (owner only, consent recorded), cancel, and a machine round trip (the generated speech is recognised
 * again by the local recogniser and compared with the text).
 *
 *   PF_VOICE_PYTHON=.artifacts/speech/tts-venv/bin/python PF_SPEECH_PYTHON=.artifacts/speech/venv/bin/python [NODE_USE_ENV_PROXY=1] pnpm proof:voice
 * Exits 2 (blocked) without the voice engine. First run downloads about 3.2 GB.
 *
 * What this is NOT: a judgement of how the Hebrew sounds. Nobody listened. The round trip only says that another model can
 * recover most of the words; it says nothing about pronunciation, stress, naturalness or likeness to a reference voice.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/voice-proof');
const MODELS = path.join(root, '.artifacts/speech/models');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const norm = (s: string) => s.normalize('NFKC').replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().split(/\s+/).filter(Boolean);
const SENTENCES = ['שלום, ברוכים הבאים לסרטון החדש שלנו.', 'היום נלמד איך לערוך וידאו בקלות ובמהירות.', 'תודה שצפיתם, נתראה בפעם הבאה.'];

async function main() {
  const voicePy = process.env.PF_VOICE_PYTHON ? path.resolve(process.env.PF_VOICE_PYTHON) : null;
  const speechPy = process.env.PF_SPEECH_PYTHON ? path.resolve(process.env.PF_SPEECH_PYTHON) : null;
  if (!voicePy || !fs.existsSync(voicePy)) { console.error('BLOCKED: PF_VOICE_PYTHON does not name a Python interpreter with the voice engine'); process.exit(2); }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });

  {
    const s = await startServer({ port: 8845, dataDir: path.join(art, 'data-off'), speechPython: null, voicePython: null });
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close', 'content-type': 'application/json' };
    try {
      const st = (await (await fetch(`${s.url}/api/v1/speech`, { headers: h })).json()) as any;
      const pid = ((await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'off' }) })).json()) as any).project.id;
      const r = await fetch(`${s.url}/api/v1/projects/${pid}/narration`, { method: 'POST', headers: h, body: JSON.stringify({ text: SENTENCES[0] }) });
      const b = (await r.json()) as any;
      check('Not configured: status says so, and narration is refused with the reason (no job, no sound)', st.narration.ready === false && st.narration.reason === 'engine_not_configured' && r.status === 409 && b.error.code === 'voice_not_ready', { detail: st.narration.detail, status: r.status });
    } finally { await s.close(); }
  }

  const s = await startServer({ port: 8846, dataDir: path.join(art, 'data'), speechPython: speechPy, voicePython: voicePy, speechModelsDir: MODELS });
  const origin = s.url;
  const agent = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner = { cookie, origin, connection: 'close' };
  const call = async (p: string, body?: unknown, headers: Record<string, string> = agent) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const waitJob = async (jobId: string, maxMs = 60 * 60_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > maxMs) throw new Error(`job ${jobId} still ${j.status}`); await sleep(500); } };
  const takes: unknown[] = [];
  let download: unknown = null;
  try {
    const pid = (await call('/projects', { name: 'voice proof' })).body.project.id as string;
    let st = (await call('/speech')).body;
    check('Voice engine answers a probe and is reported with its version', st.voiceEngine.ok === true && /chatterbox/.test(st.voiceEngine.engine), { engine: st.voiceEngine.engine, version: st.voiceEngine.version });
    const model = st.models.find((m: any) => m.kind === 'tts');
    check('The reviewed voice model is listed with licence, exact size and per-file state', model.license === 'MIT' && model.totalBytes === 3514875743 && model.files.length === 6, { id: model.id, totalBytes: model.totalBytes, missing: model.missingDownloadBytes });
    if (!model.ready) {
      const a = await call(`/projects/${pid}/speech/models/${model.id}/download`, { confirmBytes: model.missingDownloadBytes }, agent);
      check('Download: an agent credential is refused', a.status === 403 && a.body.error.code === 'human_approval_required', { status: a.status });
      const d = await call(`/projects/${pid}/speech/models/${model.id}/download`, { confirmBytes: model.missingDownloadBytes }, owner);
      const job = await waitJob(d.body.jobId);
      st = (await call('/speech')).body;
      check('Download: the owner\'s approval of the exact size downloads and verifies every file', job.status === 'succeeded' && st.models.find((m: any) => m.kind === 'tts').ready === true, { status: job.status, error: job.error, wallSeconds: job.output?.wallSeconds, bytes: model.missingDownloadBytes });
      download = { bytes: model.missingDownloadBytes, wallSeconds: job.output?.wallSeconds, note: 'network-dependent, single sample' };
    } else {
      check('Model files were already present; size and SHA-256 of each were verified again', model.files.every((f: any) => f.state === 'ready'), { files: model.files.length });
      download = { note: 'files were already present from an earlier run; verified by size and SHA-256' };
    }
    check('Ready state names the device and says what has not been qualified', st.narration.ready === true && /nobody has listened/.test(st.narration.qualification), { device: st.narration.device });

    // ---------- built-in voice ----------
    const made: { assetId: string; text: string; seconds: number; hash: string }[] = [];
    let cursor = T.ZERO;
    for (const [i, text] of SENTENCES.entries()) {
      const r = await call(`/projects/${pid}/narration`, { text, language: 'he', seed: 100 + i, start: cursor });
      const job = await waitJob(r.body.jobId);
      if (job.status !== 'succeeded') { takes.push({ text, status: job.status, error: job.error }); continue; }
      const doc = (await call(`/projects/${pid}`)).body.project;
      const asset = doc.assets[job.output.assetId];
      made.push({ assetId: asset.id, text, seconds: job.output.seconds, hash: asset.contentHash });
      takes.push({ text, seconds: job.output.seconds, wallSeconds: Number(job.output.run.wallSeconds.toFixed(1)), placed: !!job.output.placed, provenance: asset.provenance.voice });
      const tl = (await call(`/projects/${pid}/timeline`)).body;
      const clip = tl.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === job.output.placed?.clipId);
      if (clip) cursor = T.add(clip.start, clip.duration);
      console.log(`       take ${i + 1}: ${job.output.seconds} s of speech in ${job.output.run.wallSeconds.toFixed(1)} s`);
    }
    check('Three Hebrew sentences were spoken by jobs and became audio assets', made.length === SENTENCES.length, { seconds: made.map((m) => m.seconds) });
    const doc1 = (await call(`/projects/${pid}`)).body.project;
    check('Each asset is ordinary 48 kHz audio of a plausible length (0.05–0.3 s per character)', made.every((m) => doc1.assets[m.assetId].audio?.sampleRate === 48000 && m.seconds / m.text.length > 0.05 && m.seconds / m.text.length < 0.3), made.map((m) => ({ chars: m.text.length, seconds: m.seconds })));
    check('Each asset records its recipe: engine, model revisions, language, the text and the pointed text that was spoken, the seed, built-in voice, watermark', made.every((m) => { const v = doc1.assets[m.assetId].provenance.voice; return doc1.assets[m.assetId].provenance.origin === 'generated' && /chatterbox/.test(v.engine) && /ResembleAI/.test(v.model) && v.language === 'he' && v.text === m.text && /[\u05b0-\u05bc]/.test(v.spokenText ?? '') && v.voice === 'built-in' && !v.consent && /PerTh/.test(v.watermark); }));
    const tl1 = (await call(`/projects/${pid}/timeline`)).body;
    const clips = tl1.tracks.flatMap((t: any) => t.clips).filter((c: any) => made.some((m) => m.assetId === c.assetId));
    check('The three takes sit on the timeline one after another', clips.length === 3 && clips.every((c: any, i: number) => i === 0 || T.eq(c.start, T.add(clips[i - 1].start, clips[i - 1].duration))), clips.map((c: any) => T.toSeconds(c.start)));

    // ---------- machine round trip ----------
    if (st.transcription.ready) {
      let found = 0, total = 0;
      const heard: unknown[] = [];
      for (const m of made) {
        const j = await waitJob((await call(`/projects/${pid}/assets/${m.assetId}/transcribe`, { language: 'he' })).body.jobId);
        const tr = j.output?.attached ? (await call(`/projects/${pid}`)).body.project.transcripts[m.assetId] : null;
        const hyp = norm(tr ? tr.segments.map((x: any) => x.text).join(' ') : ''), ref = norm(m.text);
        const pool = [...hyp];
        for (const w of ref) { total++; const k = pool.indexOf(w); if (k >= 0) { pool.splice(k, 1); found++; } }
        heard.push({ said: m.text, recognised: hyp.join(' ') });
      }
      check('Round trip: the local recogniser recovers at least 60% of the words from the generated speech', found / total >= 0.6, { wordsRecovered: found, words: total, heard, note: 'machine check only; says nothing about how it sounds to a person' });
    } else console.log('       (round trip skipped: speech recognition is not set up)');

    // ---------- same seed ----------
    const again = await waitJob((await call(`/projects/${pid}/narration`, { text: SENTENCES[2], language: 'he', seed: 102 })).body.jobId);
    const same = again.status === 'succeeded' && (await call(`/projects/${pid}`)).body.project.assets[again.output.assetId]?.contentHash === made[2]?.hash;
    check('The same text, voice and seed give the same audio again on this machine (the existing asset is reused)', same, { assetId: again.output?.assetId, first: made[2]?.assetId });
    const other = await waitJob((await call(`/projects/${pid}/narration`, { text: SENTENCES[2], language: 'he', seed: 7 })).body.jobId);
    check('Another seed gives another take, kept as its own asset', other.status === 'succeeded' && other.output.assetId !== made[2]?.assetId, { seconds: other.output?.seconds });

    // ---------- a reference voice ----------
    // The reference here is a take of the built-in voice joined to itself: a synthetic voice, so no person's consent is at stake in this proof.
    const refFile = path.join(art, 'reference.wav');
    const blob = (await call(`/projects/${pid}/assets/${made[1]!.assetId}/content`)).body as Buffer;
    fs.writeFileSync(path.join(art, 'take.wav'), blob);
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-stream_loop', '2', '-i', path.join(art, 'take.wav'), '-c:a', 'pcm_s16le', '-y', refFile]);
    const up = (await (await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...agent, 'x-filename': 'reference.wav' }, body: fs.readFileSync(refFile) })).json()) as any;
    const refId = up.assetId as string;
    const byAgent = await call(`/projects/${pid}/narration`, { text: SENTENCES[0], referenceAssetId: refId, consent: { speaker: 'synthetic test voice', confirmed: true } }, agent);
    check('Reference voice: an agent credential is refused, even with a consent object', byAgent.status === 403 && byAgent.body.error.code === 'human_approval_required', { status: byAgent.status });
    const noConsent = await call(`/projects/${pid}/narration`, { text: SENTENCES[0], referenceAssetId: refId }, owner);
    check('Reference voice: the owner without a consent statement is refused', noConsent.status === 422 && noConsent.body.error.code === 'consent_required', { status: noConsent.status });
    const short = await call(`/projects/${pid}/narration`, { text: SENTENCES[0], referenceAssetId: made[2]!.assetId, consent: { speaker: 'synthetic test voice', confirmed: true } }, owner);
    check('Reference voice: a recording under 5 seconds is refused', short.status === 422 && short.body.error.code === 'reference_too_short', { status: short.status, seconds: made[2]!.seconds });
    const cl = await waitJob((await call(`/projects/${pid}/narration`, { text: SENTENCES[0], referenceAssetId: refId, seed: 5, consent: { speaker: 'synthetic test voice', confirmed: true } }, owner)).body.jobId);
    const cv = cl.status === 'succeeded' ? (await call(`/projects/${pid}`)).body.project.assets[cl.output.assetId].provenance.voice : null;
    check('Reference voice: with the owner\'s statement the job runs, and the asset records the reference, the speaker, the statement, who made it and when', cl.status === 'succeeded' && cv.voice === 'reference' && cv.referenceAssetId === refId && cv.consent.speaker === 'synthetic test voice' && cv.consent.attestedBy === 'user:local' && /agreed/.test(cv.consent.statement) && !!cv.consent.attestedAt, { status: cl.status, error: cl.error, seconds: cl.output?.seconds });

    // ---------- cancel ----------
    const assetsBefore = Object.keys((await call(`/projects/${pid}`)).body.project.assets).length;
    const cj = (await call(`/projects/${pid}/narration`, { text: SENTENCES[1], seed: 9 })).body.jobId;
    for (let i = 0; i < 400; i++) { if ((await call(`/jobs/${cj}`)).body.status === 'running') break; await sleep(100); }
    await sleep(3000);
    const c = await call(`/jobs/${cj}/cancel`, {});
    const done = await waitJob(cj, 60_000);
    check('Cancel stops a running narration and adds nothing to the library', c.status === 200 && done.status === 'canceled' && Object.keys((await call(`/projects/${pid}`)).body.project.assets).length === assetsBefore, { status: done.status });

    // ---------- export with narration ----------
    const ej = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
    if (ej.status === 'succeeded') {
      const out = path.join(art, 'narration.mp4');
      fs.writeFileSync(out, (await call(`/jobs/${ej.id}/output`)).body);
      const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', out, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
      const x = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
      let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
      check('The timeline with the narration exports with audible sound of the expected length', peak > 1000 && Math.abs(x.length / 8000 - T.toSeconds(cursor)) < 0.2, { seconds: Number((x.length / 8000).toFixed(2)), expected: Number(T.toSeconds(cursor).toFixed(2)) });
    } else check('The timeline with the narration exports', false, { status: ej.status, error: ej.error });
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, gpu: 'none' },
      scope: 'Functional evidence only: three short Hebrew sentences with the built-in voice and one take with a synthetic reference voice, on one CPU machine, one run. Nobody listened to any of it. No claim about pronunciation, naturalness, likeness to a reference, other languages or speed.',
      download, takes, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/voice-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nVoice proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
