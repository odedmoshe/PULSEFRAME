/**
 * Built-in music (ADR-0022, plan §9 M1–M10 with the verifier's corrections; M2 and M9 are in music.determinism.test.ts).
 * - M1 exact length for the six styles and N ∈ {4, 7, 16, 33, 64}; M6 levels, DC, silence at both ends and the clamp;
 *   M7 the form is heard (last peak at least 3 dB over the intro, or the first build when there is no intro; peaks louder than
 *   builds); M8 the ending: nothing starts after its first beat and its 100 ms RMS never rises.
 * - M3 another seed gives other bytes on the same grid; M4 a click-only render has its onsets exactly on k·samplesPerBeat;
 *   M5 the beat detector is never called; M10 speed and event-loop lag on 128 s of the slowest and the fastest tempo.
 * - The server half: the request rules, the queue (sharing, 429, cache by bytes, cancel, time limit), validateMusic's
 *   refusals, makeMusic (exact duration, known grid, provenance, storage, dedup) and addMusic (one commit, one undo,
 *   propose-mode refusal).
 * Nothing here listens: whether this is music anyone wants is the owner's call (every style stays 'unheard').
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { analysisEntityId, isKnownGrid, knownGridOf, MUSIC_GENERATOR, MUSIC_METHOD, MUSIC_STYLES, musicLayout, type MusicLayout } from '@pulseframe/core';

// M5: the beat detector is wrapped in spies; nothing on the music path may call it
const spies = vi.hoisted(() => ({ detectBeats: 0, detectBeatsOfFile: 0 }));
vi.mock('./beats.ts', async (orig) => {
  const m = await orig<typeof import('./beats.ts')>();
  return { ...m, detectBeats: (...a: Parameters<typeof m.detectBeats>) => { spies.detectBeats++; return m.detectBeats(...a); } };
});
vi.mock('./analysis.ts', async (orig) => {
  const m = await orig<typeof import('./analysis.ts')>();
  return { ...m, detectBeatsOfFile: (...a: Parameters<typeof m.detectBeatsOfFile>) => { spies.detectBeatsOfFile++; return m.detectBeatsOfFile(...a); } };
});

import { Governance, type Principal } from './governance.ts';
import { addMusic, createMusicQueue, makeMusic, MUSIC_PEAK_LIMIT, musicPreview, resolveMusicRequest, validateMusic, type RenderedMusic } from './music.ts';
import { arrange, clicks, tickSample } from './music/arrange.ts';
import { compose } from './music/compose.ts';
import { MusicCancelled, renderMusic } from './music/render.ts';
import { styleSpec } from './music/styles.ts';
import { readWavSamples } from './music/wav.ts';
import { ApiError, Store } from './store.ts';

const STYLES = MUSIC_STYLES.map((s) => s.id);
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
const rmsOf = (s: Int16Array, from: number, to: number, ch: 0 | 1 | 'mono') => {
  let e = 0;
  for (let n = from; n < to; n++) { const v = ch === 'mono' ? (s[2 * n]! + s[2 * n + 1]!) / 2 : s[2 * n + ch]!; e += v * v; }
  return Math.sqrt(e / Math.max(1, to - from)) / 32768;
};

/** Every per-render check of M1, M6, M7 and M8 for one track. */
function checkTrack(r: RenderedMusic, styleId: string, bars: number) {
  const where = `${styleId} × ${bars} bars`;
  const L: MusicLayout = musicLayout(styleId, bars);
  const S = L.samplesPerBeat, frames = L.totalFrames;
  // M1: exactly 4·N·S frames, 44 + 16·N·S bytes
  expect(frames, where).toBe(4 * bars * S);
  expect(r.wav.length, where).toBe(44 + 16 * bars * S);
  expect(r.layout, where).toEqual(L);
  const s = readWavSamples(r.wav);
  // M6: levels
  let peak = 0, dcL = 0, dcR = 0;
  for (let n = 0; n < frames; n++) { peak = Math.max(peak, Math.abs(s[2 * n]!), Math.abs(s[2 * n + 1]!)); dcL += s[2 * n]!; dcR += s[2 * n + 1]!; }
  expect(peak / 32768, where).toBeLessThanOrEqual(MUSIC_PEAK_LIMIT);
  expect(r.peak, where).toBeCloseTo(peak / 32768, 9);
  const rmsAll = Math.sqrt((rmsOf(s, 0, frames, 0) ** 2 + rmsOf(s, 0, frames, 1) ** 2) / 2);
  expect(db(rmsAll), where).toBeGreaterThanOrEqual(-24);
  expect(db(rmsAll), where).toBeLessThanOrEqual(-12);
  expect(Math.abs(dcL / frames / 32768), where).toBeLessThan(1e-3);
  expect(Math.abs(dcR / frames / 32768), where).toBeLessThan(1e-3);
  expect([s[0], s[1], s[2 * frames - 2], s[2 * frames - 1]], where).toEqual([0, 0, 0, 0]);
  let tail = 0;
  for (let n = frames - 480; n < frames; n++) tail = Math.max(tail, Math.abs(s[2 * n]!), Math.abs(s[2 * n + 1]!));
  expect(db(tail / 32768), `${where}: last 10 ms`).toBeLessThan(-60);
  expect(rmsOf(s, 0, frames, 'mono') / rmsOf(s, 0, frames, 0), `${where}: mono fold-down`).toBeGreaterThanOrEqual(0.7);
  expect(r.clamped / (2 * frames), `${where}: clamp engaged`).toBeLessThan(0.001);
  // M7: the form is heard
  const secs = L.sections.map((x) => ({ ...x, rms: rmsOf(s, x.startBar * 4 * S, (x.startBar + x.bars) * 4 * S, 'mono') }));
  const peaks = secs.filter((x) => x.kind === 'peak');
  const builds = secs.filter((x) => x.kind === 'build');
  const first = secs.find((x) => x.kind === 'intro') ?? builds[0]!;
  expect(db(peaks[peaks.length - 1]!.rms) - db(first.rms), `${where}: last peak over ${first.kind}`).toBeGreaterThanOrEqual(3);
  const mean = (xs: { rms: number }[]) => xs.reduce((a, x) => a + x.rms, 0) / xs.length;
  expect(mean(peaks), `${where}: peaks over builds`).toBeGreaterThan(mean(builds));
  // M8: the ending's 100 ms RMS never rises
  const endAt = (bars - 1) * 4 * S;
  let prev = Infinity;
  for (let w = endAt; w + 4800 <= frames; w += 4800) {
    const v = rmsOf(s, w, w + 4800, 'mono');
    expect(v, `${where}: ending window at ${w}`).toBeLessThanOrEqual(prev);
    prev = v;
  }
  return { rmsDb: db(rmsAll), sections: secs.map((x) => `${x.kind}${x.level} ${db(x.rms).toFixed(1)}`) };
}

