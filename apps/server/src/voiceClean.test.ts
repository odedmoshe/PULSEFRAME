/**
 * measure_voice (ADR-0013, voiceClean.ts) with real ffmpeg on synthetic files written here: a "recording" of speech-like harmonic
 * phrases with 30 % pauses, white noise at −50 dBFS (so every band of the noise profile is −50 dB) and 50 Hz mains hum (k = 1..4,
 * −40 dBFS in all). The route is read-only; its candidate ops, sent as one transaction, put the three cleanup effects on the clip
 * in their fixed order and keep its other effects, and one undo restores the project exactly.
 *
 * Two kinds of test:
 *  - the server's own plumbing (decoding, sound-clip resolution, scopes, ranges, ops) runs with a LABELLED TEST-ONLY stand-in for
 *    the meter (testMeter below), so it does not depend on what the engine measures;
 *  - what is measured (bands, hum, the job, the speed) uses the engine's voiceMeter (W1). In a tree where that is still the
 *    contracts placeholder ('not implemented'), those tests are skipped and say so.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffEntities, encodeNoiseProfile, findClip, type MediaClip } from '@pulseframe/core';
import { voiceMeter, type VoiceMeasureOptions, type VoiceMeasurement } from '@pulseframe/engine';
import { startServer, type RunningServer } from './index.ts';
import { measureVoiceCheckWith, toPushed, toSource, voiceWindows, type VoiceCheck, type VoiceMeasureDeps } from './voiceClean.ts';

const SR = 48000;
/** Whether the engine's meter is implemented in this tree (it is a placeholder until W1's voiceMeasure.ts lands). */
const METER_READY = (() => { try { voiceMeter(); return true; } catch (e) { if (/not implemented/.test(String(e))) return false; throw e; } })();
const NEEDS_METER = METER_READY ? '' : ' [SKIPPED here: the engine voiceMeter is still the contracts placeholder]';

/** Deterministic Gaussian noise (xorshift32 + Box–Muller). */
function gaussian(seed: number) {
  let s = seed >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
/**
 * The synthetic recording, 48 kHz stereo 16-bit WAV: speech-like phrases (a 130 Hz harmonic complex shaped by three formants,
 * syllables at 4 Hz, −20 dBFS RMS) in the first 2.1 s of every 3 s, the last 0.9 s a pause (30 % pauses, each long enough for the
 * meter's 341 ms low-band frames); white noise at `noiseDb` dBFS RMS per
 * channel (independent L/R) throughout; mains hum at 50·k Hz, k = 1..4, `humDb` dBFS RMS in all (none when null).
 */
function recording(seconds: number, opts: { noiseDb?: number; humDb?: number | null; seed?: number } = {}): Buffer {
  const n = Math.round(seconds * SR), noiseAmp = 10 ** ((opts.noiseDb ?? -50) / 20), humDb = opts.humDb === undefined ? -40 : opts.humDb;
  const humAmp = humDb === null ? 0 : Math.sqrt((2 * 10 ** (humDb / 10)) / 4);
  const gl = gaussian(opts.seed ?? 1), gr = gaussian((opts.seed ?? 1) + 1000);
  const H = 12, f0 = 130, form = [700, 1200, 2600];
  const w = Array.from({ length: H }, (_, h) => form.reduce((s, f) => s + 1 / (1 + (((h + 1) * f0 - f) / 150) ** 2), 0.05));
  const norm = Math.sqrt(w.reduce((s, x) => s + (x * x) / 2, 0)), speechAmp = 10 ** (-20 / 20) / norm;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR, inCycle = t % 3;
    const env = inCycle < 2.1 ? Math.min(1, inCycle / 0.01, (2.1 - inCycle) / 0.01) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t) ** 2) : 0;
    let v = 0;
    if (env > 0) for (let h = 0; h < H; h++) v += w[h]! * Math.sin(2 * Math.PI * (h + 1) * f0 * t);
    let hum = 0;
    for (let k = 1; k <= 4; k++) hum += humAmp * Math.sin(2 * Math.PI * 50 * k * t);
    const l = env * speechAmp * v + hum + noiseAmp * gl(), r = env * speechAmp * v + hum + noiseAmp * gr();
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), 44 + i * 4);
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), 46 + i * 4);
  }
  return b;
}

