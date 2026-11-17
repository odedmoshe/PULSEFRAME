/**
 * pnpm proof:ai-local: the local tools of the AI-model wave (ADR-0017, route R3), end to end through the product's REST surface on this
 * machine's CPU: setup states, the owner-approval download path for the OPUS-MT weights, caption translation in both directions,
 * AI voice cleanup with the operator-installed deep-filter, and classic vocal removal.
 *
 *   PF_TOOLS_PYTHON=.artifacts/comfyui/.venv/bin/python PF_DENOISE_BIN=.artifacts/tools/bin/deep-filter \
 *   [PF_TOOLS_MODELS_DIR=.artifacts/tools/models] [NODE_USE_ENV_PROXY=1] pnpm proof:ai-local
 *
 * PF_TOOLS_MODELS_DIR defaults to .artifacts/tools/models (where the lead placed the DeepFilterNet3 model and the small OPUS-MT files),
 * so the two OPUS-MT weight files (476 MB + 314 MB) are fetched once, through request → owner approval → verified download; a later
 * run finds them present and verifies them again. PF_MODEL_HOSTS (default: huggingface.co, .hf.co and the GitHub publisher hosts) must
 * allow the Hugging Face hosts.
 * Exits 0 when every check passes, 1 when one fails, 2 (blocked) when an engine, the narration sample or a model source is unavailable.
 * Writes docs/evidence/ai-local-cpu.json: timings, peak RSS and digests, for this CPU-only machine. No quality claim is made: nobody
 * has read the Hebrew output or listened to the cleaned voice; the translations are stored there for the owner to read.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_TOOLS, type LocalToolDescriptor } from '@pulseframe/providers';
import { startServer } from '@pulseframe/server';
import { estimateLag, LocalTools, readWavFrames, readWavInfo, SAMPLE_RATE } from '@pulseframe/server/localtools.ts';
import * as T from '@pulseframe/time';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/ai-local-proof');
const evidenceFile = path.join(root, 'docs/evidence/ai-local-cpu.json');
const SAMPLE = path.join(root, 'docs/demo/narration-sample-he.m4a');
const SMALL_SOURCE = path.join(root, '.artifacts/tools/models/opus-small');
const PORT = 8857;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const tool = (id: string): LocalToolDescriptor => LOCAL_TOOLS.find((d) => d.id === id)!;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
function blocked(why: string): never { console.error(`BLOCKED: ${why}`); process.exit(2); }

// ---------------------------------------------------------------- sound helpers (proof-side measurements)
function decodeMono(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
function pinkNoise(seconds: number): Float32Array {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `anoisesrc=color=pink:sample_rate=${SAMPLE_RATE}:amplitude=0.5:seed=7:duration=${seconds}`, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
function writeWav16(file: string, channels: Float32Array[]) {
  const n = channels[0]!.length, ch = channels.length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVE', 8, 'latin1'); b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(SAMPLE_RATE, 24); b.writeUInt32LE(SAMPLE_RATE * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(channels[c]![i]! * 32767))), 44 + (i * ch + c) * 2);
  fs.writeFileSync(file, b);
}
const readAll = (file: string) => { const info = readWavInfo(file); return readWavFrames(file, info, 0, info.frames); };
const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i]! * x[i]!; return Math.sqrt(s / Math.max(1, b - a)); };
const dB = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round = (x: number, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x > 0 ? 'inf' : '-inf');
/** Scale-invariant signal-to-distortion ratio of `est` against `ref` over [a, b). */
function siSdr(est: Float32Array, ref: Float32Array, a: number, b: number) {
  let er = 0, rr = 0;
  for (let i = a; i < b; i++) { er += est[i]! * ref[i]!; rr += ref[i]! * ref[i]!; }
  const k = er / rr;
  let t = 0, e = 0;
  for (let i = a; i < b; i++) { const s = k * ref[i]!; t += s * s; e += (est[i]! - s) ** 2; }
  return 10 * Math.log10(t / e);
}
/** Amplitude of the `freq` component over [a, b) (Goertzel). */
function tone(x: Float32Array, freq: number, a: number, b: number) {
  const w = (2 * Math.PI * freq) / SAMPLE_RATE, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = a; i < b; i++) { const s0 = x[i]! + c * s1 - s2; s2 = s1; s1 = s0; }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))) / (b - a);
}

