/**
 * The model-free tracker (ADR-0015): pyramidal Lucas–Kanade median flow with a forward-backward check, verified by NCC
 * against the seed template and up to seven adaptive templates, with a state machine that holds the last usable position
 * when the target is lost and finds it again only on a unique match confirmed on several frames (it never jumps silently).
 * While lost it looks only where the target can be (gate()): around the place it would have reached at its last trusted
 * velocity. A look-alike elsewhere is neither accepted nor counted as a rival; a look-alike in that region keeps it lost.
 * No AI model. Pure and deterministic (vision/types.ts): + − × / and Math.floor|sqrt|abs|round only, a fixed order, ties to
 * the lowest (y, x); no randomness, clocks or threads.
 *
 * Region tracking, per frame: a grid of points inside the box (inset 10%), points with too little structure dropped
 * (smallest eigenvalue < 1e-3 of the largest), each tracked forward and back; points whose forward-backward error is at most
 * the median AND whose 11×11 NCC is at least the median are kept; the box moves by the median displacement and scales by the
 * median ratio of point distances. Point tracking: one point, a larger window, the same forward-backward check.
 */
import { buildPyramid, median, pow2, type Pyramid } from './image.ts';
import { minEigen, trackPoint, type LkOptions } from './lk.ts';
import { boxGrid, centreOf, dot, ellipseNormal, fromLevel, grid, levelFor, normalise, patchNcc, resizeTemplate, slide, toLevel, type Normed } from './ncc.ts';
import { DEFAULT_TRACKER_PARAMS, type CreateTracker, type GreyFrame, type Tracker, type TrackerParams, type TrackerSeed, type TrackerStep } from './types.ts';

/** Algorithm version recorded with every track (origin.params.algo). Change it whenever results can change. */
export const TRACKER_ALGO = 'pf-track 2';
/** Samples per side of the resampled box a region's confidence is measured on, and of a point's patch. */
export const BOX_N = 32;
export const POINT_N = 15;
const NCC_N = 11;
/** Scales searched while lost, relative to the last usable size. */
const SEARCH_SCALES = [0.85, 1, 1.18] as const;
/** Scales tried again on level 0 at the best coarse position. */
const FINE_SCALES = [0.85, 0.92, 1, 1.09, 1.18] as const;
/** Distinct coarse peaks refined on level 0 while lost (the match and its strongest rivals). */
const PEAKS = 3;
/** Template added on a frame this confident (q), at least templateEvery frames after the last one, and still this close to the seed. */
const TEMPLATE_Q = 85;
const TEMPLATE_SEED_NCC = 0.7;
/** Re-detections on consecutive frames must agree this closely (work px) after the earlier one is carried forward by optical flow. */
const CONFIRM_PX = 2;
/** The coarse search runs on the coarsest level (at most quarter scale) on which the box still spans this many pixels. */
const COARSE_MIN = 12;
/** Multiply-adds the coarse search may spend per frame; above it the search moves one level coarser (at most quarter scale). */
const COARSE_BUDGET = 12_000_000;
/** The velocity at a loss is measured over the trusted (tracked) poses of at most this many frames before it. */
const VELOCITY_SPAN = 5;
/**
 * The gate a lost target is looked for in (gate()): a disc around the place it would have reached at its last trusted velocity.
 * Its radius is GATE_BOX box sizes at the loss and grows every frame by GATE_SPEED of the last trusted speed plus GATE_DRIFT of
 * the box: while unseen the target may have changed its velocity by up to half its speed, or drifted 3% of its size a frame.
 * Rivals are also looked for RIVAL_BOX box sizes beyond the gate, so a look-alike on its edge still makes the match ambiguous.
 */
const GATE_BOX = 1.5;
const GATE_SPEED = 0.5;
const GATE_DRIFT = 0.03;
const RIVAL_BOX = 0.5;

interface Pose { cx: number; cy: number; s: number }
/** A picture of the target: the raw grid (searched for while lost) and its normalised verification vector (a region: inside the box's inscribed ellipse). */
interface Picture { grid: Float64Array; vec: Normed }
/** The best match in the search region: its NCC against all templates, against the trusted ones, and its lead over the runner-up. */
interface Found extends Pose { ncc: number; trusted: number; margin: number }
/** Where a lost target may be: within r of (cx, cy), work px. */
interface Gate { cx: number; cy: number; r: number }

