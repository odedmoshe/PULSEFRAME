/**
 * match_colour (ADR-0014) on a real store with a STUB RENDERER (test only, labelled): renderStill returns PNGs made by ffmpeg
 * (lavfi testsrc2, with colour casts made by ffmpeg colorbalance), one picture per asset. Where the scratch document carries an
 * enabled colour grade, the stub stands in for the WGSL pass with the engine's model gradePixel, or refuses as a worker without a
 * graphics adapter does. The real worker and the real pass are exercised by pnpm proof:colourmatch.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, findClip, validateProject, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { GRADE_DEFAULTS, gradePixel, type GradeParams } from '@pulseframe/engine';
import { isolateClip } from '@pulseframe/engine/colourMatch.ts';
import { decodePng, matchColour, MATCH_STILL_SCALE, type ColourMatch } from './colourMatch.ts';
import type { Exporter } from './export.ts';
import { ApiError, Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const W = 160, H = 90;
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { input, maxBuffer: 1 << 26 });
/** A colourful still from ffmpeg's test pattern, optionally with a colour cast (colorbalance) or a flat colour. */
const still = (vf = 'null', src = `testsrc2=size=${W}x${H}:rate=1`) => ff(['-f', 'lavfi', '-i', src, '-vf', vf, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
const rawToPng = (rgba: Uint8Array, w: number, h: number) => ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], Buffer.from(rgba));

let dir: string, store: Store;
const PNG: Record<string, Buffer | ((frame: number) => Buffer)> = {};
interface Call { doc: ProjectDocument; frame: number; scale: number; clipId: string; graded: boolean }
/** STUB RENDERER (test only). `adapter: false` refuses any still with an enabled colour grade, as a worker without WebGPU does. */
function stubExporter(opts: { adapter: boolean } = { adapter: true }) {
  const calls: Call[] = [];
  const renderStill = async (doc: ProjectDocument, _rev: number, frame: number, scale: number): Promise<Buffer> => {
    const clips = doc.sequences[doc.mainSequenceId]!.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips) as MediaClip[];
    if (clips.length !== 1) throw new Error(`stub: expected one picture clip, got ${clips.length}`);
    const clip = clips[0]!, grade = clip.effects?.find((e) => e.type === 'color.grade' && e.enabled);
    calls.push({ doc, frame, scale, clipId: clip.id, graded: !!grade });
    const src = PNG[clip.assetId]!, png = typeof src === 'function' ? src(frame) : src;
    if (!grade) return png;
    if (!opts.adapter) throw new ApiError(503, 'renderer_unavailable', `the render worker could not produce the frame: gpu_effect_unavailable: frame 0 uses color.grade, which needs a graphics adapter in the render worker; no adapter (stub)`);
    const { rgba, width, height } = await decodePng(png), p = { ...GRADE_DEFAULTS, ...grade.params } as GradeParams;
    for (let i = 0; i < width * height; i++) {
      const g = gradePixel([rgba[i * 4]! / 255, rgba[i * 4 + 1]! / 255, rgba[i * 4 + 2]! / 255], p);
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(g[c]! * 255);
    }
    return rawToPng(rgba, width, height);
  };
  return { exporter: { renderStill } as unknown as Exporter, calls };
}