// ---------------------------------------------------------------- peak RSS of the engine processes (sampled from /proc)
const peakRssKb: Record<string, number> = {};
let sampling: NodeJS.Timeout | null = null;
function startRssSampler(denoiseBin: string) {
  if (!fs.existsSync('/proc')) return;
  sampling = setInterval(() => {
    for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const kind = cmd.includes('pf_tools.py') ? 'toolsWorker' : cmd.includes(denoiseBin) || cmd.startsWith(denoiseBin) ? 'deepFilter' : cmd.startsWith('ffmpeg') ? 'ffmpeg' : null;
        if (!kind) continue;
        const kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0);
        peakRssKb[kind] = Math.max(peakRssKb[kind] ?? 0, kb);
      } catch { /* the process ended between listing and reading */ }
    }
  }, 100);
  sampling.unref();
}

async function main() {
  const python = process.env.PF_TOOLS_PYTHON ? path.resolve(root, process.env.PF_TOOLS_PYTHON) : null;
  const denoiseBin = process.env.PF_DENOISE_BIN ? path.resolve(root, process.env.PF_DENOISE_BIN) : null;
  const modelsDir = path.resolve(root, process.env.PF_TOOLS_MODELS_DIR ?? '.artifacts/tools/models');
  if (!python || !fs.existsSync(python)) blocked('PF_TOOLS_PYTHON does not name a Python interpreter with torch, transformers and sentencepiece');
  if (!denoiseBin || !fs.existsSync(denoiseBin)) blocked('PF_DENOISE_BIN does not name the installed deep-filter 0.5.6 binary');
  if (!fs.existsSync(SAMPLE)) blocked(`the narration sample ${path.relative(root, SAMPLE)} is missing`);
  try { execFileSync('ffmpeg', ['-hide_banner', '-version']); } catch { blocked('ffmpeg is not installed'); }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });

  // The small OPUS-MT files (tokenizers, vocabulary, configs) placed by the lead are copied into the descriptors' layout when they are
  // the pinned bytes; anything absent is fetched by the download path below together with the weights.
  const seeded: string[] = [];
  for (const [d, dir] of [[tool('local.text.translate-he-en'), 'he-en'], [tool('local.text.translate-en-he'), 'en-he']] as const) {
    for (const m of d.models.slice(1)) {
      const target = path.join(modelsDir, m.path), from = path.join(SMALL_SOURCE, dir, path.basename(m.path));
      if (fs.existsSync(target) || !fs.existsSync(from)) continue;
      const bytes = fs.readFileSync(from);
      if (bytes.length !== m.bytes || sha(bytes) !== m.sha256) { console.log(`  note  ${from} is not the pinned file; the download path fetches it`); continue; }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(from, target);
      seeded.push(m.path);
    }
  }

  startRssSampler(denoiseBin!);
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), toolsPython: python, denoiseBin, toolsModelsDir: modelsDir });
  const origin = s.url;
  const agent = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner = { cookie, origin, connection: 'close' };
  const call = async (p: string, body?: unknown, headers: Record<string, string> = agent) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body: json, text };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction refused: ${r.text.slice(0, 300)}`); return r.body; };
  const upload = async (pid: string, file: string) => { const r = await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...agent, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) }); const b = (await r.json()) as any; if (!b.assetId) throw new Error(`upload refused: ${JSON.stringify(b).slice(0, 300)}`); return b.assetId as string; };
  const waitJob = async (jobId: string, maxMs = 60 * 60_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > maxMs) throw new Error(`job ${jobId} still ${j.status} after ${maxMs} ms`); await sleep(500); } };
  const run = async (pid: string, d: LocalToolDescriptor, body: Record<string, unknown>) => {
    const r = await call(`/projects/${pid}/capabilities/${d.id}/runs`, { params: {}, ...body });
    if (r.status !== 202) throw new Error(`run of ${d.id} refused (${r.status}): ${r.text.slice(0, 400)} — is the local-tools runner wired into the server (index.ts) and does POST …/runs accept source/apply?`);
    return waitJob(r.body.jobId);
  };
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project;
  // Read-only setup reads with the product's own runner code and the server's configuration (no job is created by these).
  const reader = new LocalTools(s.store, s.cfg);
  const evidence: Record<string, unknown> = {};
  try {
    const pid0 = (await call('/projects', { name: 'ai local proof: setup' })).body.project.id as string;

    // ---------- 1. engines and setup states ----------
    const setups: Record<string, unknown> = {};
    for (const d of LOCAL_TOOLS) setups[d.id] = await reader.setup(d);
    const voiceSetup = setups['local.voice.clean'] as { code: string; detail: string; versions?: Record<string, string> };
    if (voiceSetup.code === 'engine_unverified' || voiceSetup.code === 'engine_not_working') blocked(`the voice engine is not usable: ${voiceSetup.detail}`);
    const trSetup = setups['local.text.translate-he-en'] as { code: string; detail: string };
    if (['engine_not_working', 'engine_not_configured'].includes(trSetup.code)) blocked(`the tools environment is not usable: ${trSetup.detail}`);
    check('Setup: deep-filter is the reviewed build (SHA-256) and the voice model is present and verified', voiceSetup.code === 'ready', voiceSetup);
    check('Setup: vocals-classic needs only ffmpeg', (setups['local.audio.vocals-classic'] as { code: string }).code === 'ready', setups['local.audio.vocals-classic']);
    evidence.setup = setups;

    // ---------- 2. OPUS-MT weights through request → owner approval → verified download ----------
    const downloads: Record<string, unknown> = {};
    for (const id of ['local.text.translate-he-en', 'local.text.translate-en-he']) {
      const d = tool(id);
      const before = await reader.setup(d);
      if (before.code === 'host_not_allowed') blocked(`model hosts not allowed: ${before.hosts?.join(', ')} (set PF_MODEL_HOSTS)`);
      if (before.code === 'disk_insufficient') blocked(`not enough disk for the download: ${before.detail}`);
      if (before.code === 'ready') {
        downloads[id] = { note: 'files were already present from an earlier run; size and SHA-256 of each were verified again', bytes: d.resources.downloadBytes };
        check(`${id}: model files already present and verified`, true);
        continue;
      }
      const agentTry = await call(`/projects/${pid0}/capabilities/${id}/models/download`, { confirmBytes: before.missingBytes }, agent);
      check(`${id}: an agent cannot start the download itself`, agentTry.status === 403, { status: agentTry.status, code: agentTry.body?.error?.code });
      const req = await call(`/projects/${pid0}/capabilities/${id}/models/request`, {}, agent);
      if (req.status !== 201) throw new Error(`download request refused (${req.status}): ${req.text.slice(0, 300)} — does GET /capabilities list the local tools?`);
      const t0 = Date.now();
      const ok = await call(`/projects/${pid0}/approvals/${req.body.approval.id}/approve`, {}, owner);
      if (!ok.body?.jobId) throw new Error(`approval did not start a download (${ok.status}): ${ok.text.slice(0, 300)}`);
      const job = await waitJob(ok.body.jobId, 3 * 3600_000);
      if (job.status !== 'succeeded' && ['model_host_not_allowed', 'model_download_failed'].includes(job.error?.code)) blocked(`the download could not reach the publisher: ${job.error.message}`);
      const after = await reader.setup(d);
      check(`${id}: the owner's approval downloads exactly the missing bytes, verifies them and the tool reads ready`, job.status === 'succeeded' && after.code === 'ready', { status: job.status, error: job.error, bytes: before.missingBytes, setup: after.code });
      downloads[id] = { bytes: before.missingBytes, wallSeconds: (Date.now() - t0) / 1000, note: 'network-dependent, single sample' };
    }
    evidence.downloads = { seededSmallFiles: seeded, ...downloads };

    // ---------- 3. translation, both directions ----------
    const HE = ['שלום וברוכים הבאים לסרטון שלנו.', 'היום נלמד איך לערוך וידאו בקלות.', 'קודם כול נפתח פרויקט חדש.', 'אחר כך נוסיף את הקטעים לציר הזמן.', 'אפשר לחתוך כל קטע בדיוק במקום הנכון.', 'נוסיף מוזיקה ברקע ונכוון את העוצמה.', 'הכתוביות נוצרות מתוך התמלול.', 'בסוף נייצא את הסרטון בגודל המתאים.', 'תודה רבה שצפיתם.', 'נתראה בפרק הבא.'];
    const EN = ['Welcome to our video.', 'Today we will learn how to edit a video.', 'First, we open a new project.', 'Then we add the clips to the timeline.', 'You can trim every clip at exactly the right frame.', 'We add background music and set its volume.', 'The captions are made from the transcript.', 'At the end we export the video in the right size.', 'Thank you for watching.', 'See you in the next episode.'];
    const toneFile = path.join(art, 'tone30.wav');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `sine=f=220:d=30:r=${SAMPLE_RATE}`, '-c:a', 'pcm_s16le', '-y', toneFile]);
    const translations: Record<string, unknown> = {};
    for (const [id, lang, texts, to] of [['local.text.translate-he-en', 'he', HE, 'en'], ['local.text.translate-en-he', 'en', EN, 'he']] as const) {
      const d = tool(id);
      const pid = (await call('/projects', { name: `ai local proof: ${id}` })).body.project.id as string;
      const assetId = await upload(pid, toneFile);
      await tx(pid, [{ op: 'add_clip', args: { assetId, start: T.ZERO, trackId: 'trk_audio' } }]);
      const set = await tx(pid, [{ op: 'set_transcript', args: { assetId, language: lang, segments: texts.map((text, i) => ({ start: T.rt(i * 2500, 1000), duration: T.rt(2000, 1000), text })) } }]);
      const segmentIds = set.results[0].output.segmentIds as string[];
      await tx(pid, [{ op: 'add_caption_track', args: { mode: 'transcript', linkedTrackId: 'trk_audio' } }]);
      const job = await run(pid, d, { source: { assetId } });
      const p = await doc(pid);
      const v = job.output?.attachment?.variantId ? p.variants[job.output.attachment.variantId] : null;
      const ids = v ? Object.keys(v.phraseText ?? {}) : [];
      check(`${id}: a typed ${texts.length}-phrase ${lang} transcript becomes a ${to} language format with the same phrase ids, all non-empty, review "needed"`,
        job.status === 'succeeded' && !!v && v.language === to && v.translation?.review === 'needed' && ids.length === segmentIds.length && segmentIds.every((x) => typeof v.phraseText[x] === 'string' && v.phraseText[x].trim().length > 0),
        { status: job.status, error: job.error, language: v?.language, review: v?.translation?.review, phrases: ids.length });
      const master = (await call(`/projects/${pid}/captions?format=srt`)).text, variant = v ? (await call(`/projects/${pid}/captions?format=srt&variant=${v.id}`)).text : '';
      const times = (srt: string) => srt.split('\n').filter((l) => l.includes('-->'));
      check(`${id}: the format's SRT has exactly the master's cue times, with the translated words`, times(master).length === texts.length && JSON.stringify(times(master)) === JSON.stringify(times(variant)) && variant !== master,
        { masterCues: times(master).length, variantCues: times(variant).length });
      const sources = v?.translation?.sources ?? {};
      check(`${id}: the master text of every phrase is recorded by SHA-256`, segmentIds.every((x, i) => sources[x] === createHash('sha256').update(texts[i]!, 'utf8').digest('hex')));
      translations[id] = { run: job.output?.run, engine: v?.translation?.engine, model: v?.translation?.model, phrases: segmentIds.map((x, i) => ({ source: texts[i], machineTranslation: v?.phraseText?.[x] ?? null })), review: 'not reviewed: machine translation; no quality claim' };
    }
    evidence.translation = translations;

    // ---------- 4. AI voice cleanup on Hebrew narration with pink noise at 5 dB SNR ----------
    {
      const d = tool('local.voice.clean');
      const speech = decodeMono(SAMPLE);
      const pad = SAMPLE_RATE; // 1 s of pause before and after the speech: where the noise floor is measured
      // whole seconds: the file's duration is then an exact decimal, and the clip placed from it covers every sample
      const total = Math.ceil((speech.length + 2 * pad) / SAMPLE_RATE) * SAMPLE_RATE;
      const clean = new Float32Array(total);
      clean.set(speech, pad);
      const noise = pinkNoise(total / SAMPLE_RATE + 1).subarray(0, total);
      const g = rms(clean, pad, pad + speech.length) / (rms(noise) * 10 ** (5 / 20));
      const mix = new Float32Array(total);
      for (let i = 0; i < total; i++) mix[i] = clean[i]! + g * noise[i]!;
      let peak = 0;
      for (const x of mix) peak = Math.max(peak, Math.abs(x));
      if (peak > 0.99) { const k = 0.99 / peak; for (let i = 0; i < total; i++) { mix[i] = mix[i]! * k; clean[i] = clean[i]! * k; } }
      const mixFile = path.join(art, 'narration-noisy.wav');
      writeWav16(mixFile, [mix]);
      const input = readAll(mixFile)[0]!; // as stored (16-bit)
      const pid = (await call('/projects', { name: 'ai local proof: voice cleanup' })).body.project.id as string;
      const assetId = await upload(pid, mixFile);
      const placed = await tx(pid, [{ op: 'add_clip', args: { assetId, start: T.ZERO, trackId: 'trk_audio' } }]);
      const clipId = placed.results[0].output.clipId as string;
      const job = await run(pid, d, { source: { clipId }, apply: 'replace-clip' });
      check('Voice cleanup: the job succeeds and the clip is given the cleaned copy', job.status === 'succeeded' && job.output?.attachment?.status === 'attached', { status: job.status, error: job.error, attachment: job.output?.attachment });
      const p = await doc(pid);
      const outAsset = p.assets[job.output?.attachment?.assetId];
      const out = outAsset ? readAll(s.store.blobPath(outAsset.contentHash))[0]! : new Float32Array(0);
      check('Voice cleanup: equal sample count', out.length === input.length && job.output?.validation?.samples === input.length, { result: out.length, source: input.length });
      const win = Math.min(input.length - pad, 1 << 17);
      const lag = estimateLag(input.subarray(pad, pad + win), out.subarray(pad, pad + win), 4800);
      check('Voice cleanup: lag ≤ 1 ms (measured again here)', Math.abs(lag.lag) <= SAMPLE_RATE / 1000, { lagSamples: lag.lag, match: round(lag.match, 3), runnerLag: job.output?.validation?.lagSamples });
      const edge = SAMPLE_RATE / 20; // 50 ms away from the speech
      const pauses = [[edge, pad - edge], [pad + speech.length + edge, total - edge]] as const;
      const floor = (x: Float32Array) => dB(Math.sqrt(pauses.reduce((n, [a, b]) => n + rms(x, a, b) ** 2 * (b - a), 0) / pauses.reduce((n, [a, b]) => n + (b - a), 0)));
      const floorIn = floor(input), floorOut = floor(out);
      check('Voice cleanup: the noise floor in the pauses is lowered by at least 10 dB', floorIn - floorOut >= 10, { inDbfs: round(floorIn), outDbfs: round(floorOut), loweredDb: round(floorIn - floorOut) });
      const a = pad, b = pad + speech.length;
      const sdrIn = siSdr(input, clean, a, b), sdrOut = out.length === input.length ? siSdr(out, clean, a, b) : NaN;
      const undo = await call(`/projects/${pid}/undo`, {});
      const clipAfter = (await doc(pid)).sequences[p.mainSequenceId].tracks.find((t: any) => t.id === 'trk_audio').clips.find((c: any) => c.id === clipId);
      check('Voice cleanup: undo gives the clip its original file back', undo.status === 200 && clipAfter?.assetId === assetId, { status: undo.status });
      evidence.voiceClean = {
        input: { file: 'docs/demo/narration-sample-he.m4a + 1 s pauses + pink noise (ffmpeg anoisesrc seed 7) at 5 dB SNR over the speech', samples: input.length, sha256: sha(fs.readFileSync(mixFile)) },
        engine: voiceSetup.versions ?? null, validation: job.output?.validation, run: job.output?.run,
        pauseFloorDbfs: { input: round(floorIn), output: round(floorOut), loweredDb: round(floorIn - floorOut) },
        siSdrDb: { input: round(sdrIn), output: round(sdrOut), gain: round(sdrOut - sdrIn) },
        resultSha256: outAsset?.contentHash ?? null, note: 'measurements only; nobody has listened to the result (not quality-reviewed)',
      };
    }

    // ---------- 5. classic vocal removal on a synthetic stereo mix ----------
    {
      const d = tool('local.audio.vocals-classic');
      const n = 5 * SAMPLE_RATE;
      const l = new Float32Array(n), r = new Float32Array(n);
      for (let i = 0; i < n; i++) { const c = 0.25 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE), h = 0.25 * Math.sin((2 * Math.PI * 660 * i) / SAMPLE_RATE); l[i] = c + h; r[i] = c; }
      const file = path.join(art, 'centre440-left660.wav');
      writeWav16(file, [l, r]);
      const [inL] = readAll(file);
      const pid = (await call('/projects', { name: 'ai local proof: vocals classic' })).body.project.id as string;
      const assetId = await upload(pid, file);
      const placed = await tx(pid, [{ op: 'add_clip', args: { assetId, start: T.ZERO, trackId: 'trk_audio' } }]);
      const job = await run(pid, d, { source: { clipId: placed.results[0].output.clipId }, apply: 'replace-clip' });
      const p = await doc(pid);
      const outAsset = p.assets[job.output?.attachment?.assetId];
      const [outL] = outAsset ? readAll(s.store.blobPath(outAsset.contentHash)) : [new Float32Array(n)];
      const a = SAMPLE_RATE / 2, b = n - SAMPLE_RATE / 2;
      const centreDrop = dB(tone(inL!, 440, a, b)) - dB(tone(outL!, 440, a, b));
      const leftChange = dB(tone(outL!, 660, a, b)) - dB(tone(inL!, 660, a, b));
      check('Vocals classic: the job succeeds and the clip is given the result', job.status === 'succeeded' && job.output?.attachment?.status === 'attached', { status: job.status, error: job.error });
      check('Vocals classic: the centred 440 Hz tone drops by at least 40 dB', centreDrop >= 40, { droppedDb: round(centreDrop) });
      check('Vocals classic: the hard-left 660 Hz tone stays within 1 dB', Math.abs(leftChange) <= 1, { changeDb: round(leftChange, 3) });
      evidence.vocalsClassic = { input: { samples: n, sha256: sha(fs.readFileSync(file)) }, centreDropDb: round(centreDrop), leftToneChangeDb: round(leftChange, 3), run: job.output?.run, resultSha256: outAsset?.contentHash ?? null };
    }
  } catch (e) {
    check('Proof ran to the end', false, { error: String((e as Error)?.message ?? e).slice(0, 600) });
  } finally {
    if (sampling) clearInterval(sampling);
    await reader.stop();
    await s.close();
  }

  const engineSha = denoiseBin && fs.existsSync(denoiseBin) ? sha(fs.readFileSync(denoiseBin)) : null;
  const out = {
    proof: 'pnpm proof:ai-local', at: new Date().toISOString(),
    label: 'CPU only: this machine, one run each. Functional checks and measurements, not a quality review: nobody has read the Hebrew output or listened to the cleaned voice. Timings are for this machine only.',
    machine: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? null, ramBytes: os.totalmem(), platform: `${process.platform}-${process.arch}`, node: process.version },
    peakRssKb: { ...peakRssKb, serverProcess: process.resourceUsage().maxRSS, basis: 'VmRSS of the engine processes sampled every 100 ms from /proc; maxRSS of this process (the server ran in it)' },
    digests: { deepFilterBinarySha256: engineSha, tools: LOCAL_TOOLS.map((d) => ({ id: d.id, codeDigest: d.codeDigest, models: d.models.map((m) => ({ path: m.path, sha256: m.sha256, bytes: m.bytes })) })) },
    ...evidence,
    checks,
    passed: checks.every((c) => c.ok),
  };
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, `${JSON.stringify(out, null, 1)}\n`);
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; evidence: ${path.relative(root, evidenceFile)}`);
  process.exit(failed.length ? 1 : 0);
}

void main().catch((e) => { console.error(e); process.exit(1); });