export const createTracker: CreateTracker = (first: GreyFrame, seed: TrackerSeed, params?: Partial<TrackerParams>): Tracker => new MedianFlowTracker(first, seed, { ...DEFAULT_TRACKER_PARAMS, ...params });

export class MedianFlowTracker implements Tracker {
  private readonly P: TrackerParams;
  private readonly kind: 'point' | 'region';
  /** Box at s = 1 (work px); a point is verified on a POINT_N × POINT_N patch. */
  private readonly seedW: number;
  private readonly seedH: number;
  private prev: Pyramid;
  private prevFrame: GreyFrame;
  /** A pyramid no longer needed, whose arrays the next one reuses. */
  private spare: Pyramid | null = null;
  private pose: Pose;
  private good: Pose;
  private readonly templates: Picture[] = [];
  private nextSlot = 1;
  /** Pictures a person vouched for: the seed and the latest hand-placed samples (anchor()). A drifted adaptive template is not one. */
  private readonly trusted: Picture[] = [];
  private frame = 0;
  private lastTemplateFrame = 0;
  private lost = false;
  /** Frame of `good`, the trusted poses of the last VELOCITY_SPAN frames up to it, and the velocity (work px per frame) they gave at the loss. */
  private goodFrame = 0;
  private recent: { f: number; cx: number; cy: number }[] = [];
  private vel = { x: 0, y: 0 };
  private cand: (Found & { count: number }) | null = null;

  constructor(first: GreyFrame, seed: TrackerSeed, P: TrackerParams) {
    this.P = P;
    this.kind = seed.kind;
    this.seedW = seed.kind === 'region' ? Math.max(4, seed.w ?? POINT_N) : POINT_N;
    this.seedH = seed.kind === 'region' ? Math.max(4, seed.h ?? POINT_N) : POINT_N;
    this.prev = buildPyramid(first, P.levels);
    this.prevFrame = first;
    this.pose = { cx: seed.cx, cy: seed.cy, s: 1 };
    this.good = { ...this.pose };
    this.recent = [{ f: 0, cx: seed.cx, cy: seed.cy }];
    this.templates.push(this.sample(this.prev, this.pose));
    this.trusted.push(this.templates[0]!);
  }

  /** Box size (work px) at scale s. */
  private dims(s: number): { w: number; h: number } { return this.kind === 'region' ? { w: this.seedW * s, h: this.seedH * s } : { w: POINT_N, h: POINT_N }; }
  /** The picture of the box (or point patch) at a pose. */
  private sample(pyr: Pyramid, p: Pose): Picture {
    if (this.kind === 'point') { const g = grid(pyr.levels[0]!, p.cx, p.cy, POINT_N, 1); return { grid: g, vec: normalise(g) }; }
    const { w, h } = this.dims(p.s);
    const g = boxGrid(pyr, p.cx, p.cy, w, h, BOX_N);
    return { grid: g, vec: ellipseNormal(g, BOX_N) };
  }
  /** Best NCC of a picture against the templates. */
  private best(t: Picture): number {
    let b = -1;
    for (const tm of this.templates) { const v = dot(t.vec, tm.vec); if (v > b) b = v; }
    return b;
  }
  /** Best NCC of a picture against the trusted pictures (the seed and hand-placed samples). */
  private trustedNcc(t: Picture): number {
    let b = -1;
    for (const tm of this.trusted) { const v = dot(t.vec, tm.vec); if (v > b) b = v; }
    return b;
  }
  /** A pose the tracker stands behind (tracked, re-acquired or hand-placed) on the current frame. `fresh`: nothing before it says how the target moves. */
  private trust(p: Pose, fresh: boolean) {
    this.good = { ...p };
    this.goodFrame = this.frame;
    if (fresh) this.recent = [];
    this.recent.push({ f: this.frame, cx: p.cx, cy: p.cy });
    while (this.recent[0]!.f < this.frame - VELOCITY_SPAN) this.recent.shift();
  }
  private addTemplate(t: Picture) {
    if (!t.vec) return;
    if (this.templates.length < this.P.maxTemplates) { this.templates.push(t); return; }
    if (this.P.maxTemplates < 2) return;
    this.templates[this.nextSlot] = t; // the seed (slot 0) is never replaced; the oldest adaptive one is
    this.nextSlot = this.nextSlot + 1 >= this.P.maxTemplates ? 1 : this.nextSlot + 1;
  }
  private lk(window: number): LkOptions { return { window, levels: this.P.levels, maxIter: this.P.maxIter, epsilon: this.P.epsilon }; }
  /** Share of the box that lies outside the picture (a point: 1 when it is outside, else 0). */
  private outside(p: Pose, pyr: Pyramid): number {
    const W = pyr.levels[0]!.width, H = pyr.levels[0]!.height;
    if (this.kind === 'point') return p.cx < 0 || p.cy < 0 || p.cx > W - 1 || p.cy > H - 1 ? 1 : 0;
    const { w, h } = this.dims(p.s);
    const ox = Math.max(0, Math.min(p.cx + w / 2, W - 0.5) - Math.max(p.cx - w / 2, -0.5));
    const oy = Math.max(0, Math.min(p.cy + h / 2, H - 0.5) - Math.max(p.cy - h / 2, -0.5));
    return 1 - (ox * oy) / (w * h);
  }
  private q(ncc: number): number { return Math.round(100 * (ncc > 0 ? (ncc > 1 ? 1 : ncc) : 0)); }

