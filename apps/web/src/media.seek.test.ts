/**
 * ClipDecoder seeks (media.ts): a seek followed by the next frames decodes every frame once, a seek that follows a seek
 * (scrubbing) decodes to the sought frame and no further, and the picture given for a time is the one the decoder gave before
 * both changes, whatever was asked earlier.
 *
 * The sample source is a counting stand-in (labelled: ClipDecoder.over is the test-only seam; no Mediabunny, no browser). It
 * models what the installed Mediabunny (1.66.0, src/media-sink.ts) does with a stream of packets in decode order:
 *   getSample(t)   decodes from the key packet of the last packet at or before t up to that packet, flushes, and gives the last
 *                  sample that does not start more than 1e-10 s after t (its own tolerance), or null when there is none;
 *   samples(start) starts decoding at the same key packet as soon as it is created, keeps up to four samples decoded ahead, and
 *                  yields the last sample at or before `start` (the first one when none is), then every sample after it.
 * Every decode of a frame is counted, so a group of pictures decoded twice shows.
 */
import { describe, expect, it } from 'vitest';
import type { FrameImage } from '@pulseframe/engine';
import { ClipDecoder, type ClipSample, type ClipSampleSource, type PoolDecoder } from './media.ts';

interface Packet { seq: number; idx: number; ts: number; dur: number; key: boolean }
/** `dur`: how long a sample says it lasts, in frames (1 when left out; under 1 leaves gaps between samples, over 1 makes them overlap). */
interface StreamShape { frames: number; fps: number; gop: number; bframes?: number; first?: number; dur?: number }
/** Packets in decode order: closed groups of `gop` pictures; with B-frames, each P comes before the B pictures shown before it. */
function packets({ frames, fps, gop, bframes = 0, first = 0, dur = 1 }: StreamShape): Packet[] {
  const order: number[] = [];
  for (let g = 0; g < frames; g += gop) {
    const end = Math.min(frames, g + gop);
    order.push(g);
    for (let i = g + 1; i < end; i += bframes + 1) {
      const p = Math.min(end - 1, i + bframes);
      order.push(p);
      for (let b = i; b < p; b++) order.push(b);
    }
  }
  return order.map((idx, seq) => ({ seq, idx, ts: first + idx / fps, dur: dur / fps, key: idx % gop === 0 }));
}

class FakeSample implements ClipSample {
  closed = false;
  constructor(readonly idx: number, readonly timestamp: number, readonly duration: number, private sink: FakeSink) { sink.open.add(this); }
  close() { this.closed = true; this.sink.open.delete(this); }
  draw(ctx: unknown) { if (this.closed) throw new Error('VideoSample is closed'); (ctx as { idx: number }).idx = this.idx; }
}
const MAX_QUEUE = 4;
const done = { value: undefined, done: true } as const;