const image = (name: string) => ({ kind: 'image' as const, name, contentHash: `sha256:${Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(10, 1), image: { width: W, height: H, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } });
const sound = { kind: 'audio' as const, name: 'voice.wav', contentHash: `sha256:${'5'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
interface Scene { pid: string; ref: string; same: string; warm: string; graded: string; title: string; voice: string; assets: Record<string, string> }
/**
 * ref (neutral pattern), same (the same picture), warm (the pattern with a warm cast), graded (a cool picture that already has a
 * look), a title and a sound clip; then the reference gets a look with shadows/highlights/fade that must carry over.
 */
function scene(): Scene {
  const pid = store.createProject({ name: 'match', width: 640, height: 360, frameRate: R }).doc.id;
  const names = ['ref.png', 'same.png', 'warm.png', 'cool.png'];
  const imp = store.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [...names.map((n) => ({ op: 'import_asset', args: { asset: image(n) } })), { op: 'import_asset', args: { asset: sound } }] });
  const assets = Object.fromEntries(names.map((n, i) => [n, imp.results[i]!.output!.assetId as string]));
  const voiceAsset = imp.results[4]!.output!.assetId as string;
  PNG[assets['ref.png']!] = still(); PNG[assets['same.png']!] = still();
  PNG[assets['warm.png']!] = still('colorbalance=rm=0.25:gm=0.05:bm=-0.25');
  PNG[assets['cool.png']!] = still('colorbalance=rm=-0.2:bm=0.2');
  const add = store.commit({ projectId: pid, actor: 'u', ops: [
    { op: 'add_clip', args: { assetId: assets['ref.png']!, start: f(0), duration: f(60) } },
    { op: 'add_clip', args: { assetId: assets['same.png']!, start: f(60), duration: f(60) } },
    { op: 'add_clip', args: { assetId: assets['warm.png']!, start: f(120), duration: f(60) } },
    { op: 'add_clip', args: { assetId: assets['cool.png']!, start: f(180), duration: f(60) } },
    { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60) } },
    { op: 'add_clip', args: { assetId: voiceAsset, start: f(0), duration: f(90) } },
  ] });
  const [ref, same, warm, graded, title, voice] = add.results.map((r) => r.output!.clipId as string) as [string, string, string, string, string, string];
  store.commit({ projectId: pid, actor: 'u', ops: [
    { op: 'apply_look', args: { clipId: graded, lookId: lookWithFade() } },
    { op: 'set_colour_grade', args: { clipId: ref, params: { shadows: 0.3, highlights: -0.2, fade: 0.1 } } },
  ] });
  return { pid, ref, same, warm, graded, title, voice, assets };
}
const lookWithFade = () => 'teal-orange';
const refusal = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('expected a refusal'); };
const clipOf = (doc: ProjectDocument, id: string) => findClip(doc, id)!.clip as MediaClip;

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-colourmatch-')); store = new Store(path.join(dir, 'data')); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('match_colour (stub renderer, test only)', { timeout: 120_000 }, () => {
  it('match: one set_colour_grade op per target, read-only, measured on isolated scratch documents, verified', async () => {
    const s = scene(), before = store.getProject(s.pid);
    const { exporter, calls } = stubExporter();
    const m = await matchColour(store, exporter, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: [s.same, s.warm, s.graded], amount: 1, samples: 3 });
    expect(store.getProject(s.pid).revision).toBe(before.revision);
    expect(store.getProject(s.pid).doc).toEqual(before.doc);
    expect(m.revision).toBe(before.revision);
    expect(m.method).toBe('match');
    expect(m.reference?.clipId).toBe(s.ref);
    expect(m.ops.map((o) => [o.op, (o.args as { clipId: string }).clipId, (o.args as { mode: string }).mode])).toEqual([['set_colour_grade', s.same, 'replace'], ['set_colour_grade', s.warm, 'replace'], ['set_colour_grade', s.graded, 'replace']]);
    expect(m.targets.map((t) => t.clipId)).toEqual([s.same, s.warm, s.graded]);
    // the reference's shadows, highlights and fade carry over
    for (const t of m.targets) expect([t.params.shadows, t.params.highlights, t.params.fade]).toEqual([0.3, -0.2, 0.1]);
    // the same picture needs (almost) no change; the warm one is cooled
    const same = m.targets[0]!, warm = m.targets[1]!, graded = m.targets[2]!;
    // (the reference still is rounded to 8 bits, and the test pattern's large flat blocks put percentiles on plateaus: 0.03, not the
    // model's 0.01 of the engine test)
    for (const k of ['exposure', 'temperature', 'tint', 'contrast', 'saturation'] as const) expect(Math.abs(same.params[k] - GRADE_DEFAULTS[k]), k).toBeLessThan(0.03);
    expect(same.verdict).toBe('close');
    expect(warm.params.temperature).toBeLessThan(-0.1);
    expect(graded.params.temperature).toBeGreaterThan(0); // the cool picture is warmed
    for (const t of m.targets) {
      expect(t.residual.verified).not.toBeNull();
      expect(t.statsAfter).not.toBeNull();
      expect(Math.abs(t.residual.verified! - t.residual.model)).toBeLessThan(1.5); // the stub renders with the model: only 8-bit rounding differs
      expect(t.verdict).toMatch(/^(close|noticeable|partial)$/);
    }
    expect(same.warnings).toEqual([]);
    expect(graded.warnings).toEqual(['replaces_grade']);
    expect(m.unavailable).toBeNull();
    expect(m.note).toMatch(/Candidates only/);
    expect(m.note).toMatch(/nobody has compared the result by eye/);
    // what was rendered: quarter-size stills of one clip at 25/50/75 %, from scratch documents that are valid projects
    expect(new Set(calls.map((c) => c.scale))).toEqual(new Set([MATCH_STILL_SCALE]));
    expect(calls.filter((c) => c.clipId === s.ref).map((c) => c.frame)).toEqual([15, 30, 45]);
    expect(calls.filter((c) => c.clipId === s.warm && !c.graded).map((c) => c.frame)).toEqual([135, 150, 165]);
    for (const c of calls) {
      expect(c.doc.settings.fit).toBe('cover');
      const clip = clipOf(c.doc, c.clipId);
      expect(clip.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
      expect(c.doc.sequences[c.doc.mainSequenceId]!.tracks.filter((t) => t.kind !== 'audio').flatMap((t) => t.clips)).toHaveLength(1);
      expect(validateProject(c.doc)).toEqual([]);
    }
    // the reference is measured with its grade, a target without its own
    expect(calls.filter((c) => c.clipId === s.ref).every((c) => c.graded)).toBe(true);
    expect(calls.filter((c) => c.clipId === s.graded).map((c) => c.graded)).toEqual([false, false, false, true, true, true]);
    // the ops apply as one transaction (one revision) and can be undone in one step
    const applied = store.commit({ projectId: s.pid, actor: 'u', expectedRevision: m.revision, ops: m.ops });
    expect(applied.revision).toBe(before.revision + 1);
    expect(clipOf(store.getProject(s.pid).doc, s.warm).effects!.find((e) => e.type === 'color.grade')!.params).toEqual(warm.params);
  });

  it('a clip whose grade is animated is measured and reported, but left out of ops', async () => {
    const s = scene();
    const gid = clipOf(store.getProject(s.pid).doc, s.graded).effects!.find((e) => e.type === 'color.grade')!.id;
    store.commit({ projectId: s.pid, actor: 'u', ops: [{ op: 'set_effect_keyframe', args: { clipId: s.graded, effectId: gid, param: 'exposure', time: f(0), value: 0.4 } }, { op: 'set_effect_keyframe', args: { clipId: s.graded, effectId: gid, param: 'exposure', time: f(30), value: -0.2 } }] });
    const m = await matchColour(store, stubExporter().exporter, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: [s.warm, s.graded], amount: 1, samples: 1 });
    expect(m.targets.find((t) => t.clipId === s.graded)!.warnings).toEqual(['replaces_grade', 'animated_grade']);
    expect(m.ops.map((o) => (o.args as { clipId: string }).clipId)).toEqual([s.warm]);
    expect(m.note).toMatch(new RegExp(`${s.graded} \\(its grade is animated`));
  });

  it("'all' means every picture clip: not titles, not sound, not the reference", async () => {
    const s = scene();
    const m = await matchColour(store, stubExporter().exporter, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: 'all', amount: 1, samples: 1 });
    expect(m.targets.map((t) => t.clipId)).toEqual([s.same, s.warm, s.graded]);
    const b = await matchColour(store, stubExporter().exporter, s.pid, { method: 'balance', targetClipIds: 'all', amount: 1, samples: 1 });
    expect(b.reference).toBeNull();
    expect(b.targets.map((t) => t.clipId)).toEqual([s.ref, s.same, s.warm, s.graded]);
    expect(b.ops).toHaveLength(4);
    for (const t of b.targets) { expect(t.params.saturation).toBe(1); expect(t.params.shadows).toBe(0); expect(t.params.fade).toBe(0); }
    // balance brings the warm picture's mid-tones toward neutral (verified through the stub)
    const warm = b.targets.find((t) => t.clipId === s.warm)!;
    expect(Math.hypot(warm.statsAfter!.meanA, warm.statsAfter!.meanB)).toBeLessThan(Math.hypot(warm.statsBefore.meanA, warm.statsBefore.meanB) / 2);
  });

  it('refuses: the reference as a target, sound and title clips, unknown clips, a missing or needless reference', async () => {
    const s = scene(), ex = stubExporter().exporter;
    const run = (b: Record<string, unknown>) => refusal(matchColour(store, ex, s.pid, { method: 'match', amount: 1, samples: 1, ...b } as never));
    expect(await run({ referenceClipId: s.ref, targetClipIds: [s.warm, s.ref] })).toMatchObject({ status: 422, code: 'invalid_args' });
    expect(await run({ referenceClipId: s.ref, targetClipIds: [s.voice] })).toMatchObject({ status: 422, code: 'incompatible' });
    expect(await run({ referenceClipId: s.voice, targetClipIds: [s.warm] })).toMatchObject({ status: 422, code: 'incompatible' });
    expect(await run({ referenceClipId: s.ref, targetClipIds: [s.title] })).toMatchObject({ status: 422, code: 'incompatible' });
    expect(await run({ referenceClipId: s.ref, targetClipIds: ['clp_nope'] })).toMatchObject({ status: 404, code: 'not_found' });
    expect(await run({ targetClipIds: [s.warm] })).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(await run({ method: 'balance', referenceClipId: s.ref, targetClipIds: [s.warm] })).toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('a target on a locked track: refused when listed, left out of all (said in the note)', async () => {
    const s = scene();
    const doc = store.getProject(s.pid).doc, trackId = findClip(doc, s.warm)!.track.id;
    // the warm clip alone on its own locked track
    store.commit({ projectId: s.pid, actor: 'u', ops: [{ op: 'delete_clip', args: { clipId: s.warm } }] });
    const placed = store.commit({ projectId: s.pid, actor: 'u', ops: [{ op: 'add_track', args: { kind: 'video' } }] });
    const lockedTrack = placed.results[0]!.output!.trackId as string;
    const warm = store.commit({ projectId: s.pid, actor: 'u', ops: [{ op: 'add_clip', args: { assetId: s.assets['warm.png']!, trackId: lockedTrack, start: f(120), duration: f(60) } }] }).results[0]!.output!.clipId as string;
    store.commit({ projectId: s.pid, actor: 'u', ops: [{ op: 'update_track', args: { trackId: lockedTrack, locked: true } }] });
    expect(trackId).not.toBe(lockedTrack);
    const ex = stubExporter().exporter;
    expect(await refusal(matchColour(store, ex, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: [warm], amount: 1, samples: 1 }))).toMatchObject({ status: 422, code: 'track_locked' });
    const m = await matchColour(store, ex, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: 'all', amount: 1, samples: 1 });
    expect(m.targets.map((t) => t.clipId)).not.toContain(warm);
    expect(m.note).toMatch(new RegExp(`Left out of ops: .*${warm} \\(track .* is locked\\)`));
  });

  it('a clip that changes inside (a cut within the clip) is flagged changes_within_clip', async () => {
    const s = scene();
    PNG[s.assets['same.png']!] = (frame: number) => (frame < 80 ? still() : still('null', `color=c=0x203060:size=${W}x${H}:rate=1`));
    const m = await matchColour(store, stubExporter().exporter, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: [s.same, s.warm], amount: 1, samples: 3 });
    expect(m.targets[0]!.warnings).toContain('changes_within_clip');
    expect(m.targets[1]!.warnings).not.toContain('changes_within_clip');
    PNG[s.assets['same.png']!] = still();
  });

  it('a worker without a graphics adapter: nothing claims to be verified, `unavailable` says why, the ops are still offered', async () => {
    const s = scene();
    store.commit({ projectId: s.pid, actor: 'u', ops: [{ op: 'set_colour_grade', args: { clipId: s.ref, params: {} } }, { op: 'remove_effect', args: { clipId: s.ref, effectId: clipOf(store.getProject(s.pid).doc, s.ref).effects![0]!.id } }] });
    const m = await matchColour(store, stubExporter({ adapter: false }).exporter, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: [s.same, s.warm], amount: 1, samples: 1 });
    expect(m.unavailable).toMatch(/no graphics adapter/);
    for (const t of m.targets) { expect(t.residual.verified).toBeNull(); expect(t.statsAfter).toBeNull(); expect(t.warnings).toContain('not_verified'); }
    expect(m.ops).toHaveLength(2);
    expect(m.note).toMatch(/Not verified/);
    // a reference that has a grade cannot even be measured there
    const s2 = scene();
    expect(await refusal(matchColour(store, stubExporter({ adapter: false }).exporter, s2.pid, { method: 'match', referenceClipId: s2.ref, targetClipIds: [s2.warm], amount: 1, samples: 1 }))).toMatchObject({ status: 503, code: 'renderer_unavailable' });
  });

  it('amount 0 offers no change at all', async () => {
    const s = scene();
    const m: ColourMatch = await matchColour(store, stubExporter().exporter, s.pid, { method: 'match', referenceClipId: s.ref, targetClipIds: [s.warm], amount: 0, samples: 1 });
    expect(m.targets[0]!.params).toEqual({ ...GRADE_DEFAULTS });
  });
});

