/**
 * pnpm proof:qc — «בדיקה לפני ייצוא» (wave 8 qc; .artifacts/wave8/qc-plan.md §5 as corrected by qc-verify.md and decisions.md
 * "Batch C … qc"). B1 builds Q1–Q15 and Q17 here (core rules, server lines); the editor rows (Q16) are B2's, in
 * editor-interactions-proof.ts, read here from its evidence when it is recorded. Needs `pnpm build` (the exports render).
 * Corrections taken in: Q3 is held_past_picture (C1) on an ffmpeg fixture made here (10 s of video muxed with 12.5 s of tone, no
 * -shortest), not a hand-built document; Q5 is the after-export `fade_edge` bound only (faded_out is CUT, C4/C9); Q11 checks the
 * USER-VISIBLE strings (sheet, card, i18n rows), not the API's `ok`/`verdict` fields (C7); Q12 has no PNG line (cut); no `there`.
 * Every rule is report only: no qc code blocks an export or an agent (owner decision 2026-11-26, autonomy first).
 * Fixtures are SYNTHETIC only, made at proof time (the barcode video of @pulseframe/fixtures with its beeps, ffmpeg lavfi pictures
 * and tones, a typed word-timed transcript) and deleted at the end. Nobody here can look or listen: every check is a measurement,
 * every rule a rule of thumb. A server is started with startServer on port 0 and its own data directory.
 *
 * Exit codes: 0 = every check that could run passed; 1 = a check failed; 2 = a check is blocked (listed with its reason).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { createProject, creativeProjection, documentChecks, type MediaClip } from '@pulseframe/core';
import { startServer } from '@pulseframe/server';
import { f, makeApi, makeSource, type Api } from './incremental-fixtures.ts';
import { evidenceRows } from './send-evidence.ts';

export const QC_PROOF_BUILT = true;
export const QC_CHECKS: Readonly<Record<string, string>> = {
  Q1: 'a 2-frame clip of a.mp4 between two longer clips gives exactly one flash_clip with measured {frames: 2, minFrames: 3}, its range and no fix',
  Q2: 'a 4-frame clip elsewhere gives no flash_clip',
  Q3: 'a clip of the ffmpeg file whose sound runs 2.5 s past its last picture gives one held_past_picture note with heldFrames 75; its picture-only fix (includeLinked false) removes it and one undo restores the document hash; after export the frozen finding there is explained picture_ends (C1, C14)',
  Q4: 'a title under a full-frame opaque video for its whole length gives one title_hidden; moved to a track above, none; under a chroma-keyed or shaken cover, none (C3)',
  Q5: 'an opacity fade to 0 over the last 0.7 s gives, after export, one black finding at the end explained fade_edge; a 20 s black clip after a fade is not explained (C9)',
  Q6: 'a dip-black transition of 20 frames leaves no unexplained black finding after export (a render-found one is dip_transition)',
  Q7: 'a 3-s freeze frame (add_clip freeze: true) gives no frozen finding and its silence is freeze_hold; a still photo with a motion preset for 4 s gives no frozen finding',
  Q8: 'a 3.2-s hole between two tone clips: the sheet\'s measurement (the route with the variantId of a format and with a short\'s sequenceId, and without) lists one silence with soundPlays false, and the export lists the same range (± one 0.1 s block)',
  Q9: 'a tone clip at +12 dB gives one clipped finding before export and the same after',
  Q10: 'the film ending inside a transcript word gives one ends_mid_word; a cut on a word edge mid-film none; a cut 2 frames inside a word one cut_mid_word note; a fadeOut at the end and a razor split are excused; segment timing is skipped and named (C5)',
  Q11: 'a clean control project (same media, no plant) has zero qc issues; no USER-VISIBLE string of the sheet\'s section, the file card or the qc i18n rows matches /fine|ok|pass|clean|תקין|עבר/ as a word (C7)',
  Q12: 'the WAV export of the planted project has checks.sound measured and checks.picture not_measured with its reason; a browser-route export stores not_measured on both with the route reason',
  Q13: 'fast export: after a one-clip edit, findings and their explained equal those of a single-pass export of the same revision',
  Q14: 'preflight with a variantId and with a short\'s sequenceId lists each qc issue in that output\'s own frames',
  Q15: 'MCP preflight and get_job (agent credential, observe) return the codes, frame ranges, measured numbers and clip ids, and no transcript word in any message (C5)',
  Q16: 'editor (Chromium, B2\'s rows of editor-interactions-proof): the count line in Hebrew, «מעבר לקטע» on flash_clip lands on its first frame, the file card folds «יש לזה הסבר בעריכה (n)», Tab reaches every jump, English shows the same keys',
  Q17: 'timing: documentChecks on a synthetic 10-minute, 600-clip document — one sample recorded, not gated',
};

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/qc-proof');
const R = { num: 30, den: 1 };

interface Check { id: string; name: string; pass: boolean | null; numbers: unknown; blocked?: string }
const checks: Check[] = [];
function check(id: string, pass: boolean, numbers: unknown = {}) { checks.push({ id, name: QC_CHECKS[id] ?? id, pass, numbers }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${QC_CHECKS[id] ?? ''}  ${JSON.stringify(numbers).slice(0, pass ? 500 : 2000)}`); }
function blocked(id: string, why: string) { checks.push({ id, name: QC_CHECKS[id] ?? id, pass: null, numbers: {}, blocked: why }); console.log(`BLOCKED  ${id}: ${why}`); }
function finish(): never {
  const failed = checks.filter((c) => c.pass === false), blockedN = checks.filter((c) => c.pass === null);
  fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.artifacts/qc-proof.json'), JSON.stringify({ checks }, null, 1));
  console.log(`\nqc-proof: ${checks.filter((c) => c.pass).length} passed, ${failed.length} failed, ${blockedN.length} blocked`);
  fs.rmSync(art, { recursive: true, force: true });
  process.exit(failed.length ? 1 : blockedN.length ? 2 : 0);
}
const ff = (args: string[]) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };
const framesOf = (x: { from: T.RationalTime; to: T.RationalTime }) => [T.frameIndexAt(x.from, R), T.frameIndexAt(x.to, R)] as const;
const sec = (t: T.RationalTime) => T.toSeconds(t);
const qcOf = (rep: any, code: string) => ((rep?.issues ?? []) as any[]).filter((i) => i.code === code);
const QC = ['flash_clip', 'held_past_picture', 'title_hidden', 'ends_mid_word', 'cut_mid_word'];

async function exportAndWait(api: Api, pid: string, options: unknown) {
  const r = await api.call(`/projects/${pid}/exports`, options);
  if (r.status !== 202) throw new Error(`export refused ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  return api.waitJob(r.body.jobId, 20 * 60_000);
}
const newProject = async (api: Api, name: string, w = 640, h = 360) => (await api.call('/projects', { name, width: w, height: h })).body.project.id as string;
const out = (r: any, k = 0) => r.results[k].output;
const preflight = async (api: Api, pid: string, q = '') => (await api.call(`/projects/${pid}/preflight${q}`)).body;

async function main() {
  // ---- Q17: in-process, no server ----
  {
    const doc = createProject({ id: 'prj_q17', name: 'q17', width: 640, height: 360 });
    doc.assets.a = { id: 'a', kind: 'video', name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(18300, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 18000 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: { origin: 'fixture', importedAt: '2026-11-26T00:00:00Z', importedBy: 'proof' } };
    const v1 = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!;
    for (let k = 0; k < 600; k++) v1.clips.push({ id: `c${k}`, type: 'media', assetId: 'a', start: f(k * 30), duration: f(30), sourceIn: f((k * 30) % 17000), gain: 1, linkGroupId: null, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } } as MediaClip);
    const t0 = performance.now();
    const r = documentChecks(doc);
    const ms = performance.now() - t0;
    check('Q17', r.built === true, { ms: Number(ms.toFixed(1)), clips: 600, frames: 18000, issues: r.issues.length, note: 'one sample, not gated' });
  }
  // ---- Q16: B2's editor rows, read from their evidence ----
  {
    const e = evidenceRows('editor-interactions-proof.json', /^Q16 /, 'pnpm proof:editor-interactions');
    if (e.state === 'blocked') blocked('Q16', `B2's rows: ${e.reason}`);
    else if (e.state === 'fail' && !e.rows.length) blocked('Q16', `B2's editor rows (Q16 …) are not in the recorded evidence yet: ${e.reason}`);
    else check('Q16', e.state === 'pass', e);
  }
  // ---- Q11 strings (no server) ----
  {
    const files = ['apps/web/src/editor/exportSheet.strings.ts', 'packages/i18n/src/qc.ts', 'apps/web/src/editor/send/ChecksResult.tsx'].map((p) => path.join(root, p)).filter((p) => fs.existsSync(p));
    const literals = files.flatMap((p) => [...fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => ({ file: path.relative(root, p), s: m[1] ?? m[2] ?? '' })))
      .filter((x) => /[֐-׿]/.test(x.s) || / /.test(x.s)); // words people read (Hebrew, or English with a space), not keys or class names
    const judge = /(^|[^\p{L}])(fine|ok|pass|passed|clean|תקין|תקינה|עבר)(?=[^\p{L}]|$)/iu;
    const bad = literals.filter((x) => judge.test(x.s));
    globalThis.__q11strings = { files: files.map((p) => path.relative(root, p)), literals: literals.length, bad };
  }
  const webBuilt = fs.existsSync(path.join(root, 'apps/web/dist/render.html'));
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const barcode = await makeSource(path.join(art, 'barcode-600.mp4'), 600);
  const phone = path.join(art, 'phone.mp4'), still = path.join(art, 'still.png'), tone = path.join(art, 'tone.wav'), loudWav = path.join(art, 'loud.wav'), blackMp4 = path.join(art, 'black.mp4');
  // C1's fixture: 10 s of moving picture muxed with 12.5 s of tone, no -shortest: the sound runs on after the last picture
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=10', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12.5', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', phone]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1', still]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20', '-af', 'volume=0.3', '-ac', '2', '-c:a', 'pcm_s16le', tone]);
  // 0.5 s of a near-full-scale square wave (the recipe of proof:send K1s), played at gain 4 (+12 dB)
  ff(['-f', 'lavfi', '-i', 'aevalsrc=if(lt(mod(t*200\\,1)\\,0.5)\\,0.999\\,-0.999):s=48000:d=0.5', '-ac', '2', '-c:a', 'pcm_s16le', loudWav]);
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=20', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', blackMp4]);

  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const api = makeApi(s.url, s.auth.tokens.agent);
  try {
    // ================= document rules (preflight; no render) =================
    // ---- Q1, Q2, Q14: P1 ----
    const p1 = await newProject(api, 'qc P1 flash');
    const A1 = (await api.upload(p1, barcode)).assetId;
    const placed1 = await api.tx(p1, [
      { op: 'add_clip', args: { assetId: A1, start: f(0), sourceIn: f(0), duration: f(60) } },
      { op: 'add_clip', args: { assetId: A1, start: f(60), sourceIn: f(100), duration: f(2) } },
      { op: 'add_clip', args: { assetId: A1, start: f(62), sourceIn: f(200), duration: f(60) } },
      { op: 'add_clip', args: { assetId: A1, start: f(122), sourceIn: f(300), duration: f(4) } },
      { op: 'add_clip', args: { assetId: A1, start: f(126), sourceIn: f(400), duration: f(60) } },
    ]);
    const short = out(placed1, 1).clipId;
    const rep1 = await preflight(api, p1);
    const fl = qcOf(rep1, 'flash_clip');
    check('Q1', fl.length === 1 && fl[0].ids[0] === short && fl[0].measured.frames === 2 && fl[0].measured.minFrames === 3 && fl[0].range.startFrame === 60 && fl[0].range.endFrame === 62 && !fl[0].fix && fl[0].severity === 'warning', { flash: fl });
    check('Q2', !fl.some((i: any) => i.range.startFrame === 122), { flashRanges: fl.map((i: any) => i.range) });
    {
      const v = await api.tx(p1, [{ op: 'add_variant', args: { name: 'square', width: 360, height: 360, fit: 'cover' } }]);
      const variantId = out(v).variantId as string;
      const sq = await api.tx(p1, [{ op: 'add_sequence', args: { name: 'short' } }]);
      const so = out(sq);
      await api.tx(p1, [
        { op: 'add_clip', args: { sequenceId: so.sequenceId, assetId: A1, trackId: so.videoTrackId, start: f(0), sourceIn: f(0), duration: f(10), withLinkedAudio: false } },
        { op: 'add_clip', args: { sequenceId: so.sequenceId, assetId: A1, trackId: so.videoTrackId, start: f(10), sourceIn: f(100), duration: f(2), withLinkedAudio: false } },
        { op: 'add_clip', args: { sequenceId: so.sequenceId, assetId: A1, trackId: so.videoTrackId, start: f(12), sourceIn: f(200), duration: f(30), withLinkedAudio: false } },
      ]);
      const rv = qcOf(await preflight(api, p1, `?variant=${variantId}`), 'flash_clip'), rs = qcOf(await preflight(api, p1, `?sequence=${so.sequenceId}`), 'flash_clip');
      check('Q14', rv.length === 1 && rv[0].range.startFrame === 60 && rs.length === 1 && rs[0].range.startFrame === 10 && rs[0].range.endFrame === 12, { variant: rv.map((i: any) => i.range), short: rs.map((i: any) => i.range) });
    }
    // ---- Q3 (document half): P3 ----
    {
      const p3 = await newProject(api, 'qc P3 held');
      const P = (await api.upload(p3, phone)).assetId;
      const asset = (await api.call(`/projects/${p3}`)).body.project.assets[P];
      await api.tx(p3, [{ op: 'add_clip', args: { assetId: P, start: f(0) } }]);
      const h = qcOf(await preflight(api, p3), 'held_past_picture');
      const before = creativeProjection((await api.call(`/projects/${p3}`)).body.project);
      const fixOps = h[0]?.fix?.ops ?? [];
      let fixedHeld: any[] = ['not applied'], undone = false;
      if (fixOps.length) {
        await api.tx(p3, fixOps);
        fixedHeld = qcOf(await preflight(api, p3), 'held_past_picture');
        await api.call(`/projects/${p3}/undo`, {});
        undone = creativeProjection((await api.call(`/projects/${p3}`)).body.project) === before;
      }
      globalThis.__q3doc = { pass: h.length === 1 && h[0].severity === 'note' && h[0].measured.heldFrames === 75 && h[0].range.startFrame === 300 && fixOps[0]?.args?.includeLinked === false && fixedHeld.length === 0 && undone,
        numbers: { asset: { frameCount: asset?.video?.frameCount, duration: asset && sec(asset.duration) }, held: h.map((i: any) => ({ range: i.range, measured: i.measured, fix: i.fix })), afterFix: fixedHeld.length, undoRestoresHash: undone } };
    }
    // ---- Q4: P4 ----
    {
      const p4 = await newProject(api, 'qc P4 title');
      const S = (await api.upload(p4, still)).assetId;
      const t = await api.tx(p4, [{ op: 'add_text', args: { text: 'כותרת', start: f(30), duration: f(60) } }, { op: 'add_track', args: { kind: 'video' } }]);
      const coverTrack = out(t, 1).trackId;
      const c = await api.tx(p4, [{ op: 'add_clip', args: { assetId: S, trackId: coverTrack, start: f(0), duration: f(120) } }]);
      const tracks = (await api.call(`/projects/${p4}`)).body.project.sequences;
      const seqId = Object.keys(tracks).find((k) => tracks[k].tracks.some((x: any) => x.id === coverTrack))!;
      const top = tracks[seqId].tracks.length - 1;
      await api.tx(p4, [{ op: 'move_track', args: { trackId: coverTrack, toIndex: top } }]);
      const hidden = qcOf(await preflight(api, p4), 'title_hidden');
      const coverClip = out(c).clipId;
      await api.tx(p4, [{ op: 'add_effect', args: { clipId: coverClip, type: 'key.chroma' } }]);
      const keyed = qcOf(await preflight(api, p4), 'title_hidden');
      await api.call(`/projects/${p4}/undo`, {});
      await api.tx(p4, [{ op: 'add_effect', args: { clipId: coverClip, type: 'motion.shake' } }]);
      const shaken = qcOf(await preflight(api, p4), 'title_hidden');
      await api.call(`/projects/${p4}/undo`, {});
      await api.tx(p4, [{ op: 'move_track', args: { trackId: coverTrack, toIndex: 0 } }]);
      const below = qcOf(await preflight(api, p4), 'title_hidden');
      check('Q4', hidden.length === 1 && hidden[0].ids[0] === out(t).clipId && hidden[0].ids.includes(coverClip) && keyed.length === 0 && shaken.length === 0 && below.length === 0, { hidden: hidden.map((i: any) => ({ ids: i.ids, range: i.range })), keyed: keyed.length, shaken: shaken.length, coverBelow: below.length });
    }
    // ---- Q10, Q15: P10 (a typed word-timed transcript: a word of 0.3 s every 0.4 s on the file's clock) ----
    const p10 = await newProject(api, 'qc P10 words');
    const W = (await api.upload(p10, barcode)).assetId;
    const typed = Array.from({ length: 50 }, (_, k) => ({ text: `מילה${k}`, start: T.rt(4 * k, 10), duration: T.rt(3, 10) }));
    await api.tx(p10, [{ op: 'set_transcript', args: { assetId: W, language: 'he', segments: [{ start: T.ZERO, duration: T.rt(20, 1), text: typed.map((w) => w.text).join(' '), words: typed }] } }]);
    // c1 [0, 62) from 0: ends at 2.0667 s, 2 frames inside the word [2.0, 2.3) → cut_mid_word · c2 [62, 122) from 10.0 s to 12.0 s: both
    // edges on word starts · c3 [122, 186) from 12.0 s to 14.1333 s: the film ends 4 frames inside the word [14.0, 14.3) → ends_mid_word
    const w3 = await api.tx(p10, [
      { op: 'add_clip', args: { assetId: W, start: f(0), sourceIn: f(0), duration: f(62) } },
      { op: 'add_clip', args: { assetId: W, start: f(62), sourceIn: f(300), duration: f(60) } },
      { op: 'add_clip', args: { assetId: W, start: f(122), sourceIn: f(360), duration: f(64) } },
    ]);
    const r10 = await preflight(api, p10);
    const ends = qcOf(r10, 'ends_mid_word'), cuts = qcOf(r10, 'cut_mid_word');
    const sound3 = out(w3, 2).audioClipId as string, sound2 = out(w3, 1).audioClipId as string;
    await api.tx(p10, [{ op: 'set_clip_fades', args: { clipId: sound3, fadeOut: f(6) } }]);
    const faded = qcOf(await preflight(api, p10), 'ends_mid_word');
    await api.call(`/projects/${p10}/undo`, {});
    await api.tx(p10, [{ op: 'split_clip', args: { clipId: sound2, at: f(80) } }]); // 0.6 s into c2: inside a word, a razor split of the same source
    const afterSplit = qcOf(await preflight(api, p10), 'cut_mid_word');
    await api.call(`/projects/${p10}/undo`, {});
    // segment timing: the same transcript without word times
    const pSeg = await newProject(api, 'qc P10 segment');
    const Ws = (await api.upload(pSeg, barcode)).assetId;
    await api.tx(pSeg, [{ op: 'set_transcript', args: { assetId: Ws, language: 'he', segments: [{ start: T.ZERO, duration: T.rt(20, 1), text: 'בלי זמני מילים' }] } }, { op: 'add_clip', args: { assetId: Ws, start: f(0), sourceIn: f(360), duration: f(64) } }]);
    const segDoc = (await api.call(`/projects/${pSeg}`)).body.project;
    const segChecks = documentChecks(segDoc);
    check('Q10', ends.length === 1 && ends[0].severity === 'warning' && ends[0].measured.wordStartMs === 14000 && ends[0].measured.wordEndMs === 14300 && cuts.length === 1 && cuts[0].severity === 'note' && cuts[0].measured.wordStartMs === 2000
      && faded.length === 0 && afterSplit.length === 1 && segChecks.issues.filter((i) => i.code.endsWith('mid_word')).length === 0 && segChecks.skipped.some((x) => x.reason === 'segment_timing'),
      { ends: ends.map((i: any) => ({ range: i.range, measured: i.measured })), cuts: cuts.map((i: any) => ({ range: i.range, measured: i.measured })), withFadeOut: faded.length, afterRazorSplit: afterSplit.length, segment: { issues: segChecks.issues.length, skipped: segChecks.skipped } });
    // ---- Q11 (document half): P11, the same media and no plant ----
    {
      const p11 = await newProject(api, 'qc P11 clean');
      const C = (await api.upload(p11, barcode)).assetId;
      await api.tx(p11, [
        { op: 'add_clip', args: { assetId: C, start: f(0), sourceIn: f(0), duration: f(120) } },
        { op: 'add_clip', args: { assetId: C, start: f(120), sourceIn: f(200), duration: f(120) } },
        { op: 'add_text', args: { text: 'שלום', start: f(30), duration: f(60) } },
      ]);
      const r = await preflight(api, p11);
      const qc = (r.issues as any[]).filter((i) => QC.includes(i.code));
      const st = (globalThis as any).__q11strings;
      check('Q11', qc.length === 0 && st.bad.length === 0 && st.files.length === 3, { qcIssues: qc, strings: { files: st.files, literalsRead: st.literals, judging: st.bad } });
    }
    // ================= sound before and after export (WAV; no picture render) =================
    // ---- Q8, Q12 (WAV): P8 ----
    let wavJob: any = null;
    {
      const p8 = await newProject(api, 'qc P8 hole');
      const Tn = (await api.upload(p8, tone)).assetId;
      await api.tx(p8, [{ op: 'add_clip', args: { assetId: Tn, start: f(0), duration: f(30) } }, { op: 'add_clip', args: { assetId: Tn, start: f(126), duration: f(30) } }]);
      const v = out(await api.tx(p8, [{ op: 'add_variant', args: { name: 'square', width: 360, height: 360, fit: 'cover' } }])).variantId;
      const so = out(await api.tx(p8, [{ op: 'add_sequence', args: { name: 'short' } }]));
      await api.tx(p8, [{ op: 'add_clip', args: { sequenceId: so.sequenceId, assetId: Tn, trackId: so.audioTrackId, start: f(0), duration: f(30) } }, { op: 'add_clip', args: { sequenceId: so.sequenceId, assetId: Tn, trackId: so.audioTrackId, start: f(126), duration: f(30) } }]);
      const silences = async (body: unknown) => { const r = await api.call(`/projects/${p8}/analysis/loudness`, body); return ((r.body?.soundChecks?.findings ?? []) as any[]).filter((x) => x.kind === 'silence'); };
      const [main, variant, shortS] = [await silences({}), await silences({ variantId: v }), await silences({ sequenceId: so.sequenceId })];
      wavJob = await exportAndWait(api, p8, { format: 'wav' });
      const exp = ((wavJob.output?.checks?.sound?.findings ?? []) as any[]).filter((x) => x.kind === 'silence');
      const one = (xs: any[]) => xs.length === 1 && xs[0].soundPlays === false && Math.abs(sec(xs[0].from) - 1) <= 0.1 && Math.abs(sec(xs[0].to) - 4.2) <= 0.1;
      const same = (a: any[], b: any[]) => a.length === 1 && b.length === 1 && Math.abs(sec(a[0].from) - sec(b[0].from)) <= 0.1 && Math.abs(sec(a[0].to) - sec(b[0].to)) <= 0.1;
      const show = (xs: any[]) => xs.map((x) => ({ from: sec(x.from), to: sec(x.to), soundPlays: x.soundPlays }));
      check('Q8', one(main) && one(variant) && one(shortS) && one(exp) && same(main, exp), { main: show(main), variant: show(variant), short: show(shortS), export: show(exp) });
      const bstart = await api.call(`/projects/${p8}/exports/browser`, { sessionId: 'session-qc-proof' });
      let browserChecks: any = null;
      if (bstart.status === 201) {
        await api.call(`/jobs/${bstart.body.jobId}/complete`, { sessionId: 'session-qc-proof', bytes: 10, sha256: 'a'.repeat(64), videoCodec: 'avc', audioCodec: 'opus', frames: bstart.body.manifest.output.frames, container: 'mp4' });
        browserChecks = (await api.call(`/jobs/${bstart.body.jobId}`)).body.output?.checks ?? null;
      }
      const wc = wavJob.output?.checks;
      check('Q12', wavJob.status === 'succeeded' && wc?.sound?.status === 'measured' && wc?.picture?.status === 'not_measured' && /no picture/.test(wc?.picture?.method ?? '')
        && browserChecks?.picture?.status === 'not_measured' && browserChecks?.sound?.status === 'not_measured' && /^browser route/.test(browserChecks?.picture?.method ?? '') && /^browser route/.test(browserChecks?.sound?.method ?? ''),
        { wav: wc && { picture: wc.picture, sound: { status: wc.sound.status, findings: wc.sound.findings.length } }, browserStart: bstart.status, browser: browserChecks && { picture: browserChecks.picture, sound: browserChecks.sound } });
    }
    // ---- Q15 (MCP, agent credential) on P10 and a finished job ----
    {
      let rpc = 0;
      const tool = async (name: string, args: Record<string, unknown>) => {
        const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) });
        const text = await r.text();
        const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
        return msg.result?.isError ? { error: msg.result.content?.[0]?.text } : JSON.parse(msg.result.content[0].text);
      };
      const pre = await tool('preflight', { projectId: p10 });
      const qc = ((pre.issues ?? []) as any[]).filter((i) => QC.includes(i.code));
      const job = await tool('get_job', { jobId: wavJob.id });
      const quoted = qc.filter((i) => typed.some((w) => i.message.includes(w.text)));
      check('Q15', qc.length >= 2 && qc.every((i) => Array.isArray(i.ids) && i.ids.length && typeof i.range?.startFrame === 'number' && i.measured && Object.keys(i.measured).length) && quoted.length === 0 && job?.output?.checks?.sound?.status === 'measured',
        { codes: qc.map((i) => i.code), sample: qc[0], quoted: quoted.length, jobChecks: job?.output?.checks ? Object.keys(job.output.checks) : job });
    }
    // ================= after export (picture renders) =================
    if (!webBuilt) {
      for (const id of ['Q3', 'Q5', 'Q6', 'Q7', 'Q9', 'Q13']) blocked(id, 'the web bundle is not built here (run pnpm build): no picture export can render');
      return;
    }
    // ---- Q3 (export half): E1, the held tail after export ----
    {
      const e1 = await newProject(api, 'qc E1 held');
      const P = (await api.upload(e1, phone)).assetId;
      await api.tx(e1, [{ op: 'add_clip', args: { assetId: P, start: f(0), sourceIn: f(210), duration: f(165) } }]);
      const pre = qcOf(await preflight(api, e1), 'held_past_picture');
      const job = await exportAndWait(api, e1, { quality: 'draft' });
      const frozen = ((job.output?.checks?.picture?.findings ?? []) as any[]).filter((x) => x.kind === 'frozen');
      const d = (globalThis as any).__q3doc;
      check('Q3', d.pass && pre.length === 1 && pre[0].range.startFrame === 90 && job.status === 'succeeded' && frozen.length === 1 && frozen[0].explained === 'picture_ends',
        { document: d.numbers, export: { held: pre.map((i: any) => i.range), frozen: frozen.map((x) => ({ frames: framesOf(x), explained: x.explained ?? null })), status: job.status, error: job.error } });
    }
    // ---- Q5–Q7, Q9, Q13: E2 ----
    {
      const e2 = await newProject(api, 'qc E2');
      const A = (await api.upload(e2, barcode)).assetId, S = (await api.upload(e2, still)).assetId, Tn = (await api.upload(e2, tone)).assetId, L = (await api.upload(e2, loudWav)).assetId;
      const v = await api.tx(e2, [
        { op: 'add_clip', args: { assetId: A, start: f(0), sourceIn: f(0), duration: f(90), withLinkedAudio: false } },
        { op: 'add_clip', args: { assetId: A, start: f(90), sourceIn: f(300), duration: f(90), withLinkedAudio: false } },
        { op: 'add_clip', args: { assetId: A, start: f(180), sourceIn: f(100), duration: f(90), freeze: true } },
        { op: 'add_clip', args: { assetId: S, start: f(270), duration: f(120) } },
        { op: 'add_clip', args: { assetId: A, start: f(390), sourceIn: f(500), duration: f(60), withLinkedAudio: false } },
        { op: 'add_clip', args: { assetId: Tn, start: f(0), duration: f(180) } },
        { op: 'add_clip', args: { assetId: Tn, start: f(270), duration: f(180) } },
      ]);
      const [, second, , photo, last, , tone2] = [0, 1, 2, 3, 4, 5, 6].map((k) => out(v, k).clipId as string);
      await api.tx(e2, [
        { op: 'set_transition', args: { clipId: second, type: 'dip-black', frames: 20 } },
        { op: 'apply_motion_preset', args: { clipId: photo, presetId: 'motion.move.ken-burns-in' } },
      ]);
      // the last 1.4 s: opacity 1 at local 18, 0 at local 39 (a fade over 0.7 s), held 0 to the end (local 60)
      await api.tx(e2, [{ op: 'set_keyframe', args: { clipId: last, property: 'opacity', time: f(18), value: 1 } }, { op: 'set_keyframe', args: { clipId: last, property: 'opacity', time: f(39), value: 0 } }]);
      const lt = await api.tx(e2, [{ op: 'add_track', args: { kind: 'audio' } }]);
      const loudClip = out(await api.tx(e2, [{ op: 'add_clip', args: { assetId: L, trackId: out(lt).trackId, start: f(400), duration: f(15) } }])).clipId;
      await api.tx(e2, [{ op: 'set_clip_gain', args: { clipId: loudClip, gain: 4 } }]);
      const before = await api.call(`/projects/${e2}/analysis/loudness`, {});
      const clippedBefore = ((before.body?.soundChecks?.findings ?? []) as any[]).filter((x) => x.kind === 'clipped');
      const inc1 = await exportAndWait(api, e2, { quality: 'draft', mode: 'incremental' });
      await api.tx(e2, [{ op: 'set_clip_gain', args: { clipId: tone2, gain: 0.9 } }]); // the one-clip edit (Q13)
      const inc2 = await exportAndWait(api, e2, { quality: 'draft', mode: 'incremental' });
      const single = await exportAndWait(api, e2, { quality: 'draft' });
      const c = single.output?.checks;
      const pic = (c?.picture?.findings ?? []) as any[], snd = (c?.sound?.findings ?? []) as any[];
      const blacks = pic.filter((x) => x.kind === 'black'), frozen = pic.filter((x) => x.kind === 'frozen');
      const endBlack = blacks.filter((x) => framesOf(x)[1] === 450);
      const show = (xs: any[]) => xs.map((x) => ({ kind: x.kind, frames: x.kind === 'black' || x.kind === 'frozen' ? framesOf(x) : [sec(x.from), sec(x.to)], explained: x.explained ?? null, context: x.context }));
      // Q5's negative half: E3, a fade to 0 and then a 20 s black clip (320×180 to keep the render small)
      const e3 = await newProject(api, 'qc E3', 320, 180);
      const A3 = (await api.upload(e3, barcode)).assetId, B3 = (await api.upload(e3, blackMp4)).assetId;
      const v3 = await api.tx(e3, [{ op: 'add_clip', args: { assetId: A3, start: f(0), duration: f(60), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: B3, start: f(60), duration: f(600), withLinkedAudio: false } }]);
      await api.tx(e3, [{ op: 'set_keyframe', args: { clipId: out(v3).clipId, property: 'opacity', time: f(18), value: 1 } }, { op: 'set_keyframe', args: { clipId: out(v3).clipId, property: 'opacity', time: f(39), value: 0 } }]);
      const j3 = await exportAndWait(api, e3, { quality: 'draft' });
      const b3 = ((j3.output?.checks?.picture?.findings ?? []) as any[]).filter((x) => x.kind === 'black');
      check('Q5', single.status === 'succeeded' && endBlack.length === 1 && endBlack[0].explained === 'fade_edge' && j3.status === 'succeeded' && b3.length >= 1 && b3.every((x) => !x.explained) && b3.some((x) => framesOf(x)[1] === 660),
        { e2: show(blacks), e3: show(b3), e3status: j3.status });
      const inDip = blacks.filter((x) => framesOf(x)[0] < 110 && framesOf(x)[1] > 90);
      check('Q6', inDip.every((x) => x.explained === 'dip_transition'), { inDip: show(inDip) });
      const frozenThere = frozen.filter((x) => framesOf(x)[0] < 390 && framesOf(x)[1] > 180);
      const sil = snd.filter((x) => x.kind === 'silence');
      check('Q7', frozenThere.length === 0 && sil.length === 1 && sil[0].explained === 'freeze_hold' && Math.abs(sec(sil[0].from) - 6) <= 0.1 && Math.abs(sec(sil[0].to) - 9) <= 0.1, { frozen: show(frozen), silence: show(sil) });
      const clippedAfter = snd.filter((x) => x.kind === 'clipped');
      check('Q9', clippedBefore.length === 1 && clippedAfter.length === 1 && Math.abs(sec(clippedBefore[0].from) - sec(clippedAfter[0].from)) <= 0.1 && Math.abs(sec(clippedAfter[0].from) - 400 / 30) <= 0.1, { before: show(clippedBefore), after: show(clippedAfter) });
      const strip = (ch: any) => JSON.stringify({ picture: ch?.picture?.findings, sound: ch?.sound?.findings });
      check('Q13', inc1.status === 'succeeded' && inc2.status === 'succeeded' && single.status === 'succeeded' && inc2.output?.route !== single.output?.route && strip(inc2.output?.checks) === strip(c) && [...pic, ...snd].some((x) => x.explained),
        { routes: [inc2.output?.route, single.output?.route], reused: inc2.output?.segments?.reused ?? inc2.output?.segments, equal: strip(inc2.output?.checks) === strip(c), incremental: show([...(inc2.output?.checks?.picture?.findings ?? []), ...(inc2.output?.checks?.sound?.findings ?? [])]) });
    }
  } finally {
    await s.close();
  }
}

declare global { var __q11strings: any; var __q3doc: any }
main().then(finish, (e) => { console.error(e); checks.push({ id: 'run', name: 'the proof ran to the end', pass: false, numbers: { error: String(e?.stack ?? e).slice(0, 2000) } }); finish(); });