class FakeSink implements ClipSampleSource {
  /** How many times each frame (by presentation index) was decoded. */
  decodes: number[];
  /** Decode pipelines started (a decoder configured, fed from a key packet). */
  pipelines = 0;
  /** What the decoder asked of the source, in order: a lookup (getSample) or an iterator (samples). */
  asked: ('lookup' | 'iterator')[] = [];
  open = new Set<FakeSample>();
  /** A frame whose packet cannot be decoded (a damaged file), or -1. */
  broken = -1;
  private byTime: Packet[];
  constructor(private pkts: Packet[]) {
    this.decodes = pkts.map(() => 0);
    this.byTime = [...pkts].sort((a, b) => a.ts - b.ts);
  }
  private packetAt(t: number, keyOnly = false): Packet | null {
    let hit: Packet | null = null;
    for (const p of this.byTime) { if (p.ts > t) break; if (!keyOnly || p.key) hit = p; }
    return hit;
  }
  /** A decoder: fed packets in decode order, it gives samples in presentation order (a picture once every one before it is out). */
  private decoder(from: Packet, out: (s: FakeSample) => void) {
    this.pipelines++;
    let nextIdx = from.idx;
    const held: Packet[] = [];
    const emit = (p: Packet) => { nextIdx = p.idx + 1; out(new FakeSample(p.idx, p.ts, p.dur, this)); };
    return {
      decode: (p: Packet) => {
        if (p.idx === this.broken) throw new Error(`frame ${p.idx} cannot be decoded`);
        this.decodes[p.idx]!++;
        held.push(p);
        held.sort((a, b) => a.idx - b.idx);
        while (held[0]?.idx === nextIdx) emit(held.shift()!);
      },
      flush: () => { for (const p of held.splice(0)) emit(p); },
    };
  }
  async getSample(t: number): Promise<FakeSample | null> {
    this.asked.push('lookup');
    await null;
    const target = this.packetAt(t);
    const key = target && this.packetAt(target.ts, true);
    if (!target || !key) return null;
    let held: FakeSample | null = null, answer: FakeSample | null | undefined;
    const dec = this.decoder(key, (s) => {
      if (answer !== undefined) { s.close(); return; }
      if (s.timestamp - t > 1e-10) { answer = held; s.close(); return; }
      held?.close();
      held = s;
    });
    try {
      for (let seq = key.seq; seq <= target.seq; seq++) dec.decode(this.pkts[seq]!);
      dec.flush();
    } catch (e) {
      (held as FakeSample | null)?.close();
      throw e;
    }
    return answer !== undefined ? answer : held;
  }
  samples(start = -Infinity): AsyncGenerator<FakeSample, void, unknown> {
    this.asked.push('iterator');
    const queue: FakeSample[] = [];
    let last: FakeSample | null = null, firstQueued = false, flushed = false, terminated = false;
    const startPacket = this.packetAt(start);
    const key = this.packetAt(startPacket?.ts ?? start, true) ?? this.pkts.find((p) => p.key) ?? null;
    const dec = key && this.decoder(key, (s) => {
      if (terminated) { s.close(); return; }
      if (last) { if (s.timestamp > start) { queue.push(last); firstQueued = true; } else last.close(); }
      if (s.timestamp >= start) { queue.push(s); firstQueued = true; }
      last = firstQueued ? null : s;
    });
    let seq = key ? key.seq : this.pkts.length;
    let failed: unknown;
    const pump = () => {
      try {
        while (dec && !terminated && !flushed && queue.length < MAX_QUEUE) {
          if (seq < this.pkts.length) { dec.decode(this.pkts[seq++]!); continue; }
          dec.flush();
          if (!firstQueued && last) { queue.push(last); last = null; }
          flushed = true;
        }
      } catch (e) { failed = e; flushed = true; }
    };
    pump(); // Mediabunny's pump runs from the moment the iterator is created, whether or not anything is read from it
    const end = async () => { terminated = true; last?.close(); for (const s of queue.splice(0)) s.close(); return done; };
    return {
      next: async () => {
        await null;
        if (terminated) return done;
        pump();
        if (failed) { await end(); throw failed; } // as Mediabunny: an error of the pump comes before the samples already queued
        const value = queue.shift();
        if (!value) return done;
        pump();
        return { value, done: false };
      },
      return: end,
      throw: async (e: unknown) => { await end(); throw e; },
      [Symbol.asyncIterator]() { return this; },
    } as unknown as AsyncGenerator<FakeSample, void, unknown>;
  }
}

/**
 * The decoder as it was before seeks stopped decoding twice (main 948af69, ClipDecoder.get, word for word): the reference the
 * decoder has to agree with, picture for picture, over the same source.
 */
class DecoderBefore implements PoolDecoder {
  private cur: ClipSample | null = null;
  private iter: AsyncGenerator<ClipSample, void, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private sink: ClipSampleSource, private frameDur: number, private first: number) {}
  frame(seconds: number): Promise<FrameImage | null> {
    const p = this.chain.then(() => this.get(this.first + seconds));
    this.chain = p.catch(() => {});
    return p;
  }
  private covers(s: ClipSample, t: number) { return t >= s.timestamp && t < s.timestamp + (s.duration || this.frameDur); }
  private wrap(s: ClipSample): FrameImage { return { draw: (ctx, dx, dy, dw, dh) => s.draw(ctx, dx, dy, dw, dh) }; }
  private async get(t: number): Promise<FrameImage | null> {
    if (this.cur && this.covers(this.cur, t)) return this.wrap(this.cur);
    if (this.cur && this.iter && t > this.cur.timestamp && t < this.cur.timestamp + 0.5) {
      for (;;) {
        const n = await this.iter.next();
        if (n.done) break;
        if (n.value.timestamp <= this.cur.timestamp) { n.value.close(); continue; }
        this.cur.close();
        this.cur = n.value;
        if (this.covers(this.cur, t) || this.cur.timestamp > t) break;
      }
      if (this.cur && this.covers(this.cur, t)) return this.wrap(this.cur);
    }
    await this.iter?.return();
    this.iter = null;
    this.cur?.close();
    this.cur = await this.sink.getSample(t); // last frame with PTS <= t
    if (!this.cur) return null;
    this.iter = this.sink.samples(this.cur.timestamp);
    return this.wrap(this.cur);
  }
  async dispose() {
    await this.chain.catch(() => {});
    await this.iter?.return();
    this.cur?.close();
    this.cur = null;
  }
}

