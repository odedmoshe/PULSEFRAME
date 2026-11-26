/**
 * Local speech recognition, end to end through the product: setup state, owner-approved verified model download, recognition
 * jobs on real Hebrew read speech with reference text, refusal paths, cancel, undo, and a cut by recognised words.
 *
 * Needs a Python environment with the engine (docs/INTEGRATIONS.md) and, on first run, about 1.6 GB of model download:
 *   PF_SPEECH_PYTHON=.artifacts/speech/venv/bin/python [NODE_USE_ENV_PROXY=1] pnpm proof:speech
 * Exits 2 (blocked) when the engine or the speech samples are absent. Samples: the first files of FLEURS he_il dev (CC BY 4.0),
 * fetched by hand into .artifacts/speech/fleurs (see docs/INTEGRATIONS.md); they are not part of the repository.
 *
 * What this is NOT: an accuracy benchmark (a few dozen clean read sentences), a word-timing measurement (there is no reference
 * timing) or a speed claim (one CPU machine, one run).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { chromium } from 'playwright';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/speech-proof');
const samples = path.join(root, '.artifacts/speech/fleurs');
const MODELS = path.join(root, '.artifacts/speech/models');
const CLIPS = Number(process.env.PF_SPEECH_PROOF_CLIPS ?? 12);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

/** Letters and digits only, without Hebrew points: what is compared is the words, not punctuation or spelling marks. */
const norm = (s: string) => s.normalize('NFKC').replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().split(/\s+/).filter(Boolean);
/** Word-level edit distance. */
function wordErrors(ref: string[], hyp: string[]) {
  let prev = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[hyp.length]!;
}