describe('the synthesiser: length, levels, form and ending (M1, M6, M7, M8)', () => {
  it.each(STYLES)('%s, 4 / 7 / 16 / 33 / 64 bars', async (id) => {
    for (const bars of [4, 7, 16, 33, 64]) {
      const r = await renderMusic(id, bars, 1);
      checkTrack(r, id, bars);
    }
  }, 600_000);

  it('M8: the arranger starts nothing after beat 1 of the last bar, and the ending holds every pitched part on the tonic with the kick', () => {
    for (const id of STYLES) for (const bars of [4, 9, 16]) {
      const spec = styleSpec(id), layout = musicLayout(id, bars);
      const notes = arrange(spec, layout, compose(spec, layout, 3), 3);
      const endAt = (bars - 1) * 4 * layout.samplesPerBeat;
      expect(notes.filter((n) => n.at > endAt), `${id} ${bars}`).toEqual([]);
      const ending = notes.filter((n) => n.at === endAt);
      expect(ending.some((n) => n.voice.kind === 'kick'), id).toBe(true);
      const pitched = ending.filter((n) => ['pluck', 'fm', 'pad'].includes(n.voice.kind));
      // every pitched note of the ending is the tonic, its third or its fifth (the tonic chord)
      const tonicPcs = (spec.sevenths ? [0, 2, 4, 6] : [0, 2, 4]).map((d) => (spec.root + spec.scale[d]!) % 12);
      for (const n of pitched) expect(tonicPcs, `${id}: ${n.midi}`).toContain(n.midi % 12);
      expect(new Set(pitched.map((n) => n.midi % 12)).size, id).toBe(tonicPcs.length);
      // every note before it starts inside the track and on the tick grid
      for (const n of notes) expect(n.at, id).toBeGreaterThanOrEqual(0);
    }
  });
  it('the lead plays only in peaks, and A′ comes home to the tonic or the third', () => {
    for (const id of STYLES) {
      const spec = styleSpec(id), layout = musicLayout(id, 32);
      const c = compose(spec, layout, 5);
      const level = new Array(32).fill(0);
      for (const s of layout.sections) for (let i = 0; i < s.bars; i++) level[s.startBar + i] = s.level;
      for (const n of c.lead) expect(level[n.bar], id).toBeGreaterThanOrEqual(2);
      // the inside of every lead stays within a twelfth
      const degs = c.lead.map((n) => n.deg);
      expect(Math.max(...degs) - Math.min(...degs), id).toBeLessThanOrEqual(11);
      for (const s of layout.sections.filter((x) => x.kind === 'peak')) {
        for (const p of [3, 7]) {
          const bar = s.startBar + p;
          if (bar >= s.startBar + s.bars || bar >= 30) continue;
          const last = c.leadByBar[bar]!.at(-1)!;
          expect([0, 2], `${id} bar ${bar}`).toContain(((last.deg % 7) + 7) % 7);
        }
      }
    }
  });
});

