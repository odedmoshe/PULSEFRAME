import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { carriedChannels, copyKeys, curveOps, deleteKeysOps, keyTimes, keysOf, moveKeysOps, pasteKeysOps, type KeyRef } from './keyEdits.ts';
import type { ChannelRef, Keyframe } from './keyframe.ts';
import type { OpCall } from './ops.ts';
import type { Clip, Track } from './schema.ts';
import { channelsFor } from './keyframeChannels.ts';

const rate: T.Rate = { num: 30, den: 1 };
const ft = (f: number) => T.frameTime(f, rate);
const key = (f: number, value: number, easing: Keyframe['easing'] = 'linear'): Keyframe => ({ time: ft(f), value, easing });
const track = (kind: Track['kind'] = 'video'): Track => ({ id: 'tr', kind, name: 't', locked: false, muted: false, hidden: false, clips: [] }) as unknown as Track;
const media = (keyframes: Record<string, Keyframe[]>, extra: Record<string, unknown> = {}): Clip => ({ id: 'c1', type: 'media', start: ft(0), duration: ft(100), keyframes, ...extra }) as unknown as Clip;
const adjustment = (extra: Record<string, unknown> = {}): Clip => ({ id: 'a1', type: 'adjustment', start: ft(0), duration: ft(100), ...extra }) as unknown as Clip;
const X: ChannelRef = { property: 'x' }, Y: ChannelRef = { property: 'y' };
const ref = (channel: ChannelRef, frame: number): KeyRef => ({ channel, frame });

/** What replace_clip_keyframes / replace_effect_keyframes (range form) do to a key list; refuses what the operations refuse. */
function applyRange(keys: readonly Keyframe[], args: { keys: Keyframe[] | null; from: T.RationalTime; to: T.RationalTime }): Keyframe[] {
  for (const k of args.keys ?? []) { expect(T.lte(args.from, k.time) && T.lte(k.time, args.to)).toBe(true); expect(T.isNegative(k.time)).toBe(false); }
  const out = [...keys.filter((k) => T.lt(k.time, args.from) || T.lt(args.to, k.time)), ...(args.keys ?? [])].sort((a, b) => T.cmp(a.time, b.time));
  for (let i = 1; i < out.length; i++) expect(T.lt(out[i - 1]!.time, out[i]!.time)).toBe(true);
  return out;
}
const apply = (clip: Clip, ops: OpCall[]): Clip => {
  const c = structuredClone(clip) as Clip & { keyframes?: Record<string, Keyframe[]> };
  for (const o of ops) {
    const a = o.args as { property?: string; effectId?: string; param?: string; keys: Keyframe[] | null; from: T.RationalTime; to: T.RationalTime };
    if (o.op === 'replace_clip_keyframes') { c.keyframes = { ...c.keyframes, [a.property!]: applyRange(c.keyframes?.[a.property!] ?? [], a) }; }
    else if (o.op === 'replace_effect_keyframes') {
      const fx = (c as unknown as { effects: { id: string; keyframes?: Record<string, Keyframe[]> }[] }).effects.find((e) => e.id === a.effectId)!;
      fx.keyframes = { ...fx.keyframes, [a.param!]: applyRange(fx.keyframes?.[a.param!] ?? [], a) };
    } else throw new Error(`unexpected ${o.op}`);
  }
  return c;
};
const frames = (c: Clip, ch: ChannelRef) => keysOf(c, ch).map((k) => T.frameIndexAt(k.time, rate));
const mv = (c: Clip, sel: KeyRef[], d: number) => { const r = moveKeysOps(c, track(), rate, sel, d); if (!('ops' in r)) throw new Error(r.refused); return r.ops; };

