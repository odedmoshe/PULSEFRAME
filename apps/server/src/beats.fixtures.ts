/** Synthetic material and scoring for the beat tracker (used by unit tests and the Phase 9 corpus run). */
import { BEAT_SR } from './beats.ts';

/** Synthetic drum loop: kick (with attack click) on every beat, quieter hat on the off-beats, a bass tone, light noise. Deterministic. */
export function drumLoop(bpm: (t: number) => number, seconds: number, first = 0.37, seed = 1): { x: Float32Array; beats: number[] } {
  const x = new Float32Array(Math.round(seconds * BEAT_SR));
  let r = seed;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296 - 0.5; };
  const beats: number[] = [];
  for (let t = first; t < seconds - 0.2; t += 60 / bpm(t)) beats.push(t);
  const add = (at: number, f: (dt: number) => number, len: number) => { const s0 = Math.round(at * BEAT_SR); for (let i = 0; i < len * BEAT_SR && s0 + i < x.length; i++) x[s0 + i] = x[s0 + i]! + f(i / BEAT_SR); };
  beats.forEach((b, i) => {
    add(b, (dt) => 0.8 * Math.sin(2 * Math.PI * (70 - 60 * dt) * dt) * Math.exp(-18 * dt), 0.25);
    add(b, () => 0.5 * rnd() * 2, 0.004); // beater click: real kicks have a short broadband attack
    const half = (beats[i + 1] ?? b + 60 / bpm(b)) - b;
    add(b + half / 2, (dt) => 0.12 * rnd() * 2 * Math.exp(-60 * dt), 0.06);
  });
  for (let i = 0; i < x.length; i++) x[i] = x[i]! + 0.08 * Math.sin((2 * Math.PI * 110 * i) / BEAT_SR) + 0.01 * rnd();
  return { x, beats };
}
/** F-measure of detected beats against the truth, within ±tol seconds (each true beat matched at most once). */
export function beatF1(found: number[], truth: number[], tol = 0.07) {
  const used = new Set<number>();
  let hit = 0;
  for (const f of found) { const j = truth.findIndex((t, k) => !used.has(k) && Math.abs(t - f) <= tol); if (j >= 0) { used.add(j); hit++; } }
  const p = found.length ? hit / found.length : 0, r = truth.length ? hit / truth.length : 0;
  return { f1: p + r ? (2 * p * r) / (p + r) : 0, precision: p, recall: r };
}

