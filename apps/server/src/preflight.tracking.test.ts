/**
 * Preflight warns about motion tracking problems (ADR-0015): a clip that follows a track where the tracking is lost or
 * uncertain (follow_track_loss) or whose followed picture is absent (follow_target_missing), and a privacy region whose
 * tracking is lost or uncertain (redact_track_loss). Ranges are timeline frames, found by the evaluator, so speed and reverse
 * map them exactly as they render. Warnings only, never blockers. The exporter is a stub (labelled as such): only its plan is
 * read here, and it reports nothing.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@pulseframe/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/engine')>();
  const core = await import('@pulseframe/core');
  /**
   * LABELLED TEST DOUBLE until W1 merges (tracking wave): the evaluator does not yet set LayerLook.follow or
   * VideoLayer.regions. Where the real evaluate leaves them out for a clip that has a follow or privacy regions, this fills
   * them per their contract (packages/core/src/tracking.ts): the sample state at the picture's sourceFrameIndex, 'outside'
   * beyond the track, 'target-missing' when the followed picture is not on the target track; whole = a bad state and
   * onLoss 'frame' (WITHOUT the closing filter of lossFlags). Once the real evaluator sets them, it is used unchanged.
   */
  const stateAt = (t: import('@pulseframe/core').MotionTrack, frame: number) => { const i = frame - t.from; return i < 0 || i >= t.st.length ? 'outside' as const : core.TRACK_STATES[t.st[i]!]!; };
  const evaluate: typeof real.evaluate = (doc, time, sequenceId) => {
    const g = real.evaluate(doc, time, sequenceId);
    const clipOf = (id: string) => { for (const s of Object.values(doc.sequences)) for (const tr of s.tracks) for (const c of tr.clips) if (c.id === id) return c; return undefined; };
    for (const l of g.layers) {
      if (l.kind === 'caption') continue;
      const c = clipOf(l.clipId);
      if (!c) continue;
      if (l.kind === 'video' && c.type === 'media' && c.redact && l.regions === undefined)
        l.regions = c.redact.map((r) => {
          const t = r.motionTrackId ? doc.motionTracks[r.motionTrackId] : undefined;
          const state = t ? stateAt(t, l.sourceFrameIndex) : 'fixed' as const;
          const bad = state === 'outside' || state === 'unknown' || state === 'lost' || (state === 'weak' && r.weakIsLost);
          return { id: r.id, shape: r.shape, x: r.x, y: r.y, width: r.width, height: r.height, feather: r.feather, style: r.style, strength: r.strength, color: r.color, whole: bad && r.onLoss === 'frame', state, sourceFrame: l.sourceFrameIndex };
        });
      if (c.type !== 'caption' && c.follow && l.follow === undefined) {
        const t = doc.motionTracks[c.follow.motionTrackId];
        const target = g.layers.find((x) => x.kind === 'video' && x.trackId === c.follow!.targetTrackId && x.assetId === t?.assetId);
        l.follow = t && target && target.kind === 'video'
          ? { motionTrackId: t.id, state: stateAt(t, target.sourceFrameIndex), sourceFrame: target.sourceFrameIndex, confidence: 0, targetClipId: target.clipId }
          : { motionTrackId: c.follow.motionTrackId, state: 'target-missing', sourceFrame: null, confidence: 0, targetClipId: null };
      }
    }
    return g;
  };
  return { ...real, evaluate };
});

import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, ST, type MotionTrack, type OpCall, type ProjectDocument, type RedactRegion } from '@pulseframe/core';
import type { Exporter } from './export.ts';
import { preflight } from './preflight.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pt${n++}_`, actor: 'test', allowInternal });
const stubExporter = { plan: () => ({ blockers: [], warnings: [] }) } as unknown as Exporter;
const asset = {
  kind: 'video' as const, name: 'walk.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
};
const region = (onLoss: RedactRegion['onLoss'], motionTrackId: string | null = 'mtk_p'): RedactRegion => ({ id: 'rg1', motionTrackId, shape: 'ellipse', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0.15, feather: 0.01, style: 'blur', strength: 0.8, color: '#000000', onLoss, weakIsLost: true });