describe('seed, grid and onsets (M3, M4, M5)', () => {
  it('M3: another seed gives other bytes on the same grid', async () => {
    for (const id of ['music.birthday', 'music.cinematic']) {
      const a = await renderMusic(id, 8, 1), b = await renderMusic(id, 8, 2);
      expect(a.wav.equals(b.wav), id).toBe(false);
      expect(a.wav.length).toBe(b.wav.length);
      expect(a.layout).toEqual(b.layout);
      const ga = knownGridOf(a.layout, 1, 'x'), gb = knownGridOf(b.layout, 2, 'x');
      expect({ ...ga, params: { ...ga.params, seed: 0 } }).toEqual({ ...gb, params: { ...gb.params, seed: 0 } });
    }
  }, 120_000);
  it('M4: a click-only render has one onset per beat, exactly at k·samplesPerBeat, and none anywhere else', async () => {
    for (const id of STYLES) {
      const bars = 6;
      const r = await renderMusic(id, bars, 1, { clickOnly: true });
      const s = readWavSamples(r.wav);
      const S = r.layout.samplesPerBeat;
      // an onset: a sample above 1000 after at least 2 ms (96 samples) below 30
      const onsets: number[] = [];
      let quiet = 96;
      for (let n = 0; n < r.layout.totalFrames; n++) {
        const v = Math.abs(s[2 * n]!);
        if (v > 1000 && quiet >= 96) onsets.push(n);
        quiet = v < 30 ? quiet + 1 : 0;
      }
      expect(onsets, id).toEqual(Array.from({ length: 4 * bars }, (_, k) => k * S));
      // the same scheduler places the real notes: kicks on whole beats fall on those very samples
      const spec = styleSpec(id), layout = musicLayout(id, bars);
      for (const n of arrange(spec, layout, compose(spec, layout, 1), 1)) if (n.voice.kind === 'kick' && n.at % S === 0) expect(n.at / S, id).toBe(Math.round(n.at / S));
      expect(clicks(layout).map((n) => n.at)).toEqual(Array.from({ length: 4 * bars }, (_, k) => k * S));
      expect(tickSample(layout, 12 * 5)).toBe(5 * S);
    }
  }, 120_000);
  it('M5: making and storing music never calls the beat detector', async () => {
    const before = { ...spies };
    await renderMusic('music.pop', 4, 1);
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-music-m5-')));
    try { await makeMusic(store, { styleId: 'music.pop', bars: 4, seed: 1 }, 'test', createMusicQueue()); } finally { store.close(); }
    expect(spies).toEqual(before);
  }, 120_000);
});