  step(next: GreyFrame): TrackerStep {
    this.frame++;
    const pyr = buildPyramid(next, this.P.levels, this.spare);
    this.spare = null;
    const out = this.lost ? this.redetect(pyr) : this.track(pyr);
    this.spare = this.prev; // nothing refers to the old pyramid any more: its arrays serve the next frame
    this.prev = pyr;
    this.prevFrame = next;
    return out;
  }

  anchor(frame: GreyFrame, at: { cx: number; cy: number; s: number }): void {
    if (frame !== this.prevFrame) { this.prev = buildPyramid(frame, this.P.levels, this.spare); this.spare = null; this.prevFrame = frame; }
    this.pose = { cx: at.cx, cy: at.cy, s: at.s };
    this.trust(this.pose, true);
    this.lost = false;
    this.cand = null;
    const t = this.sample(this.prev, this.pose);
    this.addTemplate(t);
    if (t.vec) { this.trusted.push(t); if (this.trusted.length > this.P.maxTemplates) this.trusted.splice(1, 1); } // the seed stays; the oldest hand-placed one goes
    this.lastTemplateFrame = this.frame;
  }

  /**
   * Lost from this frame on: report the last usable pose, with a confidence below the weak threshold. The velocity the search
   * gate is built on is fixed here: the mean displacement per frame over the trusted poses of the last VELOCITY_SPAN frames
   * (0 when there is only one, as right after the seed, a hand-placed sample or a re-acquisition).
   */
  private lose(q: number): TrackerStep {
    this.lost = true;
    this.cand = null;
    const a = this.recent[0]!, b = this.recent[this.recent.length - 1]!;
    this.vel = b.f > a.f ? { x: (b.cx - a.cx) / (b.f - a.f), y: (b.cy - a.cy) / (b.f - a.f) } : { x: 0, y: 0 };
    return { cx: this.good.cx, cy: this.good.cy, s: this.good.s, q: Math.min(q, this.P.weakQ - 1), st: 3 };
  }

  /** Optical flow from the previous frame, then verification. */
  private track(next: Pyramid): TrackerStep {
    const P = this.P, prev = this.prev, p = this.pose;
    let moved: Pose;
    if (this.kind === 'point') {
      const o = this.lk(P.pointWindow);
      const f = trackPoint(prev, next, p.cx, p.cy, o);
      if (!f.ok) return this.lose(0);
      const b = trackPoint(next, prev, f.x, f.y, o);
      if (!b.ok) return this.lose(0);
      const ex = b.x - p.cx, ey = b.y - p.cy;
      if (Math.sqrt(ex * ex + ey * ey) > P.maxFb) return this.lose(0);
      moved = { cx: f.x, cy: f.y, s: p.s };
    } else {
      const flow = this.medianFlow(next);
      if (!flow) return this.lose(0);
      moved = { cx: p.cx + flow.dx, cy: p.cy + flow.dy, s: p.s * flow.scale };
    }
    if (this.outside(moved, next) > 0.5) return this.lose(0);
    const t = this.sample(next, moved);
    const ncc = this.best(t);
    const q = this.q(ncc);
    if (q < P.weakQ) return this.lose(q);
    const st: 1 | 2 = q >= P.trackedQ ? 1 : 2;
    this.pose = moved;
    if (st === 1) this.trust(moved, false);
    if (q >= TEMPLATE_Q && this.frame - this.lastTemplateFrame >= P.templateEvery && this.trustedNcc(t) >= TEMPLATE_SEED_NCC) {
      this.addTemplate(t);
      this.lastTemplateFrame = this.frame;
    }
    return { cx: moved.cx, cy: moved.cy, s: moved.s, q, st };
  }