/** Which frame a picture is (its presentation index), or null. Drawing a closed sample throws, as Mediabunny's does. */
const shown = (img: FrameImage | null): number | null => {
  if (!img) return null;
  const ctx = { idx: -1 };
  img.draw(ctx as never, 0, 0, 1, 1);
  return ctx.idx;
};
const mid = (frame: number, fps: number) => (frame + 0.5) / fps;
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOP30: StreamShape = { frames: 150, fps: 30, gop: 30 };
const SHAPES: Record<string, StreamShape> = {
  'P only, GOP 30': GOP30,
  'B-frames 2, GOP 30': { frames: 150, fps: 30, gop: 30, bframes: 2 },
  'B-frames 3, GOP 250': { frames: 300, fps: 30, gop: 250, bframes: 3 },
  'start offset 0.5 s, B-frames 2': { frames: 120, fps: 30, gop: 30, bframes: 2, first: 0.5 },
  'start offset 1/3 s, 25 fps': { frames: 100, fps: 25, gop: 25, bframes: 2, first: 1 / 3 },
};
/** Streams whose samples do not tile the time line: which sample a time gets then depends on how the decoder got there, and has to depend on it as before. */
const ODD: Record<string, StreamShape> = {
  'samples shorter than their spacing (gaps), B-frames 2': { frames: 150, fps: 30, gop: 30, bframes: 2, dur: 0.6 },
  'samples longer than their spacing (overlaps)': { frames: 150, fps: 30, gop: 30, dur: 1.7 },
  'samples without a duration': { frames: 90, fps: 30, gop: 30, bframes: 2, dur: 0, first: 0.25 },
};
const open = (shape: StreamShape) => {
  const sink = new FakeSink(packets(shape));
  // As ClipDecoder.open: requests are measured from the first frame (a negative first timestamp counts as 0), frames last 1/30 s when a sample does not say.
  return { sink, dec: ClipDecoder.over(sink, 30, Math.max(0, shape.first ?? 0)) };
};

describe('a seek followed by the next frames decodes every frame once', () => {
  for (const [name, target] of [['mid group', 45], ['last of its group', 59], ['a key frame', 60]] as const) {
    it(`seek to frame ${target} (${name}), then the next 5 frames`, async () => {
      const { sink, dec } = open(GOP30);
      const got: (number | null)[] = [];
      for (let f = target; f <= target + 5; f++) got.push(shown(await dec.frame(mid(f, 30))));
      expect(got).toEqual([0, 1, 2, 3, 4, 5].map((d) => target + d));
      const key = target - (target % 30);
      const twice = sink.decodes.flatMap((n, idx) => (n > 1 ? [idx] : []));
      expect(twice).toEqual([]); // before: every frame from the key frame to the sought one was decoded twice
      expect(sink.pipelines).toBe(1); // before: 2 (the lookup's, then the iterator's)
      // exactly the frames from the key frame to the last one asked for, and the few the iterator keeps decoded ahead
      const decoded = sink.decodes.flatMap((n, idx) => (n ? [idx] : []));
      expect(decoded[0]).toBe(key);
      expect(decoded.at(-1)!).toBeGreaterThanOrEqual(target + 5);
      expect(decoded.at(-1)!).toBeLessThanOrEqual(target + 5 + MAX_QUEUE + 1);
      expect(decoded.length).toBe(decoded.at(-1)! - key + 1);
      await dec.dispose();
      expect(sink.open.size).toBe(0);
    });
  }

  it('with B-frames too: seek, then the next 5 frames', async () => {
    const { sink, dec } = open(SHAPES['B-frames 2, GOP 30']!);
    for (let f = 44; f <= 49; f++) expect(shown(await dec.frame(mid(f, 30)))).toBe(f);
    expect(Math.max(...sink.decodes)).toBe(1);
    expect(sink.pipelines).toBe(1);
    await dec.dispose();
  });

  it('a seek after frames were played, then the next 5 frames', async () => {
    const { sink, dec } = open(GOP30);
    for (const f of [10, 11, 12, 100, 101, 102, 103, 104, 105]) expect(shown(await dec.frame(mid(f, 30)))).toBe(f);
    expect(sink.asked).toEqual(['iterator', 'iterator']); // each seek is one iterator, started at the sought frame
    expect(Math.max(...sink.decodes)).toBe(1);
    await dec.dispose();
    expect(sink.open.size).toBe(0);
  });
});

