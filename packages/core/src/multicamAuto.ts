/**
 * Auto-switch (ADR-0020 plan §5, recipe 'multicam-auto'): a labelled heuristic — "the clearly loudest mic, not who is
 * speaking". Pure and deterministic: the same document, parameters and envelopes give byte-identical operations.
 * Thresholds are tuned on synthetic speech only (wave4-decisions.md). The parameters live in multicamApi.ts (recipes.ts reads
 * them at load time, and this file imports recipes.ts).
 *
 * HOW (per program frame of the program track, at the sequence frame rate):
 * - Group time of the frame comes from the tagged segment under it (its piece's sync map; gaps, reversed, ramped and frozen
 *   segments give no data and hold the shot). Levels are read from the level envelopes (ctx.multicamLevels, loaded by the
 *   server) of each speaker's mic: the piece of the mic angle that covers that group time, at the speaker's channel (null =
 *   the mixdown). These group times only READ envelopes (10 ms frames); every cut is a timeline FRAME, so no rounding of
 *   them is ever written.
 * - Normalisation per speaker: floor = 10th percentile; speech = 90th percentile of the frames above floor + 10 dB.
 *   n_i = dB_i − speech_i; a speaker is active when n_i ≥ −10 dB (mic bleed of another talker sits lower); with transcripts
 *   (useTranscripts) a segment of that speaker (Segment.speaker = transcriptSpeaker) on the mic's file counts as active too.
 * - Two or more voices each at or above its own activity threshold (n ≥ −10 dB) make a frame "both", whatever the level
 *   difference (lead decision 2026-11-18). Otherwise dominance_k = n_k − max_{j≠k} n_j for the loudest k: "speaker k" when k
 *   is active and dominance ≥ marginDb; "both" when a transcript makes a second speaker active; "silence" when none is;
 *   otherwise unsure (it holds the shot).
 * - Hysteresis: cut to speaker k's shot (shotAngleId, else the wide angle) once "speaker k" has held switchHold, landing
 *   preRoll before it started; to the wide angle after bothHold of "both" or silenceHold of "silence" (no wide angle: hold).
 *   No shot shorter than minShot (a cut waits; one that would leave less than minShot before the end is dropped); with
 *   maxShot, a shot that long cuts to the wide angle (or back from it to the last speaker). All frame-snapped.
 * - Decisions whose margin is below 3 dB are flagged unsure.
 * - Two speakers on the same mic and channel, or whose levels move together (correlation > 0.9 over the frames where either
 *   is active, and fewer than 5 % of those frames apart by the margin), are refused: they cannot be told apart.
 * OUTPUT: switch_angles ops of ≤ MAX_CUTS cuts with coverage 'clip' (each with `until`, so nothing past it changes), applied
 * as ONE apply_recipe; protected ranges (segments edited by hand since the last run, regenerate in place) are never touched.
 * plan.steps[0] is MULTICAM_AUTO_LABEL; plan.basis lists the screen time per angle, the cut count, the mean shot and the
 * unsure decisions.
 */
import * as T from '@pulseframe/time';
import type { MediaClip, MulticamGroup, MulticamPiece, MulticamSpeaker, ProjectDocument, Track } from './schema.ts';
import { RecipeError, type PlanContext, type RecipePlan } from './recipes.ts';
import { MULTICAM_AUTO_LABEL, MULTICAM_AUTO_RECIPE_ID, MulticamAutoParams, type AutoDecision } from './multicamApi.ts';
import { MAX_CUTS } from './multicamLimits.ts';
import { levelAtFrame, type LevelEnvelope } from './multicamEnvelope.ts';
import { transcriptFor } from './lineage.ts';
import { isRamped, isReverse, speedValue } from './speed.ts';
import type { OpCall } from './ops.ts';

const ACTIVE_DB = -10;
const UNSURE_DB = 3;
const CORRELATED = 0.9;
/** ...and they are told apart when at least this share of those frames differs by the margin. */
const APART_SHARE = 0.05;

