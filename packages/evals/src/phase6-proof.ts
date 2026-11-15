/**
 * Phase 6 gate (SPEC §16, Appendix D): transcripts and captions.
 * Proves on a synthetic "speech" fixture (every beep is one word) that
 *  - captions are derived from source time and follow cuts with no re-timing step,
 *  - deleting transcript words cuts picture, sound and captions together, frame- and sample-checked in a real export,
 *  - correcting text never changes audio, word-level highlight needs word-level timing,
 *  - SRT/VTT import and export round-trip, Hebrew/mixed-direction captions render as the committed baselines.
 * Speech recognition itself is NOT covered: no ASR provider is configured on this machine (see docs/BLOCKERS.md).
 *   pnpm build && pnpm proof:phase6
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { FONT_CATALOG, parseSubtitles } from '@pulseframe/core';
import { evaluate, type CaptionLayer } from '@pulseframe/engine';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase6');
const base = path.join(root, 'docs/evidence/baselines');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const W = 640, H = 360;
const WORDS = ['שלום', 'עולם', 'Hello', '2026', 'בדיקה', 'כתוביות', 'PULSEFRAME', 'סוף'];
const HIGHLIGHT = [0x3d, 0xe0, 0xc8];
/** Pixels close to the highlight colour in the lower third of an RGB24 frame. */
const lit = (rgb: Buffer, w = W, h = H) => { let n = 0; for (let y = Math.floor(h * 0.6); y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; if (Math.abs(rgb[i]! - HIGHLIGHT[0]!) < 28 && Math.abs(rgb[i + 1]! - HIGHLIGHT[1]!) < 28 && Math.abs(rgb[i + 2]! - HIGHLIGHT[2]!) < 28) n++; } return n; };
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const decodePng = (file: string) => ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
/** Beep onsets (seconds) in mono 48 kHz s16le PCM. */
function onsets(pcm: Buffer): number[] {
  const out: number[] = [];
  let quiet = 4800;
  for (let i = 0; i < pcm.length / 2; i++) {
    const loud = Math.abs(pcm.readInt16LE(i * 2)) > 3000;
    if (loud && quiet >= 4800) out.push(i / 48000);
    quiet = loud ? 0 : quiet + 1;
  }
  return out;
}