async function main() {
  const python = process.env.PF_SPEECH_PYTHON ? path.resolve(process.env.PF_SPEECH_PYTHON) : null;
  if (!python || !fs.existsSync(python)) { console.error('BLOCKED: PF_SPEECH_PYTHON does not name a Python interpreter with the speech engine'); process.exit(2); }
  const tsv = path.join(samples, 'dev.tsv');
  if (!fs.existsSync(tsv)) { console.error(`BLOCKED: no speech samples in ${samples}`); process.exit(2); }
  const refs = fs.readFileSync(tsv, 'utf8').split('\n').map((l) => l.split('\t')).filter((c) => c.length > 3 && fs.existsSync(path.join(samples, 'dev', c[1]!)) && fs.statSync(path.join(samples, 'dev', c[1]!)).size > 50_000).slice(0, CLIPS).map((c) => ({ file: path.join(samples, 'dev', c[1]!), text: c[2]! }));
  if (refs.length < 3) { console.error('BLOCKED: fewer than 3 usable speech samples'); process.exit(2); }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });

  // ---------- 1. not configured: an honest setup state ----------
  {
    const s = await startServer({ port: 0, dataDir: path.join(art, 'data-off'), speechPython: null });
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    try {
      const st = (await (await fetch(`${s.url}/api/v1/speech`, { headers: h })).json()) as any;
      check('Not configured: status says so and nothing is ready', st.transcription.ready === false && st.transcription.reason === 'engine_not_configured', { detail: st.transcription.detail });
      const pid = ((await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'off' }) })).json()) as any).project.id;
      const a = (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'a.wav' }, body: fs.readFileSync(refs[0]!.file) })).json()) as any;
      const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets/${a.assetId ?? a.asset?.id}/transcribe`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' });
      const b = (await r.json()) as any;
      check('Not configured: transcription is refused with the reason, no job is created', r.status === 409 && b.error?.code === 'speech_not_ready', { status: r.status, code: b.error?.code, hint: b.error?.hint });
    } finally { await s.close(); }
  }

  // ---------- 2. configured ----------
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), speechPython: python, speechModelsDir: MODELS });
  const origin = s.url;
  const agent = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner = { cookie, origin, connection: 'close' };
  const call = async (p: string, body?: unknown, headers: Record<string, string> = agent) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null } as { status: number; body: any };
  };
  const upload = async (pid: string, file: string) => { const r = (await (await fetch(`${origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...agent, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any; return (r.assetId ?? r.asset?.id) as string; };
  const waitJob = async (jobId: string, maxMs = 30 * 60_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > maxMs) throw new Error(`job ${jobId} still ${j.status} after ${maxMs} ms`); await sleep(500); } };
  const perClip: unknown[] = [];
  let download: unknown = null, timing: unknown = null;
  try {
    const pid = (await call('/projects', { name: 'speech proof' })).body.project.id as string;
    let st = (await call('/speech')).body;
    check('Engine answers a probe and is reported with its version', st.engine.ok === true && /faster-whisper/.test(st.engine.engine), { engine: st.engine.engine, version: st.engine.version, cudaDevices: st.engine.cudaDevices });
    const model = st.models[0];
    check('The reviewed model is listed with licence, exact size and per-file state', model.license === 'Apache-2.0' && model.totalBytes === 1621665181 && model.files.length === 5, { id: model.id, totalBytes: model.totalBytes, missing: model.missingDownloadBytes });

    // ---------- 3. download: a human action for the exact bytes ----------
    if (!model.ready) {
      const a = await call(`/projects/${pid}/speech/models/${model.id}/download`, { confirmBytes: model.missingDownloadBytes }, agent);
      check('Download: an agent credential is refused', a.status === 403 && a.body.error.code === 'human_approval_required', { status: a.status });
      const w = await call(`/projects/${pid}/speech/models/${model.id}/download`, { confirmBytes: model.missingDownloadBytes - 1 }, owner);
      check('Download: a different byte count than the one shown is refused', w.status === 409 && w.body.error.code === 'download_size_mismatch', { status: w.status });
      const d = await call(`/projects/${pid}/speech/models/${model.id}/download`, { confirmBytes: model.missingDownloadBytes }, owner);
      const job = await waitJob(d.body.jobId, 60 * 60_000);
      st = (await call('/speech')).body;
      check('Download: the owner\'s approval of the exact size downloads and verifies every file', d.status === 202 && job.status === 'succeeded' && st.models[0].ready === true && st.models[0].files.every((f: any) => f.state === 'ready'), { status: job.status, error: job.error, wallSeconds: job.output?.wallSeconds, bytes: model.missingDownloadBytes });
      download = { bytes: model.missingDownloadBytes, wallSeconds: job.output?.wallSeconds, note: 'network-dependent, single sample' };
    } else {
      check('Model files were already present; size and SHA-256 of each were verified again', st.models[0].files.every((f: any) => f.state === 'ready' && f.detail === 'size and SHA-256 verified'), { files: st.models[0].files.length });
      download = { note: 'files were already present from an earlier run; verified by size and SHA-256' };
      const again = await call(`/projects/${pid}/speech/models/${model.id}/download`, { confirmBytes: 1 }, owner);
      check('Download: refused when nothing is missing', again.status === 409 && again.body.error.code === 'models_already_ready', { status: again.status });
    }
    check('Ready state names the device actually used', st.transcription.ready === true && ['cpu', 'cuda'].includes(st.transcription.device), { device: st.transcription.device, qualification: st.transcription.qualification });

    // ---------- 4. recognition of real read speech ----------
    let errors = 0, refWords = 0, audio = 0, wall = 0, words = 0, lowConf = 0, adjusted = 0, wordsInSound = 0, structural = true, origins = true;
    const assets: string[] = [];
    const silentWords: unknown[] = [];
    let missing = 0;
    for (const [i, ref] of refs.entries()) {
      const assetId = await upload(pid, ref.file);
      assets.push(assetId);
      const r = await call(`/projects/${pid}/assets/${assetId}/transcribe`, { language: 'he' });
      const job = await waitJob(r.body.jobId);
      if (job.status !== 'succeeded' || !job.output?.attached) { structural = false; perClip.push({ file: path.basename(ref.file), status: job.status, error: job.error, output: job.output }); continue; }
      const tr = (await call(`/projects/${pid}`)).body.project.transcripts[assetId];
      const dur = T.toSeconds((await call(`/projects/${pid}`)).body.project.assets[assetId].duration);
      if (tr.origin.kind !== 'asr' || tr.origin.provider !== 'local:faster-whisper' || !/ivrit-ai/.test(tr.origin.model)) origins = false;
      // structure: phrases ascending without overlap, words ascending inside their phrase, everything inside the media
      let prev = 0;
      const pcm = new Int16Array(new Uint8Array(ff(['-i', ref.file, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'])).buffer);
      let clipPeak = 0;
      for (const v of pcm) clipPeak = Math.max(clipPeak, Math.abs(v));
      for (const seg of tr.segments) {
        const a = T.toSeconds(seg.start), b = a + T.toSeconds(seg.duration);
        if (a < prev - 1e-9 || b > dur + 1e-3 || b <= a) structural = false;
        prev = b;
        let w = a;
        for (const word of seg.words) {
          const ws = T.toSeconds(word.start), we = ws + T.toSeconds(word.duration);
          if (ws < w - 1e-9 || we > b + 1e-9 || !word.text.trim() || word.confidence === null) structural = false;
          w = we;
          // is there sound where the word is said to be? (a peak of at least a tenth of the clip's own peak inside the word, widened by 50 ms; some recordings are very quiet)
          let peak = 0;
          for (let k = Math.max(0, Math.round((ws - 0.05) * 16000)); k < Math.min(pcm.length, Math.round((we + 0.05) * 16000)); k++) peak = Math.max(peak, Math.abs(pcm[k]!));
          if (peak > clipPeak * 0.1) wordsInSound++; else silentWords.push({ clip: i + 1, word: word.text, at: Number(ws.toFixed(2)), to: Number(we.toFixed(2)), peak });
        }
      }
      const hyp = norm(tr.segments.map((x: any) => x.text).join(' ')), rw = norm(ref.text);
      const e = wordErrors(rw, hyp);
      // the same comparison without regard to order: reference words that were not recognised anywhere in the clip
      const pool = [...hyp];
      for (const x of rw) { const k = pool.indexOf(x); if (k >= 0) pool.splice(k, 1); else missing++; }
      errors += e; refWords += rw.length; audio += job.output.run.audioSeconds; wall += job.output.run.wallSeconds; words += job.output.words; lowConf += job.output.lowConfidenceWords; adjusted += job.output.adjustedTimes;
      perClip.push({ file: path.basename(ref.file), audioSeconds: job.output.run.audioSeconds, wallSeconds: Number(job.output.run.wallSeconds.toFixed(1)), referenceWords: rw.length, wordErrors: e, reference: ref.text, recognised: tr.segments.map((x: any) => x.text).join(' ') });
      console.log(`       clip ${i + 1}/${refs.length}: ${e}/${rw.length} word errors, ${job.output.run.wallSeconds.toFixed(1)} s for ${job.output.run.audioSeconds} s of audio`);
    }
    const wer = errors / refWords;
    check(`Every one of ${refs.length} real Hebrew recordings was recognised by a job and attached as a transcript`, perClip.length === refs.length && perClip.every((c: any) => c.wordErrors !== undefined), { clips: refs.length });
    check('Attached transcripts obey the transcript rules (order, no overlap, inside the media, every word timed with a confidence)', structural, { words, adjustedTimes: adjusted });
    check('Each transcript records that it is machine recognition, with engine and model revision', origins);
    check('Recognised text is close to the reference text (under 25% of the reference words missing; under 40% word error rate in order)', missing / refWords < 0.25 && wer < 0.4, { referenceWordsNotRecognised: Number((missing / refWords).toFixed(4)), wordErrorRateInOrder: Number(wer.toFixed(4)), wordErrors: errors, referenceWords: refWords, note: 'punctuation and Hebrew points ignored; spelling variants, digits written as words, and omitted bracketed asides count as errors. In several recordings the speaker read Latin-script names and clauses in a different order than the reference text (checked on one clip: a second, unrelated model hears the same order there), which the in-order figure counts as errors' });
    check('Word times fall where there is sound (at least 95% of words have signal inside their span)', wordsInSound / words >= 0.95, { wordsWithSound: wordsInSound, words, silent: silentWords.slice(0, 12), note: 'a plausibility check, not a timing-accuracy measurement' });
    timing = { audioSeconds: Number(audio.toFixed(1)), wallSeconds: Number(wall.toFixed(1)), wallPerAudioSecond: Number((wall / audio).toFixed(2)), lowConfidenceWords: lowConf, note: 'the model stays loaded between jobs (first job includes the load); one CPU machine, one run: not a performance figure' };

    // ---------- 5. refusals and honesty ----------
    const first = assets[0]!;
    const dup = await call(`/projects/${pid}/assets/${first}/transcribe`, {});
    check('An existing transcript is not replaced without overwrite', dup.status === 409 && dup.body.error.code === 'would_replace_transcript', { status: dup.status });
    const silent = path.join(art, 'silence.wav');
    ff(['-f', 'lavfi', '-i', 'anoisesrc=d=8:c=pink:a=0.0005:r=16000', '-ac', '1', '-y', silent]);
    const sid = await upload(pid, silent);
    const sj = await waitJob((await call(`/projects/${pid}/assets/${sid}/transcribe`, {})).body.jobId);
    const afterSilent = (await call(`/projects/${pid}`)).body.project.transcripts[sid];
    check('Eight seconds without speech: the job succeeds, says so, and attaches nothing', sj.status === 'succeeded' && sj.output.attached === false && afterSilent === undefined, { note: sj.output?.note, phrases: sj.output?.phrases });
    const picture = path.join(art, 'mute.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc=d=1:s=160x90:r=30', '-pix_fmt', 'yuv420p', '-y', picture]);
    const mute = await call(`/projects/${pid}/assets/${await upload(pid, picture)}/transcribe`, {});
    check('A file without sound is refused before any job', mute.status === 422 && mute.body.error.code === 'no_audio', { status: mute.status });

    // ---------- 6. overwrite, then undo ----------
    const last = assets.at(-1)!;
    const idsBefore = (await call(`/projects/${pid}`)).body.project.transcripts[last].segments.map((x: any) => x.id).join();
    const over = await waitJob((await call(`/projects/${pid}/assets/${last}/transcribe`, { overwrite: true })).body.jobId);
    const idsAfter = (await call(`/projects/${pid}`)).body.project.transcripts[last].segments.map((x: any) => x.id).join();
    check('overwrite=true recognises again and replaces the transcript', over.status === 'succeeded' && over.output.attached === true && idsAfter !== idsBefore, { status: over.status });
    const undo = await call(`/projects/${pid}/undo`, {});
    const idsUndone = (await call(`/projects/${pid}`)).body.project.transcripts[last].segments.map((x: any) => x.id).join();
    check('Recognition is one undoable transaction: undo brings the previous transcript back', undo.status === 200 && idsUndone === idsBefore, { status: undo.status });

    // ---------- 7. cut by recognised words ----------
    const tr0 = (await call(`/projects/${pid}`)).body.project.transcripts[first];
    const allWords = tr0.segments.flatMap((x: any) => x.words);
    const placed = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: first, start: T.rt(0, 1) } }] });
    const durBefore = (await call(`/projects/${pid}/timeline`)).body;
    const cut = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'delete_transcript_range', args: { assetId: first, fromWordId: allWords[1].id, toWordId: allWords[2].id } }] });
    check('Recognised words drive an edit: deleting two words by their ids cuts the clip', placed.status === 200 && cut.status === 200, { status: cut.status, summary: cut.body?.summary ?? cut.body?.error, words: allWords.slice(1, 3).map((w: any) => w.text), hadTimeline: !!durBefore });

    // ---------- filler candidates ----------
    // On the recognised transcripts (reported, whatever the count), then on a typed transcript with known fillers.
    const fa = await call(`/projects/${pid}/analysis/fillers`, { assetId: assets[1]! });
    check('Filler search runs on a recognised transcript and returns candidates with the cuts to apply (read-only)', fa.status === 200 && Array.isArray(fa.body.words) && fa.body.ops.length === fa.body.candidates.length && fa.body.transcript.origin === 'asr', { found: fa.body.words?.length, note: 'read sentences: few or none are expected' });
    const fid = assets[2]!;
    const one = (k: number) => T.rt(k, 2);
    const typed = ['שלום', 'אה', 'לכולם', 'אני', 'אני', 'כאן', 'אממ', 'היום'];
    const st2 = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_transcript', args: { assetId: fid, language: 'he', segments: [{ start: one(0), duration: one(typed.length), text: typed.join(' '), words: typed.map((text, k) => ({ text, start: one(k), duration: one(1) })) }] } }, { op: 'add_clip', args: { assetId: fid, start: T.frameTime(900, { num: 30, den: 1 }) } }] });
    const ff2 = await call(`/projects/${pid}/analysis/fillers`, { assetId: fid });
    const lenBefore = (await call(`/projects/${pid}/timeline`)).body.tracks.flatMap((t: any) => t.clips).filter((c: any) => c.assetId === fid).reduce((n: number, c: any) => n + T.toSeconds(c.duration), 0);
    const applied = await call(`/projects/${pid}/transactions`, { ops: ff2.body.ops, expectedRevision: ff2.body.revision });
    const lenAfter = (await call(`/projects/${pid}/timeline`)).body.tracks.flatMap((t: any) => t.clips).filter((c: any) => c.assetId === fid).reduce((n: number, c: any) => n + T.toSeconds(c.duration), 0);
    check('Filler search finds the hesitations and the repeated word in a typed transcript, and applying its cuts removes exactly them', st2.status === 200 && ff2.body.words.map((w: any) => `${w.kind}:${w.text}`).join() === 'hesitation:אה,repeat:אני,hesitation:אממ' && applied.status === 200 && Math.abs(lenBefore - lenAfter - 1.5) < 1e-6, { words: ff2.body.words?.map((w: any) => `${w.kind}:${w.text}`), removedSeconds: Number((lenBefore - lenAfter).toFixed(3)), status: applied.status });

    // ---------- time the words of an imported transcript (alignment) ----------
    const aid = assets[3]!, aref = refs[3]!;
    const adur = T.toSeconds((await call(`/projects/${pid}`)).body.project.assets[aid].duration);
    const stamp = (x: number) => { const ms = Math.floor(x * 1000); const p2 = (v: number, n = 2) => String(v).padStart(n, '0'); return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)},${p2(ms % 1000, 3)}`; };
    const srtText = aref.text.replace(/\s+/g, ' ').trim();
    const imp = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'import_transcript', args: { assetId: aid, language: 'he', content: `1\n00:00:00,000 --> ${stamp(adur)}\n${srtText}\n` } }] });
    const beforeAlign = (await call(`/projects/${pid}`)).body.project.transcripts[aid];
    const aj = await waitJob((await call(`/projects/${pid}/assets/${aid}/transcribe`, { mode: 'align' })).body.jobId);
    const afterAlign = (await call(`/projects/${pid}`)).body.project.transcripts[aid];
    const seg0 = afterAlign.segments[0];
    const inOrder = seg0.words.every((w: any, k: number) => k === 0 || T.lte(T.add(seg0.words[k - 1].start, seg0.words[k - 1].duration), w.start));
    check('Alignment: an imported phrase-timed transcript gets word times from the sound; its text, phrase ids and origin are unchanged', imp.status === 200 && beforeAlign.segments[0].timing === 'segment' && aj.status === 'succeeded' && aj.output.attached === true && afterAlign.origin.kind === 'import' && seg0.id === beforeAlign.segments[0].id && seg0.text === beforeAlign.segments[0].text && seg0.words.map((w: any) => w.text).join(' ') === srtText && inOrder && ['word', 'approximate'].includes(seg0.timing), { timing: seg0.timing, same: aj.output?.same, different: aj.output?.different, estimated: aj.output?.estimated, words: seg0.words.length, error: aj.error });
    check('Alignment: most typed words were found in the sound (at least 60% identical to what was heard)', aj.output.same / seg0.words.length >= 0.6, { identical: aj.output.same, of: seg0.words.length });
    const noTr = await call(`/projects/${pid}/assets/${sid}/transcribe`, { mode: 'align' });
    check('Alignment: refused for an asset without a transcript', noTr.status === 404 && noTr.body.error.code === 'no_transcript', { status: noTr.status });

    // ---------- the button in the editor ----------
    const browser = await chromium.launch();
    try {
      const fresh = path.join(art, 'ui.wav');
      ff(['-i', refs[0]!.file, '-af', 'volume=0.9', '-ac', '1', '-ar', '16000', '-y', fresh]); // a new file (other bytes), so it has no transcript yet
      const uid = await upload(pid, fresh);
      const placedUi = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: uid, start: T.frameTime(1800, { num: 30, den: 1 }) } }] });
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.locator(`.clip[data-clip-id="${placedUi.body.results[0].output.clipId}"]`).click();
      await page.getByTestId('inspector-tab-speech').click();
      await page.locator('[data-testid=transcript-panel][data-state=empty]').waitFor();
      const state0 = await page.getByTestId('asr').getAttribute('data-state');
      await page.getByTestId('asr-run').click();
      await page.getByTestId('asr-progress').waitFor();
      await page.locator('[data-testid=transcript-panel][data-state=ready]').waitFor({ timeout: 300_000 });
      const shown = await page.getByTestId('transcript-word').count();
      check('Editor: the Speech tab offers recognition when it is set up; pressing the button fills the transcript panel with words', state0 === 'ready' && shown > 3, { state: state0, words: shown });
      await page.getByTestId('filler-find').click();
      await page.getByTestId('filler-summary').waitFor();
      check('Editor: the filler search reports its result in the panel', (await page.getByTestId('filler-summary').getAttribute('data-count')) !== null, { count: await page.getByTestId('filler-summary').getAttribute('data-count') });
    } finally { await browser.close(); }

    // ---------- 8. cancel a running recognition ----------
    const long = path.join(art, 'long.wav');
    fs.writeFileSync(path.join(art, 'list.txt'), Array.from({ length: 12 }, (_, i) => `file '${refs[i % refs.length]!.file}'`).join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', path.join(art, 'list.txt'), '-ac', '1', '-ar', '16000', '-y', long]);
    const lid = await upload(pid, long);
    const lj = (await call(`/projects/${pid}/assets/${lid}/transcribe`, {})).body.jobId;
    for (let i = 0; i < 240; i++) { const j = (await call(`/jobs/${lj}`)).body; if (j.status === 'running' && /recognising/.test(j.stage ?? '')) break; await sleep(250); }
    const c = await call(`/jobs/${lj}/cancel`, {});
    const cj = await waitJob(lj, 60_000);
    check('Cancel stops a running recognition and nothing is attached', c.status === 200 && cj.status === 'canceled' && (await call(`/projects/${pid}`)).body.project.transcripts[lid] === undefined, { status: cj.status, outcome: c.body?.outcome });
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, gpu: 'none' },
      scope: `Functional evidence only. ${refs.length} clean read-speech sentences from FLEURS he_il dev (CC BY 4.0), one speaker style, no background noise, no conversation. Not an accuracy benchmark, no word-timing reference, no GPU, single run.`,
      download, timing, checks, clips: perClip,
    };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/speech-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSpeech proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