/**
 * A 120-frame clip of a 240-frame video (optionally at a speed or reversed), its 240-sample track (states per source frame
 * from `states`), a title over the same span that follows the track on the clip's own video track (or on `target`), and a
 * privacy region along the track. Follow and regions are set on the document directly: this tests preflight, not the ops.
 */
function build(o: { speed?: number; reverse?: boolean; onLoss?: RedactRegion['onLoss']; states: (frame: number) => number; follow?: boolean; redact?: RedactRegion | null; target?: 'own' | 'empty' }) {
  let r = tx(createProject({ id: 'prj_pt', name: 'PT' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(120), withLinkedAudio: false } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  let doc = r.doc;
  if (o.speed) doc = tx(doc, [{ op: 'set_clip_speed', args: { clipId, speed: o.speed } }]).doc;
  if (o.reverse) doc = tx(doc, [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }]).doc;
  const st = Array.from({ length: 240 }, (_, i) => o.states(i));
  const track: MotionTrack = { id: 'mtk_p', assetId, name: 'face', kind: 'point', from: 0, x: st.map(() => 5000), y: st.map(() => 5000), q: st.map((s) => (s === ST.tracked ? 90 : 30)), st, origin: { method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z', createdBy: 'test', edited: false } };
  doc = tx(doc, [{ op: 'restore_entities', args: { targets: [{ id: track.id, state: { kind: 'motionTrack', track } }] } }], true).doc;
  const media = findClip(doc, clipId)!;
  let targetTrackId = media.track.id;
  if (o.target === 'empty') { const t = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }]); doc = t.doc; targetTrackId = t.results[0]!.output!.trackId as string; }
  r = tx(doc, [{ op: 'add_text', args: { text: 'label', start: media.clip.start, duration: media.clip.duration } }]);
  const textId = r.results[0]!.output!.clipId as string;
  doc = structuredClone(r.doc);
  if (o.follow !== false) { const t = findClip(doc, textId)!.clip; if (t.type !== 'caption') t.follow = { motionTrackId: 'mtk_p', targetTrackId, scale: false, smooth: 0 }; }
  const redact = o.redact === undefined ? region(o.onLoss ?? 'hold') : o.redact;
  if (redact) { const m = findClip(doc, clipId)!.clip; if (m.type === 'media') m.redact = [redact]; }
  return { doc, clipId, textId, frames: T.frameIndexAt(media.clip.duration, R) };
}
const lost = (from: number, to: number, also: (i: number) => number | undefined = () => undefined) => (i: number) => also(i) ?? (i >= from && i < to ? ST.lost : ST.tracked);
const ranges = (doc: ProjectDocument, code: string) => preflight(stubExporter, doc, 1).issues.filter((i) => i.code === code).map((i) => i.range);

