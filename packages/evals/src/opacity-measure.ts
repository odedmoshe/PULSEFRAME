/**
 * MEASUREMENTS beside conformance:opacity (opacity-conformance.ts runs them as checks 9 to 12): four things that were left on the
 * old path (globalAlpha) or never measured. Each is drawn by the product's own evaluate + drawGraph in headless Chromium
 * (opacity-measure-page.ts) in the full quality (stills, export, the paused preview) and in the draft quality (the player while it
 * plays), compared byte by byte with an exact mix computed HERE from independently recomputed pictures (opacity-measure-patterns.ts).
 * For every case: the maximum deviation in 8-bit levels, max |O − round(exact)|; the mean signed deviation (bias), mean of O − exact
 * with the exact value real-valued; and the number of sampled bytes more than 1 level off, |O − round(exact)| ≥ 2.
 * The tolerances below are set above what the product measured when this was written (stated per check); they gate regressions
 * and claim nothing new. A deviation above 2 levels is reported, not fixed (opacity-measure.json "above2").
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page } from 'playwright';
import { MW as W, MH as H, picA, picB, picF, rgbOfPx, TITLE_RGB } from './opacity-measure-patterns.ts';
import type { MeasurePage } from './opacity-measure-page.ts';

type Q = 'draft' | 'full';
const N = W * H * 3;
declare global { interface Window { __pfMeasure: MeasurePage } }

/** Running deviation statistics of one set of bytes against exact (real-valued) references. */
export class Acc {
  n = 0; sum = 0; sumAbs = 0; max = 0; off2 = 0; maxReal = 0;
  add(o: number, e: number) { const d = o - e, r = Math.abs(o - Math.round(e)); this.n++; this.sum += d; this.sumAbs += Math.abs(d); if (r > this.max) this.max = r; if (r >= 2) this.off2++; const a = Math.abs(d); if (a > this.maxReal) this.maxReal = a; }
  merge(x: Acc) { this.n += x.n; this.sum += x.sum; this.sumAbs += x.sumAbs; this.max = Math.max(this.max, x.max); this.off2 += x.off2; this.maxReal = Math.max(this.maxReal, x.maxReal); return this; }
  out() { return { bytes: this.n, maxLevels: this.max, maxRealValuedDeviation: +this.maxReal.toFixed(3), meanSigned: this.n ? +(this.sum / this.n).toFixed(4) : 0, meanAbs: this.n ? +(this.sumAbs / this.n).toFixed(4) : 0, bytesOff2: this.off2 }; }
}
const dec = (s: string) => { const b = Buffer.from(s, 'base64'); if (b.length !== N) throw new Error('frame size'); return b; };
const diff = (a: Buffer, b: Buffer) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const q8 = (x: number) => Math.round(255 * x) / 255;

export interface Measured { checks: { name: string; ok: boolean; detail: unknown }[]; evidence: Record<string, unknown>; above2: { case: string; levels: number; where: string }[]; seconds: number }

/** Bundles the page script (esbuild from the workspace's install) and loads it into a fresh page. */
export async function openMeasurePage(page: Page, root: string) {
  const pnpm = path.join(root, 'node_modules/.pnpm');
  const dirName = fs.readdirSync(pnpm).find((d) => d.startsWith('esbuild@'));
  if (!dirName) throw new Error('esbuild is not installed (it comes with vite)');
  const out = path.join(root, '.artifacts/opacity-conformance/measure-page.js');
  execFileSync(path.join(pnpm, dirName, 'node_modules/esbuild/bin/esbuild'), [path.join(root, 'packages/evals/src/opacity-measure-page.ts'), '--bundle', '--format=iife', '--platform=browser', '--target=es2022', `--outfile=${out}`, '--log-level=error'], { cwd: path.join(root, 'packages/evals') });
  await page.goto('about:blank');
  await page.addScriptTag({ content: fs.readFileSync(out, 'utf8') });
  await page.waitForFunction(() => document.body.dataset.ready === '1');
}

