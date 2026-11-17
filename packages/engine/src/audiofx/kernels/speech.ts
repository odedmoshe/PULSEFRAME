/**
 * cleanup.speech «שיפור דיבור» (ADR-0013), stage 2 (window stage, with look-ahead). In this order, for amount a > 0:
 *
 *  1. Low cut: a 4th-order Butterworth high-pass at lowCutHz (design.ts butterworth4), mixed with the dry sound by a.
 *  2. Presence: with p = presence·a, a peaking cut of −2p dB at 300 Hz, a peaking boost of +4p dB at 3.5 kHz and a high shelf of
 *     +2p dB from 10 kHz (left out at or above 0.45·sr). Less mud, more presence and air.
 *  3. Phrase leveller, on 10 ms blocks anchored to the timeline grid (blocks start where (at + n) % B === 0):
 *     - E_k = the block's energy after steps 1–2; a block is ACTIVE when its mean square is at least −50 dBFS (the gate);
 *     - U_k = clamp(sqrt(T / Ē_k), 1/Gmax, Gmax), Ē_k the mean energy of the ACTIVE blocks in the centred 400 ms window
 *       [k − 20, k + 20], T = targetDb as energy, Gmax = levelDb·a as a gain; U_k = 1 when that window holds no active block, so a
 *       pause is measured as nothing, never as quiet speech to be raised. The clamp compares T/Ē with Gmax² and 1/Gmax² (linear,
 *       design-time constants), so only sqrt runs here;
 *     - Gs_k = the anchored moving average of U over 300 ms, blocks [k − 27, k + 2] (mostly trailing: the centred window already
 *       looks 200 ms ahead, and the whole effect may read at most 250 ms ahead, the registry's aheadMs);
 *     - a pause cap: a block with no active block within ±100 ms (HOLD) is a pause, capped at gain 1; the cap is averaged over
 *       ±2 blocks so it eases in. F_k = min(Gs_k, cap_k). Short gaps between words (under about 200 ms) hold the speech gain,
 *       so the noise between words is not pumped up and down; a longer pause is never raised beyond 130 ms from speech;
 *     - the gain of a sample is F interpolated linearly between block centres.
 *  4. Limiter, always last: r[n] = min(1, c / max(|L|, |R|)), c = ceilingDb as a gain; m = the anchored minimum of r over the
 *     next 5 ms; the gain is the anchored average of m over the last 5 ms (every averaged window of minima contains n, so the gain
 *     never exceeds r[n] and the peak never exceeds c); a final clamp to c (to the largest 32-bit float not above it) covers rounding.
 *
 * EXACTLY finite memory, so histories that agree on `warm` give the same bits and the parts of a split clip sum to the whole
 * bit for bit: the IIR filters of steps 1–2 are restarted on the timeline grid. Segment s = [s·S, (s+1)·S) is filtered by a
 * filter reset to zero at s·S − Wf (two filters take turns), where Wf is the restart warm-up: what a never-reset filter would
 * still carry from before it is below 2^-20 of the input peak (−120 dB, below the 16-bit step). S = Wf, so steps 1–2 cost two
 * filter runs per sample and need S + Wf − 1 samples of history. Every block, window and segment grid is keyed on the timeline
 * sample t = at + n, so moving a clip by a non-multiple of the grids changes the result very slightly (ADR-0013 accepts this).
 *
 * Runtime arithmetic per sample: + − × ÷, sqrt (per block), min and max. Every dB conversion is a design-time constant (design.ts).
 * The leveller compares and clamps in the linear domain, so no gain table is needed. The clip speed does not matter: every
 * frequency and level here is the one heard. Nobody has listened to this yet: the defaults are starting points to be judged by ear.
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { butterworth4, cascadeWarm, dbToGain, DRY, fxParams, highShelf, msToSamples, peaking, type Biquad, type BoundedKernel } from '../design.ts';
import { AnchoredMin, AnchoredSum } from '../anchored.ts';

const TYPE = 'cleanup.speech';
/** The fixed design of the speech enhancer (exported for the tests and the proofs). */
export const SPEECH = {
  /** leveller block, ms */ blockMs: 10,
  /** a block below this mean square (dBFS) is not speech */ gateDb: -50,
  /** half-width of the centred level window, blocks (±200 ms: 400 ms) */ windowBlocks: 20,
  /** gain smoothing over blocks [k − smoothPast, k + smoothFuture] (300 ms) */ smoothPast: 27, smoothFuture: 2,
  /** a block with no active block within ±holdBlocks is a pause (gain capped at 1) */ holdBlocks: 10,
  /** half-width of the cap's easing, blocks */ capEase: 2,
  /** limiter window, ms */ limiterMs: 5,
  /** what a restarted filter may differ from a never-reset one by, relative to the input peak */ restartEps: 2 ** -20,
  presence: { lowHz: 300, lowDb: -2, lowQ: 0.9, midHz: 3500, midDb: 4, midQ: 1.2, shelfHz: 10000, shelfDb: 2 },
} as const;