/** The longest dip in a speaker's level that is bridged as part of the same speech (syllable and word gaps). */
const BRIDGE_MS = 400;
/** Running max (dilate) or min (erode) over [i − h, i + h]; NaN (no data) frames stay NaN and bound the window. */
function runExtreme(x: Float64Array, h: number, max: boolean): Float64Array {
  const out = new Float64Array(x.length).fill(NaN);
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i]!)) continue;
    let v = x[i]!;
    for (let j = i - 1; j >= Math.max(0, i - h) && !Number.isNaN(x[j]!); j--) v = max ? Math.max(v, x[j]!) : Math.min(v, x[j]!);
    for (let j = i + 1; j <= Math.min(x.length - 1, i + h) && !Number.isNaN(x[j]!); j++) v = max ? Math.max(v, x[j]!) : Math.min(v, x[j]!);
    out[i] = v;
  }
  return out;
}
/** Morphological closing with a flat window of 2h + 1 frames: fills dips narrower than the window, keeps steps and peaks. */
export const closing = (x: Float64Array, h: number): Float64Array => runExtreme(runExtreme(x, h, true), h, false);
/** Float map of a placed piece in seconds (reading envelopes only). */
type SecMap = { s: number; g: number }[];
const secMap = (p: MulticamPiece): SecMap => p.anchors.map((a) => ({ s: T.toSeconds(a.source), g: T.toSeconds(a.group) }));
function lin(m: SecMap, x: number, from: 's' | 'g', to: 's' | 'g'): number {
  if (m.length === 1) return x + (m[0]![to] - m[0]![from]);
  let i = 0;
  while (i < m.length - 2 && x >= m[i + 1]![from]) i++;
  const a = m[i]!, b = m[i + 1]!;
  return a[to] + ((x - a[from]) * (b[to] - a[to])) / (b[from] - a[from]);
}
const fmt = (x: number) => x.toFixed(1);
const quantile = (xs: number[], q: number) => { if (!xs.length) return -120; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]!; };
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 10) return 0;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i]! - ma, db = b[i]! - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 1;
}

/** The program track: the one given, or the one video track holding the group's segments. */
function programTrack(doc: ProjectDocument, groupId: string, trackId?: string): { sequenceId: string; track: Track } {
  const found: { sequenceId: string; track: Track }[] = [];
  for (const [sequenceId, s] of Object.entries(doc.sequences)) for (const track of s.tracks) {
    if (trackId ? track.id === trackId : track.kind === 'video' && track.clips.some((c) => c.type === 'media' && c.multicam?.groupId === groupId)) found.push({ sequenceId, track });
  }
  if (trackId && !found.length) throw new RecipeError('not_found', `track ${trackId} not found`, 'get_multicam lists the program tracks of the group.');
  if (!found.length) throw new RecipeError('nothing_to_do', `multicam group ${groupId} has no program on a picture track yet`, 'Lay the program first (place_multicam).');
  if (found.length > 1) throw new RecipeError('invalid_args', `multicam group ${groupId} has a program on ${found.length} picture tracks`, 'Name the program track (trackId); get_multicam lists them.');
  return found[0]!;
}

