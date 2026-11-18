/** Auto-switch planner (ADR-0020 W2): exact cut frames on scripted envelopes, the shot rules, determinism, the refusals. */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, MULTICAM_AUTO_LABEL, multicamAutoDecisions, planMulticamAuto, RecipeError,
  type Asset, type LevelEnvelope, type MulticamGroup, type OpCall, type PlanContext, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const cam = (c: string): Omit<Asset, 'id'> => ({ kind: 'video', name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(120, 1), video: { width: 1280, height: 720, frameRate: R, codec: 'h264', rotation: 0, frameCount: 3600 }, provenance });
const rec = (c: string): Omit<Asset, 'id'> => ({ kind: 'audio', name: `${c}.wav`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(120, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance });
const q = (verdict: 'reference' | 'confident') => ({ verdict, peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null });

/** A wide camera, two close-ups and a dual-channel recorder (host ch 1, guest ch 2); a program of one wide segment of `seconds`. */
function setup(seconds = 60, speakers?: MulticamGroup['speakers'], hostOffsetSeconds = -0.5) {
  const r = applyTransaction(createProject({ id: 'prj_auto', name: 'auto', width: 1280, height: 720, frameRate: R }), [
    { op: 'import_asset', args: { asset: cam('a') } }, { op: 'import_asset', args: { asset: cam('b') } }, { op: 'import_asset', args: { asset: cam('c') } }, { op: 'import_asset', args: { asset: rec('d') } },
  ], { idSeed: 'au_', actor: 'test', allowInternal: true });
  const [W, H, G, MIC] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string];
  const r2 = applyTransaction(r.doc, [{ op: 'add_clip', args: { assetId: W, start: f(0), duration: f(seconds * 30), withLinkedAudio: false } }], { idSeed: 'au2_', actor: 'test' });
  const clipId = r2.results[0]!.output!.clipId as string;
  const doc: ProjectDocument = structuredClone(r2.doc);
  const off = (s: number) => [{ group: T.rt(s * 48000, 48000), source: T.ZERO }];
  const group: MulticamGroup = {
    id: 'mcg_a', name: 'Podcast', sampleRate: 48000, referenceAngleId: 'mic', wideAngleId: 'wide',
    angles: [
      { id: 'mic', label: 'Recorder', kind: 'sound', pieces: [{ assetId: MIC, anchors: off(0), quality: q('reference') }] },
      { id: 'wide', label: 'Wide', kind: 'picture', pieces: [{ assetId: W, anchors: off(0), quality: q('confident') }] },
      { id: 'host', label: 'Host', kind: 'picture', pieces: [{ assetId: H, anchors: off(hostOffsetSeconds), quality: q('confident') }] },
      { id: 'guest', label: 'Guest', kind: 'picture', pieces: [{ assetId: G, anchors: off(-1), quality: q('confident') }] },
    ],
    speakers: speakers ?? [
      { id: 'spk_h', label: 'Host', micAngleId: 'mic', channel: 0, shotAngleId: 'host' },
      { id: 'spk_g', label: 'Guest', micAngleId: 'mic', channel: 1, shotAngleId: 'guest' },
    ],
    origin: { method: 'test', params: {}, createdAt: 'x', createdBy: 'test', edited: false },
  };
  doc.multicam = { mcg_a: group };
  for (const s of Object.values(doc.sequences)) for (const t of s.tracks) for (const c of t.clips) if (c.id === clipId && c.type === 'media') c.multicam = { groupId: 'mcg_a', angleId: 'wide' };
  return { doc, MIC, clipId };
}
/** Envelope of the recorder from a script of [from s, to s, host dB, guest dB]; everything else is −80 dB. */
function envelope(assetId: string, seconds: number, script: [number, number, number, number][]): LevelEnvelope {
  const F = seconds * 100, h = new Int16Array(F).fill(-8000), g = new Int16Array(F).fill(-8000);
  for (const [a, b, dh, dg] of script) for (let i = Math.round(a * 100); i < Math.round(b * 100); i++) { h[i] = dh * 100; g[i] = dg * 100; }
  return { assetId, rate: 100, frames: F, channels: [h, g], mix: h.map((v, i) => Math.max(v, g[i]!)), flux: new Float32Array(F) };
}
// host 0–10 s; silence 10–13; guest 13–25; both 25–27; host 27–45 with a 200 ms guest blip at 40; silence 45–60
const SCRIPT: [number, number, number, number][] = [[0, 10, -20, -35], [13, 25, -35, -20], [25, 27, -20, -20], [27, 40, -20, -35], [40, 40.2, -35, -20], [40.2, 45, -20, -35]];
const cutsOf = (ops: OpCall[]) => ops.flatMap((o) => (o.args as any).cuts.map((c: any) => [T.frameIndexAt(c.at, R), c.angleId]));

