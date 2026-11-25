/**
 * Marked source ranges «פנינים», builder A: rangeUsage and screenTime against a plain per-frame scan, over seeded random documents.
 * The scan walks every project frame of every media clip and asks the evaluator's own mapping (speed.ts sourceFrameIndexAt for a
 * picture, pictureSourceAt for a sound) what it shows, then applies rule C6 with a LINEAR search for kHi; rangeUsage must report
 * exactly the same frames as one run per clip (it uses binary searches, a memo per lineage root and quick rejects). The documents
 * mix forward, reversed, sped-up, slowed, frozen and ramped clips (a reversed ramp too), sound clips, stills, a hidden track, a
 * second sequence, files at 30, 25 and 30000/1001 fps whose picture may start after time zero, a time-preserving copy (offset
 * 1.5 s) and an untimed copy, spans on frame edges and off them, and whole-file ranges. Projects run at 24, 25, 30 or 30000/1001.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  createProject, pictureSourceAt, rangeUsage, screenTime, sourceFrameIndexAt, sourceFrameOfTime, sourceTimeOfFrame,
  type Asset, type MediaClip, type ProjectDocument, type SourceRange,
} from './index.ts';

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const PROJECT_RATES: T.Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30, den: 1 }, { num: 30000, den: 1001 }];
const FILE_RATES: T.Rate[] = [{ num: 30, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }];
const hash = (i: number) => `sha256:${i.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const derived = (src: string, start?: T.RationalTime) => ({ origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test', derived: { jobId: 'j', capabilityId: 'c', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: [src], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: {}, ...(start ? { sourceRangeStart: start } : {}) } });

function randomDoc(seed: number): ProjectDocument {
  const rnd = rng(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <V>(xs: readonly V[]) => xs[int(xs.length)]!;
  const rate = pick(PROJECT_RATES);
  const doc = createProject({ id: 'prj_prop', name: 'prop', frameRate: rate });
  const video = (id: string, fr: T.Rate, frames: number, extra: Partial<Asset> = {}): Asset => ({
    id, kind: 'video', name: `${id}.mp4`, contentHash: hash(seed * 100 + id.length), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, fr),
    video: { width: 64, height: 36, frameRate: fr, codec: 'h264', rotation: 0, frameCount: frames, ...(rnd() < 0.25 ? { startTime: T.rt(int(40), 1000) } : {}) }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov, ...extra,
  } as Asset);
  doc.assets = {
    ast_a: video('ast_a', pick(FILE_RATES), 150 + int(150)),
    ast_b: video('ast_b', pick(FILE_RATES), 90 + int(120)),
    ast_copy: video('ast_copy', { num: 30, den: 1 }, 120, { provenance: derived('ast_a', T.rt(3, 2)) as Asset['provenance'] }),
    ast_rev: video('ast_rev', { num: 30, den: 1 }, 120, { provenance: derived('ast_a') as Asset['provenance'] }),
    ast_snd: { id: 'ast_snd', kind: 'audio', name: 's.wav', contentHash: hash(seed * 100 + 7), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(8, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov } as Asset,
    ast_img: { id: 'ast_img', kind: 'image', name: 'i.png', contentHash: hash(seed * 100 + 8), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 36, codec: 'png', hasAlpha: false }, provenance: prov } as Asset,
  };
  doc.people = { per_1: { id: 'per_1', name: 'אלף', birthDate: null }, per_2: { id: 'per_2', name: 'Gimel', birthDate: null }, per_3: { id: 'per_3', name: 'gimel ', birthDate: null } } as ProjectDocument['people'];
  let cn = 0;
  const ids = Object.keys(doc.assets);
  const randomClip = (start: number, onAudio: boolean): MediaClip => {
    const assetId = onAudio ? pick(['ast_a', 'ast_snd', 'ast_copy', 'ast_b']) : pick(ids.filter((i) => i !== 'ast_snd'));
    const asset = doc.assets[assetId]!;
    const frames = 5 + int(80);
    const sourceIn = asset.kind === 'image' ? T.ZERO : rnd() < 0.5 ? T.frameTime(int(T.frameIndexAt(asset.duration, rate)), rate) : T.rt(int(Math.floor(T.toSeconds(asset.duration) * 1000)), 1000);
    const shape = rnd();
    const speeds = [{ num: 1, den: 1 }, { num: 2, den: 1 }, { num: 1, den: 2 }, { num: 3, den: 2 }, { num: 1, den: 4 }];
    return {
      id: `clp_${seed}_${cn++}`, type: 'media', assetId, start: T.frameTime(start, rate), duration: T.frameTime(frames, rate), sourceIn, gain: 1, linkGroupId: null, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      ...(shape < 0.2 ? { reverse: true } : {}),
      ...(shape >= 0.2 && shape < 0.3 ? { freeze: true } : {}),
      ...(shape >= 0.3 && shape < 0.55 ? { speed: pick(speeds) } : {}),
      ...(shape >= 0.55 && shape < 0.75 ? { speed: pick(speeds), speedEnd: pick(speeds), ...(rnd() < 0.5 ? { speedCurve: 'smooth' } : {}), ...(rnd() < 0.3 ? { reverse: true } : {}) } : {}),
    } as MediaClip;
  };
  const track = (id: string, kind: 'video' | 'audio', hidden: boolean) => {
    const clips: MediaClip[] = [];
    let at = int(10);
    for (let i = 0, k = 2 + int(5); i < k; i++) { const c = randomClip(at, kind === 'audio'); clips.push(c); at += T.frameIndexAt(c.duration, rate) + int(8); }
    return { id, kind, name: id, locked: false, muted: false, hidden, clips };
  };
  const main = doc.sequences[doc.mainSequenceId]!;
  main.tracks = [track('trk_v1', 'video', false), track('trk_v2', 'video', rnd() < 0.5), track('trk_v3', 'video', false), track('trk_a1', 'audio', false)];
  doc.sequences.seq_two = { id: 'seq_two', name: 'two', tracks: [track('trk_s1', 'video', false), track('trk_s2', 'audio', false)] };
  // ranges
  const ranges: Record<string, SourceRange> = {};
  for (let i = 0, k = 3 + int(8); i < k; i++) {
    const assetId = pick(ids);
    const asset = doc.assets[assetId]!;
    const presence = rnd() < 0.2;
    let span: SourceRange['span'] = null;
    if (!presence && asset.kind !== 'image' && rnd() < 0.85) {
      const d = T.toSeconds(asset.duration);
      const t = (x: number) => (rnd() < 0.5 ? T.frameTime(Math.round(x * 30), { num: 30, den: 1 }) : T.rt(Math.round(x * 1000), 1000));
      const s0 = rnd() * d * 0.9, e0 = s0 + 0.01 + rnd() * (d - s0) * 0.8;
      const start = t(s0), end = T.min(t(e0), asset.duration);
      if (T.lt(start, end)) span = { start, end };
    }
    const people = [...new Set(Array.from({ length: int(3) + (presence ? 1 : 0) }, () => pick(['per_1', 'per_2', 'per_3'])))].sort();
    ranges[`rng_${i}`] = { id: `rng_${i}`, assetId, kind: presence ? 'presence' : 'pearl', span, label: '', ...(people.length ? { people } : {}), createdBy: 't' };
  }
  doc.sourceRanges = ranges;
  return doc;
}

/** The plain scan: per clip, the set of its project frames that show (or play) part of the range; plus the untimed copies seen. */
function scan(doc: ProjectDocument, r: SourceRange): { frames: Map<string, number[]>; untimed: Set<string> } {
  const rate = doc.settings.frameRate, frame = T.frameTime(1, rate);
  // the clock of every asset in root time: ast_copy's zero is ast_a's 1.5 s; ast_rev is an untimed copy of ast_a
  const offset = (id: string) => (id === 'ast_copy' ? T.rt(3, 2) : T.ZERO);
  const root = (id: string) => (id === 'ast_copy' ? 'ast_a' : id);
  const frames = new Map<string, number[]>(), untimed = new Set<string>();
  for (const seq of Object.values(doc.sequences)) for (const track of seq.tracks) for (const c of track.clips) {
    if (c.type !== 'media') continue;
    const asset = doc.assets[c.assetId]!;
    if (c.assetId === 'ast_rev' && root(r.assetId) === 'ast_a') { untimed.add('ast_rev'); continue; }
    if (root(c.assetId) !== root(r.assetId)) continue;
    const delta = T.sub(offset(r.assetId), offset(c.assetId));
    const out: number[] = [];
    for (let i = 0; ; i++) {
      const t = T.add(c.start, T.frameTime(i, rate));
      if (!T.lt(t, T.add(c.start, c.duration))) break;
      const fIdx = T.frameIndexAt(t, rate);
      if ((r.span === null && c.assetId === r.assetId) || asset.kind === 'image') { out.push(fIdx); continue; }
      const span = r.span ?? { start: T.ZERO, end: doc.assets[r.assetId]!.duration };
      const s = T.add(span.start, delta), e = T.add(span.end, delta);
      if (!T.lt(T.ZERO, e) || !T.lt(s, asset.duration)) continue;
      if (track.kind === 'video' && asset.video) {
        const va = { ...asset, video: asset.video };
        const kLo = sourceFrameOfTime(va, s);
        let kHi = kLo + 1;
        while (T.lt(sourceTimeOfFrame(va, kHi), e)) kHi++;
        const k = sourceFrameIndexAt(va, c, t, rate);
        if (k >= kLo && k < kHi) out.push(fIdx);
      } else {
        const x = pictureSourceAt(c, t, frame);
        if (T.lte(s, x) && T.lt(x, e)) out.push(fIdx);
      }
    }
    if (out.length) frames.set(c.id, out);
  }
  return { frames, untimed };
}