export async function measureAll(page: Page): Promise<Measured> {
  const t0 = Date.now();
  const checks: Measured['checks'] = [];
  const evidence: Record<string, unknown> = {};
  const above2: Measured['above2'] = [];
  const m = <K extends keyof MeasurePage>(k: K, ...a: Parameters<MeasurePage[K]>) => page.evaluate(([kk, aa]) => (window.__pfMeasure[kk as keyof MeasurePage] as (...x: unknown[]) => unknown)(...(aa as unknown[])), [k, a] as [string, unknown[]]) as Promise<Awaited<ReturnType<MeasurePage[K]>>>;
  const note = (c: string, a: ReturnType<Acc['out']>, where = '') => { if (a.maxLevels > 2) above2.push({ case: c, levels: a.maxLevels, where }); };

  // ================= 9. titles =================
  {
    const A = rgbOfPx(picA);
    const OPAC = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    // The reference of a title is its own fully opaque rendering T1 (no animation, opacity 1) mixed over the background at the
    // nearest 8-bit alpha aq of its effective opacity (opacity × the fade-in's alpha): e = (1 − aq)·bg + aq·T1.
    // Classes of pixel, from T1 alone: 'solid' T1 is exactly the fill colour (full coverage), 'outside' T1 equals the background
    // (no coverage), 'edge' anything between: an antialiased pixel, where T1 is itself an 8-bit mix of fill and background, so
    // e is an exact mix of that rounded mix, and the title's own coverage at the lower opacity (computed by the rasteriser from
    // the same outline) may differ from it by up to one level of coverage before the mix (a few levels × aq).
    const classes = ['solid', 'edge', 'outside'] as const;
    const per: Record<string, unknown> = {};
    let titleDiff = 0; const fullFrames = new Map<string, Buffer>();
    const summary: Record<string, { full: Acc[][]; draft: Acc[][] }> = {};
    for (const stroke of [false, true]) {
      for (const anim of [false, true]) {
        const name = `${stroke ? 'stroked' : 'plain'}${anim ? ' + fade-in half way' : ''}`;
        const T1 = dec((await m('title', 1, null, stroke, 'full')).rgb);
        const cls = new Uint8Array(N / 3);
        for (let i = 0; i < N / 3; i++) { const t = [T1[i * 3]!, T1[i * 3 + 1]!, T1[i * 3 + 2]!], b = [A[i * 3]!, A[i * 3 + 1]!, A[i * 3 + 2]!]; cls[i] = t.every((v, c) => v === b[c]) ? 2 : t.every((v, c) => v === TITLE_RGB[c]) ? 0 : 1; }
        const counts = classes.map((_, k) => cls.reduce((s, v) => s + (v === k ? 1 : 0), 0));
        const sum = { full: classes.map(() => [new Acc(), new Acc(), new Acc()]), draft: classes.map(() => [new Acc(), new Acc(), new Acc()]) };
        const rows: unknown[] = [];
        for (const quality of ['full', 'draft'] as Q[]) {
          for (const o of OPAC) {
            const r = await m('title', o, anim ? 9 : null, stroke, quality);
            const O = dec(r.rgb), aq = q8(o * r.u), key = `${stroke}${anim}${o}`;
            if (quality === 'full') fullFrames.set(key, O); else titleDiff += diff(O, fullFrames.get(key)!);
            const acc = classes.map(() => [new Acc(), new Acc(), new Acc()]);
            for (let i = 0; i < N / 3; i++) for (let c = 0; c < 3; c++) { const e = (1 - aq) * A[i * 3 + c]! + aq * T1[i * 3 + c]!; acc[cls[i]!]![c]!.add(O[i * 3 + c]!, e); sum[quality][cls[i]!]![c]!.add(O[i * 3 + c]!, e); }
            rows.push({ quality, opacity: o, effectiveAlpha: +(o * r.u).toFixed(4), ...Object.fromEntries(classes.map((k, ki) => [k, acc[ki]!.map((a) => a.out())])) });
          }
        }
        summary[name] = sum;
        per[name] = { pixels: Object.fromEntries(classes.map((k, i) => [k, counts[i]])), summary: Object.fromEntries((['full', 'draft'] as Q[]).map((q) => [q, Object.fromEntries(classes.map((k, ki) => [k, sum[q][ki]!.map((a) => a.out())]))])), perOpacity: rows };
        for (const q of ['full', 'draft'] as Q[]) for (const [ki, k] of classes.entries()) for (const [c, a] of sum[q][ki]!.entries()) note(`title ${name} ${q} ${k} ch${c}`, a.out(), 'see measurements.title');
      }
    }
    evidence.title = per; evidence.titleFullVsDraftBytesDiffering = titleDiff;
    const worst = (n: string, q: Q, k: number) => Math.max(...summary[n]![q][k]!.map((a) => a.max));
    const plain = 'plain', plainAnim = 'plain + fade-in half way';
    const gate = { plainSolid: Math.max(...(['full', 'draft'] as Q[]).flatMap((q) => [plain, plainAnim].map((n) => worst(n, q, 0)))), plainEdge: Math.max(...(['full', 'draft'] as Q[]).flatMap((q) => [plain, plainAnim].map((n) => worst(n, q, 1)))), plainOutside: Math.max(...(['full', 'draft'] as Q[]).flatMap((q) => [plain, plainAnim].map((n) => worst(n, q, 2)))), bias: Math.max(...(['full', 'draft'] as Q[]).flatMap((q) => [plain, plainAnim].flatMap((n) => [0, 1].flatMap((k) => summary[n]![q][k]!.map((a) => Math.abs(a.sum / Math.max(1, a.n))))))) };
    checks.push({ name: '9. Title opacity (11 opacities incl. 0, 0.5, 1; plain, without and with a fade-in half way; full and draft): solid and antialiased edge pixels within 3 levels and mean bias within ±0.75, pixels outside the glyphs within 1, of the exact mix of the title\'s opaque rendering at the nearest 8-bit alpha (stroked title recorded, not gated)', ok: gate.plainSolid <= TOL.levels && gate.plainEdge <= TOL.levels && gate.plainOutside <= TOL.outsideLevels && gate.bias <= TOL.bias, detail: { toleranceLevels: TOL.levels, toleranceOutside: TOL.outsideLevels, toleranceBias: TOL.bias, measuredWorst: gate, fullVsDraftBytesDiffering: evidence.titleFullVsDraftBytesDiffering } });
  }

  // ================= 10. time-effect taps =================
  {
    const A = rgbOfPx(picA), frames = new Map<number, Uint8Array>();
    const P = (fr: number) => { let v = frames.get(fr); if (!v) { v = rgbOfPx(picF(fr)); frames.set(fr, v); } return v; };
    const cases: { name: string; p: { count: number; delay: number; decay: number; mode: string }; opacities: number[] }[] = [];
    for (const count of [2, 3, 4, 5]) for (const decay of [0.6, 0.9]) cases.push({ name: `echo blend count ${count} decay ${decay}`, p: { count, delay: 3, decay, mode: 'blend' }, opacities: [1, 0.75, 0.5, 0.25] });
    cases.push({ name: 'echo lighten count 4 decay 0.6', p: { count: 4, delay: 3, decay: 0.6, mode: 'lighten' }, opacities: [1] });
    cases.push({ name: 'echo trail count 4 decay 0.6', p: { count: 4, delay: 3, decay: 0.6, mode: 'trail' }, opacities: [1] });
    const out: unknown[] = []; let tapsDiff = 0; const tapFull = new Map<string, Buffer>();
    const total: Record<Q, Acc> = { full: new Acc(), draft: new Acc() };
    const blendTotal: Record<Q, Acc> = { full: new Acc(), draft: new Acc() };
    for (const cs of cases) for (const o of cs.opacities) for (const quality of ['full', 'draft'] as Q[]) {
      const r = await m('taps', cs.p, o, quality), O = dec(r.rgb);
      const key = `${cs.name}${o}`; if (quality === 'full') tapFull.set(key, O); else tapsDiff += diff(O, tapFull.get(key)!);
      const w = r.taps.map((t) => t.weight), pics = r.taps.map((t) => P(t.frame));
      const sumW = w.reduce((s, x) => s + x, 0);
      const aq = q8(o), acc = new Acc();
      for (let i = 0; i < N; i++) {
        let v: number;
        if (cs.p.mode === 'lighten') { v = 0; pics.forEach((pic, k) => { v = Math.max(v, cs.p.decay ** k * pic[i]!); }); }
        else if (cs.p.mode === 'trail') v = pics[0]![i]!; // opaque newest picture: the trail is behind it and hidden
        else { v = 0; pics.forEach((pic, k) => { v += (w[k]! / sumW) * pic[i]!; }); }
        acc.add(O[i]!, (1 - aq) * A[i]! + aq * v);
      }
      const a = acc.out();
      out.push({ case: cs.name, opacity: o, quality, tapSourceFrames: r.taps.map((t) => t.frame), tapWeightsOf4096: w, ...a });
      note(`taps ${cs.name} o=${o} ${quality}`, a);
      total[quality].merge(acc); if (cs.p.mode === 'blend') blendTotal[quality].merge(acc);
    }
    evidence.tapsFullVsDraftBytesDiffering = tapsDiff;
    evidence.taps = { reference: 'exact mix (1 − aq)·picture below + aq·Σ (W_k/4096)·P_k of the tap pictures P_k recomputed here (lighten: max_k decay^k·P_k; trail with an opaque newest picture: P_0), aq = round(255·opacity)/255', total: { full: total.full.out(), draft: total.draft.out() }, cases: out };
    const worst = Math.max(total.full.max, total.draft.max);
    checks.push({ name: '10. Time-effect taps (echo blend 2 to 5 taps at decay 0.6 and 0.9 at opacities 1, 0.75, 0.5, 0.25; lighten and trail at 1; full and draft): every byte within 3 levels and the mean bias within ±0.75 of the exact weighted mix', ok: worst <= TOL.levels && Math.max(Math.abs(total.full.sum / total.full.n), Math.abs(total.draft.sum / total.draft.n)) <= TOL.bias, detail: { toleranceLevels: TOL.levels, toleranceBias: TOL.bias, fullVsDraftBytesDiffering: evidence.tapsFullVsDraftBytesDiffering, full: total.full.out(), draft: total.draft.out() } });
  }

  // ================= 11 + 12. zoom, punch, blur-dissolve =================
  {
    const A = rgbOfPx(picA);
    const Fs = [31, 33, 35, 37, 40, 43, 45, 47, 49];
    const kinds: { id: string; type: string; reveal: boolean; ref: (parts: Record<string, Buffer>, p: number, wo: number, wi: number, i: number) => number }[] = [
      { id: 'zoom, between two clips', type: 'zoom', reveal: false, ref: (pt, _p, wo, wi, i) => wo * A[i]! + wi * pt.scaledB![i]! },
      { id: 'zoom, revealing over the track below', type: 'zoom', reveal: true, ref: (pt, _p, wo, wi, i) => wo * A[i]! + wi * pt.scaledB![i]! },
      { id: 'blur-dissolve, between two clips', type: 'blur-dissolve', reveal: false, ref: (pt, _p, wo, wi, i) => wo * pt.softA![i]! + wi * pt.softB![i]! },
      { id: 'blur-dissolve, revealing over the track below', type: 'blur-dissolve', reveal: true, ref: (pt, _p, wo, wi, i) => wo * A[i]! + wi * pt.softB![i]! },
    ];
    const ev: Record<string, unknown> = {}; let transDiff = 0;
    const gated: Record<string, Record<Q, ReturnType<Acc['out']>>> = {};
    for (const k of kinds) {
      const rows: unknown[] = [];
      const tot: Record<Q, Acc> = { full: new Acc(), draft: new Acc() }, totP: Record<Q, Acc> = { full: new Acc(), draft: new Acc() };
      for (const F of Fs) {
        const f0 = await m('transition', k.type, k.reveal, F, 'full', true);
        const parts = Object.fromEntries(Object.entries(f0.parts!).map(([n, s]) => [n, dec(s)]));
        const p = f0.progress, wo = Math.round(255 * (1 - p)) / 255, wi = q8(p);
        for (const quality of ['full', 'draft'] as Q[]) {
          const O = dec(quality === 'full' ? f0.rgb : (await m('transition', k.type, k.reveal, F, 'draft', false)).rgb);
          if (quality === 'draft') transDiff += diff(O, dec(f0.rgb));
          const a = new Acc(), ap = new Acc();
          for (let i = 0; i < N; i++) { a.add(O[i]!, k.ref(parts, p, wo, wi, i)); ap.add(O[i]!, k.ref(parts, p, 1 - p, p, i)); }
          rows.push({ quality, frame: F, progress: +p.toFixed(4), atNearest8BitAlphas: a.out(), atExactProgress: ap.out() });
          note(`${k.id} p=${p.toFixed(3)} ${quality}`, a.out(), 'at the nearest 8-bit alphas');
          tot[quality].merge(a); totP[quality].merge(ap);
        }
      }
      gated[k.id] = { full: tot.full.out(), draft: tot.draft.out() };
      ev[k.id] = { reference: k.type === 'zoom' ? 'out·(1 − p) + scaledIn·p; scaledIn = the incoming picture scaled by 1.3 − 0.3p about the centre with the same canvas call as the kernel' : 'softOut·(1 − p) + softIn·p (revealing: the picture below stands for the outgoing side, unblurred); soft = the kernel\'s own blur recipe at blurRadius(p)', total: { full: { atNearest8BitAlphas: tot.full.out(), atExactProgress: totP.full.out() }, draft: { atNearest8BitAlphas: tot.draft.out(), atExactProgress: totP.draft.out() } }, frames: rows };
    }
    evidence.transitions = ev; evidence.transFullVsDraftBytesDiffering = transDiff;
    const biasOk = (pre: string) => Object.entries(gated).filter(([n]) => n.startsWith(pre)).every(([, v]) => Math.abs(v.full.meanSigned) <= TOL.bias && Math.abs(v.draft.meanSigned) <= TOL.bias);
    const zoomWorst = Math.max(...Object.entries(gated).filter(([n]) => n.startsWith('zoom')).flatMap(([, v]) => [v.full.maxLevels, v.draft.maxLevels]));
    const blurWorst = Math.max(...Object.entries(gated).filter(([n]) => n.startsWith('blur')).flatMap(([, v]) => [v.full.maxLevels, v.draft.maxLevels]));
    checks.push({ name: '11. Zoom transition at 9 progress values (between two clips, revealing; full and draft): every byte within 3 levels and each case\'s mean bias within ±0.75 of the exact mix of the outgoing and the scaled incoming picture at the nearest 8-bit alphas', ok: zoomWorst <= TOL.levels && biasOk('zoom'), detail: { toleranceLevels: TOL.levels, toleranceBias: TOL.bias, fullVsDraftBytesDiffering: evidence.transFullVsDraftBytesDiffering, measuredWorstLevels: zoomWorst, cases: Object.fromEntries(Object.entries(gated).filter(([n]) => n.startsWith('zoom'))) } });
    checks.push({ name: '12. Blur-dissolve at 9 progress values (between two clips, revealing; full and draft): every byte within 3 levels and each case\'s mean bias within ±0.75 of the exact mix of the two blurred pictures (the product\'s own blur) at the nearest 8-bit alphas', ok: blurWorst <= TOL.levels && biasOk('blur'), detail: { toleranceLevels: TOL.levels, toleranceBias: TOL.bias, measuredWorstLevels: blurWorst, cases: Object.fromEntries(Object.entries(gated).filter(([n]) => n.startsWith('blur'))) } });

    // punch-in: four quarter-strength scaled copies of one side, added; reference = their sum at the nearest alpha (64/255 each, clipped), and at 0.25
    const pr: unknown[] = [], ptot: Record<Q, Acc> = { full: new Acc(), draft: new Acc() }, ptotQ: Record<Q, Acc> = { full: new Acc(), draft: new Acc() };
    for (const F of [31, 34, 37, 39, 41, 43, 46, 49]) {
      const f0 = await m('transition', 'punch-in', false, F, 'full', true);
      const cp = [0, 1, 2, 3].map((j) => dec(f0.parts![`copy${j}`]!));
      for (const quality of ['full', 'draft'] as Q[]) {
        const O = dec(quality === 'full' ? f0.rgb : (await m('transition', 'punch-in', false, F, 'draft', false)).rgb);
        const a = new Acc(), aq = new Acc();
        for (let i = 0; i < N; i++) { const s = cp[0]![i]! + cp[1]![i]! + cp[2]![i]! + cp[3]![i]!; a.add(O[i]!, s / 4); aq.add(O[i]!, Math.min(255, (64 / 255) * s)); }
        pr.push({ quality, frame: F, progress: +f0.progress.toFixed(4), atQuarterStrength: a.out(), atNearest8BitAlpha64of255: aq.out() });
        ptot[quality].merge(a); ptotQ[quality].merge(aq);
      }
    }
    evidence.punchIn = { note: 'punch-in (the other transition kernel that adds scaled pictures with globalAlpha): four copies of one side at 0.25 added with lighter', total: { full: { atQuarterStrength: ptot.full.out(), atNearest8BitAlpha64of255: ptotQ.full.out() }, draft: { atQuarterStrength: ptot.draft.out(), atNearest8BitAlpha64of255: ptotQ.draft.out() } }, frames: pr };
    for (const q of ['full', 'draft'] as Q[]) { note(`punch-in ${q} at quarter strength`, ptot[q].out()); }
    checks.push({ name: '13. Punch-in smear (four quarter-strength scaled copies added; full and draft), gated loosely: within 4 levels of the mean of the four copies, bias within ±0.8', ok: ptot.full.max <= TOL.punchLevels && ptot.draft.max <= TOL.punchLevels && Math.abs(ptot.full.sum / ptot.full.n) <= TOL.punchBias, detail: { full: ptot.full.out(), draft: ptot.draft.out(), atNearest8BitAlpha: { full: ptotQ.full.out(), draft: ptotQ.draft.out() } } });
  }
  return { checks, evidence, above2, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
}

/** Tolerances: levels = max |O − round(exact)|, bias = |mean signed deviation| in levels. Measured worst when written: 2 levels (title, taps, zoom, blur-dissolve), bias at most 0.55; punch-in 3 levels against the quarter-strength mean, bias +0.49; outside the title nothing moves. */
export const TOL = { levels: 3, outsideLevels: 1, bias: 0.75, punchLevels: 4, punchBias: 0.8 };
