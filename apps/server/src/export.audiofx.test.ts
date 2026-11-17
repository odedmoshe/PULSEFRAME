/**
 * Export planning with sound effects (ADR-0010): the manifest lists the effect implementations of the clips heard in the range,
 * an effect this build cannot run blocks the export, and an echo cut at the end of the video is a warning (a note in preflight).
 * Kernels for the real types are labelled pass-through TEST kernels when the kernels worker's registrations are absent.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findAudioEffect, findClip, validateProject, type AudioFxInstance, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, kernelFor, registerKernel, soundEnd, type FxKernel } from '@pulseframe/engine';
import { ENGINE, Exporter } from './export.ts';
import { preflight } from './preflight.ts';

const passThrough = (type: string, stage: FxKernel['stage'], reach: FxKernel['reach']): void => { const version = findAudioEffect(type)!.version; if (!kernelFor(type, version)) registerKernel({ type, version, stage, reach, create: () => ({ process() {} }) }); };
passThrough('space.echo', 4, (p, sr) => { const n = Number(p.repeats) * Math.round((Number(p.delayMs) * sr) / 1000); return { warm: n, tail: n }; });
passThrough('voice.telephone', 3, () => ({ warm: 600, tail: 0 }));

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `x${n++}_`, actor: 'test', allowInternal });
const asset = (h: string) => ({ kind: 'audio' as const, name: `${h}.wav`, contentHash: `sha256:${h.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' } });
function project() {
  let r = tx(createProject({ id: 'p', name: 'p', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: asset('1') } }], true);
  const a = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_track', args: { kind: 'audio', name: 'fx' } }]);
  const t = r.results[0]!.output!.trackId as string;
  // clip A: 0..3 s with an echo of 1.2 s; clip B: 7..10 s (the programme end) with an echo and a telephone voice
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a, start: f(0), trackId: t, duration: f(90) } }, { op: 'add_clip', args: { assetId: a, start: f(210), trackId: t, duration: f(90) } }]);
  const [ca, cb] = r.results.map((x) => (x.output!.audioClipId ?? x.output!.clipId) as string) as [string, string];
  const d = structuredClone(r.doc);
  const fx = (id: string, type: string, params: AudioFxInstance['params'] = {}): AudioFxInstance => ({ id, type, enabled: true, params });
  (findClip(d, ca)!.clip as any).audioFx = [fx('afx_a', 'space.echo', { delayMs: 300, repeats: 4 })];
  (findClip(d, cb)!.clip as any).audioFx = [fx('afx_t', 'voice.telephone'), fx('afx_b', 'space.echo')];
  expect(validateProject(d)).toEqual([]);
  return { doc: d, ca, cb };
}
const exporter = () => new Exporter({ blobPath: () => '/nonexistent/blob' } as any, null as any, () => '', '/nonexistent/web');
const codes = (x: { code: string }[]) => x.map((b) => b.code);

describe('export planning with sound effects', () => {
  it('the manifest names the audio runtime and the effects of the clips heard in the range, tails included', () => {
    const { doc } = project();
    const e = exporter();
    expect(ENGINE.audio).toBe('plan/2 voice/1');
    const all = e.plan(doc, 1, { format: 'wav' }).manifest;
    expect(all.engine.audio).toBe('plan/2 voice/1');
    expect(all.audioEffects).toEqual([{ type: 'space.echo', version: 1, clips: 2 }, { type: 'voice.telephone', version: 1, clips: 1 }]);
    // 3.5 s .. 4 s: clip A ended at 3 s but its echo (1.2 s) still sounds there
    expect(e.plan(doc, 1, { format: 'wav', range: { startFrame: 105, endFrame: 120 } }).manifest.audioEffects).toEqual([{ type: 'space.echo', version: 1, clips: 1 }]);
    // 5 s .. 6 s: nothing sounds
    expect(e.plan(doc, 1, { format: 'wav', range: { startFrame: 150, endFrame: 180 } }).manifest.audioEffects).toEqual([]);
    // no sound in a GIF or a still
    expect(e.plan(doc, 1, { format: 'gif' }).manifest.audioEffects).toEqual([]);
    expect(e.plan(doc, 1, { format: 'png', frame: 0 }).manifest.audioEffects).toEqual([]);
  });

  it('an echo cut at the end of the video is a warning when the range reaches the end, and a note in preflight', () => {
    const { doc, cb } = project();
    const e = exporter();
    const p = e.plan(doc, 1, { format: 'wav' });
    const w = p.warnings.filter((x) => x.code === 'audio_tail_cut');
    expect(w.map((x) => x.ids)).toEqual([[cb]]);
    expect(w[0]!.message).toMatch(/1 s past the end of the video/);
    expect(codes(e.plan(doc, 1, { format: 'wav', range: { startFrame: 0, endFrame: 150 } }).warnings)).not.toContain('audio_tail_cut');
    const pf = preflight(e, doc, 1);
    const note = pf.issues.find((i) => i.code === 'audio_tail_cut');
    expect(note?.severity).toBe('note');
    expect(note?.ids).toEqual([cb]);
  });

  it('a range that starts in an echo pins and checks the source the echo is made from (missing source blocks, as for the whole video)', () => {
    // clip A (0..3 s, echo) gets a file of its own, so its asset is used by nothing else in a range after 3 s
    const { doc, ca } = project();
    const d = structuredClone(doc);
    const r = tx(d, [{ op: 'import_asset', args: { asset: asset('2') } }], true);
    const assetA = r.results[0]!.output!.assetId as string;
    const d2 = structuredClone(r.doc);
    (findClip(d2, ca)!.clip as any).assetId = assetA;
    expect(validateProject(d2)).toEqual([]);
    const e = exporter(); // every blob is missing
    const ids = (p: ReturnType<Exporter['plan']>) => p.manifest.assets.map((x) => x.id);
    const missing = (p: ReturnType<Exporter['plan']>) => p.blockers.filter((x) => x.code === 'missing_media').flatMap((x) => x.ids);
    expect(missing(e.plan(d2, 1, { format: 'wav' }))).toContain(assetA);
    // where clip A's echo ends, at the project rate (frames of 1/30 s)
    const sr = d2.settings.sampleRate;
    const pa = audioPlan(d2).clips.find((c) => c.clipId === ca)!;
    expect(pa.voice!.tail).toBeGreaterThan(0);
    const lastHeard = Math.ceil((soundEnd(pa) * 30) / sr) - 1; // the last frame in which the echo still sounds
    expect(lastHeard).toBeGreaterThanOrEqual(90);
    // 3 s .. the last frame of the echo: only the echo of clip A sounds, read from its source
    for (const p of [e.plan(d2, 1, { format: 'wav', range: { startFrame: 90, endFrame: 120 } }), e.plan(d2, 1, { format: 'mp4-h264-aac', range: { startFrame: lastHeard, endFrame: lastHeard + 1 } })]) {
      expect(p.manifest.audioEffects).toEqual([{ type: 'space.echo', version: 1, clips: 1 }]);
      expect(p.manifest.assets.find((x) => x.id === assetA)).toMatchObject({ id: assetA, clips: 1 });
      expect(missing(p)).toContain(assetA);
    }
    // after the echo, and in formats without sound, clip A's source is not needed
    for (const p of [e.plan(d2, 1, { format: 'wav', range: { startFrame: lastHeard + 1, endFrame: 200 } }), e.plan(d2, 1, { format: 'gif', range: { startFrame: 90, endFrame: 120 } }), e.plan(d2, 1, { format: 'png', frame: 95 })]) {
      expect(ids(p)).not.toContain(assetA);
      expect(missing(p)).not.toContain(assetA);
    }
    // a clip with sound effects inside the range is counted once
    expect(e.plan(d2, 1, { format: 'wav', range: { startFrame: 0, endFrame: 120 } }).manifest.assets.find((x) => x.id === assetA)?.clips).toBe(1);
  });

  it('a sound effect this build cannot run blocks the export (never dropped silently); not for a GIF', () => {
    const { doc, cb } = project();
    const d = structuredClone(doc);
    (findClip(d, cb)!.clip as any).audioFx.push({ id: 'afx_z', type: 'voice.from_the_future', enabled: true, params: {} });
    const e = exporter();
    const p = e.plan(d, 1, { format: 'mp4-h264-aac' });
    const b = p.blockers.filter((x) => x.code === 'unknown_audio_effect');
    expect(b.map((x) => x.ids)).toEqual([[cb]]);
    expect(b[0]!.message).toMatch(/voice\.from_the_future/);
    // the effects it can run are still listed
    expect(p.manifest.audioEffects.map((x) => x.type)).toEqual(['space.echo', 'voice.telephone']);
    expect(codes(e.plan(d, 1, { format: 'gif' }).blockers)).not.toContain('unknown_audio_effect');
    // a disabled unknown effect is not needed by the render
    (findClip(d, cb)!.clip as any).audioFx.at(-1).enabled = false;
    expect(codes(e.plan(d, 1, { format: 'wav' }).blockers)).not.toContain('unknown_audio_effect');
  });
});