describe('rangeUsage equals the per-frame scan (C6)', () => {
  const SEEDS = Number(process.env.PF_PEARLS_PROP_SEEDS ?? 60);
  let compared = 0, counted = 0;
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => {
    const doc = randomDoc(seed);
    const u = rangeUsage(doc);
    for (const r of Object.values(doc.sourceRanges!)) {
      const want = scan(doc, r);
      const got = new Map<string, number[]>();
      for (const use of u.ranges[r.id]!.uses) {
        expect(got.has(use.clipId)).toBe(false); // one run per clip
        got.set(use.clipId, Array.from({ length: use.toFrame - use.fromFrame }, (_, i) => use.fromFrame + i));
        expect({ range: r.id, clipId: use.clipId, sourceInOrder: doc.assets[r.assetId]!.kind === "image" ? T.lte(use.source.start, use.source.end) : T.lt(use.source.start, use.source.end) }).toEqual({ range: r.id, clipId: use.clipId, sourceInOrder: true });
      }
      expect({ seed, range: r.id, frames: Object.fromEntries(got) }).toEqual({ seed, range: r.id, frames: Object.fromEntries(want.frames) });
      expect(u.ranges[r.id]!.untimedCopies).toEqual([...want.untimed]);
      compared++; counted += [...want.frames.values()].reduce((n, xs) => n + xs.length, 0);
    }
  });
  it('the scan compared ranges that are used, unused and on copies', () => { expect(compared).toBeGreaterThan(SEEDS * 3); expect(counted).toBeGreaterThan(SEEDS * 20); });
});

