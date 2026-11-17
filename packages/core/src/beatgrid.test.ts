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

  it('lists the beats around the moment where they are on the timeline, numbered from the first bar start', () => {
    const { doc } = project(); // beats at source 1.0, 1.5 … 10.5; the clip shows source 0.5 … 10.5 from timeline second 2
    const p = beatPositionAt(doc, f(150))!; // timeline 5.0 s = beat 5
    expect(p.at).toBe(5); expect(p.sinceFirstBar).toBeCloseTo(5, 9); expect(p.followedFrom).toBe(-Infinity); // followed since second 2, which is longer ago than the window
    expect(beatPositionAt(doc, f(75))!.followedFrom).toBe(2);
    expect(p.hits).toEqual([3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7].map((t, k) => ({ t, index: k + 1 }))); // two seconds each way
    // the same beat is the same entry from wherever it is listed
    expect(beatPositionAt(doc, f(100))!.hits.find((h) => h.index === 3)).toEqual(p.hits.find((h) => h.index === 3));
    // only beats inside the clip: the beat at source 10.5 is at the clip's end, which is not part of it
    expect(beatPositionAt(doc, f(350))!.hits.map((h) => h.t)).toEqual([10, 10.5, 11, 11.5]);
    expect(beatPositionAt(doc, f(60))!.hits.map((h) => h.t)).toEqual([2.5, 3, 3.5, 4]);
    // bars that begin at the third beat: that beat is number 0, the two before it are -2 and -1, and the count does not start again at the next bar
    const late = project(undefined, [ms(2000), ms(4000)]).doc;
    const q = beatPositionAt(late, f(60))!;
    expect(q.hits.map((h) => h.index)).toEqual([-2, -1, 0, 1]);
    expect(q.sinceFirstBar).toBeCloseTo(-3, 9); expect(q.sinceBar).toBeCloseTo(-1, 9);
    const r = beatPositionAt(late, f(255))!; // timeline 8.5 s = beat 12: two beats into the bar that began at beat 10 (source 6.0 is not a listed bar start: the last one is 4.0 = beat 6)
    expect(r.sinceFirstBar).toBeCloseTo(10, 9); expect(r.sinceBar).toBeCloseTo(6, 9);
    // without bars the first beat is number 0
    expect(beatPositionAt(project(undefined, undefined).doc, f(60))!.hits.map((h) => h.index)).toEqual([0, 1, 2, 3]);
    // at double speed the beats are half as far apart on the timeline
    const { doc: d2, clipId } = project();
    const fast = tx(d2, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc;
    expect(beatPositionAt(fast, f(60))!.hits.map((h) => h.t)).toEqual([2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4]);
  });

  it('(reported) a gradual speed change that was trimmed or split: the spacing and the places of the beats are those of the part that is left', () => {
    for (const curve of ['even', 'smooth'] as const) for (const how of ['trim', 'split-right', 'split-left', 'whole'] as const) {
      // two minutes of music with a beat every half second; one minute of it sped up gradually from 1x to 4x (24 s on the timeline)
      let r = tx(createProject({ id: 'prj_r', name: 'R' }), [{ op: 'import_asset', args: { asset: { ...song, duration: T.rt(120, 1) } } }], true);
      const assetId = r.results[0]!.output!.assetId as string;
      r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-16T00:00:00Z', times: Array.from({ length: 240 }, (_, i) => ms(i * 500)), bpm: 120 } }], true);
      r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(1800) } }]);
      const clipId = r.results[0]!.output!.clipId as string;
      r = tx(r.doc, [{ op: 'set_clip_speed_ramp', args: { clipId, from: 1, to: 4, curve } }]);
      if (how === 'trim') r = tx(r.doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(360) } }]);
      else if (how !== 'whole') r = tx(r.doc, [{ op: 'split_clip', args: { clipId, at: f(360) } }]);
      const doc = r.doc;
      for (const frame of how === 'split-left' || how === 'whole' ? [30, 200, 340] : [362, 400, 500, 700]) {
        const label = `${curve} ${how} frame ${frame}`;
        const p = beatPositionAt(doc, f(frame))!;
        // the spacing is what the beat count itself does around the moment: beats per second = 1 / period
        const perSecond = (beatPositionAt(doc, T.add(f(frame), ms(40)))!.beat - beatPositionAt(doc, T.sub(f(frame), ms(40)))!.beat) / 0.08;
        expect(p.period * perSecond, label).toBeGreaterThan(0.97); expect(p.period * perSecond, label).toBeLessThan(1.03);
        // each listed beat is where the beat count passes a whole number, with that number
        expect(p.hits.length, label).toBeGreaterThan(3);
        for (const h of p.hits.slice(1, -1)) expect(beatPositionAt(doc, T.rt(Math.round(h.t * 1e6), 1_000_000))!.beat, label).toBeCloseTo(h.index, 3);
      }
    }
  });

  it('(reported) lists the beats of every piece of music as it is heard around the moment, and says since when music has been followed without a break', () => {
    const { doc, assetId, clipId } = project(); // the music plays from second 2 to second 12, with beats at 2.5, 3 … 11.5
    const whole = beatPositionAt(doc, f(190))!;
    // cut in two at second 6 (and again at 6.2 and 7): the pieces' beats are listed exactly as those of the uncut clip, from either side of a cut
    let cut = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(180) } }]).doc;
    for (const at of [186, 210]) cut = tx(cut, [{ op: 'split_clip', args: { clipId: beatPositionAt(cut, f(at))!.clipId, at: f(at) } }]).doc;
    for (const frame of [150, 179, 180, 185, 190, 215]) {
      const uncut = beatPositionAt(doc, f(frame))!, pieces = beatPositionAt(cut, f(frame))!;
      expect(pieces.hits, `frame ${frame}`).toEqual(uncut.hits);
      expect(pieces.followedFrom, `frame ${frame}`).toBe(uncut.followedFrom);
    }
    expect(beatPositionAt(cut, f(190))!.clipId).not.toBe(clipId);
    expect(beatPositionAt(cut, f(190))!.hits).toEqual(whole.hits);
    // another piece later on the same track, after a pause of 1.33 s: the last beat before the pause is still listed, and the music has been followed only since the piece began
    const later = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(400), duration: f(60) } }]).doc;
    const after = beatPositionAt(later, f(405))!; // 13.5 s; the piece shows the file from its start, so its first beat (file second 1) is at 14.333 s
    expect(after.hits.map((h) => [Number(h.t.toFixed(3)), h.index])).toEqual([[11.5, 18], [14.333, 0], [14.833, 1]]);
    expect(after.followedFrom).toBeCloseTo(400 / 30, 9);
    expect(beatPositionAt(later, f(380))).toBeNull(); // in the pause nothing is followed
    // a piece on a second sound track under the first (tracks are followed in their order): it is heard from second 1, the
    // first track's music takes over at second 2 and hands back at second 12. Each beat is listed for the clip that is the music at that beat.
    let r = tx(doc, [{ op: 'add_track', args: { kind: 'audio' } }]);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, trackId: r.results[0]!.output!.trackId as string, start: f(30), duration: f(450) } }]);
    const under = r.results[0]!.output!.clipId as string;
    const before = beatPositionAt(r.doc, f(45))!; // 1.5 s: the lower piece is the music, its own beats at 2.0, 2.5 … fall where the upper one is
    expect(before.clipId).toBe(under);
    expect(before.hits).toEqual([{ t: 2.5, index: 0 }, { t: 3, index: 1 }, { t: 3.5, index: 2 }]);
    expect(before.followedFrom).toBe(1);
    expect(beatPositionAt(r.doc, f(80))).toMatchObject({ clipId, followedFrom: 1 }); // the upper piece took over without a break
    const handedBack = beatPositionAt(r.doc, f(400))!; // 13.333 s: the lower piece again; the file's last beat (file second 10.5) passed in it at 11.5 s, while the upper piece was the music
    expect(handedBack.clipId).toBe(under);
    expect(handedBack.hits).toEqual([{ t: 11.5, index: 18 }]); // the upper piece's beat there: the same moment, listed once
    expect(handedBack.followedFrom).toBe(-Infinity);
    // a muted track is not followed and its beats are not listed
    const lower = Object.values(r.doc.sequences)[0]!.tracks.find((t) => t.clips.some((c) => c.id === under))!;
    const muted = tx(r.doc, [{ op: 'update_track', args: { trackId: lower.id, muted: true } }]).doc;
    expect(beatPositionAt(muted, f(45))).toBeNull();
    expect(beatPositionAt(muted, f(350))!.hits.map((h) => h.t)).toEqual([10, 10.5, 11, 11.5]);
  });
});