describe('preflight: motion tracking (lost source frames 30–49)', () => {
  it('speed 1: followers and privacy regions are flagged on timeline frames 30–49, as warnings that never block', () => {
    const { doc, clipId, textId } = build({ states: lost(30, 50) });
    const pf = preflight(stubExporter, doc, 1);
    const follow = pf.issues.filter((i) => i.code === 'follow_track_loss');
    const redact = pf.issues.filter((i) => i.code === 'redact_track_loss');
    expect(follow.map((i) => i.range)).toEqual([{ startFrame: 30, endFrame: 50 }]);
    expect(redact.map((i) => i.range)).toEqual([{ startFrame: 30, endFrame: 50 }]);
    expect([...follow, ...redact].every((i) => i.severity === 'warning')).toBe(true);
    expect(pf.ok).toBe(true);
    expect(pf.blockers).toBe(0);
    expect(follow[0]!.ids).toEqual([textId, 'mtk_p']);
    expect(redact[0]!.ids).toEqual([clipId, 'mtk_p']);
    expect(redact[0]!.message).toContain('automatic tracking is not guaranteed redaction');
    expect(redact[0]!.message).toMatch(/^on frames 30–49 the tracking of the privacy region on "walk\.mp4" \("face"\) is lost; the region holds its last usable position/);
    expect(follow[0]!.message).toMatch(/^on frames 30–49 the title "label" follows "face" where the tracking is lost/);
    expect(pf.scope).toMatch(/motion tracking/);
  });
  it('speed 2: the same source frames are timeline frames 15–24', () => {
    const { doc } = build({ speed: 2, states: lost(30, 50) });
    expect(ranges(doc, 'follow_track_loss')).toEqual([{ startFrame: 15, endFrame: 25 }]);
    expect(ranges(doc, 'redact_track_loss')).toEqual([{ startFrame: 15, endFrame: 25 }]);
  });
  it('reversed: the 120-frame clip shows source 119 first, so source frames 30–49 are timeline frames 70–89', () => {
    const { doc } = build({ reverse: true, states: lost(30, 50) });
    expect(ranges(doc, 'follow_track_loss')).toEqual([{ startFrame: 70, endFrame: 90 }]);
    expect(ranges(doc, 'redact_track_loss')).toEqual([{ startFrame: 70, endFrame: 90 }]);
  });
  it('weak samples count too (not usable for a follower; weak is lost for privacy by default), each stretch its own issue', () => {
    const { doc } = build({ states: lost(30, 50, (i) => (i >= 60 && i < 65 ? ST.weak : undefined)) });
    expect(ranges(doc, 'follow_track_loss')).toEqual([{ startFrame: 30, endFrame: 50 }, { startFrame: 60, endFrame: 65 }]);
    expect(ranges(doc, 'redact_track_loss')).toEqual([{ startFrame: 30, endFrame: 50 }, { startFrame: 60, endFrame: 65 }]);
  });
  it('onLoss "frame": the whole-picture fallback covers the lost stretch (the closing filter may widen it by up to ⌈fps/3⌉ source frames each way)', () => {
    const { doc } = build({ onLoss: 'frame', states: lost(30, 50) });
    const pf = preflight(stubExporter, doc, 1);
    const [issue, ...more] = pf.issues.filter((i) => i.code === 'redact_track_loss');
    expect(more).toEqual([]);
    expect(issue!.range!.startFrame).toBeLessThanOrEqual(30);
    expect(issue!.range!.endFrame).toBeGreaterThanOrEqual(50);
    expect(issue!.range!.startFrame).toBeGreaterThanOrEqual(20);
    expect(issue!.range!.endFrame).toBeLessThanOrEqual(60);
    expect(issue!.message).toContain('the whole picture is blurred there instead');
    expect(issue!.message).toContain('automatic tracking is not guaranteed redaction');
  });
  it('a follower whose picture is not on its target track: follow_target_missing over the whole clip', () => {
    const { doc, textId } = build({ states: () => ST.tracked, target: 'empty', redact: null });
    const pf = preflight(stubExporter, doc, 1);
    const issues = pf.issues.filter((i) => i.code.startsWith('follow_') || i.code.startsWith('redact_'));
    expect(issues.map((i) => [i.code, i.range])).toEqual([['follow_target_missing', { startFrame: 0, endFrame: 120 }]]);
    expect(issues[0]!.ids[0]).toBe(textId);
    expect(issues[0]!.severity).toBe('warning');
  });
  it('a track that is fine, a fixed region, or nothing bound: no tracking issue', () => {
    expect(preflight(stubExporter, build({ states: () => ST.tracked }).doc, 1).issues.filter((i) => /^(follow|redact)_/.test(i.code))).toEqual([]);
    expect(ranges(build({ states: lost(30, 50), follow: false, redact: region('frame', null) }).doc, 'redact_track_loss')).toEqual([]);
    expect(preflight(stubExporter, build({ states: lost(30, 50), follow: false, redact: null }).doc, 1).issues.filter((i) => /^(follow|redact)_/.test(i.code))).toEqual([]);
  });
  it('many short stretches: the first 20 are listed and the rest counted in one more issue', () => {
    const { doc } = build({ states: (i) => (i < 100 && i % 4 === 1 ? ST.lost : ST.tracked), redact: null });
    const issues = preflight(stubExporter, doc, 1).issues.filter((i) => i.code === 'follow_track_loss');
    expect(issues).toHaveLength(21);
    expect(issues.slice(0, 20).map((i) => i.range)).toEqual(Array.from({ length: 20 }, (_, k) => ({ startFrame: 4 * k + 1, endFrame: 4 * k + 2 })));
    expect(issues[20]!.range).toBeUndefined();
    expect(issues[20]!.message).toMatch(/^5 more stretch\(es\) of the same problem on the title "label", 5 frame\(s\) in all, from frame 81 to frame 97/);
  });
});