/**
 * TEST-ONLY stand-in for the engine's voiceMeter, to check the server's plumbing alone (labelled; never used outside this file):
 * it reports the mean power of what it was given as every band, a hum at 50 Hz when told to, and echoes the noise ranges it was
 * given (or one range at 1–2 s of the pushed stream), so the conversion of ranges can be checked. It measures nothing real.
 */
function testMeter(log: { opts?: VoiceMeasureOptions; frames: number }, hum: boolean): VoiceMeasureDeps {
  return {
    recommend: () => 0.5,
    meter: (opts) => {
      log.opts = opts; log.frames = 0;
      let e = 0, peak = 0;
      return {
        push(pcm) { log.frames += pcm.length / 2; for (const v of pcm) { e += v * v; peak = Math.max(peak, Math.abs(v)); } },
        finish(): VoiceMeasurement {
          const db = Math.max(-140, 10 * Math.log10(e / Math.max(1, log.frames * 2)));
          const bands = Array<number>(24).fill(Number(db.toFixed(2)));
          return { analysedSeconds: log.frames / SR, noise: { mode: opts?.noiseRanges ? 'ranges' : 'auto', bandsDb: bands, profile: encodeNoiseProfile(bands), quietSeconds: 1, confidence: 0.5, ranges: opts?.noiseRanges ? [...opts.noiseRanges] : [{ start: 1, end: 2 }], warning: null }, hum: hum ? { hz: 50, levelDb: -40, harmonics: 4 } : null, speech: { levelDb: db, peakDb: 20 * Math.log10(peak), snrDb: null } };
        },
      };
    },
  };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-voiceclean-'));
let s: RunningServer;
const h = () => ({ authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' });
const call = async (p: string, body?: unknown) => {
  const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const upload = async (pid: string, name: string, bytes: Buffer) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h(), 'x-filename': name }, body: new Uint8Array(bytes) })).json()) as any).assetId as string;
const tx = async (pid: string, ops: unknown[], expectedRevision?: number) => call(`/projects/${pid}/transactions`, { ops, ...(expectedRevision !== undefined ? { expectedRevision } : {}) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = async (jobId: string) => { for (let i = 0; i < 600; i++) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } throw new Error('job did not finish'); };
const rt = (value: number, timescale = 1000) => ({ value: String(value), timescale });
/** ffmpeg, for the picture files (a still without sound, a short video with this recording as its sound). */
function ffmpeg(args: string[]) { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); }