describe('multicam auto-switch planner', () => {
  it('cuts at exact frames on a scripted conversation (pre-roll, holds, minimum shot)', () => {
    const { doc, MIC } = setup();
    const ctx: PlanContext = { multicamLevels: { [MIC]: envelope(MIC, 120, SCRIPT) } };
    const plan = planMulticamAuto(doc, { groupId: 'mcg_a' }, ctx);
    // host from 0; wide at 10 s (silence ≥ 2 s); guest 200 ms before 13 s; wide at 25 s (both ≥ 1 s); host at 27 s, not 26.8 s
    // (the wide shot must last 2 s); the 200 ms guest blip is ignored; wide at 45 s (silence)
    expect(cutsOf(plan.ops)).toEqual([[0, 'host'], [300, 'wide'], [384, 'guest'], [750, 'wide'], [810, 'host'], [1350, 'wide']]);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]!.args).toMatchObject({ groupId: 'mcg_a', coverage: 'clip', until: { at: f(1800) } });
    expect(plan.steps[0]).toBe(MULTICAM_AUTO_LABEL);
    expect(plan.basis.join('\n')).toMatch(/Screen time: Host .* s \(\d+%\)/);
    expect(plan.basis.join('\n')).toMatch(/6 shot\(s\), 5 cut\(s\); mean shot 10\.0 s/);
    expect(plan.basis.join('\n')).toMatch(/Unsure decisions \(margin below 3 dB\): 0/);
  });
  it('a cut waits for its angle\'s picture: a host camera that starts 1 s into the program is cut to at minShot, not at 0', () => {
    // switch_angles with coverage 'clip' keeps the wide where the host has no picture, so a cut at 0 would leave a 1 s wide shot
    const { doc, MIC } = setup(60, undefined, 1);
    const ctx: PlanContext = { multicamLevels: { [MIC]: envelope(MIC, 120, SCRIPT) } };
    const cuts = cutsOf(planMulticamAuto(doc, { groupId: 'mcg_a' }, ctx).ops);
    expect(cuts.slice(0, 2)).toEqual([[0, 'wide'], [60, 'host']]);
    const frames = cuts.map((c) => c[0] as number), ends = [...frames.slice(1), 1800];
    frames.forEach((c, i) => expect(ends[i]! - c).toBeGreaterThanOrEqual(60));
  });
  it('speech in syllables (150 ms on, 120 ms off) is one turn: the switch follows the turns, not the syllables', () => {
    const { doc, MIC } = setup();
    const script: [number, number, number, number][] = [];
    for (let t = 0; t < 8; t += 0.27) script.push([t, t + 0.15, -20, -35]);
    for (let t = 8; t < 16; t += 0.27) script.push([t, t + 0.15, -35, -20]);
    const cuts = cutsOf(planMulticamAuto(doc, { groupId: 'mcg_a' }, { multicamLevels: { [MIC]: envelope(MIC, 120, script) } }).ops);
    // host from 0; guest 200 ms before the first guest syllable at 8 s (frame 240 − 6); wide once the talk stops (silence ≥ 2 s)
    expect(cuts.slice(0, 2)).toEqual([[0, 'host'], [234, 'guest']]);
    expect(cuts[2]?.[1]).toBe('wide');
  });
  it('the same input gives byte-identical operations', () => {
    const { doc, MIC } = setup();
    const ctx = { multicamLevels: { [MIC]: envelope(MIC, 120, SCRIPT) } };
    expect(JSON.stringify(planMulticamAuto(doc, { groupId: 'mcg_a' }, ctx))).toBe(JSON.stringify(planMulticamAuto(structuredClone(doc), { groupId: 'mcg_a' }, { multicamLevels: { [MIC]: envelope(MIC, 120, SCRIPT) } })));
  });
  it('no shot is shorter than minShot, whatever the conversation', () => {
    const { doc, MIC } = setup(110);
    let seed = 3;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let trial = 0; trial < 20; trial++) {
      const script: [number, number, number, number][] = [];
      for (let t = 0; t < 110;) { const d = 0.1 + rnd() * 3, k = Math.floor(rnd() * 4); script.push([t, Math.min(110, t + d), k === 0 || k === 2 ? -20 : -35, k === 1 || k === 2 ? -20 : -35]); t += d + (rnd() < 0.3 ? rnd() * 3 : 0); }
      for (const minShotSeconds of [1, 2, 3.5]) {
        const cuts = cutsOf(planMulticamAuto(doc, { groupId: 'mcg_a', minShotSeconds }, { multicamLevels: { [MIC]: envelope(MIC, 120, script) } }).ops).map((c) => c[0] as number);
        const ends = [...cuts.slice(1), 3300];
        cuts.forEach((c, i) => expect(ends[i]! - c, `trial ${trial} minShot ${minShotSeconds}`).toBeGreaterThanOrEqual(Math.round(minShotSeconds * 30)));
      }
    }
  });
  it('at least 1 s of both talking gives the wide shot; less does not', () => {
    const { doc, MIC } = setup();
    const both = (d: number) => cutsOf(planMulticamAuto(doc, { groupId: 'mcg_a' }, { multicamLevels: { [MIC]: envelope(MIC, 120, [[0, 20, -20, -35], [20, 20 + d, -20, -20], [20 + d, 40, -20, -35], [40, 60, -35, -20]]) } }).ops);
    expect(both(1.2)).toEqual([[0, 'host'], [600, 'wide'], [660, 'host'], [1194, 'guest']]);
    expect(both(0.6)).toEqual([[0, 'host'], [1194, 'guest']]);
  });
  it('maxShot cuts a long shot to the wide angle and back', () => {
    const { doc, MIC } = setup();
    const cuts = cutsOf(planMulticamAuto(doc, { groupId: 'mcg_a', maxShotSeconds: 20 }, { multicamLevels: { [MIC]: envelope(MIC, 120, [[0, 50, -20, -35], [50, 60, -35, -20]]) } }).ops);
    expect(cuts).toEqual([[0, 'host'], [600, 'wide'], [1200, 'host'], [1494, 'guest']]);
  });
  it('refuses two speakers on the same mic and channel, and mics that move together', () => {
    const same = setup(60, [{ id: 's1', label: 'A', micAngleId: 'mic', channel: 0, shotAngleId: 'host' }, { id: 's2', label: 'B', micAngleId: 'mic', channel: 0, shotAngleId: 'guest' }]);
    const e = (() => { try { planMulticamAuto(same.doc, { groupId: 'mcg_a' }, { multicamLevels: { [same.MIC]: envelope(same.MIC, 120, SCRIPT) } }); } catch (x) { return x; } return null; })();
    expect(e).toBeInstanceOf(RecipeError);
    expect((e as RecipeError).message).toMatch(/same mic and channel/);
    const { doc, MIC } = setup();
    const together = envelope(MIC, 120, [[0, 10, -20, -21], [12, 30, -30, -31], [33, 50, -18, -19]]);
    expect(() => planMulticamAuto(doc, { groupId: 'mcg_a' }, { multicamLevels: { [MIC]: together } })).toThrow(/cannot be told apart/);
  });
  it('protected ranges (segments edited by hand) are never touched: the cut list leaves them out', () => {
    const { doc, MIC } = setup();
    const ctx: PlanContext = { multicamLevels: { [MIC]: envelope(MIC, 120, SCRIPT) }, protectedRanges: [{ start: f(700), end: f(900) }] };
    const plan = planMulticamAuto(doc, { groupId: 'mcg_a' }, ctx);
    const spans = plan.ops.map((o) => [T.frameIndexAt((o.args as any).cuts[0].at, R), T.frameIndexAt((o.args as any).until.at, R)]);
    expect(spans).toEqual([[0, 700], [900, 1800]]);
    expect(cutsOf(plan.ops)).toEqual([[0, 'host'], [300, 'wide'], [384, 'guest'], [900, 'host'], [1350, 'wide']]);
    expect(plan.basis.join('\n')).toMatch(/Kept as edited by hand: 1/);
  });
  it('honest refusals: no group, no speakers, no envelope', () => {
    const { doc, MIC } = setup();
    expect(() => planMulticamAuto(doc, { groupId: 'nope' }, {})).toThrow(/not found/);
    expect(() => planMulticamAuto(doc, { groupId: 'mcg_a' }, {})).toThrow(RecipeError);
    const none = setup(60, []);
    expect(() => planMulticamAuto(none.doc, { groupId: 'mcg_a' }, { multicamLevels: { [MIC]: envelope(MIC, 120, SCRIPT) } })).toThrow(/no speakers/);
    expect(multicamAutoDecisions(doc, { groupId: 'mcg_a' }, { multicamLevels: { [MIC]: envelope(MIC, 120, SCRIPT) } })[0]).toEqual({ frame: 0, angleId: 'host' });
  });
});