describe('isolateClip', () => {
  it('keeps the clip alone, filling the frame; grade-input leaves out the grade and what follows it, keeping a time effect', () => {
    const r0 = applyTransaction(store.createProject({ name: 'iso', frameRate: R }).doc, [{ op: 'import_asset', args: { asset: image('iso.png') } }], { idSeed: 'iso0_', actor: 't', allowInternal: true });
    const assetId = r0.results[0]!.output!.assetId as string;
    const r1 = applyTransaction(r0.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(30) } }, { op: 'add_clip', args: { assetId, start: f(30), duration: f(30) } }], { idSeed: 'iso1_', actor: 't' });
    const [a, b] = r1.results.map((x) => x.output!.clipId as string) as [string, string];
    const ops: OpCall[] = [
      { op: 'add_effect', args: { clipId: b, type: 'time.echo' } }, { op: 'apply_look', args: { clipId: b, lookId: 'teal-orange' } }, { op: 'add_effect', args: { clipId: b, type: 'blur.gaussian' } },
      { op: 'set_clip_transform', args: { clipId: b, transform: { scale: 0.5, opacity: 0.4, x: 0.2 } } }, { op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 10 } },
    ];
    const doc = applyTransaction(r1.doc, ops, { idSeed: 'iso2_', actor: 't' }).doc;
    expect(clipOf(doc, b).effects!.map((e) => e.type)).toEqual(['time.echo', 'color.grade', 'blur.gaussian']);
    const shown = isolateClip(doc, b, 'shown'), input = isolateClip(doc, b, 'grade-input');
    expect(findClip(shown, a)).toBeUndefined();
    expect(clipOf(shown, b).effects!.map((e) => e.type)).toEqual(['time.echo', 'color.grade', 'blur.gaussian']);
    expect(clipOf(input, b).effects!.map((e) => e.type)).toEqual(['time.echo']);
    expect(clipOf(shown, b).transition).toBeUndefined();
    expect(clipOf(shown, b).transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    expect(shown.settings.fit).toBe('cover');
    expect(findClip(doc, a)).toBeDefined(); // the document itself is untouched
    expect(clipOf(doc, b).transform.scale).toBe(0.5);
  });
});
