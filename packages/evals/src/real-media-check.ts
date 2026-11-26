/**
 * Run a folder of real media files through the product and report what happened to each: import (and whether the file had to
 * be conformed), placement on a timeline, optional speech recognition, a caption track, a server export, and checks on the result.
 *
 *   pnpm build && [PF_SPEECH_PYTHON=...] pnpm check:media <folder> [--show-text]
 *
 * The files stay where they are and are never copied into the repository. The evidence file names them by position only and
 * contains technical figures, never frames, sound or recognised text. `--show-text` prints the recognised text to the console.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/real-media');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 26 }));
/** Mean level of each second of a file's sound, in dBFS. */
function levels(file: string): number[] {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const x = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1), out: number[] = [];
  for (let i = 0; i + 8000 <= x.length; i += 8000) { let e = 0; for (let k = i; k < i + 8000; k++) e += (x[k]! / 32768) ** 2; out.push(Number((10 * Math.log10(e / 8000 + 1e-12)).toFixed(1))); }
  return out;
}
/** Mean brightness (0-255) of one frame of a file at a time in seconds. */
function brightness(file: string, at: number): number {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=64:64,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  return raw.length ? Number((raw.reduce((n, v) => n + v, 0) / raw.length).toFixed(1)) : -1;
}

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const showText = process.argv.includes('--show-text');
  if (!dir || !fs.existsSync(dir)) { console.error('usage: pnpm check:media <folder with media files> [--show-text]'); process.exit(2); }
  const files = fs.readdirSync(dir).filter((f) => /\.(mp4|mov|m4v|mkv|webm|mp3|wav|m4a|aac|flac|ogg)$/i.test(f)).sort().map((f) => path.join(dir, f));
  if (!files.length) { console.error(`no media files in ${dir}`); process.exit(2); }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const python = process.env.PF_SPEECH_PYTHON ? path.resolve(process.env.PF_SPEECH_PYTHON) : null;
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), speechPython: python, ...(python ? { speechModelsDir: path.join(root, '.artifacts/speech/models') } : {}) });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const waitJob = async (jobId: string) => { for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(300); } };
  const perFile: any[] = [];
  let exportInfo: unknown = null;
  try {
    const first = probe(files[0]!).streams.find((x: any) => x.codec_type === 'video');
    const pid = (await call('/projects', { name: 'real media', ...(first ? { width: first.width, height: first.height } : {}) })).body.project.id as string;
    const speech = (await call('/speech')).body;
    console.log(`speech recognition: ${speech.transcription.ready ? `ready on ${speech.transcription.device}` : `not available (${speech.transcription.detail})`}`);

    // ---------- import ----------
    let cursor = T.ZERO;
    for (const [i, file] of files.entries()) {
      const src = probe(file);
      const sv = src.streams.find((x: any) => x.codec_type === 'video'), sa = src.streams.find((x: any) => x.codec_type === 'audio');
      const up = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': `clip${i + 1}${path.extname(file)}` }, body: fs.readFileSync(file) });
      const ub = (await up.json()) as any;
      const row: any = { file: i + 1, source: { seconds: Number(Number(src.format.duration).toFixed(3)), video: sv ? { codec: sv.codec_name, size: `${sv.width}x${sv.height}`, declaredRate: sv.r_frame_rate, averageRate: sv.avg_frame_rate, frames: Number(sv.nb_read_frames) } : null, audio: sa ? { codec: sa.codec_name, sampleRate: Number(sa.sample_rate), channels: sa.channels } : null } };
      perFile.push(row);
      if (up.status !== 201) { row.import = { status: up.status, error: ub.error }; continue; }
      const a = ub.asset;
      row.assetId = a.id;
      row.import = { seconds: Number(T.toSeconds(a.duration).toFixed(3)), frameRate: a.video ? `${a.video.frameRate.num}/${a.video.frameRate.den}` : null, frames: a.video?.frameCount ?? null, conformed: a.conform ? { reasons: a.conform.reasons ?? a.conform.reason, detail: a.conform.note ?? null } : null };
      const placed = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: a.id, start: cursor } }] });
      const clip = placed.body?.results?.[0]?.output;
      row.placed = placed.status === 200;
      if (placed.status !== 200) { row.placeError = placed.body?.error; continue; }
      const tl = (await call(`/projects/${pid}/timeline`)).body;
      const c = tl.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === clip.clipId);
      row.timeline = { start: Number(T.toSeconds(c.start).toFixed(3)), seconds: Number(T.toSeconds(c.duration).toFixed(3)) };
      cursor = T.add(c.start, c.duration);
    }
    check(`All ${files.length} files were imported`, perFile.every((r) => r.assetId), perFile.map((r) => ({ file: r.file, source: `${r.source.video?.size ?? 'audio'} @ ${r.source.video?.averageRate ?? '-'}`, imported: r.import })));
    check('Imported length matches the source length (within 2 frames or 70 ms)', perFile.every((r) => r.assetId && Math.abs(r.import.seconds - r.source.seconds) < 0.07), perFile.map((r) => ({ file: r.file, source: r.source.seconds, imported: r.import?.seconds })));
    check('Every file was placed on the timeline, one after another', perFile.every((r) => r.placed), perFile.map((r) => r.timeline));

    // ---------- speech ----------
    if (speech.transcription.ready) {
      // one request for the whole project, as the editor's "recognise every file" button does
      const all = await call(`/projects/${pid}/transcribe`, { language: 'he' });
      const again = await call(`/projects/${pid}/transcribe`, { language: 'he' });
      check('One request starts a recognition job for every file with sound; asking again does not queue them twice', all.status === 202 && all.body.jobs.length === perFile.filter((x) => x.assetId && x.source.audio).length && again.body.jobs.length === 0, { jobs: all.body.jobs?.length, secondRequest: again.body.jobs?.length, alreadyQueued: again.body.alreadyQueued });
      for (const { assetId, jobId } of all.body.jobs as { assetId: string; jobId: string }[]) {
        const r = perFile.find((x) => x.assetId === assetId)!;
        const j = await waitJob(jobId);
        r.speech = j.status === 'succeeded' ? { attached: j.output.attached, phrases: j.output.phrases, words: j.output.words, lowConfidenceWords: j.output.lowConfidenceWords, adjustedTimes: j.output.adjustedTimes, degeneratePhrases: j.output.degeneratePhrases, language: j.output.run.language, languageProbability: j.output.run.languageProbability, speechSeconds: j.output.run.speechSeconds, wallSeconds: Number(j.output.run.wallSeconds.toFixed(1)) } : { status: j.status, error: j.error };
        if (showText && j.output?.attached) console.log(`       file ${r.file}: ${(await call(`/projects/${pid}`)).body.project.transcripts[r.assetId].segments.map((x: any) => x.text).join(' ')}`);
      }
      check('Speech recognition jobs finished on every file with sound', perFile.filter((r) => r.source.audio).every((r) => r.speech && r.speech.attached !== undefined), perFile.map((r) => ({ file: r.file, ...r.speech })));
      const cap = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_caption_track', args: { mode: 'transcript' } }] });
      check('A caption track that follows the transcripts was added', cap.status === 200, { status: cap.status, error: cap.body?.error });
    }

    // ---------- export ----------
    const t0 = Date.now();
    const job = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
    const total = T.toSeconds(cursor);
    if (job.status !== 'succeeded') check('The timeline was exported', false, { status: job.status, error: job.error });
    else {
      const out = path.join(art, 'export.mp4');
      fs.writeFileSync(out, (await call(`/jobs/${job.id}/output`)).body);
      const p = probe(out), ov = p.streams.find((x: any) => x.codec_type === 'video'), oa = p.streams.find((x: any) => x.codec_type === 'audio');
      exportInfo = { seconds: Number(Number(p.format.duration).toFixed(3)), expectedSeconds: Number(total.toFixed(3)), video: `${ov.codec_name} ${ov.width}x${ov.height} @ ${ov.r_frame_rate}`, frames: Number(ov.nb_read_frames), audio: oa ? `${oa.codec_name} ${oa.sample_rate} Hz` : null, bytes: fs.statSync(out).size, wallSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)) };
      check('The timeline was exported with picture and sound, at the timeline\'s length', !!ov && !!oa && Math.abs(Number(p.format.duration) - total) < 0.1, exportInfo);
      // each source's picture and sound are where the timeline says: compare brightness and per-second level with the source
      const lv = levels(out);
      const cmp = perFile.filter((r) => r.timeline).map((r) => {
        const srcFile = files[r.file - 1]!, mid = r.timeline.seconds / 2;
        const sb = r.source.video ? brightness(srcFile, mid) : null, ob = r.source.video ? brightness(out, r.timeline.start + mid) : null;
        const sl = r.source.audio ? levels(srcFile) : [], k0 = Math.round(r.timeline.start);
        // whole seconds that lie fully inside the clip in both files
        const diffs = sl.slice(1, Math.floor(r.timeline.seconds) - 1).map((v, k) => Math.abs(v - (lv[k0 + 1 + k] ?? -120)));
        return { file: r.file, brightness: { source: sb, export: ob }, soundLevelDifferenceDb: diffs.length ? Number((diffs.reduce((n, v) => n + v, 0) / diffs.length).toFixed(1)) : null };
      });
      check('In the export, each file\'s picture is at its place (mid-clip brightness within 12 of the source)', cmp.every((c) => c.brightness.source === null || Math.abs(c.brightness.source - c.brightness.export!) < 12), cmp.map((c) => ({ file: c.file, ...c.brightness })));
      check('In the export, each file\'s sound is at its place (per-second level within 3 dB of the source on average)', cmp.every((c) => c.soundLevelDifferenceDb === null || c.soundLevelDifferenceDb < 3), cmp.map((c) => ({ file: c.file, dB: c.soundLevelDifferenceDb })));
    }
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, gpu: 'none' },
      scope: `${files.length} files supplied by the owner, run once on a CPU machine. Files are identified by position only; no frames, sound or recognised text are recorded here. Nobody watched or listened to the export: the checks are numeric.`,
      files: perFile.map(({ assetId, ...r }) => r), export: exportInfo, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/real-media-check.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nReal media check ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
