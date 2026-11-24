/**
 * Player.setPictureDoc / follow / draftOnly (ADR-0020). The real Player, the real audioPlan and evaluate; only the drawing is a
 * labelled stand-in (Node has no canvas). "Playing" is set directly on the player (a flag the transport sets), because no audio
 * device exists here: what is tested is whether a document swap pauses it.
 */
import { describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MULTICAM_OPS_BUILT, type OpCall, type ProjectDocument } from '@pulseframe/core';
import type { MediaPool } from './media.ts';
import { Player } from './player.ts';

// ---- labelled stand-ins (test only) ----
const drawn = vi.hoisted(() => ({ calls: [] as { pool: unknown; w: number; h: number; quality: unknown }[] }));
vi.mock('@pulseframe/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/engine')>();
  return { ...real, drawGraph: async (ctx: { canvas: { width: number; height: number } }, _g: unknown, provider: unknown, opts?: { quality?: unknown }) => { drawn.calls.push({ pool: provider, w: ctx.canvas.width, h: ctx.canvas.height, quality: opts?.quality }); return { missing: [], unavailableEffects: [] }; } };
});
class FakeCanvas {
  width = 0; height = 0; dataset: Record<string, string> = {};
  getContext() { return { canvas: this, drawImage: () => {} }; }
}
vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
const pool = { frames: { tag: 'full' }, draftFrames: { tag: 'draft' } } as unknown as MediaPool;
// ---- end of stand-ins ----

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pm${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
function project() {
  const img = { kind: 'image' as const, name: 'a.png', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 320, height: 180, codec: 'png', hasAlpha: false }, provenance: prov };
  const aud = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
  let r = tx(createProject({ id: 'prj_pm', name: 'PM', frameRate: R, width: 320, height: 180 }), [{ op: 'import_asset', args: { asset: img } }, { op: 'import_asset', args: { asset: aud } }], true);
  const [I, A] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: I, start: T.ZERO, duration: T.rt(10, 1) } }, { op: 'add_clip', args: { assetId: A, start: T.ZERO, duration: T.rt(10, 1) } }]);
  return { doc: r.doc, picture: r.results[0]!.output!.clipId as string, sound: r.results[1]!.output!.clipId as string };
}
function playing(doc: ProjectDocument, opts?: ConstructorParameters<typeof Player>[4]) {
  const p = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, pool, () => {}, (e) => { throw e; }, opts);
  p.doc = doc;
  p.frame = 30;
  (p as unknown as { playing: boolean }).playing = true;
  const pause = vi.spyOn(p, 'pause').mockImplementation(() => { (p as unknown as { playing: boolean }).playing = false; });
  vi.spyOn(p, 'shuttle').mockImplementation(() => {}); // setDoc resumes through the audio device, which Node has not
  return { p, pause };
}