let pid = '', voiceAsset = '', clipA = '', clipB = '', otherClip = '', stillClip = '', videoPicture = '', videoSound = '';
const voice20 = recording(20);
beforeAll(async () => {
  s = await startServer({ port: 42000 + Math.floor(Math.random() * 18000), dataDir: path.join(dir, 'data') });
  pid = (await call('/projects', { name: 'ניקוי קול' })).body.project.id;
  voiceAsset = await upload(pid, 'voice.wav', voice20);
  const other = await upload(pid, 'other.wav', recording(4, { seed: 9, humDb: null }));
  fs.writeFileSync(path.join(dir, 'voice.wav'), recording(4, { seed: 3 }));
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=1', '-frames:v', '1', path.join(dir, 'still.png')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=30:duration=4', '-i', path.join(dir, 'voice.wav'), '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'video.mp4')]);
  const still = await upload(pid, 'still.png', fs.readFileSync(path.join(dir, 'still.png')));
  const video = await upload(pid, 'video.mp4', fs.readFileSync(path.join(dir, 'video.mp4')));
  const r = await tx(pid, [
    { op: 'add_clip', args: { assetId: voiceAsset, start: rt(0) } },
    { op: 'add_clip', args: { assetId: voiceAsset, start: rt(30000) } },
    { op: 'add_clip', args: { assetId: other, start: rt(60000) } },
    { op: 'add_clip', args: { assetId: still, start: rt(70000), duration: rt(2000) } },
    { op: 'add_clip', args: { assetId: video, start: rt(80000) } },
  ]);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const out = r.body.results.map((x: any) => x.output);
  [clipA, clipB, otherClip, stillClip, videoPicture] = out.map((o: any) => o.clipId as string);
  videoSound = out[4].audioClipId;
  expect((await tx(pid, [{ op: 'add_audio_effect', args: { clipId: clipA, type: 'space.echo' } }])).status).toBe(200);
}, 120000);
afterAll(async () => { await s?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('measure_voice: windows and ranges (pure)', () => {
  it('up to 600 s: one window, the whole recording; longer: 30 evenly spaced 20 s windows from the start to the end', () => {
    expect(voiceWindows(20)).toEqual([{ start: 0, seconds: 20 }]);
    expect(voiceWindows(600)).toEqual([{ start: 0, seconds: 600 }]);
    const w = voiceWindows(3600);
    expect(w.length).toBe(30);
    expect(w[0]).toEqual({ start: 0, seconds: 20 });
    expect(w[29]!.start + w[29]!.seconds).toBeCloseTo(3600, 9);
    for (let k = 1; k < 30; k++) expect(w[k]!.start - w[k - 1]!.start).toBeCloseTo(3580 / 29, 9);
  });
  it('source seconds ↔ pushed seconds: identity for the whole recording; split at the windows otherwise; a range outside every window disappears', () => {
    const whole = [{ sourceStart: 0, pushedFrame: 0, frames: Infinity }];
    expect(toPushed([{ start: 1.5, end: 2.25 }], whole)).toEqual([{ start: 1.5, end: 2.25 }]);
    const wins = [{ sourceStart: 0, pushedFrame: 0, frames: 20 * SR }, { sourceStart: 100, pushedFrame: 20 * SR, frames: 20 * SR }];
    expect(toPushed([{ start: 110, end: 115 }, { start: 15, end: 105 }, { start: 50, end: 60 }], wins)).toEqual([{ start: 30, end: 35 }, { start: 15, end: 20 }, { start: 20, end: 25 }]);
    expect(toSource([{ start: 18, end: 22 }, { start: 30, end: 35 }], wins)).toEqual([{ start: 18, end: 20 }, { start: 100, end: 102 }, { start: 110, end: 115 }]);
  });
});

describe('measure_voice: the server plumbing (with the labelled test-only stand-in meter)', () => {
  it('decodes the whole recording at 48 kHz stereo, passes noise ranges in pushed seconds, returns them in source seconds, and builds one clean_voice op with the profile, the recording as source and the hum found; the project does not change', async () => {
    const log = { frames: 0 } as { opts?: VoiceMeasureOptions; frames: number };
    const before = s.store.getProject(pid);
    const r = await measureVoiceCheckWith(s.store, pid, { clipId: clipA, noiseRanges: [{ start: rt(700), end: rt(1000) }, { start: rt(1700), end: rt(2000) }] }, testMeter(log, true));
    expect(log.frames).toBe(20 * SR);
    expect(log.opts).toEqual({ noiseRanges: [{ start: 0.7, end: 1 }, { start: 1.7, end: 2 }] });
    expect(r.report.noise.ranges).toEqual([{ start: 0.7, end: 1 }, { start: 1.7, end: 2 }]);
    expect(r.report.analysedSeconds).toBe(20);
    expect([r.revision, r.assetId, r.clipIds, r.recommendedStrength]).toEqual([before.revision, voiceAsset, [clipA], 0.5]);
    expect(r.ops).toEqual([{ op: 'clean_voice', args: { clipId: clipA, includeLinked: false, strength: 0.5, profile: r.report.noise.profile, source: voiceAsset, mainsHz: '50' } }]);
    expect(r.note).toMatch(/^Candidates only\. To apply, send `ops` as ONE transaction with expectedRevision set to this revision/);
    expect(r.note).toMatch(/not listened to/);
    expect(r.method).toMatch(/the whole recording \(20 s\).*48 kHz stereo/);
    const after = s.store.getProject(pid);
    expect(after.revision).toBe(before.revision);
    expect(diffEntities(before.doc, after.doc)).toEqual([]);
    // a strength given is used as given; no hum found: mainsHz null, and the note says hum removal is left out
    const r2 = await measureVoiceCheckWith(s.store, pid, { clipId: clipA, strength: 0.8 }, testMeter(log, false));
    expect(r2.ops[0]!.args).toMatchObject({ strength: 0.8, mainsHz: null });
    expect(r2.note).toMatch(/No mains hum was found/);
  });
  it('the ops as ONE transaction: revision +1, the three cleanup effects in their fixed order before the echo, which is kept; one undo restores the project exactly (diffEntities empty)', async () => {
    const r = await measureVoiceCheckWith(s.store, pid, { clipId: clipA }, testMeter({ frames: 0 }, true));
    const before = s.store.getProject(pid);
    const applied = await tx(pid, r.ops, r.revision);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.revision).toBe(before.revision + 1);
    const clip = findClip(s.store.getProject(pid).doc, clipA)!.clip as MediaClip;
    expect(clip.audioFx!.map((f) => f.type)).toEqual(['cleanup.dehum', 'cleanup.denoise', 'cleanup.speech', 'space.echo']);
    expect(clip.audioFx![1]!.params).toMatchObject({ profile: r.report.noise.profile, source: voiceAsset });
    // a stale revision is refused (the candidates were measured on the revision they carry)
    expect((await tx(pid, r.ops, r.revision)).status).toBe(409);
    expect((await call(`/projects/${pid}/undo`, {})).status).toBe(200);
    expect(diffEntities(before.doc, s.store.getProject(pid).doc)).toEqual([]);
  });
  it('scope asset: one op per sound clip of the same recording (not the other recording); a picture clip finds its linked sound; a clip on a locked track is left out and named in the note', async () => {
    const all = await measureVoiceCheckWith(s.store, pid, { clipId: clipB, scope: 'asset' }, testMeter({ frames: 0 }, false));
    expect(all.clipIds.sort()).toEqual([clipA, clipB].sort());
    expect(all.ops.map((o) => o.args.clipId).sort()).toEqual([clipA, clipB].sort());
    expect(all.ops.every((o) => o.op === 'clean_voice' && o.args.source === voiceAsset)).toBe(true);
    expect(all.clipIds).not.toContain(otherClip);
    const linked = await measureVoiceCheckWith(s.store, pid, { clipId: videoPicture }, testMeter({ frames: 0 }, false));
    expect([linked.clipIds, linked.ops[0]!.args.clipId]).toEqual([[videoSound], videoSound]);
    expect(linked.report.analysedSeconds).toBeGreaterThan(3.9);
    // lock the track of the recording's clips: they are left out (clean_voice would refuse them) and the note names them
    const trackId = findClip(s.store.getProject(pid).doc, clipB)!.track.id;
    expect((await tx(pid, [{ op: 'update_track', args: { trackId, locked: true } }])).status).toBe(200);
    const locked = await measureVoiceCheckWith(s.store, pid, { clipId: clipA, scope: 'asset' }, testMeter({ frames: 0 }, false));
    const onTrack = [clipA, clipB].filter((id) => findClip(s.store.getProject(pid).doc, id)!.track.id === trackId);
    expect(locked.clipIds.sort()).toEqual([clipA, clipB].filter((id) => !onTrack.includes(id)).sort());
    for (const id of onTrack) expect(locked.note).toMatch(new RegExp(`Left out .*${id} \\(its track is locked\\)`));
    expect((await tx(pid, [{ op: 'update_track', args: { trackId, locked: false } }])).status).toBe(200);
  });
  it('a picture-only clip is 422 no_audio and an unknown clip 404, before anything is measured, also as a job (no job is made)', async () => {
    const still = await call(`/projects/${pid}/analysis/voice`, { clipId: stillClip });
    expect([still.status, still.body.error.code]).toEqual([422, 'no_audio']);
    const unknown = await call(`/projects/${pid}/analysis/voice`, { clipId: 'clp_nope' });
    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'not_found']);
    expect((await call(`/projects/${pid}/analysis/voice`, { clipId: 'clp_nope', background: true })).status).toBe(404);
  });
});

