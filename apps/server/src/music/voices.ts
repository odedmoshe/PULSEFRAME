/**
 * The instruments of the built-in music synthesiser (ADR-0022), arithmetic only (see dsp.ts): a Karplus-Strong pluck, a
 * two-operator FM voice (electric piano, bell, round bass), a polyBLEP saw pad through a state-variable filter, and drums made
 * of a sine sweep and filtered xorshift noise. Each renders one note into a scratch buffer, starting from silence: every
 * envelope begins at 0 on the note's first sample (the click voice of the onset test excepted), so a track begins with a 0.
 */
import { decay60, expNeg, flush, midiHz, Noise, polyBlep, SR, sin01, svfF, centsRatio } from './dsp.ts';

export type Voice =
  /** Karplus-Strong string: bright = excitation smoothing (0..1, 1 = raw noise), t60 = ring time of the string. */
  | { kind: 'pluck'; level: number; bright: number; t60: number; release: number }
  /** Two-operator FM: index in cycles of carrier phase, falling to 0 by indexT60; amplitude falls by t60 (0 = held). */
  | { kind: 'fm'; level: number; ratio: number; index: number; indexT60: number; t60: number; attack: number; release: number }
  /** Detuned polyBLEP saws through a low-pass state-variable filter; t60 0 = held while the note lasts. */
  | { kind: 'pad'; level: number; cutoff: number; attack: number; release: number; detune: number; saws: 2 | 3; t60: number }
  | { kind: 'kick'; level: number; f0: number; f1: number; pitchT60: number; t60: number }
  | { kind: 'snare'; level: number; tone: number; noiseHz: number; t60: number }
  | { kind: 'hat'; level: number; hz: number; t60: number }
  | { kind: 'clap'; level: number; hz: number; t60: number }
  | { kind: 'crash'; level: number; hz: number; t60: number }
  | { kind: 'shaker'; level: number; hz: number; t60: number }
  /** Noise through a low-pass that opens from `from` to `to` Hz over the note, swelling from silence. */
  | { kind: 'riser'; level: number; from: number; to: number }
  /** The onset test's click (M4): starts at full level on its first sample. */
  | { kind: 'click'; level: number; hz: number };

const LN1000 = 6.907755278982137;
/** Per-period loss of a string that rings for t60 seconds. */
const lossOver = (samples: number, t60: number) => expNeg((LN1000 * samples) / (t60 * SR));
const sec = (s: number) => Math.max(1, Math.round(s * SR));

/** How many samples a note sounds for (its gate plus its tail), before the caller caps it at the end of the track. */
export function noteLength(v: Voice, gate: number): number {
  switch (v.kind) {
    case 'pluck': return Math.min(gate, sec(v.t60)) + sec(v.release);
    case 'fm': return (v.t60 > 0 ? Math.min(gate, sec(v.t60)) : gate) + sec(v.release);
    case 'pad': return (v.t60 > 0 ? Math.min(gate, sec(v.t60)) : gate) + sec(v.release);
    case 'kick': case 'snare': case 'hat': case 'clap': case 'crash': case 'shaker': return sec(v.t60);
    case 'riser': return gate + sec(0.015);
    case 'click': return sec(0.05);
  }
}

/** An envelope: a linear attack from 0, a decay (or hold) while the gate is open, then a release. */
class Env {
  private e = 0;
  private i = 0;
  constructor(private att: number, private dec: number, private gate: number, private rel: number) {}
  next(): number {
    const i = this.i++;
    if (i < this.att) { this.e = i / this.att; return this.e; }
    this.e *= i < this.gate ? this.dec : this.rel;
    return this.e;
  }
}

/**
 * Render one note into out[0..n) and return n (n <= out.length). `gate` is how long the note is held, in samples;
 * vel scales the level (0..1).
 */