export function planMulticamAuto(doc: ProjectDocument, raw: unknown, ctx: PlanContext): RecipePlan {
  const parsed = MulticamAutoParams.safeParse(raw ?? {});
  if (!parsed.success) throw new RecipeError('invalid_args', parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; '));
  const p = parsed.data;
  const group: MulticamGroup | undefined = doc.multicam && Object.hasOwn(doc.multicam, p.groupId) ? doc.multicam[p.groupId] : undefined;
  if (!group) throw new RecipeError('not_found', `multicam group ${p.groupId} not found`, 'get_summary lists the multicam groups.');
  const speakers = group.speakers;
  if (!speakers.length) throw new RecipeError('invalid_args', 'the group has no speakers mapped to mics', 'Say who speaks on which mic and which angle frames them (update_multicam speakers).');
  for (let i = 0; i < speakers.length; i++) for (let j = i + 1; j < speakers.length; j++) {
    const a = speakers[i]!, b = speakers[j]!;
    if (a.micAngleId === b.micAngleId && a.channel === b.channel) throw new RecipeError('invalid_args', `speakers "${a.label}" and "${b.label}" are on the same mic and channel, so they cannot be told apart`, 'Give each speaker their own mic or channel (update_multicam speakers), or cut by hand.');
  }
  const angleOf = (id: string | null) => (id ? group.angles.find((a) => a.id === id) : undefined);
  const wide = angleOf(group.wideAngleId)?.kind === 'picture' ? group.wideAngleId : null;
  const shotOf = (s: MulticamSpeaker) => (s.shotAngleId && angleOf(s.shotAngleId)?.kind === 'picture' ? s.shotAngleId : wide);

  const { sequenceId, track } = programTrack(doc, group.id, p.trackId);
  const rate = doc.settings.frameRate;
  const segs = track.clips.filter((c): c is MediaClip => c.type === 'media' && c.multicam?.groupId === group.id).sort((a, b) => T.cmp(a.start, b.start));
  if (!segs.length) throw new RecipeError('nothing_to_do', `track ${track.id} holds no segment of this group`, 'Lay the program first (place_multicam).');
  const ceilF = (t: T.RationalTime) => T.frameIndexAt(t, rate) + (T.isFrameAligned(t, rate) ? 0 : 1);
  const F0 = p.from ? ceilF(p.from) : T.frameIndexAt(segs[0]!.start, rate);
  const F1 = p.to ? T.frameIndexAt(p.to, rate) : Math.max(...segs.map((c) => ceilF(T.add(c.start, c.duration))));
  if (F1 <= F0) throw new RecipeError('invalid_args', 'the range to cut is empty', 'from must be before to.');
  const fps = rate.num / rate.den;
  const secondsToFrames = (s: number) => Math.round(s * fps);

  // ---- group time of every program frame (null: no data there) ----
  const N = F1 - F0;
  const gAt = new Float64Array(N).fill(NaN);
  {
    let k = 0;
    for (let i = 0; i < N; i++) {
      const t = ((F0 + i) * rate.den) / rate.num;
      while (k < segs.length && T.toSeconds(T.add(segs[k]!.start, segs[k]!.duration)) <= t) k++;
      const c = segs[k];
      if (!c || T.toSeconds(c.start) > t || isReverse(c) || isRamped(c) || c.freeze) continue;
      const angle = angleOf(c.multicam!.angleId);
      const piece = angle?.pieces.find((x) => x.assetId === c.assetId && x.anchors.length);
      if (!piece) continue;
      const src = T.toSeconds(c.sourceIn) + (t - T.toSeconds(c.start)) * speedValue(c);
      gAt[i] = lin(secMap(piece), src, 's', 'g');
    }
  }
  // ---- levels per speaker ----
  const micPieces = speakers.map((s) => {
    const a = angleOf(s.micAngleId);
    if (!a) throw new RecipeError('invalid_args', `speaker "${s.label}" names a mic angle that is not in the group`, 'Map the speaker to one of the group\'s angles (update_multicam speakers).');
    return a.pieces.filter((x) => x.anchors.length).map((piece) => {
      const env: LevelEnvelope | undefined = ctx.multicamLevels?.[piece.assetId];
      if (!env) throw new RecipeError('needs_analysis', `the level envelope of file ${piece.assetId} (mic of "${s.label}") is not loaded`, 'The server builds it on demand; plan through the recipe routes or tools.');
      const asset = Object.hasOwn(doc.assets, piece.assetId) ? doc.assets[piece.assetId] : undefined;
      const tr = p.useTranscripts && s.transcriptSpeaker ? transcriptFor(doc, piece.assetId) : null;
      const spans = tr ? tr.transcript.segments.filter((x) => x.speaker === s.transcriptSpeaker).map((x) => { const a0 = T.toSeconds(T.add(x.start, tr.offset)); return [a0, a0 + T.toSeconds(x.duration)] as const; }) : [];
      return { map: secMap(piece), env, duration: asset ? T.toSeconds(asset.duration) : env.frames / 100, spans };
    });
  });
  const S = speakers.length;
  const db: Float64Array[] = speakers.map(() => new Float64Array(N).fill(NaN));
  const said: Uint8Array[] = speakers.map(() => new Uint8Array(N));
  for (let i = 0; i < N; i++) {
    const g = gAt[i]!;
    if (Number.isNaN(g)) continue;
    for (let k = 0; k < S; k++) {
      let v = -120;
      for (const mp of micPieces[k]!) {
        const s = lin(mp.map, g, 'g', 's');
        if (s < 0 || s >= mp.duration) continue;
        // the loudest 10 ms envelope frame within this program frame (one point would alias: 3 of every 10 ms frames unseen)
        const e0 = Math.round(s * 100), e1 = Math.max(e0 + 1, Math.round((s + 1 / fps) * 100));
        let m = -Infinity;
        for (let e = e0; e < e1; e++) m = Math.max(m, levelAtFrame(mp.env, speakers[k]!.channel, e));
        v = m / 100;
        if (mp.spans.some(([a, b]) => s >= a && s < b)) said[k]![i] = 1;
        break;
      }
      db[k]![i] = v;
    }
  }
  // Speech is syllables with short dips between them; read frame by frame, a talker's turn breaks into runs far shorter than
  // switchHold, and an overlap into alternating single-speaker frames. A morphological closing of each speaker's level
  // (running max, then running min, over BRIDGE frames; never across frames without data) fills every dip narrower than
  // BRIDGE_MS and leaves steps, plateaus and peaks exactly where they were, so a level that holds for longer is unchanged.
  for (let k = 0; k < S; k++) db[k] = closing(db[k]!, Math.max(1, Math.round((BRIDGE_MS / 1000) * fps / 2)));
  const speech = db.map((series) => {
    const vals = [...series].filter((v) => !Number.isNaN(v));
    const floor = quantile(vals, 0.1);
    const loud = vals.filter((v) => v > floor + 10);
    return loud.length ? quantile(loud, 0.9) : floor + 10;
  });
  const norm = db.map((series, k) => series.map((v) => v - speech[k]!));
  const active = (k: number, i: number) => norm[k]![i]! >= ACTIVE_DB || said[k]![i] === 1;
  // two speakers whose levels move together cannot be told apart
  for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) {
    const xa: number[] = [], xb: number[] = [];
    let apart = 0;
    for (let i = 0; i < N; i++) if (!Number.isNaN(gAt[i]!) && (active(a, i) || active(b, i))) { xa.push(db[a]![i]!); xb.push(db[b]![i]!); if (Math.abs(norm[a]![i]! - norm[b]![i]!) >= p.marginDb) apart++; }
    const r = pearson(xa, xb);
    if (r > CORRELATED && apart < APART_SHARE * xa.length) throw new RecipeError('invalid_args', `the mics of "${speakers[a]!.label}" and "${speakers[b]!.label}" rise and fall together (correlation ${r.toFixed(2)}), so the speakers cannot be told apart`, 'Check which mic and channel each speaker is on (update_multicam speakers), or cut by hand.');
  }

  // ---- per-frame classes: 0..S-1 speaker, S both, S+1 silence, -1 unsure, -2 no data ----
  const BOTH = S, SILENCE = S + 1, UNSURE = -1, NODATA = -2;
  const cls = new Int16Array(N), margin = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(gAt[i]!)) { cls[i] = NODATA; continue; }
    let k = 0;
    for (let j = 1; j < S; j++) if (norm[j]![i]! > norm[k]![i]!) k = j;
    let other = -Infinity;
    for (let j = 0; j < S; j++) if (j !== k) other = Math.max(other, norm[j]![i]!);
    const dom = S === 1 ? Infinity : norm[k]![i]! - other;
    const nActive = speakers.reduce((n, _, j) => n + (active(j, i) ? 1 : 0), 0);
    margin[i] = dom;
    // a transcript names exactly one speaker: that speaker, unless the levels clearly say another
    const saidBy = speakers.map((_, j) => j).filter((j) => said[j]![i] === 1);
    // two voices each above its own activity threshold are both talking, whatever the level difference (lead decision
    // 2026-11-18): a voice wins an overlap only when the other is below its own threshold
    const heard = speakers.reduce((n, _, j) => n + (norm[j]![i]! >= ACTIVE_DB ? 1 : 0), 0);
    if (heard >= 2) cls[i] = BOTH;
    else if (active(k, i) && dom >= p.marginDb) cls[i] = k;
    else if (saidBy.length === 1 && !(active(k, i) && k !== saidBy[0] && dom >= p.marginDb)) { cls[i] = saidBy[0]!; margin[i] = Math.max(dom, p.marginDb); }
    else if (nActive >= 2) cls[i] = BOTH;
    else if (nActive === 0) cls[i] = SILENCE;
    else cls[i] = UNSURE;
  }
  // ---- hysteresis into decisions ----
  const minShot = Math.max(1, secondsToFrames(p.minShotSeconds)), maxShot = p.maxShotSeconds === null ? Infinity : Math.max(minShot, secondsToFrames(p.maxShotSeconds));
  const hold = (c: number) => Math.max(1, secondsToFrames((c === BOTH ? p.bothHoldMs : c === SILENCE ? p.silenceHoldMs : p.switchHoldMs) / 1000));
  const preRoll = secondsToFrames(p.preRollMs / 1000);
  const decisions: AutoDecision[] = [];
  let cur: string | null = null, last = -Infinity, lastSpeaker: number | null = null;
  const decide = (i: number, angleId: string, reason: AutoDecision['reason'], speaker: number | null, m: number | null) => {
    decisions.push({ frame: F0 + i, angleId, reason, speakerId: speaker === null ? null : speakers[speaker]!.id, marginDb: m === null || !Number.isFinite(m) ? null : Number(m.toFixed(2)), unsure: m !== null && Number.isFinite(m) && m < UNSURE_DB });
    cur = angleId; last = i;
  };
  const longShots = (upTo: number) => {
    while (cur !== null && Number.isFinite(maxShot) && upTo - last > maxShot) {
      const at = last + maxShot;
      if (N - at < minShot) break;
      const back = lastSpeaker !== null ? shotOf(speakers[lastSpeaker]!) : null;
      const to = cur !== wide && wide ? wide : back && back !== cur ? back : null;
      if (!to) break;
      decide(at, to, 'max-shot', null, null);
    }
  };
  // which program frames each angle has picture for (a placed piece whose file covers the frame's group time)
  const coverage = new Map<string, Uint8Array>();
  const coveredBy = (angleId: string): Uint8Array => {
    let c = coverage.get(angleId);
    if (c) return c;
    c = new Uint8Array(N);
    const pieces = (angleOf(angleId)?.pieces ?? []).filter((x) => x.anchors.length).map((x) => ({ map: secMap(x), duration: Object.hasOwn(doc.assets, x.assetId) ? T.toSeconds(doc.assets[x.assetId]!.duration) : 0 }));
    for (let i = 0; i < N; i++) { const g = gAt[i]!; if (!Number.isNaN(g) && pieces.some((x) => { const src = lin(x.map, g, 'g', 's'); return src >= 0 && src < x.duration; })) c[i] = 1; }
    coverage.set(angleId, c);
    return c;
  };
  /** The first frame in [from, to) the angle has picture for, or `to`. Frames without data (gAt NaN) keep what is there and count as covered. */
  const firstCovered = (angleId: string, from: number, to: number): number => { const c = coveredBy(angleId); let i = Math.max(0, from); while (i < to && !c[i] && !Number.isNaN(gAt[i]!)) i++; return i; };
  for (let a = 0; a < N;) {
    let b = a + 1;
    while (b < N && cls[b] === cls[a]) b++;
    const c = cls[a]!;
    longShots(a);
    if (c >= 0 && b - a >= hold(c)) {
      const target = c < S ? shotOf(speakers[c]!) : wide;
      if (c < S) lastSpeaker = c;
      if (target && target !== cur) {
        let at = cur === null ? 0 : Math.max(c < S ? a - preRoll : a, last + minShot);
        // the cut waits until the target angle has picture (switch_angles 'clip' keeps the old angle where it has none, which
        // would leave a shot shorter than minShot); before the first cut the program shows what it shows now, for minShot too
        at = firstCovered(target, at, b);
        if (cur === null && at > 0) at = firstCovered(target, Math.max(at, minShot), b);
        if (at < b && (cur === null || N - at >= minShot)) decide(at, target, c < S ? 'speaker' : c === BOTH ? 'both' : 'silence', c < S ? c : null, c < S ? margin[a]! : null);
      }
    }
    a = b;
  }
  longShots(N);
  if (!decisions.length) throw new RecipeError('nothing_to_do', 'no stretch of the program has a clear speaker, both speakers or a silence long enough to cut on', 'Check the speakers\' mics (update_multicam), or lower marginDb or the holds.');

  // ---- operations, never touching protected ranges ----
  const blocked: [number, number][] = (ctx.protectedRanges ?? []).map((r) => [T.frameIndexAt(r.start, rate), ceilF(r.end)] as [number, number]).filter(([s, e]) => e > F0 && s < F1).sort((x, y) => x[0] - y[0]);
  const free: [number, number][] = [];
  let pos = F0;
  for (const [s, e] of blocked) { if (s > pos) free.push([pos, Math.min(s, F1)]); pos = Math.max(pos, e); }
  if (pos < F1) free.push([pos, F1]);
  const ops: OpCall[] = [];
  const at = (f: number) => T.frameTime(f, rate);
  // before the first decision the program keeps the angle it shows (the first cut may wait for the target's picture)
  const startAngle = segs.find((c) => T.frameIndexAt(c.start, rate) <= F0)?.multicam?.angleId ?? decisions[0]!.angleId;
  const angleAt = (f: number) => { if (f < decisions[0]!.frame) return startAngle; let d = decisions[0]!; for (const x of decisions) { if (x.frame <= f) d = x; else break; } return d.angleId; };
  for (const [s, e] of free) {
    const cuts = [{ frame: s, angleId: angleAt(s) }, ...decisions.filter((d) => d.frame > s && d.frame < e).map((d) => ({ frame: d.frame, angleId: d.angleId }))];
    for (let i = 0; i < cuts.length; i += MAX_CUTS) {
      const chunk = cuts.slice(i, i + MAX_CUTS), until = cuts[i + MAX_CUTS]?.frame ?? e;
      ops.push({ op: 'switch_angles', args: { groupId: group.id, sequenceId, trackId: track.id, cuts: chunk.map((x) => ({ at: at(x.frame), angleId: x.angleId })), until: { at: at(until) }, coverage: 'clip' } });
    }
  }
  // ---- basis ----
  const screen = new Map<string, number>();
  decisions.forEach((d, i) => { const end = decisions[i + 1]?.frame ?? F1; screen.set(d.angleId, (screen.get(d.angleId) ?? 0) + (end - d.frame)); });
  const label = (id: string) => angleOf(id)?.label ?? id;
  const unsure = decisions.filter((d) => d.unsure);
  const secs = (frames: number) => frames / fps;
  const basis = [
    `Screen time: ${[...screen].map(([id, n]) => `${label(id)} ${fmt(secs(n))} s (${Math.round((100 * n) / N)}%)`).join(', ')}`,
    `${decisions.length} shot(s), ${Math.max(0, decisions.length - 1)} cut(s); mean shot ${fmt(secs(N) / decisions.length)} s`,
    `Unsure decisions (margin below ${UNSURE_DB} dB): ${unsure.length}${unsure.length ? ` at frame(s) ${unsure.slice(0, 20).map((d) => d.frame).join(', ')}` : ''}`,
    `Speakers: ${speakers.map((s, k) => `${s.label} on ${label(s.micAngleId)}${s.channel === null ? '' : ` ch ${s.channel + 1}`} → ${shotOf(s) ? label(shotOf(s)!) : 'hold'} (speech level ${fmt(speech[k]!)} dBFS)`).join('; ')}`,
    `Rules: margin ${p.marginDb} dB, switch after ${p.switchHoldMs} ms, wide after ${p.bothHoldMs} ms of both or ${p.silenceHoldMs} ms of silence, shots ≥ ${p.minShotSeconds} s${p.maxShotSeconds ? ` and ≤ ${p.maxShotSeconds} s` : ''}, cuts ${p.preRollMs} ms early; tuned on synthetic speech only`,
    ...(blocked.length ? [`Kept as edited by hand: ${blocked.length} stretch(es)`] : []),
  ];
  return {
    recipeId: MULTICAM_AUTO_RECIPE_ID, params: p as unknown as Record<string, unknown>,
    steps: [MULTICAM_AUTO_LABEL, `Cut the program on track ${track.id} into ${decisions.length} shot(s) over ${fmt(secs(N))} s by who is clearly loudest${wide ? `, wide (${label(wide)}) when both or nobody speak` : ''}`, `${ops.length} switch_angles step(s) with coverage 'clip'`],
    basis, ops,
    alternatives: [
      { label: 'Fewer cuts (longer shots, larger margin)', params: { ...p, minShotSeconds: Math.min(30, p.minShotSeconds * 2), marginDb: Math.min(20, p.marginDb + 3) } },
      { label: 'Livelier (shorter shots, quicker switch)', params: { ...p, minShotSeconds: Math.max(0.5, p.minShotSeconds / 2), switchHoldMs: Math.max(0, Math.round(p.switchHoldMs / 2)) } },
    ],
  };
}
/** The decisions behind a plan (for the editor's sheet and the proof): recomputed from the same inputs. */
export function multicamAutoDecisions(doc: ProjectDocument, raw: unknown, ctx: PlanContext): { frame: number; angleId: string }[] {
  const plan = planMulticamAuto(doc, raw, ctx);
  return plan.ops.flatMap((o) => (o.args as { cuts: { at: T.RationalTime; angleId: string }[] }).cuts.map((c) => ({ frame: T.frameIndexAt(c.at, doc.settings.frameRate), angleId: c.angleId })));
}