function rng(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe('keyTimes', () => {
  it('aggregates by exact frame, effect keys included, and marks keys outside the clip', () => {
    const c = media({ x: [key(-5, 0), key(10, 1), key(100, 2)], y: [key(10, 0, 'hold')] }, { effects: [{ id: 'fx1', type: 'blur.gaussian', enabled: true, params: {}, keyframes: { radius: [key(10, 3), key(40, 5)] } }] });
    const at = keyTimes(c, track(), rate);
    expect(at.map((a) => a.frame)).toEqual([-5, 10, 40, 100]);
    expect(at[1]!.channels).toEqual([X, Y, { effectId: 'fx1', param: 'radius' }]);
    expect(at[1]!.easings).toEqual(['linear', 'hold', 'linear']);
    expect(at.map((a) => a.inside)).toEqual([false, true, true, false]);
  });
  it('shows nothing on a sound track and only opacity on an adjustment', () => {
    expect(keyTimes(media({ x: [key(3, 1)] }), track('audio'), rate)).toEqual([]);
    expect(carriedChannels(adjustment(), track('adjustment'))).toEqual([{ property: 'opacity' }]);
  });
});

describe('moveKeysOps', () => {
  const base = () => media({ x: [key(10, 0.1), key(20, 0.2), key(50, 0.5)], y: [key(10, 0.3), key(30, 0.4)] });
  it('+7 then −3 gives the same keys as +4', () => {
    const c0 = base();
    const sel = (fs: number[]) => fs.flatMap((f) => [ref(X, f), ref(Y, f)]);
    const c1 = apply(c0, mv(c0, sel([10]), 7));
    const c2 = apply(c1, mv(c1, sel([17]), -3));
    const direct = mv(c0, sel([10]), 4);
    expect(keysOf(c2, X)).toEqual(keysOf(apply(c0, direct), X));
    expect(keysOf(c2, Y)).toEqual(keysOf(apply(c0, direct), Y));
    expect(frames(c2, X)).toEqual([14, 20, 50]);
    // ops of the chained edit and of the direct edit write the same final keys
    expect(mv(c1, sel([17]), -3).length).toBe(direct.length);
  });
  it('writes one range per channel over [min(old,new), max(old,new)]', () => {
    const ops = mv(base(), [ref(X, 10)], 5);
    expect(ops).toHaveLength(1);
    const a = ops[0]!.args as { from: T.RationalTime; to: T.RationalTime };
    expect([T.frameIndexAt(a.from, rate), T.frameIndexAt(a.to, rate)]).toEqual([10, 15]);
  });
  it('refuses crossing and landing on an unselected key', () => {
    expect(moveKeysOps(base(), track(), rate, [ref(X, 10)], 12)).toMatchObject({ refused: 'crosses_key' });
    expect(moveKeysOps(base(), track(), rate, [ref(X, 10)], 10)).toMatchObject({ refused: 'lands_on_key' });
    expect(moveKeysOps(base(), track(), rate, [ref(X, 50)], -30)).toMatchObject({ refused: 'lands_on_key' });
  });
  it('moves a selected group past nothing, together', () => {
    const c = apply(base(), mv(base(), [ref(X, 10), ref(X, 20)], 5));
    expect(frames(c, X)).toEqual([15, 25, 50]);
  });
  it('clamps to the clip and leaves keys outside alone', () => {
    const c = media({ x: [key(-4, 0), key(3, 1)] });
    expect(mv(c, [ref(X, 3)], -10)).toHaveLength(1);
    expect(frames(apply(c, mv(c, [ref(X, 3)], -10)), X)).toEqual([-4, 0]);
    expect(moveKeysOps(c, track(), rate, [ref(X, -4)], 3)).toEqual({ ops: [] });
  });
  it('never crosses or lands on an unselected key (1e4 random cases) and keeps the order', () => {
    const r = rng(7);
    let moved = 0, refused = 0;
    for (let i = 0; i < 10000; i++) {
      const fs = [...new Set(Array.from({ length: 2 + Math.floor(r() * 6) }, () => Math.floor(r() * 100)))].sort((a, b) => a - b);
      const c = media({ x: fs.map((f, j) => key(f, j / 10)) });
      const picked = fs.filter(() => r() < 0.4);
      if (!picked.length) continue;
      const d = Math.floor(r() * 41) - 20;
      const res = moveKeysOps(c, track(), rate, picked.map((f) => ref(X, f)), d);
      if ('refused' in res) {
        refused++;
        const lo = Math.max(-Math.min(...picked), Math.min(99 - Math.max(...picked), d));
        const bad = picked.some((f) => fs.some((o) => !picked.includes(o) && (o === f + lo || (lo > 0 ? o > f && o < f + lo : o < f && o > f + lo))));
        expect(bad).toBe(true);
        continue;
      }
      moved++;
      const out = apply(c, res.ops);
      const vals = keysOf(out, X).map((k) => k.value);
      expect(vals).toEqual(fs.map((_, j) => j / 10)); // same order of the same keys
    }
    expect(moved).toBeGreaterThan(1000); expect(refused).toBeGreaterThan(100);
  });
});

describe('deleteKeysOps', () => {
  it('removes the selection in one range per channel and keeps the keys between', () => {
    const c = media({ x: [key(5, 0), key(10, 1), key(15, 2), key(20, 3)] });
    const out = apply(c, deleteKeysOps(c, rate, [ref(X, 10), ref(X, 20)]));
    expect(frames(out, X)).toEqual([5, 15]);
  });
  it('a channel left empty keeps the value of the last removed key', () => {
    const c = media({ x: [key(5, 0.4)] });
    const [op] = deleteKeysOps(c, rate, [ref(X, 5)]);
    const a = op!.args as { keys: unknown; at: T.RationalTime };
    expect(a.keys).toBeNull();
    expect(T.eq(a.at, ft(5))).toBe(true);
  });
  it('ignores a frame with no key', () => expect(deleteKeysOps(media({ x: [key(5, 0)] }), rate, [ref(X, 6)])).toEqual([]));
});

describe('curveOps', () => {
  it('one set_keyframe_curve for channels on the same times, another for different times', () => {
    const c = media({ x: [key(10, 0), key(20, 1)], y: [key(10, 0), key(20, 1)], scale: [key(20, 1)] });
    const one = curveOps(c, rate, [ref(X, 10), ref(Y, 10)], 'after', 'smooth');
    expect(one).toHaveLength(1);
    expect((one[0]!.args as { channels: ChannelRef[] }).channels).toEqual([X, Y]);
    const two = curveOps(c, rate, [ref(X, 10), ref(Y, 20)], 'after', 'bezier', [0.2, 0.1, 0.8, 0.9]);
    expect(two).toHaveLength(2);
    expect((two[0]!.args as { bezier: number[] }).bezier).toEqual([0.2, 0.1, 0.8, 0.9]);
    expect(curveOps(c, rate, [ref(X, 10)], 'both', 'linear')[0]!.args).not.toHaveProperty('bezier');
  });
});

describe('copy and paste', () => {
  const fxClip = () => media({ x: [key(10, 0.1, 'smooth'), key(20, 0.2)], y: [key(10, 0.3)] }, { effects: [{ id: 'fx1', type: 'blur.gaussian', enabled: true, params: {}, keyframes: { radius: [{ ...key(20, 4), easing: 'bezier' as const, bezier: [0.2, 0, 0.8, 1] as [number, number, number, number] }] } }] });
  const all = (c: Clip, fs: number[]) => carriedChannels(c, track()).flatMap((ch) => fs.filter((f) => frames(c, ch).includes(f)).map((f) => ref(ch, f)));
  it('paste times are playhead − start + df, exactly', () => {
    const c = fxClip();
    const cb = copyKeys(c, rate, all(c, [10, 20]));
    const { ops } = pasteKeysOps(c, track(), rate, cb, 37);
    for (const o of ops) for (const k of (o.args as { keys: Keyframe[] }).keys) expect(cb.entries.some((e) => e.keys.some((q) => T.eq(k.time, T.add(ft(37), ft(q.df))))) ).toBe(true);
    const xs = ops.find((o) => (o.args as { property?: string }).property === 'x')!.args as { keys: Keyframe[]; from: T.RationalTime; to: T.RationalTime };
    expect(xs.keys.map((k) => T.frameIndexAt(k.time, rate))).toEqual([37, 47]);
    expect([T.frameIndexAt(xs.from, rate), T.frameIndexAt(xs.to, rate)]).toEqual([37, 47]);
  });
  it('copy → paste → copy round-trips', () => {
    const c = fxClip();
    const cb = copyKeys(c, rate, all(c, [10, 20]));
    const { ops, skipped } = pasteKeysOps(c, track(), rate, cb, 50);
    expect(skipped).toEqual([]);
    const after = apply(c, ops);
    const pasted = copyKeys(after, rate, all(after, [50, 60]));
    expect(pasted).toEqual(cb);
    expect(cb.entries.find((e) => 'effectId' in e.channel)).toMatchObject({ effectType: 'blur.gaussian', keys: [{ df: 10, value: 4, easing: 'bezier', bezier: [0.2, 0, 0.8, 1] }] });
  });
  it('an adjustment takes opacity and effects, and skips the rest and reports it', () => {
    const c = fxClip();
    const cb = copyKeys(c, rate, [...all(c, [10, 20]), ref({ property: 'opacity' }, 0)]);
    cb.entries.push({ channel: { property: 'opacity' }, keys: [{ df: 0, value: 0.5, easing: 'linear' }] });
    const target = adjustment({ effects: [{ id: 'fxA', type: 'blur.gaussian', enabled: true, params: {} }] });
    const { ops, skipped } = pasteKeysOps(target, track('adjustment'), rate, cb, 5);
    expect(ops.map((o) => o.op).sort()).toEqual(['replace_clip_keyframes', 'replace_effect_keyframes']);
    expect((ops.find((o) => o.op === 'replace_effect_keyframes')!.args as { effectId: string }).effectId).toBe('fxA');
    expect(skipped).toEqual([X, Y]);
  });
  it('skips an effect the target does not have', () => {
    const c = fxClip();
    const cb = copyKeys(c, rate, all(c, [20]));
    const { ops, skipped } = pasteKeysOps(media({}), track(), rate, cb, 0);
    expect(skipped).toEqual([{ effectId: 'fx1', param: 'radius' }]);
    expect(ops.map((o) => (o.args as { property: string }).property)).toEqual(['x']);
  });
  it('copying nothing gives nothing', () => expect(copyKeys(fxClip(), rate, [])).toEqual({ entries: [] }));
});

describe('channel rules', () => {
  it.skipIf((() => { try { channelsFor(media({}), track()); return false; } catch { return true; } })())('agrees with keyframeChannels once it is built', () => {
    const c = media({}, { effects: [{ id: 'fx1', type: 'blur.gaussian', enabled: true, params: {} }] });
    for (const [clip, tr] of [[c, track()], [adjustment({ effects: [] }), track('adjustment')], [c, track('audio')]] as const) expect(carriedChannels(clip, tr)).toEqual(channelsFor(clip, tr));
  });
});