export function renderNote(v: Voice, midi: number, vel: number, gate: number, noise: Noise, out: Float64Array): number {
  const n = Math.min(out.length, noteLength(v, gate));
  const amp = v.level * vel;
  switch (v.kind) {
    case 'pluck': {
      const L = SR / midiHz(midi);
      let N = Math.floor(L - 0.5), frac = L - 0.5 - N;
      if (frac < 0.2) { N -= 1; frac += 1; }
      const c = (1 - frac) / (1 + frac);
      const buf = new Float64Array(N);
      let lp = 0, mean = 0;
      for (let i = 0; i < N; i++) { lp += v.bright * (noise.next() - lp); buf[i] = lp; mean += lp; }
      mean /= N;
      let mag = 0;
      for (let i = 0; i < N; i++) { buf[i] = buf[i]! - mean; mag += Math.abs(buf[i]!); }
      const norm = mag > 0 ? (0.6 * N) / mag : 0;
      const g = 0.5 * lossOver(L, v.t60);
      const env = new Env(96, 1, gate, decay60(v.release));
      let idx = 0, apx = 0, apy = 0;
      for (let i = 0; i < n; i++) {
        const x = buf[idx]!;
        const nx = buf[idx + 1 === N ? 0 : idx + 1]!;
        const avg = (x + nx) * g;
        const y = flush(c * avg + apx - c * apy);
        apx = avg; apy = y;
        buf[idx] = y;
        if (++idx === N) idx = 0;
        out[i] = x * norm * amp * env.next();
      }
      return n;
    }
    case 'fm': {
      const fc = midiHz(midi);
      const dc = fc / SR, dm = (fc * v.ratio) / SR;
      let pc = 0, pm = 0, index = v.index;
      const im = decay60(v.indexT60);
      const env = new Env(sec(v.attack), v.t60 > 0 ? decay60(v.t60) : 1, gate, decay60(v.release));
      for (let i = 0; i < n; i++) {
        out[i] = sin01(pc + index * sin01(pm)) * amp * env.next();
        pc += dc; pm += dm;
        if (pc >= 1) pc -= 1;
        if (pm >= 1) pm -= 1;
        index *= im;
      }
      return n;
    }
    case 'pad': {
      const f = midiHz(midi);
      const ratios = v.saws === 3 ? [centsRatio(-v.detune), 1, centsRatio(v.detune)] : [centsRatio(-v.detune / 2), centsRatio(v.detune / 2)];
      const dts = ratios.map((r) => (f * r) / SR);
      const ph = ratios.map((_, k) => k / ratios.length);
      const ff = svfF(Math.min(v.cutoff, f * 8)), q = 1.1;
      let low = 0, band = 0;
      const env = new Env(sec(v.attack), v.t60 > 0 ? decay60(v.t60) : 1, gate, decay60(v.release));
      const scale = amp / ratios.length;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k < dts.length; k++) {
          const p = ph[k]!, dt = dts[k]!;
          s += 2 * p - 1 - polyBlep(p, dt);
          let np = p + dt;
          if (np >= 1) np -= 1;
          ph[k] = np;
        }
        low = flush(low + ff * band);
        const high = s - low - q * band;
        band = flush(band + ff * high);
        out[i] = low * scale * env.next();
      }
      return n;
    }
    case 'kick': {
      let ph = 0, fe = 1;
      const pmul = decay60(v.pitchT60);
      const env = new Env(48, decay60(v.t60), n, 1);
      for (let i = 0; i < n; i++) {
        out[i] = sin01(ph) * amp * env.next();
        ph += (v.f1 + (v.f0 - v.f1) * fe) / SR;
        if (ph >= 1) ph -= 1;
        fe *= pmul;
      }
      return n;
    }
    case 'snare': {
      const ff = svfF(v.noiseHz);
      let low = 0, band = 0, ph = 0;
      const env = new Env(24, decay60(v.t60), n, 1);
      const body = new Env(24, decay60(v.t60 * 0.6), n, 1);
      for (let i = 0; i < n; i++) {
        low = flush(low + ff * band);
        const high = noise.next() - low - 0.9 * band;
        band = flush(band + ff * high);
        out[i] = (band * 0.8 * env.next() + 0.6 * sin01(ph) * body.next()) * amp;
        ph += v.tone / SR;
        if (ph >= 1) ph -= 1;
      }
      return n;
    }
    case 'hat': case 'shaker': case 'crash': case 'clap': {
      const ff = svfF(v.hz);
      let low = 0, band = 0;
      const att = v.kind === 'shaker' ? sec(0.008) : v.kind === 'crash' ? sec(0.003) : 12;
      const env = new Env(att, decay60(v.t60), n, 1);
      const burst = sec(0.011), bm = decay60(0.025);
      let be = 0;
      for (let i = 0; i < n; i++) {
        low = flush(low + ff * band);
        const high = noise.next() - low - 1.0 * band;
        band = flush(band + ff * high);
        const sig = v.kind === 'hat' || v.kind === 'crash' ? high : band;
        let e = env.next();
        if (v.kind === 'clap') {
          // three quick hand claps 11 ms apart, then the room
          if (i < 3 * burst) { if (i % burst === 0) be = 1; else be *= bm; e = Math.max(be * (i % burst < 12 ? (i % burst) / 12 : 1), e * 0.5); }
        }
        out[i] = sig * amp * e;
      }
      return n;
    }
    case 'riser': {
      let low = 0, band = 0, ff = svfF(v.from);
      const rel = decay60(0.015);
      let tail = 1;
      for (let i = 0; i < n; i++) {
        if ((i & 63) === 0 && i < gate) ff = svfF(v.from + ((v.to - v.from) * i) / gate);
        low = flush(low + ff * band);
        const high = noise.next() - low - 0.7 * band;
        band = flush(band + ff * high);
        const u = i < gate ? i / gate : 1;
        if (i >= gate) tail *= rel;
        out[i] = low * amp * u * u * tail;
      }
      return n;
    }
    case 'click': {
      const dec = decay60(0.03);
      let e = 1, ph = 0.25; // a cosine: full level on the first sample, so the onset is that sample exactly
      for (let i = 0; i < n; i++) {
        out[i] = sin01(ph) * amp * e;
        ph += v.hz / SR;
        if (ph >= 1) ph -= 1;
        e *= dec;
      }
      return n;
    }
  }
}