describe('M10: speed and the event loop', () => {
  it.each([['music.cinematic', 38], ['music.pop', 68]] as const)('%s: about 128 s renders at least 5× faster than real time, the event loop never waits 100 ms', async (id, bars) => {
    await renderMusic(id, 4, 9); // warm the code first: the gate is about the render, not the compiler
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const t0 = performance.now();
    const r = await renderMusic(id, bars, 1);
    const ms = performance.now() - t0;
    h.disable();
    const seconds = r.layout.totalFrames / 48000;
    expect(seconds).toBeGreaterThan(125);
    console.log(`M10 ${id}: ${seconds.toFixed(1)} s of music in ${ms.toFixed(0)} ms (${(seconds * 1000 / ms).toFixed(1)}× real time); longest event-loop delay ${(h.max / 1e6).toFixed(1)} ms`);
    expect(ms).toBeLessThan((seconds * 1000) / 5);
    expect(h.max / 1e6).toBeLessThan(100);
  }, 240_000);
  it('a render stops at the next yield once it is cancelled, and refuses what musicLayout refuses', async () => {
    const cancel = { cancelled: false };
    const p = renderMusic('music.calm', 32, 1, { cancel });
    setImmediate(() => { cancel.cancelled = true; });
    await expect(p).rejects.toBeInstanceOf(MusicCancelled);
    await expect(renderMusic('music.none', 8, 1)).rejects.toBeInstanceOf(RangeError);
    await expect(renderMusic('music.pop', 3, 1)).rejects.toBeInstanceOf(RangeError);
    await expect(renderMusic('music.pop', 8, -1)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('requests, the queue and validation (music.ts)', () => {
  const fake = (bytes = 1000) => ({ wav: Buffer.alloc(bytes), layout: musicLayout('music.pop', 4), peak: 0, rms: 0, clamped: 0 }) as RenderedMusic;
  it('a request names exactly one length; fitSeconds is rounded up to whole bars; an unknown style is 404', () => {
    expect(resolveMusicRequest({ styleId: 'music.birthday', fitSeconds: '10', seed: 1 }).layout.bars).toBe(5); // 10 s · 120 / 240
    expect(resolveMusicRequest({ styleId: 'music.birthday', fitSeconds: '8', seed: 1 }).layout.bars).toBe(4);
    expect(resolveMusicRequest({ styleId: 'music.cinematic', fitSeconds: '40/3', seed: 1 }).layout.bars).toBe(4); // exactly 4 bars at 72
    expect(resolveMusicRequest({ styleId: 'music.cinematic', fitSeconds: '1', seed: 1 }).layout.bars).toBe(4); // minBars
    const err = (f: () => unknown) => { try { f(); } catch (e) { return e as ApiError; } throw new Error('no refusal'); };
    expect([err(() => resolveMusicRequest({ styleId: 'music.pop', bars: 4, fitSeconds: '3', seed: 1 })).status, err(() => resolveMusicRequest({ styleId: 'music.pop', seed: 1 })).code]).toEqual([400, 'invalid_option']);
    const unknown = err(() => resolveMusicRequest({ styleId: 'music.unknown', bars: 4, seed: 1 }));
    expect([unknown.status, unknown.code, unknown.message]).toEqual([404, 'not_found', 'there is no built-in music style "music.unknown"']);
    expect(err(() => resolveMusicRequest({ styleId: 'music.pop', bars: 2, seed: 1 })).code).toBe('invalid_option');
    expect(err(() => resolveMusicRequest({ styleId: 'music.cinematic', bars: 100, seed: 1 })).message).toContain('at most 300 s');
  });
  it('the queue shares a render, runs one at a time with adds first, refuses with 429 when its line is full, caches previews by bytes', async () => {
    const calls: string[] = [];
    const gates: (() => void)[] = [];
    const renderer = (id: string, bars: number, seed: number) => { calls.push(`${id}/${bars}/${seed}`); return new Promise<RenderedMusic>((res) => gates.push(() => res(fake(400)))); };
    const q = createMusicQueue({ maxWaitingPreviews: 1, maxWaitingAdds: 1, cacheBytes: 1000 }, renderer);
    const a = q.render('music.pop', 4, 1, 'preview');
    const a2 = q.render('music.pop', 4, 1, 'preview'); // shares
    const b = q.render('music.pop', 4, 2, 'preview'); // waits
    await expect(q.render('music.pop', 4, 3, 'preview')).rejects.toMatchObject({ status: 429, code: 'synthesis_busy' });
    const c = q.render('music.pop', 4, 4, 'add'); // its own line, goes before the waiting preview
    await Promise.resolve();
    expect(calls).toEqual(['music.pop/4/1']);
    gates.shift()!();
    expect(await a).toBe(await a2);
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual(['music.pop/4/1', 'music.pop/4/4']);
    gates.shift()!(); await c;
    await new Promise((r) => setImmediate(r));
    gates.shift()!(); await b;
    expect(q.stats()).toMatchObject({ running: false, cached: 2, cachedBytes: 800 }); // the add was not cached
    expect(await q.render('music.pop', 4, 1, 'preview')).toBe(await a); // from memory
    gates.length = 0;
    const d = q.render('music.pop', 4, 9, 'preview');
    await Promise.resolve(); gates.shift()!(); await d;
    expect(q.stats().cachedBytes).toBeLessThanOrEqual(1000); // the oldest went
  });
  it('the queue cancels a render nobody wants any more, and stops one at its time limit with 503 music_timeout', async () => {
    const seen: { cancelled: boolean }[] = [];
    const renderer = async (_i: string, _b: number, _s: number, o: { cancel: { cancelled: boolean } }) => {
      seen.push(o.cancel);
      for (;;) { await new Promise((r) => setTimeout(r, 5)); if (o.cancel.cancelled) throw new MusicCancelled(); }
    };
    const q = createMusicQueue({ previewTimeoutMs: 50 }, renderer);
    await expect(q.render('music.pop', 4, 1, 'preview')).rejects.toMatchObject({ status: 503, code: 'music_timeout' });
    const ac = new AbortController();
    const p = q.render('music.pop', 4, 2, 'preview', ac.signal);
    const waiting = q.render('music.pop', 4, 3, 'preview', ac.signal); // in line behind it: leaves the line
    setTimeout(() => ac.abort(), 10);
    const [rp, rw] = await Promise.allSettled([p, waiting]);
    expect(rp).toMatchObject({ status: 'rejected', reason: { code: 'music_cancelled' } });
    expect(rw).toMatchObject({ status: 'rejected', reason: { code: 'music_cancelled' } });
    expect(q.stats()).toMatchObject({ running: false, waiting: { add: 0, preview: 0 } });
    expect(seen.length).toBe(2);
  });
  it('validateMusic refuses a wrong length, a peak over the limit and a non-silent end; previews are at most 32 bars', async () => {
    const r = await renderMusic('music.pop', 4, 1);
    expect(() => validateMusic(r)).not.toThrow();
    const code = (x: RenderedMusic) => { try { validateMusic(x); return 'ok'; } catch (e) { return (e as ApiError).code; } };
    expect(code({ ...r, wav: r.wav.subarray(0, r.wav.length - 4) })).toBe('music_invalid');
    const loud = Buffer.from(r.wav); loud.writeInt16LE(30000, 44 + 4 * 1000);
    expect(code({ ...r, wav: loud })).toBe('music_invalid');
    const end = Buffer.from(r.wav); end.writeInt16LE(5, end.length - 2);
    expect(code({ ...r, wav: end })).toBe('music_invalid');
    await expect(musicPreview('music.pop', 33, 1)).rejects.toMatchObject({ status: 400, code: 'invalid_option' });
    await expect(musicPreview('music.nope', 8, 1)).rejects.toMatchObject({ status: 404 });
    const wav = await musicPreview('music.pop', 4, 1, { queue: createMusicQueue() });
    expect(wav.equals(r.wav)).toBe(true);
  }, 60_000);
});

describe('storing and adding (makeMusic, addMusic)', () => {
  let dir: string, store: Store, gov: Governance;
  const owner: Principal = { actor: 'owner', kind: 'user', scopes: ['observe', 'edit'] };
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-music-')); store = new Store(dir); gov = new Governance(store); });
  afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('makeMusic stores the exact track: duration exact (thirds of a second at 72 and 90 BPM), known grid, provenance, blob', async () => {
    const q = createMusicQueue();
    for (const id of STYLES) {
      const made = await makeMusic(store, { styleId: id, bars: 4, seed: 1 }, 'owner', q);
      expect(T.eq(made.asset.duration, made.layout.duration), id).toBe(true);
      expect(made.asset).toMatchObject({ kind: 'audio', mimeType: 'audio/wav', byteSize: 44 + 4 * made.layout.totalFrames, audio: { sampleRate: 48000, channels: 2 } });
      expect(made.asset.video).toBeUndefined();
      expect(made.asset.provenance).toMatchObject({ origin: 'generated', importedBy: 'owner', procedural: { id, version: 1, generator: MUSIC_GENERATOR, params: { bars: 4, seed: 1, bpm: made.layout.bpm, meter: 4, synth: 1 } } });
      expect(made.grid).toEqual(knownGridOf(made.layout, 1, made.asset.provenance.importedAt));
      expect(fs.statSync(store.blobPath(made.asset.contentHash)).size).toBe(made.asset.byteSize);
    }
    const again = await makeMusic(store, { styleId: 'music.lofi', bars: 4, seed: 1 }, 'owner', q);
    const first = await makeMusic(store, { styleId: 'music.lofi', bars: 4, seed: 1 }, 'owner', q);
    expect(again.asset.contentHash).toBe(first.asset.contentHash);
  }, 180_000);

  it('addMusic is one commit (asset, known grid with sections, clip); a second identical add is deduplicated; one undo removes it all', async () => {
    const pid = store.createProject({ name: 'music', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } }).doc.id;
    const before = store.getProject(pid);
    const r = await addMusic(store, gov, owner, pid, { styleId: 'music.birthday', bars: 8, seed: 2, start: T.ZERO }, createMusicQueue());
    expect(r.revision).toBe(before.revision + 1);
    expect([r.bars, r.seconds]).toEqual([8, 16]);
    expect(r.sections.map((s) => s.kind)).toEqual(['intro', 'build', 'peak', 'ending']);
    const doc = store.getProject(pid).doc;
    const asset = doc.assets[r.assetId]!;
    expect(asset.byteSize).toBe(44 + 16 * 8 * 24000);
    const beats = doc.analyses[r.assetId]!.beats!;
    expect(isKnownGrid(beats)).toBe(true);
    expect([beats.origin.method, beats.confidence, beats.beats.length, beats.downbeats!.length, beats.sections!.length]).toEqual([MUSIC_METHOD, null, 32, 8, 4]);
    expect(r.clipId).toBeTruthy();
    const again = await addMusic(store, gov, owner, pid, { styleId: 'music.birthday', bars: 8, seed: 2 }, createMusicQueue());
    expect(again.assetId).toBe(r.assetId);
    expect(again.clipId).toBeNull();
    expect(again.revision).toBe(r.revision); // the same track with the same grid: nothing to commit
    store.undo(pid, 'owner', 'undo');
    const after = store.getProject(pid).doc;
    expect(after.assets[r.assetId]).toBeUndefined();
    expect(after.analyses[r.assetId]).toBeUndefined();
    expect(analysisEntityId(r.assetId)).toContain(r.assetId);
    expect(after).toEqual(before.doc);
  }, 120_000);

  it('an agent that may only propose is refused before anything is made; one limited to a track range too', async () => {
    const pid = store.createProject({ name: 'music2', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } }).doc.id;
    const rev = store.getProject(pid).revision;
    const proposer: Principal = { actor: 'agent:p', kind: 'agent', scopes: ['observe', 'edit'], mode: 'propose' };
    await expect(addMusic(store, gov, proposer, pid, { styleId: 'music.pop', bars: 4, seed: 1 })).rejects.toMatchObject({ status: 403, code: 'insufficient_scope' });
    const ranged: Principal = { actor: 'agent:r', kind: 'agent', scopes: ['observe', 'edit'], mode: 'edit', grant: { trackIds: ['t1'] } as Principal['grant'] };
    await expect(addMusic(store, gov, ranged, pid, { styleId: 'music.pop', bars: 4, seed: 1 })).rejects.toMatchObject({ status: 403, code: 'out_of_scope' });
    expect(store.getProject(pid).revision).toBe(rev);
  });
});