describe('screenTime equals the per-frame scan', () => {
  for (let seed = 1; seed <= 30; seed++) it(`seed ${seed}`, () => {
    const doc = randomDoc(seed + 1000);
    for (const sequenceId of Object.keys(doc.sequences)) {
      const st = screenTime(doc, sequenceId);
      const seq = doc.sequences[sequenceId]!;
      const picture = new Set<number>();
      for (const t of seq.tracks) if (t.kind === 'video' && !t.hidden) for (const c of t.clips) {
        const a = T.frameIndexAt(c.start, doc.settings.frameRate), n = T.frameIndexAt(c.duration, doc.settings.frameRate);
        for (let i = 0; i < n; i++) picture.add(a + i);
      }
      const visibleClips = new Set(seq.tracks.filter((t) => t.kind === 'video' && !t.hidden).flatMap((t) => t.clips.map((c) => c.id)));
      const on = new Map<string, Set<number>>(Object.keys(doc.people!).map((p) => [p, new Set()]));
      for (const r of Object.values(doc.sourceRanges!)) {
        if (!r.people) continue;
        for (const [clipId, frames] of scan(doc, r).frames) if (visibleClips.has(clipId)) for (const p of r.people) for (const x of frames) on.get(p)!.add(x);
      }
      const tagged = new Set([...on.values()].flatMap((s) => [...s]));
      expect(st.pictureFrames).toBe(picture.size);
      expect(st.untaggedFrames).toBe([...picture].filter((x) => !tagged.has(x)).length);
      expect(Object.fromEntries(st.people.map((p) => [p.personId, p.frames]))).toEqual(Object.fromEntries([...on].map(([p, s]) => [p, s.size])));
      // "gimel" and "gimel " share a name key: the id decides; Latin before Hebrew (code units)
      expect(st.people.map((p) => p.personId)).toEqual(['per_2', 'per_3', 'per_1']);
    }
  });
});