describe('a seek that follows a seek decodes to the sought frame and no further (scrubbing)', () => {
  it('seek after seek: the first is an iterator, every one after it a lookup that decodes from its key frame to its frame', async () => {
    const { sink, dec } = open(GOP30);
    const targets = [100, 40, 131, 12, 77, 76, 75, 140];
    for (const f of targets) expect(shown(await dec.frame(mid(f, 30)))).toBe(f);
    expect(sink.asked).toEqual(['iterator', ...targets.slice(1).map(() => 'lookup')]);
    expect(sink.pipelines).toBe(targets.length); // before: two per seek
    // frame 100's seek decoded 90..100 and a few ahead; every other seek exactly its key frame..its frame (77, 76 and 75 share 60..75)
    const want = sink.decodes.map(() => 0);
    for (const f of targets.slice(1)) for (let i = f - (f % 30); i <= f; i++) want[i]!++;
    const got = [...sink.decodes];
    for (let i = 90; i < 120; i++) { want[i] = 0; got[i] = 0; }
    expect(got).toEqual(want);
    expect(sink.decodes.slice(90, 101)).toEqual(Array(11).fill(1));
    expect(sink.decodes.slice(101, 120).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_QUEUE + 1);
    await dec.dispose();
    expect(sink.open.size).toBe(0);
  });

  it('the rule reads the requests only: frame held, step, jump, jump after jump', async () => {
    const { sink, dec } = open(GOP30);
    const ask = async (f: number, want: ('lookup' | 'iterator')[]) => {
      const n = sink.asked.length;
      expect(shown(await dec.frame(mid(f, 30)))).toBe(f);
      expect(sink.asked.slice(n), `frame ${f}`).toEqual(want);
    };
    await ask(50, ['iterator']); // the first request: a jump, then perhaps play
    await ask(50, []); // the frame held
    await ask(51, []); // a step: the iterator's next sample
    await ask(20, ['iterator']); // a jump after a step
    await ask(20, []);
    await ask(90, ['lookup']); // a jump after a jump (the frame held asked again in between changes nothing)
    await ask(89, ['lookup']); // stepping back is a jump each time
    await ask(88, ['lookup']);
    await ask(120, ['lookup']);
    await ask(121, ['iterator']); // play starts from a frame a lookup reached: the iterator starts at that frame
    await ask(122, []);
    await ask(130, []); // a step of several frames, under half a second
    await ask(60, ['iterator']); // a jump after a step again
    await ask(76, ['lookup']); // half a second ahead or more is a jump
    await dec.dispose();
    expect(sink.open.size).toBe(0);
  });

  it('play after scrubbing: the frames from the key frame to the frame scrubbing stopped on are decoded once more, then every frame once', async () => {
    const { sink, dec } = open(GOP30);
    for (const f of [100, 40, 135]) expect(shown(await dec.frame(mid(f, 30)))).toBe(f);
    const before = [...sink.decodes];
    for (let f = 135; f <= 141; f++) expect(shown(await dec.frame(mid(f, 30)))).toBe(f);
    const more = sink.decodes.map((n, i) => n - before[i]!);
    expect(more.slice(120, 136)).toEqual(Array(16).fill(1)); // the accepted cost, once
    expect(more.slice(136, 142)).toEqual(Array(6).fill(1));
    expect(Math.max(...more)).toBe(1);
    expect(sink.asked).toEqual(['iterator', 'lookup', 'lookup', 'iterator']);
    await dec.dispose();
  });
});