export interface SpeechDesign {
  identity: boolean;
  /** amount: the low cut is mixed with the dry sound by it */
  wet: number;
  /** low cut and presence sections (presence empty when presence·amount is 0) */
  lowCut: Biquad[]; presence: Biquad[];
  /** restart segment length and restart warm-up of the filters, samples */
  S: number; Wf: number;
  /** leveller block and limiter window, samples */
  B: number; M: number;
  gmax: number; ceiling: number; clampTo: number;
  /** leveller look-ahead (whole blocks), total look-ahead, warm-up */
  aheadLevel: number; ahead: number; warm: number;
}
/** The largest 32-bit float not above x (x > 0): a clamp to it survives the Float32Array store. */
function float32AtMost(x: number): number {
  const f = Math.fround(x);
  if (f <= x) return f;
  const b = new Float32Array([f]);
  new Uint32Array(b.buffer)[0]! -= 1;
  return b[0]!;
}
/** The presence sections for p = presence·amount (empty at p = 0). */
export function presenceSections(p: number, sampleRate: number): Biquad[] {
  if (p === 0) return [];
  const P = SPEECH.presence;
  return [peaking(P.lowHz, P.lowDb * p, P.lowQ, sampleRate), peaking(P.midHz, P.midDb * p, P.midQ, sampleRate), ...(P.shelfHz < 0.45 * sampleRate ? [highShelf(P.shelfHz, P.shelfDb * p, sampleRate)] : [])];
}
const cache = new Map<string, SpeechDesign>();
export function speechDesign(p: Readonly<AudioFxParams>, sampleRate: number): SpeechDesign {
  const q = fxParams(TYPE, p);
  const key = `${JSON.stringify(q.all)}|${sampleRate}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const wet = q.num('amount');
  const lowCut = butterworth4('high', q.num('lowCutHz'), sampleRate);
  const presence = presenceSections(q.num('presence') * wet, sampleRate);
  // restart warm-up: the tail of the composite P ∗ ((1 − a)·δ + a·HP) is at most the larger of the tails of P ∗ HP and of P
  const Wf = Math.max(1, cascadeWarm([...lowCut, ...presence], 1, SPEECH.restartEps), presence.length ? cascadeWarm(presence, 1, SPEECH.restartEps) : 0);
  const S = Wf;
  const B = Math.max(1, msToSamples(SPEECH.blockMs, sampleRate)), M = Math.max(1, Math.round((SPEECH.limiterMs * sampleRate) / 1000));
  const { windowBlocks: Wb, smoothPast: P, smoothFuture: Qf, holdBlocks: H, capEase: E } = SPEECH;
  // F_{k+1} needs the blocks up to k + 1 + Qf + Wb (level) and k + 1 + E + H (cap); they are complete when the input is that many blocks on
  const aheadBlocks = Math.max(Qf + Wb + 2, H + E + 2);
  const aheadLevel = aheadBlocks * B;
  const ahead = aheadLevel + M - 1;
  // history: limiter (M − 1), leveller (the level window and smoothing behind the block before: (P + Wb + 2)·B − 1), filters (S + Wf − 1)
  const warm = (M - 1) + ((P + Wb + 2) * B - 1) + (S + Wf - 1);
  const ceiling = dbToGain(q.num('ceilingDb'));
  const d: SpeechDesign = { identity: q.identity, wet, lowCut, presence, S, Wf, B, M, gmax: dbToGain(q.num('levelDb') * wet), ceiling, clampTo: float32AtMost(ceiling), aheadLevel, ahead, warm };
  if (cache.size > 256) cache.clear();
  cache.set(key, d);
  return d;
}

/** Leveller block ring (whole blocks kept: the level window and the smoothing reach back 49 blocks). */
const NB = 128, NM = NB - 1;
/** Frames filtered at once (scratch size). */
const CHUNK = 1024;
const pow2AtLeast = (n: number): number => { let r = 1; while (r < n) r *= 2; return r; };

/** One instance: the steps of the header, sample by sample (a class, so the hot loop stays monomorphic and allocation-free). */
class SpeechProcessor implements FxProcessor {
  // filters: low cut [s1, s2] and presence sections of filter f and channel ch at f·nAll·4 + ch·nAll·2 + k·2
  private readonly hc: Float64Array; private readonly pc: Float64Array; private readonly st: Float64Array;
  private readonly nH: number; private readonly nP: number; private readonly nAll: number;
  private readonly wet: number; private readonly S: number; private readonly sw: number;
  // leveller
  private readonly B: number; private readonly gateSum: number; private readonly T2B: number;
  private readonly gmax: number; private readonly gmin: number; private readonly gmax2: number; private readonly gmin2: number;
  private readonly invSmooth: number; private readonly invCap: number; private readonly aheadBlocks: number;
  private readonly Esum = new Float64Array(NB); private readonly act = new Uint8Array(NB);
  private readonly G = new Float64Array(NB).fill(1); private readonly capRaw = new Float64Array(NB).fill(1);
  private readonly capS = new Float64Array(NB).fill(1); private readonly F = new Float64Array(NB).fill(1);
  private readonly wts: Float64Array; private readonly side: Int8Array;
  // delay lines and limiter
  private readonly eRing: Float64Array; private readonly EM: number; private readonly lRing: Float64Array; private readonly LM: number;
  private readonly minW: AnchoredMin; private readonly sumW: AnchoredSum;
  private readonly at: number; private readonly M: number; private readonly aheadLevel: number; private readonly invM: number;
  private readonly c: number; private readonly cf: number;
  /** chunk scratch: input and filter outputs per channel (the second filter's output is not used) */
  private readonly xs0 = new Float64Array(CHUNK); private readonly xs1 = new Float64Array(CHUNK);
  private readonly e0 = new Float64Array(CHUNK); private readonly e1 = new Float64Array(CHUNK); private readonly junk = new Float64Array(CHUNK);
  private started = false; private o = 0; private cur = 0; private bo = 0; private kIn = 0; private acc = 0; private pos = 0;

  constructor(d: SpeechDesign, T2B: number, at: number) {
    this.nH = d.lowCut.length; this.nP = d.presence.length; this.nAll = this.nH + this.nP;
    this.hc = new Float64Array(this.nH * 5); this.pc = new Float64Array(Math.max(1, this.nP * 5));
    d.lowCut.forEach((s, k) => this.hc.set(s, k * 5));
    d.presence.forEach((s, k) => this.pc.set(s, k * 5));
    this.st = new Float64Array(2 * this.nAll * 4);
    this.wet = d.wet; this.S = d.S; this.sw = d.S - d.Wf;
    const B = (this.B = d.B);
    this.gateSum = dbToGain(SPEECH.gateDb) * dbToGain(SPEECH.gateDb) * 2 * B; // mean square −50 dBFS over the block's 2·B values
    this.T2B = T2B;
    this.gmax = d.gmax; this.gmin = 1 / d.gmax; this.gmax2 = d.gmax * d.gmax; this.gmin2 = 1 / this.gmax2;
    this.invSmooth = 1 / (SPEECH.smoothPast + SPEECH.smoothFuture + 1); this.invCap = 1 / (2 * SPEECH.capEase + 1);
    this.aheadBlocks = d.aheadLevel / B;
    // interpolation between block centres: a sample at offset o of block k lies (o + 0.5)/B − 0.5 blocks from the centre of k
    this.wts = new Float64Array(B); this.side = new Int8Array(B);
    for (let o = 0; o < B; o++) { const x = (o + 0.5) / B - 0.5; this.wts[o] = x < 0 ? -x : x; this.side[o] = x < 0 ? -1 : 1; }
    // the filtered sound waits aheadLevel samples for its gain, the levelled sound M − 1 for the limiter
    const ER = pow2AtLeast(d.aheadLevel + 1), LR = pow2AtLeast(d.M);
    this.eRing = new Float64Array(ER * 2); this.EM = ER - 1; this.lRing = new Float64Array(LR * 2); this.LM = LR - 1;
    this.minW = new AnchoredMin(d.M); this.sumW = new AnchoredSum(d.M);
    this.at = at; this.M = d.M; this.aheadLevel = d.aheadLevel; this.invM = 1 / d.M; this.c = d.ceiling; this.cf = d.clampTo;
  }
  /**
   * Filter f, channel ch, over src[a, b) into dst[a, b): low cut, mixed with the dry sound by the amount, then presence. Section
   * by section with the state in locals; every sample sees exactly the same operations however the stream is chunked. No
   * denormal flush is needed: every filter restarts from zero at least every S + Wf samples (under 0.6 s).
   */
  private runFilter(f: number, ch: number, src: Float64Array, dst: Float64Array, a: number, b: number): void {
    const st = this.st, wet = this.wet;
    let si = f * this.nAll * 4 + ch * this.nAll * 2;
    for (let n = a; n < b; n++) dst[n] = src[n]!;
    for (let k = 0; k < this.nH; k++, si += 2) runSection(this.hc, k * 5, st, si, dst, a, b);
    for (let n = a; n < b; n++) { const x = src[n]!; dst[n] = x + wet * (dst[n]! - x); }
    for (let k = 0; k < this.nP; k++, si += 2) runSection(this.pc, k * 5, st, si, dst, a, b);
  }
  /** Block j is complete with energy e: the block pipeline moves on (level gain, pause cap, smoothed gain F). */
  private finish(j: number, e: number): void {
    const { windowBlocks: Wb, smoothPast: P, smoothFuture: Qf, holdBlocks: H, capEase: E } = SPEECH;
    const Esum = this.Esum, act = this.act, G = this.G, capRaw = this.capRaw, capS = this.capS;
    const ji = j & NM;
    Esum[ji] = e;
    act[ji] = e >= this.gateSum ? 1 : 0;
    // level gain of block u = j − Wb: the active blocks of [u − Wb, u + Wb]
    const u = j - Wb;
    let s = 0, n = 0;
    for (let i = u - Wb; i <= j; i++) { const qi = i & NM; if (act[qi]) { s += Esum[qi]!; n++; } }
    let U = 1;
    if (n > 0) { const ratio = (this.T2B * n) / s; U = ratio >= this.gmax2 ? this.gmax : ratio <= this.gmin2 ? this.gmin : Math.sqrt(ratio); }
    G[u & NM] = U;
    // pause cap of block v = j − H (no active block within ±H), eased over ±E blocks for block w = v − E
    const v = j - H;
    let near = 0;
    for (let i = v - H; i <= j; i++) if (act[i & NM]) { near = 1; break; }
    capRaw[v & NM] = near ? this.gmax : 1;
    const w = v - E;
    let c = 0;
    for (let i = w - E; i <= v; i++) c += capRaw[i & NM]!;
    capS[w & NM] = c * this.invCap;
    // smoothed gain of block z = u − Qf over [z − P, z + Qf], capped
    const z = u - Qf;
    let g = 0;
    for (let i = z - P; i <= u; i++) g += G[i & NM]!;
    g *= this.invSmooth;
    const cz = capS[z & NM]!;
    this.F[z & NM] = g < cz ? g : cz;
  }
  process(buf: Float32Array, frames: number, n0: number): void {
    const S = this.S, sw = this.sw, B = this.B, M = this.M, nAll4 = this.nAll * 4;
    if (!this.started) {
      this.started = true;
      const t0 = this.at + n0;
      this.o = ((t0 % S) + S) % S;
      this.bo = ((t0 % B) + B) % B;
      this.kIn = (t0 - this.bo) / B;
    }
    const st = this.st, eRing = this.eRing, EM = this.EM, lRing = this.lRing, LM = this.LM, F = this.F, wts = this.wts, side = this.side;
    const xs0 = this.xs0, xs1 = this.xs1, e0 = this.e0, e1 = this.e1, junk = this.junk;
    const aheadLevel = this.aheadLevel, aheadBlocks = this.aheadBlocks, c = this.c, cf = this.cf, invM = this.invM;
    let o = this.o, cur = this.cur, bo = this.bo, kIn = this.kIn, acc = this.acc, pos = this.pos;
    for (let i0 = 0; i0 < frames; i0 += CHUNK) {
      const len = Math.min(CHUNK, frames - i0);
      for (let n = 0, j = i0 * 2; n < len; n++, j += 2) { xs0[n] = buf[j]!; xs1[n] = buf[j + 1]!; }
      // 1–2. filters, restarted on the grid: at o = 0 the filter that warmed up takes over; at o = S − Wf the other one restarts
      for (let a = 0; a < len;) {
        if (o === 0) cur ^= 1;
        const other = cur ^ 1;
        if (o === sw) st.fill(0, other * nAll4, (other + 1) * nAll4);
        const b = Math.min(len, a + (o < sw ? sw - o : S - o));
        this.runFilter(cur, 0, xs0, e0, a, b);
        this.runFilter(cur, 1, xs1, e1, a, b);
        if (o >= sw) { this.runFilter(other, 0, xs0, junk, a, b); this.runFilter(other, 1, xs1, junk, a, b); }
        o += b - a;
        if (o === S) o = 0;
        a = b;
      }
      for (let n = 0, j = i0 * 2; n < len; n++, j += 2) {
        const el = e0[n]!, er = e1[n]!;
        const ei = (pos & EM) * 2;
        eRing[ei] = el;
        eRing[ei + 1] = er;
        // 3. leveller: block energy; a finished block moves the block pipeline on; the sample aheadLevel back gets its gain
        if (bo === 0) acc = 0;
        acc += el * el + er * er;
        if (bo === B - 1) this.finish(kIn, acc);
        const kl = kIn - aheadBlocks, fk = F[kl & NM]!, fo = F[(kl + side[bo]!) & NM]!;
        const g = fk + wts[bo]! * (fo - fk);
        if (++bo === B) { bo = 0; kIn++; }
        const di = ((pos - aheadLevel) & EM) * 2;
        const ll = eRing[di]! * g, lr = eRing[di + 1]! * g;
        // 4. limiter: minimum over the next M, average over the last M
        const al = ll < 0 ? -ll : ll, ar = lr < 0 ? -lr : lr, pk = al > ar ? al : ar;
        const r = pk > c ? c / pk : 1;
        const tl = this.at + n0 + i0 + n - aheadLevel;
        const m = this.minW.push(tl, r);
        const av = this.sumW.push(tl - M + 1, m) * invM;
        const li = (pos & LM) * 2;
        lRing[li] = ll;
        lRing[li + 1] = lr;
        const oi = ((pos - (M - 1)) & LM) * 2;
        let yl = lRing[oi]! * av, yr = lRing[oi + 1]! * av;
        if (yl > cf) yl = cf; else if (yl < -cf) yl = -cf;
        if (yr > cf) yr = cf; else if (yr < -cf) yr = -cf;
        buf[j] = yl;
        buf[j + 1] = yr;
        pos++;
      }
    }
    this.o = o; this.cur = cur; this.bo = bo; this.kIn = kIn; this.acc = acc; this.pos = pos;
  }
}

/** One biquad section (transposed direct form II, Float64) over v[a, b) in place, its state at st[si], st[si + 1]. */
function runSection(c: Float64Array, ci: number, st: Float64Array, si: number, v: Float64Array, a: number, b: number): void {
  const b0 = c[ci]!, b1 = c[ci + 1]!, b2 = c[ci + 2]!, a1 = c[ci + 3]!, a2 = c[ci + 4]!;
  let s1 = st[si]!, s2 = st[si + 1]!;
  for (let n = a; n < b; n++) {
    const x = v[n]!, y = b0 * x + s1;
    s1 = b1 * x - a1 * y + s2;
    s2 = b2 * x - a2 * y;
    v[n] = y;
  }
  st[si] = s1;
  st[si + 1] = s2;
}

export const speech: BoundedKernel = {
  type: TYPE, version: 1, stage: 2,
  reach(p, sampleRate) {
    const d = speechDesign(p, sampleRate);
    return d.identity ? { warm: 0, tail: 0, ahead: 0 } : { warm: d.warm, tail: 0, ahead: d.ahead };
  },
  bound(p, sampleRate) {
    const d = speechDesign(p, sampleRate);
    return d.identity ? 1 : d.ceiling;
  },
  create(p, ctx: FxContext): FxProcessor {
    const d = speechDesign(p, ctx.sampleRate);
    if (d.identity) return DRY;
    const g = dbToGain(fxParams(TYPE, p).num('targetDb'));
    return new SpeechProcessor(d, g * g * 2 * d.B /* T·2B: the target as the energy sum of one block of B stereo frames */, ctx.at);
  },
};
