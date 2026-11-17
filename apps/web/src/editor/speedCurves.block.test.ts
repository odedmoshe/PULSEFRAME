/**
 * The speed-curve tiles are held, with a sentence, for a clip the op would refuse for every curve. The verdict is read from
 * the document (curveBlocker) and checked here against the op itself: where the tiles are held the op refuses, and where they
 * are live it applies.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { curveBlocker } from './speedCurves.apply.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const film = (c: string) => ({
  kind: 'video' as const, name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance,
});
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance };

let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `b${n++}_`, actor: 'test', allowInternal });
/** Two pictures with their linked sound, back to back from 0 to 5 s and 5 to 10 s, each starting 2 s into its file (so each has unused source after it). */
function project() {
  let r = tx(createProject({ id: 'prj_b', name: 'B', frameRate: R }), [{ op: 'import_asset', args: { asset: film('a') } }, { op: 'import_asset', args: { asset: film('b') } }, { op: 'import_asset', args: { asset: song } }], true);
  const [a, b, s] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: a, start: f(0), sourceIn: T.rt(2, 1), duration: f(150) } },
    { op: 'add_clip', args: { assetId: b, start: f(150), sourceIn: T.rt(2, 1), duration: f(150) } },
  ]);
  const [one, two] = r.results.map((x) => ({ picture: x.output!.clipId as string, sound: x.output!.audioClipId as string }));
  return { doc: r.doc, one: one!, two: two!, song: s! };
}
/** What the op says to a curve on the clip: null when it applies, else its refusal. */
function opVerdict(doc: ProjectDocument, clipId: string): OpError | null {
  try { tx(doc, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]); return null; } catch (e) { if (e instanceof OpError) return e; throw e; }
}

describe('speed curves: what is refused is known before the click', () => {
  it('plain clips are open, and the op agrees', () => {
    const p = project();
    for (const id of [p.one.picture, p.one.sound, p.two.picture, p.two.sound]) {
      expect(curveBlocker(p.doc, id), id).toBeNull();
      expect(opVerdict(p.doc, id), id).toBeNull();
    }
  });

  it('a picture transition at the start of the next clip holds the clip before it, and the clip itself; picking it on their sound too', () => {
    const p = project();
    const doc = tx(p.doc, [{ op: 'set_transition', args: { clipId: p.two.picture, type: 'dissolve', frames: 10 } }]).doc;
    for (const id of [p.one.picture, p.two.picture, p.one.sound, p.two.sound]) {
      expect(curveBlocker(doc, id), id).toBe('transition');
      const refusal = opVerdict(doc, id);
      expect(refusal?.code, id).toBe('incompatible');
      expect(refusal?.message, id).toMatch(/transition/);
    }
    // removed again: open again
    const back = tx(doc, [{ op: 'set_transition', args: { clipId: p.two.picture, type: null } }]).doc;
    expect(curveBlocker(back, p.one.picture)).toBeNull();
    expect(opVerdict(back, p.one.picture)).toBeNull();
  });

  it('a sound crossfade holds both clips, also when the picture is the one selected (its linked sound is curved with it)', () => {
    const p = project();
    const doc = tx(p.doc, [{ op: 'set_audio_crossfade', args: { clipId: p.two.sound, duration: f(10) } }]).doc;
    for (const id of [p.one.picture, p.one.sound, p.two.picture, p.two.sound]) {
      expect(curveBlocker(doc, id), id).toBe('crossfade');
      const refusal = opVerdict(doc, id);
      expect(refusal?.code, id).toBe('incompatible');
      expect(refusal?.message, id).toMatch(/crossfade/);
    }
    const back = tx(doc, [{ op: 'set_audio_crossfade', args: { clipId: p.two.sound, duration: f(0) } }]).doc;
    expect(curveBlocker(back, p.two.picture)).toBeNull();
    expect(opVerdict(back, p.two.picture)).toBeNull();
  });

  it('a sound laid by hand over the end of another (not a crossfade) is an overlap; one lying wholly inside is not in the way', () => {
    const p = project();
    const track = findClip(p.doc, p.one.sound)!.track.id;
    const over = tx(p.doc, [{ op: 'add_clip', args: { assetId: p.song, trackId: track, start: f(120), duration: f(60) } }]); // 4 s to 6 s, over the cut at 5 s
    const songClip = over.results[0]!.output!.clipId as string;
    expect(curveBlocker(over.doc, p.one.picture)).toBe('overlap');
    expect(opVerdict(over.doc, p.one.picture)?.message).toMatch(/plays on over the start of the next clip/);
    expect(curveBlocker(over.doc, songClip)).toBe('overlap');
    expect(opVerdict(over.doc, songClip)?.code).toBe('incompatible');
    const inside = tx(p.doc, [{ op: 'add_clip', args: { assetId: p.song, trackId: track, start: f(30), duration: f(30) } }]); // 1 s to 2 s, inside the first sound
    expect(curveBlocker(inside.doc, p.one.picture)).toBeNull();
    expect(opVerdict(inside.doc, p.one.picture)).toBeNull();
  });

  it('a clip played backwards and a clip with keyframes are held too, as before', () => {
    const p = project();
    const reversed = tx(p.doc, [{ op: 'set_clip_reverse', args: { clipId: p.one.picture, reverse: true } }]).doc;
    expect(curveBlocker(reversed, p.one.picture)).toBe('reverse');
    expect(opVerdict(reversed, p.one.picture)?.code).toBe('incompatible');
    const keyed = tx(p.doc, [{ op: 'set_keyframe', args: { clipId: p.two.picture, property: 'opacity', time: f(0), value: 0.5 } }]).doc;
    expect(curveBlocker(keyed, p.two.picture)).toBe('keyframes');
    expect(opVerdict(keyed, p.two.picture)?.code).toBe('incompatible');
    expect(curveBlocker(keyed, 'no-such-clip')).toBeNull();
  });
});
