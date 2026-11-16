import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, beatPositionAt, createProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ms = (n: number) => T.rt(n, 1000);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `b${n++}_`, actor: 'test', allowInternal });
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' } };

/** Music whose beats fall every half second from 1.0 s (bars every four beats), placed at timeline second 2 from its own second 0.5. */
function project(beats = Array.from({ length: 20 }, (_, i) => ms(1000 + i * 500)), downbeats: T.RationalTime[] | undefined = [ms(1000), ms(3000), ms(5000)]) {
  let r = tx(createProject({ id: 'prj_b', name: 'B' }), [{ op: 'import_asset', args: { asset: song } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-16T00:00:00Z', times: beats, bpm: 120, ...(downbeats ? { downbeats, meter: 4 } : {}) } }], true);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(60), sourceIn: ms(500), duration: f(300) } }]);
  return { doc: r.doc, assetId, clipId: r.results[0]!.output!.clipId as string };
}

describe('beat position on the timeline', () => {
  it('counts beats from the first analysed beat through the clip\'s place and source start, and from the bar start', () => {
    const { doc, clipId } = project();
    // timeline 2.5 s = source 1.0 s = the first beat, which starts a bar
    const first = beatPositionAt(doc, f(75))!;
    expect(first.clipId).toBe(clipId);
    expect(first.beat).toBeCloseTo(0, 9); expect(first.sinceBar).toBeCloseTo(0, 9); expect(first.period).toBeCloseTo(0.5, 9);
    // a quarter of a beat later
    expect(beatPositionAt(doc, T.add(f(75), ms(125)))!.beat).toBeCloseTo(0.25, 9);
    // timeline 5.0 s = source 3.5 s = beat 5, one beat after the bar that starts at 3.0 s
    const later = beatPositionAt(doc, f(150))!;
    expect(later.beat).toBeCloseTo(5, 9); expect(later.sinceBar).toBeCloseTo(1, 9);
    // before the first beat the grid is continued backwards: timeline 2.0 s = source 0.5 s = one beat early
    expect(beatPositionAt(doc, f(60))!.beat).toBeCloseTo(-1, 9);
    // outside the clip, and on a project with no analysed music, there is nothing to follow
    expect(beatPositionAt(doc, f(59))).toBeNull();
    expect(beatPositionAt(doc, f(360))).toBeNull();
  });

  it('follows uneven beats, speed changes and muting', () => {
    const uneven = project([ms(1000), ms(1400), ms(2200), ms(2600)], undefined);
    // source 1.8 s lies half-way between the beats at 1.4 and 2.2
    const mid = beatPositionAt(uneven.doc, T.add(f(60), ms(1300)))!;
    expect(mid.beat).toBeCloseTo(1.5, 9); expect(mid.sinceBar).toBeCloseTo(1.5, 9); expect(mid.period).toBeCloseTo(0.8, 9);
    // after the last beat the last interval continues
    expect(beatPositionAt(uneven.doc, T.add(f(60), ms(2500)))!.beat).toBeCloseTo(3 + 0.4 / 0.4, 9);
    // at double speed the same music reaches its beats twice as fast and they are half as far apart
    const { doc, clipId } = project();
    const fast = tx(doc, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc;
    const p = beatPositionAt(fast, T.add(f(60), ms(250)))!; // 0.25 s into the clip = 0.5 s of source after 0.5 = source 1.0 = beat 0
    expect(p.beat).toBeCloseTo(0, 9); expect(p.period).toBeCloseTo(0.25, 9);
    // a muted track is not heard, so nothing follows it
    const track = Object.values(doc.sequences)[0]!.tracks.find((t) => t.clips.some((c) => c.id === clipId))!;
    const muted = tx(doc, [{ op: 'update_track', args: { trackId: track.id, muted: true } }]).doc;
    expect(beatPositionAt(muted, f(75))).toBeNull();
  });
});