describe(`measure_voice: what the engine measures (voiceMeter)${NEEDS_METER}`, () => {
  let sync: VoiceCheck;
  it.skipIf(!METER_READY)('the route leaves the revision unchanged; the 24 bands are within ±2 dB of the synthetic −50 dB truth and the hum is at 50 Hz; its op carries the recommended strength', async () => {
    const before = (await call(`/projects/${pid}`)).body.revision;
    const r = await call(`/projects/${pid}/analysis/voice`, { clipId: clipA });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    sync = r.body;
    expect((await call(`/projects/${pid}`)).body.revision).toBe(before);
    const worst = Math.max(...sync.report.noise.bandsDb.map((b) => Math.abs(b + 50)));
    console.log(`measure_voice: bands ${sync.report.noise.bandsDb.map((b) => b.toFixed(1)).join(' ')} (worst ${worst.toFixed(2)} dB off −50); hum ${JSON.stringify(sync.report.hum)}; speech ${JSON.stringify(sync.report.speech)}; recommended ${sync.recommendedStrength}`);
    expect(sync.report.noise.bandsDb.length).toBe(24);
    expect(worst).toBeLessThanOrEqual(2);
    expect(sync.report.hum?.hz).toBe(50);
    expect(sync.ops).toEqual([{ op: 'clean_voice', args: { clipId: clipA, includeLinked: false, strength: sync.recommendedStrength, profile: sync.report.noise.profile, source: voiceAsset, mainsHz: '50' } }]);
    // the pauses found are the synthetic ones, [2.1, 3) of every 3 s (source seconds), covering at least 80 % of them
    let covered = 0;
    for (const q of sync.report.noise.ranges) { expect(q.start % 3, JSON.stringify(q)).toBeGreaterThan(2.05); expect(q.end - Math.floor(q.start / 3) * 3).toBeLessThan(3.05); covered += q.end - q.start; }
    expect(covered / (0.9 * Math.floor(20 / 3) + Math.max(0, (20 % 3) - 2.1))).toBeGreaterThan(0.8);
  }, 60000);
  it.skipIf(!METER_READY)('as a background job: it succeeds with the same object; a job canceled while measuring is canceled and its result discarded', async () => {
    const started = await call(`/projects/${pid}/analysis/voice`, { clipId: clipA, background: true });
    expect(started.status).toBe(202);
    const job = await done(started.body.jobId);
    expect(job).toMatchObject({ status: 'succeeded', type: 'analysis' });
    expect(job.output.kind).toBe('voice');
    expect(job.output.result).toEqual(sync ?? (await call(`/projects/${pid}/analysis/voice`, { clipId: clipA })).body);
    const second = await call(`/projects/${pid}/analysis/voice`, { clipId: clipA, background: true });
    const cancel = await call(`/jobs/${second.body.jobId}/cancel`, {});
    expect(['result-will-be-discarded', 'removed-from-queue']).toContain(cancel.body.outcome);
    const after = await done(second.body.jobId);
    expect(after.status).toBe('canceled');
    expect(after.output ?? null).toBeNull();
  }, 60000);
  it.skipIf(!METER_READY)('a 60 s recording is measured in at most 5 s here (reported)', async () => {
    const long = await upload(pid, 'long.wav', recording(60, { seed: 21 }));
    const id = (await tx(pid, [{ op: 'add_clip', args: { assetId: long, start: rt(100000) } }])).body.results[0].output.clipId;
    const t0 = performance.now();
    const r = await call(`/projects/${pid}/analysis/voice`, { clipId: id });
    const seconds = (performance.now() - t0) / 1000;
    console.log(`measure_voice: 60 s recording measured in ${seconds.toFixed(2)} s (decode + meter, wall time on a shared machine)`);
    expect(r.status).toBe(200);
    expect(r.body.report.analysedSeconds).toBeCloseTo(60, 3);
    expect(seconds).toBeLessThanOrEqual(5);
  }, 60000);
});