describe('the picture for a time is the one given before the change, whatever was asked earlier', () => {
  /** A pattern of requests in seconds from the first frame: steps forward, repeats, jumps inside the group and across the file, both ends, and off-grid times. */
  function pattern(shape: StreamShape, rand: () => number, length: number): number[] {
    const { frames, fps, gop } = shape;
    const int = (n: number) => Math.floor(rand() * n);
    const out: number[] = [];
    let f = int(frames);
    for (let i = 0; i < length; i++) {
      const r = rand();
      const g = f - (f % gop);
      if (r < 0.3) f = Math.min(frames - 1, f + 1); // the next frame
      else if (r < 0.36) f = f + 0; // the same frame again
      else if (r < 0.48) f = Math.min(frames - 1, f + 2 + int(12)); // a step forward (inside half a second, or just past it)
      else if (r < 0.6) f = g + int(Math.min(gop, frames - g)); // anywhere in the same group, backwards too
      else if (r < 0.7) f = Math.max(0, f - 1 - int(5)); // a few frames back
      else if (r < 0.76) f = frames - 1; // the last frame
      else if (r < 0.8) f = 0;
      else if (r < 0.84) { out.push(-(1 + int(20)) / 60); continue; } // before the first frame
      else if (r < 0.87) { out.push((frames + int(40)) / fps); continue; } // past the end
      else f = int(frames);
      const where = rand();
      out.push(where < 0.8 ? mid(f, fps) : where < 0.9 ? f / fps : (f + rand()) / fps); // mid-frame (what evaluate asks for), a frame's own start, anywhere in it
    }
    return out;
  }

  /** Runs: scrubbing (seek after seek: across the file, a few frames either way, frame by frame backwards), playing on from where a run stopped, and the frame held asked again. */
  function runs(shape: StreamShape, rand: () => number, length: number): number[] {
    const { frames, fps } = shape;
    const int = (n: number) => Math.floor(rand() * n);
    const clamp = (f: number) => Math.max(0, Math.min(frames - 1, f));
    const out: number[] = [];
    let f = int(frames);
    const ask = () => { const where = rand(); out.push(where < 0.85 ? mid(f, fps) : where < 0.93 ? f / fps : (f + rand()) / fps); };
    while (out.length < length) {
      const kind = rand(), n = 1 + int(8);
      for (let i = 0; i < n; i++) {
        if (kind < 0.3) f = clamp(f + 1); // play
        else if (kind < 0.4) f = clamp(f + 2 + int(4)); // play fast
        else if (kind < 0.55) f = int(frames); // scrub across the file
        else if (kind < 0.7) f = clamp(f + int(41) - 20); // scrub around the playhead
        else if (kind < 0.8) f = clamp(f - 1); // step back, frame by frame
        else if (kind < 0.88) f = clamp(f + 15 + int(3) - 1); // right at the half second that tells a step from a jump
        else if (kind < 0.94) f = f + 0; // the frame held
        else f = i % 2 ? frames - 1 : 0; // both ends
        ask();
      }
    }
    return out;
  }

  for (const [name, shape] of Object.entries({ ...SHAPES, ...ODD })) {
    it(`${name}: 40 random patterns of 120 requests and 40 of scrub and play runs agree with the decoder before, and no sample is left open`, async () => {
      for (let seed = 1; seed <= 80; seed++) {
        const rand = mulberry32(seed * 7919 + name.length);
        const reqs = seed <= 40 ? pattern(shape, rand, 120) : runs(shape, rand, 120);
        const a = open(shape);
        const before = new DecoderBefore(new FakeSink(packets(shape)), 1 / 30, Math.max(0, shape.first ?? 0));
        const got: (number | null)[] = [], want: (number | null)[] = [];
        for (const s of reqs) { got.push(shown(await a.dec.frame(s))); want.push(shown(await before.frame(s))); }
        expect(got, `seed ${seed}`).toEqual(want);
        await a.dec.dispose();
        expect(a.sink.open.size, `seed ${seed}: samples left open`).toBe(0);
        await before.dispose();
      }
    });

    if (name in SHAPES) it(`${name}: random access gives what sequential access gives`, async () => {
      // sequential access: one decoder walked from the first frame to the last
      const walk = open(shape);
      const sequential: (number | null)[] = [];
      for (let f = 0; f < shape.frames; f++) sequential.push(shown(await walk.dec.frame(mid(f, shape.fps))));
      expect(sequential).toEqual(sequential.map((_, f) => f));
      expect(Math.max(...walk.sink.decodes)).toBe(1);
      await walk.dec.dispose();
      // random access: another decoder asked for the same times in seeded random order, each frame several times
      const rand = mulberry32(shape.frames * 31 + shape.gop);
      const jump = open(shape);
      for (let i = 0; i < 400; i++) {
        const f = Math.floor(rand() * shape.frames);
        expect(shown(await jump.dec.frame(mid(f, shape.fps))), `request ${i}: frame ${f}`).toBe(sequential[f]);
      }
      await jump.dec.dispose();
    });
  }

  it('a time before the first frame of a start-offset file has no picture, and the first frame is still found after it', async () => {
    const shape = SHAPES['start offset 0.5 s, B-frames 2']!;
    // `first` 0: the times are the file's own, so anything under 0.5 s is before its first frame
    const sink = new FakeSink(packets(shape));
    const dec = ClipDecoder.over(sink, 30, 0);
    expect(shown(await dec.frame(0.2))).toBeNull();
    expect(shown(await dec.frame(0.5 - 1e-6))).toBeNull();
    expect(sink.open.size).toBe(0); // nothing is held for a time without a picture
    expect(shown(await dec.frame(0.5))).toBe(0);
    expect(shown(await dec.frame(0.5 + mid(1, 30)))).toBe(1);
    expect(shown(await dec.frame(0.1))).toBeNull();
    expect(shown(await dec.frame(0.5 + mid(119, 30)))).toBe(119); // the last frame
    expect(shown(await dec.frame(0.5 + mid(500, 30)))).toBe(119); // and past it
    expect(shown(await dec.frame(0.5 + mid(118, 30)))).toBe(118); // back from the end
    await dec.dispose();
    expect(sink.open.size).toBe(0);
  });

  it('a time within 1e-10 s before a frame that is decoded ahead of it (B-frames): the lookup\'s own answer, as before', async () => {
    const shape = SHAPES['B-frames 2, GOP 30']!;
    const t = 3 / 30 - 5e-11; // frame 3 is a P picture, decoded before frames 1 and 2; Mediabunny's lookup counts it as started
    const a = open(shape);
    const before = new DecoderBefore(new FakeSink(packets(shape)), 1 / 30, 0);
    for (const s of [t, mid(3, 30), mid(4, 30), mid(2, 30), t, t + 1 / 30, 62 / 30 - 5e-11]) expect(shown(await a.dec.frame(s))).toBe(shown(await before.frame(s)));
    expect(shown(await a.dec.frame(mid(20, 30)))).toBe(20);
    expect(shown(await a.dec.frame(t))).toBe(3);
    await a.dec.dispose();
    await before.dispose();
    expect(a.sink.open.size).toBe(0);
  });

  it('next to a frame that cannot be decoded, a seek still shows what the lookup showed before', async () => {
    const shape = SHAPES['B-frames 2, GOP 30']!;
    const sink = new FakeSink(packets(shape));
    const beforeSink = new FakeSink(packets(shape));
    sink.broken = beforeSink.broken = 52; // a P picture: the frames of its group after it need it, the ones before it do not
    const dec = ClipDecoder.over(sink, 30, 0);
    const before = new DecoderBefore(beforeSink, 1 / 30, 0);
    const outcome = (d: PoolDecoder, f: number) => d.frame(mid(f, 30)).then(shown, (e: Error) => e.message);
    // every request is a seek (a step back, or more than half a second on)
    const asked = [49, 48, 46, 40, 31, 50, 49, 52, 51, 58, 45, 75, 47];
    const got: unknown[] = [], want: unknown[] = [];
    for (const f of asked) { got.push(await outcome(dec, f)); want.push(await outcome(before, f)); }
    expect(got).toEqual(want);
    expect(got.slice(0, 7)).toEqual([49, 48, 46, 40, 31, 50, 49]); // pictures, though the iterator's decoding ahead runs into frame 52
    expect(got[7]).toBe('frame 52 cannot be decoded');
    await dec.dispose();
    await before.dispose();
    expect(sink.open.size).toBe(0);
  });

  it('a picture stays drawable until the next one is asked for', async () => {
    const { dec } = open(GOP30);
    const a = await dec.frame(mid(10, 30));
    expect(shown(a)).toBe(10);
    expect(shown(a)).toBe(10);
    const b = await dec.frame(mid(11, 30));
    expect(shown(b)).toBe(11);
    expect(() => shown(a)).toThrow('VideoSample is closed');
    await dec.dispose();
  });
});