describe('setPictureDoc', () => {
  it('a change to picture only replaces the document without a pause (master-sound mode)', () => {
    const { doc, picture } = project();
    const edited = tx(doc, [{ op: 'set_clip_transform', args: { clipId: picture, transform: { x: 0.2 } } }] as OpCall[]).doc;
    const { p, pause } = playing(doc);
    expect(p.setPictureDoc(edited)).toBe(true);
    expect(pause).not.toHaveBeenCalled();
    expect(p.doc).toBe(edited);
    expect(p.playing).toBe(true);
  });
  it('falls back to setDoc (a pause and a restart) when a sound clip changes', () => {
    const { doc, sound } = project();
    const edited = tx(doc, [{ op: 'trim_clip', args: { clipId: sound, edge: 'end', to: T.rt(5, 1) } }]).doc;
    const { p, pause } = playing(doc);
    const set = vi.spyOn(p, 'setDoc');
    expect(p.setPictureDoc(edited)).toBe(false);
    expect(set).toHaveBeenCalledWith(edited);
    expect(pause).toHaveBeenCalled();
  });
  it('a document swap while play() waits for the audio device restarts through setDoc, not into a stuck state', async () => {
    const { doc, picture } = project();
    const edited = tx(doc, [{ op: 'set_clip_transform', args: { clipId: picture, transform: { x: 0.2 } } }] as OpCall[]).doc;
    let resume!: () => void;
    class FakeAudio { sampleRate = 48000; state = 'suspended'; currentTime = 0; destination = {}; resume() { return new Promise<void>((r) => { resume = () => { this.state = 'running'; r(); }; }); } close() { return Promise.resolve(); } }
    vi.stubGlobal('AudioContext', FakeAudio);
    try {
      const p = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, pool, () => {}, (e) => { throw e; });
      p.doc = doc;
      const shuttle = vi.spyOn(p, 'shuttle').mockImplementation(() => {}); // the restart goes through the audio device, which Node has not
      const started = p.play();
      expect(p.active).toBe(true);
      expect(p.playing).toBe(false);
      expect(p.setPictureDoc(edited)).toBe(false); // sound was planned from the old document: a restart, as setDoc does
      expect(p.doc).toBe(edited);
      expect(shuttle).toHaveBeenCalledWith(1); // setDoc asked for the restart; before the fix nothing did, and the player stayed active forever
      resume?.();
      await started;
      expect(p.playing).toBe(false); // the stale play() did not start on the old document
    } finally { vi.unstubAllGlobals(); vi.stubGlobal('document', { createElement: () => new FakeCanvas() }); }
  });
  // A switch_angles projection only changes picture clips (master-sound mode), so audioPlan is equal and nothing restarts.
  // Runs once W1's ops are in the registry (MULTICAM_OPS_BUILT); until then it is skipped and says so.
  it.skipIf(!MULTICAM_OPS_BUILT)('a switch_angles projection does not restart (needs W1 merged)', () => {
    const vid = (c: string) => ({ kind: 'video' as const, name: `cam-${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 320, height: 180, codec: 'h264', frameRate: R, rotation: 0, frameCount: 1800 }, provenance: prov });
    const mic = { kind: 'audio' as const, name: 'mic.wav', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
    let r = tx(createProject({ id: 'prj_pg', name: 'PG', frameRate: R, width: 320, height: 180 }), [{ op: 'import_asset', args: { asset: vid('a') } }, { op: 'import_asset', args: { asset: vid('b') } }, { op: 'import_asset', args: { asset: mic } }], true);
    const [A, B, M] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
    r = tx(r.doc, [{ op: 'create_multicam', args: { name: 'G', angles: [{ assetIds: [A] }, { assetIds: [B] }, { assetIds: [M] }] } }]);
    const made = r.results[0]!.output as { groupId: string; angleIds: string[] };
    r = tx(r.doc, made.angleIds.slice(0, 2).map((angleId) => ({ op: 'set_multicam_sync', args: { groupId: made.groupId, angleId, pieceIndex: 0, offset: T.ZERO } })));
    r = tx(r.doc, [{ op: 'place_multicam', args: { groupId: made.groupId, at: T.ZERO, angleId: made.angleIds[0], range: { from: T.ZERO, to: T.rt(10, 1) } } }]);
    const placed = r.results[0]!.output as { sequenceId: string; videoTrackId: string };
    const switched = tx(r.doc, [{ op: 'switch_angles', args: { groupId: made.groupId, sequenceId: placed.sequenceId, trackId: placed.videoTrackId, cuts: [{ groupTime: T.rt(5, 1), angleId: made.angleIds[1] }], coverage: 'clip' } }]).doc;
    const { p, pause } = playing(r.doc);
    expect(p.setPictureDoc(switched)).toBe(true);
    expect(pause).not.toHaveBeenCalled();
    expect(p.doc).toBe(switched);
    expect(p.playing).toBe(true);
  });
});

describe('draftOnly and follow', () => {
  it('draws from the draft frames at a height of at most maxHeight, and never plays', async () => {
    const { doc } = project();
    const v = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, pool, () => {}, (e) => { throw e; }, { draftOnly: { maxHeight: 90 } });
    drawn.calls.length = 0;
    v.setDoc(doc);
    await vi.waitFor(() => expect(drawn.calls.length).toBeGreaterThan(0));
    expect(drawn.calls.at(-1)).toMatchObject({ pool: pool.draftFrames, h: 90, w: 160 });
    await v.play();
    expect(v.playing).toBe(false);
  });
  it('follow draws the frame asked for with no transport', async () => {
    const { doc } = project();
    const v = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, pool, () => {}, (e) => { throw e; }, { draftOnly: { maxHeight: 90 } });
    v.setDoc(doc);
    v.follow(45);
    await vi.waitFor(() => expect(v.painted).toBe(45));
    expect(v.playing).toBe(false);
  });
});

describe('pictureQuality (the quality prefetch warms)', () => {
  it('is the quality pump() draws with: draft for the angle viewer and for playback at a reduced size, else full', async () => {
    const { doc } = project();
    const big = { ...doc, settings: { ...doc.settings, width: 3840, height: 2160 } };
    const viewer = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, pool, () => {}, (e) => { throw e; }, { draftOnly: { maxHeight: 400 } });
    viewer.doc = doc;
    expect(viewer.pictureQuality()).toBe('draft'); // even when the project is smaller than maxHeight
    const small = playing(doc).p;
    expect(small.pictureQuality()).toBe('full'); // 180 lines play at full size: the original
    const large = playing(big).p;
    expect(large.pictureQuality()).toBe('draft');
    (large as unknown as { playing: boolean }).playing = false;
    expect(large.pictureQuality()).toBe('full'); // paused: the real picture
    // and pump() drew with the provider of that quality
    drawn.calls.length = 0;
    (large as unknown as { playing: boolean }).playing = true;
    large.follow(10);
    await vi.waitFor(() => expect(drawn.calls.length).toBeGreaterThan(0));
    expect(drawn.calls.at(-1)!.pool).toBe(pool.draftFrames);
  });
  it('drawGraph gets the same quality (ADR-0005 amendment of 2026-11-24): draft while playing a reduced picture and in the angle viewer; full when paused and when playing at full size', async () => {
    const { doc } = project();
    const big = { ...doc, settings: { ...doc.settings, width: 1920, height: 1080 } };
    const last = async (p: Player, frame: number) => { drawn.calls.length = 0; p.follow(frame); await vi.waitFor(() => expect(drawn.calls.length).toBeGreaterThan(0)); return drawn.calls.at(-1)!; };
    const large = playing(big).p;
    expect(await last(large, 10)).toMatchObject({ pool: pool.draftFrames, quality: 'draft', h: 960 });
    (large as unknown as { playing: boolean }).playing = false;
    expect(await last(large, 11)).toMatchObject({ pool: pool.frames, quality: 'full', h: 1080 }); // paused: the picture a still shows
    expect(await last(playing(doc).p, 12)).toMatchObject({ pool: pool.frames, quality: 'full', h: 180 }); // 180 lines play at full size
    const viewer = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, pool, () => {}, (e) => { throw e; }, { draftOnly: { maxHeight: 90 } });
    viewer.doc = doc;
    expect(await last(viewer, 13)).toMatchObject({ pool: pool.draftFrames, quality: 'draft' });
  });
});

describe('paintedDoc (what prefetch plans from)', () => {
  it('is the document of the frame on screen: after setPictureDoc it stays the old one until a frame of the new one is painted', async () => {
    const { doc, picture } = project();
    const edited = tx(doc, [{ op: 'set_clip_transform', args: { clipId: picture, transform: { x: 0.2 } } }] as OpCall[]).doc;
    const { p } = playing(doc);
    p.follow(30);
    await vi.waitFor(() => expect(p.paintedDoc).toBe(doc));
    expect(p.setPictureDoc(edited)).toBe(true);
    expect(p.doc).toBe(edited);
    expect(p.paintedDoc).toBe(doc); // its first frame is still being drawn
    await vi.waitFor(() => expect(p.paintedDoc).toBe(edited));
  });
});