/** Like onsets(), for beeps that are closer together (at least 50 ms of quiet between them). */
function onsets2(pcm: Buffer): number[] {
  const out: number[] = [];
  let quiet = 2400;
  for (let i = 0; i < pcm.length / 2; i++) {
    const loud = Math.abs(pcm.readInt16LE(i * 2)) > 3000;
    if (loud && quiet >= 2400) out.push(i / 48000);
    quiet = loud ? 0 : quiet + 1;
  }
  return out;
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(base, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'speech.mp4'), frames: 240 });
  const s = await startServer({ port: 8796, dataDir: path.join(art, 'data') });
  const bearer = (t: string) => ({ authorization: `Bearer ${t}`, connection: 'close' });
  const h = bearer(s.auth.tokens.agent);
  const call = async (p: string, body?: unknown, headers: Record<string, string> = h) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, headers: r.headers, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; headers: Headers; body: any };
  };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(150); } };
  const still = async (pid: string, index: number, name: string) => { const file = path.join(art, `${name}.png`); fs.writeFileSync(file, (await call(`/projects/${pid}/frame?index=${index}`)).body); return file; };
  const exportMp4 = async (pid: string, name: string) => {
    const j = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${j.id}/output`)).body);
    return { job: j, file, rgb: ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']), pcm: ff(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']) };
  };
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project;
  const caption = (d: any, frame: number) => evaluate(d, f(frame)).layers.find((l) => l.kind === 'caption') as CaptionLayer | undefined;
  const say = (l?: CaptionLayer) => l?.words.map((w) => `${w.text}${w.state === 'current' ? '*' : ''}`).join(' ') ?? null;
  const browser = await chromium.launch();
  try {
    console.log('\n# editor: transcript panel and caption controls');
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(s.url);
    await page.waitForFunction(() => !!document.querySelector('[data-testid=project-name]')?.textContent);
    let upid = '';
    for (let i = 0; i < 100 && !upid; i++) { upid = (await call('/projects')).body.projects[0]?.id ?? ''; if (!upid) await sleep(100); }
    const uup: any = await (await fetch(`${s.url}/api/v1/projects/${upid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'speech.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    await call(`/projects/${upid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: uup.assetId, start: f(0) } }] });
    await page.getByTestId('transcript-panel').waitFor();
    check('no transcript: the panel says so and offers import; it does not invent text', (await page.getByTestId('transcript-panel').getAttribute('data-state')) === 'empty' && (await page.getByTestId('transcript-word').count()) === 0, await page.getByTestId('transcript-empty').textContent());
    const uw = (k: number) => ({ text: WORDS[k]!, start: T.rt(k * 1000, 1000), duration: T.rt(100, 1000) });
    await call(`/projects/${upid}/transactions`, { ops: [{ op: 'set_transcript', args: { assetId: uup.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(4, 1), text: WORDS.slice(0, 4).join(' '), words: [0, 1, 2, 3].map(uw) }, { start: T.rt(4, 1), duration: T.rt(4, 1), text: WORDS.slice(4).join(' '), words: [4, 5, 6, 7].map(uw) }] } }] });
    await page.locator('[data-testid=transcript-panel][data-state=ready]').waitFor();
    const words = page.getByTestId('transcript-word');
    await page.getByTestId('caption-add').click();
    await page.getByTestId('caption-preset').waitFor();
    await page.getByTestId('caption-preset').selectOption('karaoke');
    await page.waitForFunction(async (id) => (await (await fetch(`/api/v1/projects/${id}`)).json()).project.sequences.seq_main.tracks.some((t: any) => t.caption?.style.preset === 'karaoke'), upid);
    await words.nth(5).click();
    const tcAfterClick = await page.getByTestId('timecode').textContent();
    await words.nth(2).click();
    await words.nth(3).click({ modifiers: ['Shift'] });
    const selected = await page.locator('[data-testid=transcript-word].sel').count();
    await page.getByTestId('transcript-delete').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=transcript-word].cut').length === 2);
    const ud = await doc(upid);
    await page.screenshot({ path: path.join(art, 'editor-transcript.png') });
    check('editor: 8 word buttons; clicking word 6 seeks to 00:00:05:00; shift-click selects 2 words; delete cuts them from every track and marks them as cut', (await words.count()) === 8 && tcAfterClick === '00:00:05:00' && selected === 2 && ud.sequences.seq_main.tracks.filter((t: any) => t.kind === 'video' || t.kind === 'audio').every((t: any) => t.clips.length === 2) && say(caption(ud, 87)) === 'בדיקה* כתוביות PULSEFRAME סוף', { words: await words.count(), tcAfterClick, selected });
    await page.getByTestId('transcript-edit').first().click();
    await page.getByTestId('transcript-textarea').fill('שלום חברים Hello 2026');
    await page.getByTestId('transcript-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=transcript-word]:nth-of-type(2)')?.textContent?.includes('חברים') || [...document.querySelectorAll('[data-testid=transcript-word]')].some((e) => e.textContent?.includes('חברים')));
    check('editor: correcting a phrase commits correct_transcript and keeps the original', (await doc(upid)).transcripts[uup.assetId].segments[0].original === WORDS.slice(0, 4).join(' '));
    check('editor: no uncaught errors', errors.length === 0, errors.slice(0, 4));
    await page.close();

    const pid = (await call('/projects', { name: 'phase6', width: W, height: H })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'speech.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const assetId = up.assetId;
    // Every beep (first 100 ms of each second) is one "word".
    const word = (k: number) => ({ text: WORDS[k]!, start: T.rt(k * 1000, 1000), duration: T.rt(100, 1000) });
    const setup = await call(`/projects/${pid}/transactions`, { ops: [
      { op: 'add_clip', args: { assetId, start: f(0) } },
      { op: 'set_transcript', args: { assetId, language: 'he', segments: [
        { start: T.rt(0, 1), duration: T.rt(4, 1), text: WORDS.slice(0, 4).join(' '), words: [0, 1, 2, 3].map(word) },
        { start: T.rt(4, 1), duration: T.rt(4, 1), text: WORDS.slice(4).join(' '), words: [4, 5, 6, 7].map(word) },
      ] } },
      { op: 'add_caption_track', args: { mode: 'transcript', style: { preset: 'karaoke', sizeFrac: 0.07 } } },
    ] });
    const wordIds: string[] = setup.body.results[1].output.wordIds.flat();
    const capTrack: string = setup.body.results[2].output.trackId;

    console.log('\n# transcript model and senses');
    check('transcript, caption track and clip are created through the normal transaction path', setup.status === 200 && wordIds.length === 8, { revision: setup.body.revision });
    const tv = await call(`/projects/${pid}/transcripts/${assetId}`);
    check('transcript sense returns phrase and word ids with source times and the timing grade', tv.status === 200 && tv.body.segments.length === 2 && tv.body.segments[0].timing === 'word' && tv.body.segments[1].words[0].startSeconds === 4 && tv.body.segments[0].words[0].id === wordIds[0]);
    check('a client cannot label typed text as speech recognition (set_transcript refuses origin=asr)', (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_transcript', args: { assetId, language: 'he', origin: 'asr', segments: [{ start: f(0), duration: f(30), text: 'x' }] } }] })).status >= 400);
    check('observer token cannot change a transcript', (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'correct_transcript', args: { assetId, segmentId: tv.body.segments[0].id, text: 'x y z w' } }] }, bearer(s.auth.tokens.observer))).status === 403);

    console.log('\n# word highlight comes from source time');
    let d = await doc(pid);
    check('frame 1 (0.033 s): first word is current; frame 15 (0.5 s): nothing is current; frame 31: second word', say(caption(d, 1)) === 'שלום* עולם Hello 2026' && say(caption(d, 15)) === 'שלום עולם Hello 2026' && say(caption(d, 31)) === 'שלום עולם* Hello 2026', [say(caption(d, 1)), say(caption(d, 15)), say(caption(d, 31))]);
    const k0 = lit(decodePng(await still(pid, 0, 'karaoke-f0'))), k45 = lit(decodePng(await still(pid, 45, 'karaoke-f45'))), k100 = lit(decodePng(await still(pid, 100, 'karaoke-f100')));
    check('rendered karaoke frames: highlighted pixels grow as words are spoken (1 word < 2 words < 4 words)', k0 > 50 && k45 > k0 * 1.3 && k100 > k45 * 1.3, { k0, k45, k100 });

    console.log('\n# text-based editing: delete words -> picture, sound and captions cut together');
    const pcmBefore = (await exportMp4(pid, 'before.mp4')).pcm;
    // Delete "Hello 2026" = source [2.0 s, 3.1 s) -> timeline frames 60..93 (33 frames).
    const del = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'delete_transcript_range', args: { assetId, fromWordId: wordIds[2], toWordId: wordIds[3] } }] });
    check('delete_transcript_range reports the exact frame range it removed', del.status === 200 && JSON.stringify(del.body.results[0].output.ranges) === JSON.stringify([{ start: f(60), end: f(93) }]), del.body.results?.[0]?.output ?? del.body);
    d = await doc(pid);
    check('captions follow the cut with no re-timing op: removed words are gone; phrase 1 holds until its source end; "בדיקה" (source 4.0 s) becomes current exactly at timeline frame 87', say(caption(d, 30)) === 'שלום עולם*' && say(caption(d, 86)) === 'שלום עולם' && say(caption(d, 87)) === 'בדיקה* כתוביות PULSEFRAME סוף', [say(caption(d, 30)), say(caption(d, 86)), say(caption(d, 87))]);
    const ex = await exportMp4(pid, 'after.mp4');
    const frames = ex.rgb.length / (W * H * 3);
    const codeAt = (k: number) => readBarcode(ex.rgb.subarray(k * W * H * 3, (k + 1) * W * H * 3), W, 3, { x: 0, y: 0, w: W, h: H });
    check('export: 207 frames; frame 59 shows source 59 and frame 60 shows source 93 (exact cut)', ex.job.status === 'succeeded' && frames === 207 && codeAt(59) === 59 && codeAt(60) === 93 && codeAt(206) === 239, { frames, at59: codeAt(59), at60: codeAt(60), last: codeAt(206) });
    const on = onsets(ex.pcm);
    const expected = [0, 1, 2.9, 3.9, 4.9, 5.9];
    const maxErrMs = Math.max(...expected.map((e, i) => Math.abs((on[i] ?? 99) - e) * 1000));
    check('export audio: the two deleted beeps are gone and the next word is heard at 2.900 s (within 2 ms)', on.length === expected.length && maxErrMs < 2, { onsets: on.map((x) => Number(x.toFixed(4))), maxErrMs: Number(maxErrMs.toFixed(3)) });
    const frameRgb = (k: number) => ex.rgb.subarray(k * W * H * 3, (k + 1) * W * H * 3);
    const lit87 = lit(Buffer.from(frameRgb(87))), lit86 = lit(Buffer.from(frameRgb(86)));
    const still86 = lit(decodePng(await still(pid, 86, 'cut-f86'))), still87 = lit(decodePng(await still(pid, 87, 'cut-f87')));
    const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.3;
    check('export picture: the caption changes phrase on the same frame as the beep (87): exported frames 86 and 87 match the stills of those frames and differ from each other', near(lit86, still86) && near(lit87, still87) && !near(lit86, lit87), { lit86, still86, lit87, still87 });
    const srt = await call(`/projects/${pid}/captions?format=srt`);
    const cues = parseSubtitles(srt.body.toString('utf8')).cues.map((c) => [T.toSeconds(c.start), T.toSeconds(c.end), c.text]);
    check('SRT export reflects the edit and matches the picture: phrase 1 without the deleted words until 2.9 s, then phrase 2', JSON.stringify(cues) === JSON.stringify([[0, 2.9, 'שלום עולם'], [2.9, 6.9, 'בדיקה כתוביות PULSEFRAME סוף']]), cues);

    console.log('\n# undo, locks, corrections');
    const undo = await call(`/projects/${pid}/undo`, {});
    d = await doc(pid);
    check('undo restores the cut on every track and the captions', undo.status === 200 && say(caption(d, 61)) === 'שלום עולם Hello* 2026' && d.sequences[d.mainSequenceId].tracks.every((t: any) => (t.kind !== 'video' && t.kind !== 'audio') || t.clips.length === 1), { status: undo.status, caption: say(caption(d, 61)), clips: d.sequences[d.mainSequenceId].tracks.map((t: any) => `${t.kind}:${t.clips.length}`) });
    await call(`/projects/${pid}/redo`, {});
    const lockDoc = await doc(pid);
    void lockDoc;
    const seg1 = tv.body.segments[0].id;
    const fix = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'correct_transcript', args: { assetId, segmentId: seg1, text: 'שלום חברים Hello 2026' } }] });
    d = await doc(pid);
    const ex2 = await exportMp4(pid, 'corrected.mp4');
    check('correcting a word changes the caption, keeps word timing, keeps the original text, and leaves exported audio bit-identical', fix.status === 200 && fix.body.results[0].output.timing === 'word' && say(caption(d, 30)) === 'שלום חברים*' && d.transcripts[assetId].segments[0].original === WORDS.slice(0, 4).join(' ') && sha(ex2.pcm) === sha(ex.pcm), { caption: say(caption(d, 30)), audioIdentical: sha(ex2.pcm) === sha(ex.pcm) });
    void pcmBefore;
    const reword = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'correct_transcript', args: { assetId, segmentId: tv.body.segments[1].id, text: 'שלוש מילים בלבד' } }] });
    d = await doc(pid);
    const approxWords = d.transcripts[assetId].segments[1].words;
    const refuse = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'delete_transcript_range', args: { assetId, fromWordId: approxWords[0].id, toWordId: approxWords[0].id } }] });
    check('changing the word count marks times as estimates: no word highlight is drawn, and a word-precise cut is refused with a reason', reword.body.results[0].output.timing === 'approximate' && caption(d, 100)!.words.every((w) => w.state === 'plain') && refuse.status >= 400 && refuse.body.error.code === 'incompatible' && lit(decodePng(await still(pid, 100, 'approx-f100'))) === 0, { refuse: refuse.body.error?.message });

    console.log('\n# manual captions, SRT/VTT import and export');
    const pid2 = (await call('/projects', { name: 'phase6-manual', width: 1080, height: 1920 })).body.project.id;
    const srtIn = '1\n00:00:00,000 --> 00:00:01,500\nשלום Hello World עולם 2026\n\n2\n00:00:01,500 --> 00:00:03,000\nכתוביות בעברית עם English באמצע המשפט, ומספרים כמו 15 ו-2026.\n\n3\n00:00:03,010 --> 00:00:04,000\n(מוזיקה)\n';
    const imp = await call(`/projects/${pid2}/transactions`, { ops: [{ op: 'import_captions', args: { content: srtIn } }] });
    const manualTrack = imp.body.results[0].output.trackId;
    check('SRT import creates frame-snapped cues and reports the largest timing shift', imp.status === 200 && imp.body.results[0].output.cueIds.length === 3 && imp.body.results[0].output.maxShiftSeconds <= 1 / 60 + 1e-9, { maxShiftSeconds: imp.body.results[0].output.maxShiftSeconds });
    const vtt = await call(`/projects/${pid2}/captions?format=vtt&trackId=${manualTrack}`);
    const back = parseSubtitles(vtt.body.toString('utf8'));
    check('VTT export round-trips text exactly and times to the frame grid', back.format === 'vtt' && back.cues.length === 3 && back.cues[0]!.text === 'שלום Hello World עולם 2026' && T.eq(back.cues[2]!.start, f(90)) && T.eq(back.cues[2]!.end, f(120)), back.cues.map((c) => [T.toSeconds(c.start), T.toSeconds(c.end)]));
    const ass = await call(`/projects/${pid2}/captions?format=ass`);
    check('ASS export carries the play resolution and the cues', /PlayResX: 1080/.test(ass.body.toString('utf8')) && (ass.body.toString('utf8').match(/^Dialogue:/gm) ?? []).length === 3);
    check('overlapping import is rejected as a whole, not partly applied', (await call(`/projects/${pid2}/transactions`, { ops: [{ op: 'import_captions', args: { content: srtIn, trackId: manualTrack } }] })).body.error?.code === 'overlap' && (await doc(pid2)).sequences.seq_main.tracks.find((t: any) => t.id === manualTrack).clips.length === 3);
    await call(`/projects/${pid2}/transactions`, { ops: [{ op: 'set_caption_style', args: { trackId: manualTrack, style: { fontFamily: 'Not Installed Sans' } } }] });
    const blocked = await call(`/projects/${pid2}/exports/plan`, {});
    await call(`/projects/${pid2}/transactions`, { ops: [{ op: 'set_caption_style', args: { trackId: manualTrack, style: { fontFamily: 'Heebo' } } }] });
    check('a caption font that is not bundled blocks export instead of silently falling back', blocked.body.blockers.some((b: any) => b.code === 'missing_font'), blocked.body.blockers);

    console.log('\n# Hebrew and mixed-direction rendering (golden images)');
    const golden: Record<string, unknown> = {};
    const shots: [string, number, Record<string, unknown>][] = [
      ['classic-mixed', 10, { preset: 'classic' }],
      ['classic-long-wrap', 60, { preset: 'classic', maxCharsPerLine: 40, maxLines: 3 }],
      ['top-stroke', 10, { preset: 'classic', position: 'top', background: null, stroke: '#000000' }],
    ];
    for (const [name, frame, style] of shots) {
      await call(`/projects/${pid2}/transactions`, { ops: [{ op: 'set_caption_style', args: { trackId: manualTrack, style: { ...{ preset: 'classic', position: 'bottom', background: '#000000B3', stroke: null, maxCharsPerLine: 32, maxLines: 2 }, ...style } } }] });
      const file = await still(pid2, frame, `golden-${name}`);
      const ref = path.join(base, `phase6-${name}.png`);
      if (!fs.existsSync(ref) || process.env.PF_UPDATE_BASELINES === '1') { fs.copyFileSync(file, ref); golden[name] = 'baseline written'; continue; }
      golden[name] = Number(/All:([\d.]+)/.exec(spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-i', ref, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);
    }
    // word-level presets on the transcript project (restore word timing first)
    await call(`/projects/${pid}/undo`, {});
    for (const [name, preset] of [['karaoke', 'karaoke'], ['box-highlight', 'box-highlight'], ['word-pop', 'word-pop']] as const) {
      await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_caption_style', args: { trackId: capTrack, style: { preset } } }] });
      const file = await still(pid, 118, `golden-${name}`); // source 5.03 s: "כתוביות" is being spoken
      const ref = path.join(base, `phase6-${name}.png`);
      if (!fs.existsSync(ref) || process.env.PF_UPDATE_BASELINES === '1') { fs.copyFileSync(file, ref); golden[name] = 'baseline written'; continue; }
      golden[name] = Number(/All:([\d.]+)/.exec(spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-i', ref, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);
    }
    check('caption renders match the committed baselines (SSIM ≥ 0.995), or were written on first run', Object.values(golden).every((g) => g === 'baseline written' || (typeof g === 'number' && g >= 0.995)), golden);

    console.log('\n# silence candidates and clip animation (no model needed)');
    const pid4 = (await call('/projects', { name: 'phase6-silence', width: W, height: H })).body.project.id;
    const up4: any = await (await fetch(`${s.url}/api/v1/projects/${pid4}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'speech.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    await call(`/projects/${pid4}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up4.assetId, start: f(0) } }] });
    const sil = await call(`/projects/${pid4}/analysis/silences`, { assetId: up4.assetId, minSeconds: 0.5, keepSeconds: 0.1 });
    const revBefore = (await call(`/projects/${pid4}`)).body.revision;
    check('silence analysis finds the 8 gaps between beeps, proposes 8 frame-aligned cuts, and edits nothing', sil.status === 200 && sil.body.sourceSilences.length === 8 && sil.body.candidates.length === 8 && sil.body.candidates.every((c: any) => T.isFrameAligned(c.start, R) && T.isFrameAligned(c.end, R)) && revBefore === sil.body.revision, { first: sil.body.sourceSilences[0], removableSeconds: sil.body.removableSeconds });
    const applied = await call(`/projects/${pid4}/transactions`, { ops: sil.body.ops, expectedRevision: sil.body.revision });
    const again = await call(`/projects/${pid4}/transactions`, { ops: sil.body.ops, expectedRevision: sil.body.revision });
    const ex4 = await exportMp4(pid4, 'tight.mp4');
    const on4 = onsets2(ex4.pcm);
    const gaps = on4.slice(1).map((x, i) => x - on4[i]!);
    check('applying the candidates as one transaction keeps every beep (8 onsets), closes the gaps evenly, and cannot be applied twice', applied.status === 200 && again.status === 409 && on4.length === 8 && Math.max(...gaps) - Math.min(...gaps) < 0.002 && ex4.rgb.length / (W * H * 3) === 240 - Math.round(sil.body.removableSeconds * 30), { onsets: on4.map((x) => Number(x.toFixed(3))), frames: ex4.rgb.length / (W * H * 3), secondApply: again.body.error?.code });
    const title = await call(`/projects/${pid4}/transactions`, { ops: [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60), style: { color: '#00FF00' } } }] });
    const titleId = title.body.results[0].output.clipId;
    const anim = await call(`/projects/${pid4}/transactions`, { ops: [{ op: 'animate_clip', args: { clipId: titleId, in: 'fade', out: 'slide-down', inFrames: 12, outFrames: 12 } }] });
    const green = (rgb: Buffer) => { let n = 0; for (let i = 0; i < rgb.length; i += 3) if (rgb[i]! < 90 && rgb[i + 1]! > 170 && rgb[i + 2]! < 90) n++; return n; };
    const g0 = green(decodePng(await still(pid4, 0, 'anim-f0'))), g6 = green(decodePng(await still(pid4, 6, 'anim-f6'))), g30 = green(decodePng(await still(pid4, 30, 'anim-f30'))), g58 = green(decodePng(await still(pid4, 58, 'anim-f58')));
    check('animate_clip: title is invisible on its first frame, partly visible mid-entrance, fully visible at rest, fading again near the end', anim.status === 200 && g0 === 0 && g30 > 200 && g6 < g30 && g58 < g30, { g0, g6, g30, g58 });

    console.log('\n# font catalog');
    const fontHashes: Record<string, string> = {};
    for (const font of FONT_CATALOG) {
      await call(`/projects/${pid4}/transactions`, { ops: [{ op: 'update_text', args: { clipId: titleId, text: 'שָׁלוֹם עולם Hello 123', style: { fontFamily: font.family, fontWeight: 400 } } }] });
      fontHashes[font.family] = sha(decodePng(await still(pid4, 30, `font-${font.slug}`)));
    }
    const plan5 = (await call(`/projects/${pid4}/exports/plan`, {})).body;
    check(`all ${FONT_CATALOG.length} catalog families render differently from each other (none fell back to another face), and the export manifest pins the font files by SHA-256`, new Set(Object.values(fontHashes)).size === FONT_CATALOG.length && plan5.blockers.length === 0 && plan5.manifest.fonts.some((x: any) => x.family === FONT_CATALOG.at(-1)!.family && x.files.length > 0 && x.files.every((y: any) => /^[0-9a-f]{64}$/.test(y.sha256))), { families: Object.keys(fontHashes), manifestFonts: plan5.manifest.fonts.map((x: any) => `${x.family}:${x.files.length}`) });

    console.log('\n# editor: silence and animation controls, font picker');
    const pid5 = upid; // the project the editor has open
    const page2 = await (await browser.newContext({ viewport: { width: 1440, height: 2400 }, reducedMotion: 'reduce' })).newPage();
    await page2.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors2: string[] = [];
    page2.on('pageerror', (e) => errors2.push(String(e)));
    page2.on('console', (m) => m.type() === 'error' && errors2.push(m.text()));
    await page2.goto(`${s.url}/?project=${pid5}`);
    await page2.getByTestId('silence-find').waitFor();
    const before5 = await doc(pid5);
    await page2.getByTestId('silence-find').click();
    await page2.locator('[data-testid=silence-summary][data-count]').waitFor();
    const found = Number(await page2.getByTestId('silence-summary').getAttribute('data-count'));
    await page2.getByTestId('silence-apply').click();
    await page2.waitForFunction(async ([id, n]) => (await (await fetch(`/api/v1/projects/${id}`)).json()).project.sequences.seq_main.tracks.find((t: any) => t.kind === 'audio').clips.length > (n as number), [pid5, before5.sequences.seq_main.tracks.find((t: any) => t.kind === 'audio').clips.length] as const);
    const after5 = await doc(pid5);
    const dur = (d: any) => Math.max(...d.sequences.seq_main.tracks.flatMap((t: any) => t.clips.map((c: any) => T.frameIndexAt(T.add(c.start, c.duration), R))));
    check('editor: "find silences" lists candidates without editing; "remove" applies them as one undoable step', found > 0 && dur(after5) < dur(before5), { found, framesBefore: dur(before5), framesAfter: dur(after5) });
    await page2.keyboard.press('Control+z');
    await page2.waitForFunction(async ([id, n]) => { const d = (await (await fetch(`/api/v1/projects/${id}`)).json()).project; return Math.max(...d.sequences.seq_main.tracks.flatMap((t: any) => t.clips.map((c: any) => Number(c.start.value) / c.start.timescale + Number(c.duration.value) / c.duration.timescale))) * 30 > (n as number) - 0.5; }, [pid5, dur(before5)] as const);
    check('editor: one Ctrl+Z restores every removed silence', dur(await doc(pid5)) === dur(before5));
    const addText = await call(`/projects/${pid5}/transactions`, { ops: [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60) } }] });
    const tid = addText.body.results[0].output.clipId;
    await page2.locator(`.clip[data-clip-id="${tid}"]`).click();
    await page2.getByTestId('animate-in').selectOption('pop');
    await page2.getByTestId('animate-apply').click();
    await page2.getByTestId('text-font').selectOption('Frank Ruhl Libre');
    await page2.waitForFunction(async ([id, c]) => { const d = (await (await fetch(`/api/v1/projects/${id}`)).json()).project; const clip = d.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === c); return !!clip?.keyframes?.scale && clip.style.fontFamily === 'Frank Ruhl Libre'; }, [pid5, tid] as const);
    await page2.screenshot({ path: path.join(art, 'editor-phase6b.png'), fullPage: false });
    check('editor: entrance preset writes keyframes on the selected title; font picker changes its family; no uncaught errors', errors2.length === 0, errors2.slice(0, 4));
    await page2.close();

    console.log('\n# agent (MCP)');
    const c = new Client({ name: 'phase6-script', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: bearer(s.auth.tokens.agent) } }));
    const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
    const names = (await c.listTools()).tools.map((t) => t.name);
    const gt = await tool('get_transcript', { projectId: pid, assetId });
    const heard = gt.data.segments[1].words;
    const cutByAgent = await tool('delete_transcript_range', { projectId: pid, assetId, fromWordId: heard[2].id, toWordId: heard[2].id });
    const exported = await tool('export_captions', { projectId: pid, format: 'vtt' });
    check('agent reads the transcript, deletes one word by id, and reads back captions without that word', ['get_transcript', 'export_captions', 'delete_transcript_range', 'correct_transcript', 'import_captions', 'cut_range', 'find_silences', 'animate_clip'].every((n) => names.includes(n)) && !gt.isError && !cutByAgent.isError && !/PULSEFRAME/.test(exported.data.text) && /סוף/.test(exported.data.text), { cut: cutByAgent.data?.results?.[0]?.summary ?? cutByAgent.data, cues: exported.data.cues });
    await c.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Synthetic transcript on a beep fixture. Speech recognition, forced alignment and real speech are not exercised.', passed: checks.length - failed.length, total: checks.length, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/phase6-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nPhase 6 proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