  /** Median flow of the box's grid points; null = lost (too few points, forward-backward error or scale step out of bounds). */
  private medianFlow(next: Pyramid): { dx: number; dy: number; scale: number } | null {
    const P = this.P, prev = this.prev, p = this.pose;
    const { w, h } = this.dims(p.s);
    const n = Math.max(2, P.grid);
    const l0 = prev.levels[0]!;
    const cand: { x: number; y: number; e: number }[] = [];
    let maxE = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = p.cx + (-0.4 + (0.8 * i) / (n - 1)) * w, y = p.cy + (-0.4 + (0.8 * j) / (n - 1)) * h;
        if (x < 0 || y < 0 || x > l0.width - 1 || y > l0.height - 1) continue;
        const e = minEigen(l0, x, y, P.window);
        cand.push({ x, y, e });
        if (e > maxE) maxE = e;
      }
    if (!(maxE > 0)) return null;
    const o = this.lk(P.window);
    const pts: { x: number; y: number; nx: number; ny: number; fb: number; ncc: number }[] = [];
    for (const c of cand) {
      if (c.e < 1e-3 * maxE) continue;
      const f = trackPoint(prev, next, c.x, c.y, o);
      if (!f.ok) continue;
      const b = trackPoint(next, prev, f.x, f.y, o);
      if (!b.ok) continue;
      const ex = b.x - c.x, ey = b.y - c.y;
      pts.push({ x: c.x, y: c.y, nx: f.x, ny: f.y, fb: Math.sqrt(ex * ex + ey * ey), ncc: patchNcc(prev, c.x, c.y, next, f.x, f.y, NCC_N) });
    }
    if (pts.length < P.minPoints) return null;
    const medFb = median(pts.map((q) => q.fb)), medNcc = median(pts.map((q) => q.ncc));
    if (medFb > P.maxFb) return null;
    const sel = pts.filter((q) => q.fb <= medFb && q.ncc >= medNcc);
    if (sel.length < P.minPoints) return null;
    // Points that moved with the majority: within 3× the median residual (at least 1 px) of the median displacement. With 30%
    // outlier points about half of all point PAIRS involve an outlier, so the distance ratios need this gate to stay robust;
    // under a zoom the residuals grow with the distance from the centre and the gate grows with them.
    const mx = median(sel.map((q) => q.nx - q.x)), my = median(sel.map((q) => q.ny - q.y));
    const res = sel.map((q) => { const ex = q.nx - q.x - mx, ey = q.ny - q.y - my; return Math.sqrt(ex * ex + ey * ey); });
    const lim = Math.max(1, 3 * median(res));
    const kept = sel.filter((_, i) => res[i]! <= lim);
    if (kept.length < P.minPoints) return null;
    // scale: median ratio of distances over at most 200 deterministic pairs (k mod n, (37k + 11) mod n)
    const ratios: number[] = [];
    const m = kept.length;
    for (let k = 0; k < 200; k++) {
      const i = k % m, j = (37 * k + 11) % m;
      if (i === j) continue;
      const a = kept[i]!, b = kept[j]!;
      const px = b.x - a.x, py = b.y - a.y, qx = b.nx - a.nx, qy = b.ny - a.ny;
      const dp = Math.sqrt(px * px + py * py);
      if (dp < 2) continue;
      ratios.push(Math.sqrt(qx * qx + qy * qy) / dp);
    }
    const scale = ratios.length ? median(ratios) : 1;
    if (!(scale >= 0.8 && scale <= 1.25)) return null;
    // The box moves by the median of each point's displacement once its share of the scaling about the box centre is taken
    // out. Plain median displacement drifts when the kept points are not symmetric about the centre (8.9 px over a 20-frame
    // zoom in vision.test.ts); with scale 1 the two are the same.
    const dx = median(kept.map((q) => q.nx - p.cx - scale * (q.x - p.cx))), dy = median(kept.map((q) => q.ny - p.cy - scale * (q.y - p.cy)));
    return { dx, dy, scale };
  }

  /**
   * Where a target lost since frame goodFrame can be on this frame: within r of the place it would have reached at the
   * velocity it had when it was last trusted. r = GATE_BOX·box + (GATE_SPEED·speed + GATE_DRIFT·box)·frames since then.
   * A target that moved keeps a gate ahead of it, so something that looks like it but would have needed a reversal to get
   * there is outside; a target that stood still gets a slowly widening disc around where it stood.
   */
  private gate(): Gate {
    const n = this.frame - this.goodFrame;
    const { w, h } = this.dims(this.good.s);
    const box = Math.max(w, h);
    const speed = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
    return { cx: this.good.cx + this.vel.x * n, cy: this.good.cy + this.vel.y * n, r: GATE_BOX * box + (GATE_SPEED * speed + GATE_DRIFT * box) * n };
  }

  /**
   * While lost: search the gate, and accept only a match that is strong (NCC ≥ reacquireNcc against the templates), still
   * looks like what a person marked (NCC ≥ TEMPLATE_SEED_NCC against the seed or a hand-placed sample), lies inside the gate,
   * is unique (reacquireMargin above the runner-up in and just around the gate) and is confirmed on reacquireConfirm
   * consecutive frames. Anything less stays lost at the last usable pose.
   */
  private redetect(next: Pyramid): TrackerStep {
    const P = this.P;
    // carry the previous frame's candidate forward by optical flow, so a moving target can be confirmed
    let carried: { x: number; y: number } | null = null;
    if (this.cand) {
      const c = trackPoint(this.prev, next, this.cand.cx, this.cand.cy, this.lk(P.pointWindow));
      if (c.ok) carried = { x: c.x, y: c.y };
    }
    const gate = this.gate();
    const found = this.search(next, gate);
    const inGate = !!found && (found.cx - gate.cx) * (found.cx - gate.cx) + (found.cy - gate.cy) * (found.cy - gate.cy) <= gate.r * gate.r;
    const accepted = found && inGate && found.ncc >= P.reacquireNcc && found.trusted >= TEMPLATE_SEED_NCC && found.margin >= P.reacquireMargin ? found : null;
    if (!accepted) this.cand = null;
    else {
      const agrees = carried && Math.sqrt((carried.x - accepted.cx) * (carried.x - accepted.cx) + (carried.y - accepted.cy) * (carried.y - accepted.cy)) <= CONFIRM_PX;
      this.cand = { ...accepted, count: agrees && this.cand ? this.cand.count + 1 : 1 };
    }
    const q = this.q(found ? found.ncc : 0);
    if (this.cand && this.cand.count >= P.reacquireConfirm) {
      const pose = { cx: this.cand.cx, cy: this.cand.cy, s: this.cand.s };
      this.pose = pose;
      this.trust(pose, true);
      this.lost = false;
      this.cand = null;
      return { ...pose, q, st: 6 };
    }
    return { cx: this.good.cx, cy: this.good.cy, s: this.good.s, q: Math.min(q, P.weakQ - 1), st: 3 };
  }

  /**
   * NCC search of the gate and RIVAL_BOX box sizes around it (clipped to the picture). Coarse: on the coarsest level (at most
   * quarter scale) on which the box still spans COARSE_MIN pixels (coarser while the work would exceed COARSE_BUDGET), at
   * three scales, with the seed template and the newest adaptive one.
   * Fine: the best coarse peak and the best peaks farther than half the box from those already taken (up to PEAKS) are each
   * refined on level 0 against all templates (position, then scale, then position on whole and on quarter pixels).
   * The match is the best refined peak; margin = its score − the second refined peak's score (coarse scores alone vary too
   * much with sub-pixel phase to tell two lookalikes apart).
   */
  private search(next: Pyramid, gate: Gate): Found | null {
    const g = this.good;
    const { w: bw, h: bh } = this.dims(g.s);
    const l0 = next.levels[0]!;
    const radius = gate.r + RIVAL_BOX * Math.max(bw, bh);
    const use = this.templates.length > 1 ? [this.templates[0]!, this.templates[this.templates.length - 1]!] : [this.templates[0]!];
    const maxL = Math.min(2, next.levels.length - 1);
    let L = levelFor(next, bw * SEARCH_SCALES[0], bh * SEARCH_SCALES[0], COARSE_MIN, maxL);
    const cost = (l: number) => { const m = pow2(l), sx = Math.min(2 * radius, l0.width) / m + 1, sy = Math.min(2 * radius, l0.height) / m + 1; return sx * sy * ((bw * bh) / (m * m)) * SEARCH_SCALES.length * use.length; };
    while (L < maxL && cost(L) > COARSE_BUDGET) L++;
    const plane = next.levels[L]!;
    const k = pow2(L);
    const cx = toLevel(gate.cx, L), cy = toLevel(gate.cy, L), r = radius / k;
    const n = this.kind === 'point' ? POINT_N : BOX_N;
    const hits: { x: number; y: number; v: number; f: number }[] = [];
    for (const f of SEARCH_SCALES) {
      const tw = Math.max(3, Math.round((bw * f) / k)), th = Math.max(3, Math.round((bh * f) / k));
      for (const t of use) {
        const tt = resizeTemplate(t.grid, n, tw, th);
        if (!tt) continue;
        const map = slide(plane, tt, tw, th, cx - r, cx + r, cy - r, cy + r);
        if (!map) continue;
        for (let i = 0; i < map.scores.length; i++) {
          const c = centreOf(map, i);
          if ((c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy) > r * r) continue; // the region is a disc
          hits.push({ x: c.x, y: c.y, v: map.scores[i]!, f });
        }
      }
    }
    // distinct coarse peaks: each the best hit farther than half the box from every peak already taken (first best wins ties)
    const away = (0.5 * Math.max(bw, bh)) / k;
    const peaks: (typeof hits)[number][] = [];
    while (peaks.length < PEAKS) {
      let bi = -1;
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i]!;
        if (bi >= 0 && h.v <= hits[bi]!.v) continue;
        if (peaks.some((p) => (h.x - p.x) * (h.x - p.x) + (h.y - p.y) * (h.y - p.y) <= away * away)) continue;
        bi = i;
      }
      if (bi < 0) break;
      peaks.push(hits[bi]!);
    }
    if (!peaks.length) return null;
    const refined = peaks.map((p) => this.refine(next, fromLevel(p.x, L), fromLevel(p.y, L), g.s * p.f, k + 1));
    let a = 0;
    for (let i = 1; i < refined.length; i++) if (refined[i]!.v > refined[a]!.v) a = i;
    let second = 0;
    for (let i = 0; i < refined.length; i++) if (i !== a && refined[i]!.v > second) second = refined[i]!.v;
    const m = refined[a]!;
    return { cx: m.x, cy: m.y, s: m.s, ncc: m.v, trusted: this.trustedNcc(this.sample(next, { cx: m.x, cy: m.y, s: m.s })), margin: m.v - second };
  }

  /**
   * Refine a coarse match on level 0: whole pixels within ±R at its scale; the scale chosen again among FINE_SCALES (the coarse
   * level hardly tells them apart); whole pixels within ±2 at that scale; then a quarter-pixel grid within ±0.75 px (a fine
   * texture decorrelates quickly between whole pixels). The first best wins ties throughout.
   */
  private refine(next: Pyramid, x: number, y: number, s0: number, R: number): { x: number; y: number; s: number; v: number } {
    const score = (px: number, py: number, sc: number) => this.best(this.sample(next, { cx: px, cy: py, s: sc }));
    const around = (x0: number, y0: number, sc: number, half: number, step: number, best: { x: number; y: number; v: number }) => {
      for (let j = -half; j <= half; j++)
        for (let i = -half; i <= half; i++) {
          if (i === 0 && j === 0 && best.v > -2) continue;
          const v = score(x0 + i * step, y0 + j * step, sc);
          if (v > best.v) { best.v = v; best.x = x0 + i * step; best.y = y0 + j * step; }
        }
      return best;
    };
    const p0 = around(Math.round(x), Math.round(y), s0, R, 1, { x: 0, y: 0, v: -2 });
    let s = s0, sv = -2;
    const base = this.good.s;
    for (const f of FINE_SCALES) { const v = score(p0.x, p0.y, base * f); if (v > sv) { sv = v; s = base * f; } }
    const p1 = around(p0.x, p0.y, s, 2, 1, { x: p0.x, y: p0.y, v: sv });
    const p2 = around(p1.x, p1.y, s, 3, 0.25, { ...p1 });
    return { x: p2.x, y: p2.y, s, v: p2.v };
  }
}
