/**
 * Pure logic of the musicfit surfaces (wave 7 musicfit track, builder C): requests, the words of a plan, the state of a shortened
 * song's join, the impact read-out. No React, no network: musicFit.logic.test.ts runs it against small local fixtures of the contract's
 * shapes. Nothing here says that an ending or a join sounds good; nobody has listened.
 */
import * as T from '@pulseframe/time';
import {
  canHoldMoment, findClip, joinMeasuredSentence, listMusicStyles, MUSIC_UNHEARD_LABEL, MUSICFIT_REFUSALS, MUSICFIT_UNHEARD_LABEL, ownBeats, planImpact, sourceAt,
  type Asset, type JoinCandidate, type MediaClip, type MusicFitNote, type MusicFitPlan, type MusicFitPlanRequest, type ProjectDocument, type SyncImpactOutput,
} from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';
import { ApiFailure } from '../../api.ts';
import type { MusicFitT } from './musicFit.strings.ts';

export type Lang = 'he' | 'en';
export type SwapHost = { kind: 'clip'; clipId: string } | { kind: 'film'; runId: string } | { kind: 'template'; runId: string };
export type BlockState = 'idle' | 'planning' | 'plan' | 'refused' | 'not-built';
export type MusicChoice = MusicFitPlanRequest['music'];

// ---------- which clip gets the block ----------
/** A sound clip the block may plan for: a media clip on a sound file (the same clips the existing fit button serves). */
export function isFittableMusicClip(doc: ProjectDocument, clip: MediaClip): boolean {
  const a = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
  if (!a || a.kind !== 'audio' || clip.linkGroupId || clip.freeze) return false;
  if (a.provenance.voice) return false;
  return true;
}

// ---------- requests ----------
export const targetOf = (host: SwapHost): MusicFitPlanRequest['target'] => (host.kind === 'clip' ? { clipId: host.clipId } : { runId: host.runId });
export function fitRequest(clipId: string, tailor: boolean, removal?: JoinCandidate['removal']): MusicFitPlanRequest {
  return { target: { clipId }, music: { keep: true }, tailor, ...(removal ? { removal } : {}) };
}
export function swapRequest(host: SwapHost, music: MusicChoice, tailor: boolean, recut: boolean): MusicFitPlanRequest {
  return { target: targetOf(host), music, tailor, ...(host.kind !== 'clip' ? { recut } : {}) };
}

// ---------- failures in words ----------
export interface Failure { kind: 'not-built' | 'refused'; code: string; text: string }
/** An API failure of the plan or apply route said in the interface language (reason and next step); 501 musicfit_not_built is its own honest state. */
export function fitFailure(lang: Lang, e: unknown): Failure {
  if (e instanceof ApiFailure) {
    const detail = (lang === 'he' ? translateRefusal('he', e.message) : undefined) ?? (e.hint && lang === 'en' ? `${e.message}. ${e.hint}` : e.message);
    if (e.status === 501 || e.code === 'musicfit_not_built') return { kind: 'not-built', code: e.code, text: detail };
    return { kind: 'refused', code: e.code, text: detail };
  }
  return { kind: 'refused', code: 'error', text: e instanceof Error ? e.message : String(e) };
}
/** A core refusal (key and details, as planImpact returns it) said in the interface language, reason and next step. */
export function refusalLine(lang: Lang, key: keyof typeof MUSICFIT_REFUSALS, details: Record<string, unknown> = {}): string {
  const r = MUSICFIT_REFUSALS[key] as unknown as { message: (...a: string[]) => string; hint?: string };
  const err = { message: r.message(String(details.assetId ?? details.licenceId ?? 'op')), hint: r.hint };
  if (lang === 'he') { const he = translateRefusal('he', err.message); if (he) return he; }
  return err.hint ? `${err.message}. ${err.hint}` : err.message;
}

// ---------- the plan in words ----------
const sec = (n: number) => (Math.round(n * 100) / 100).toString();
export function endingText(t: MusicFitT, plan: Pick<MusicFitPlan, 'ending'> & Partial<Pick<MusicFitPlan, 'make'>>): string {
  if (plan.ending.kind === 'exact') {
    // the planner's ending.seconds is the remainder (0 for an exact ending); the last chord's length is the made track's endFrames
    // (integration: the sentence said "the last chord starts 0 s before the end")
    const chord = plan.make?.kind === 'builtin' ? plan.make.endFrames / 48000 : plan.ending.seconds;
    return chord > 0 ? t('endsWithFilm', { seconds: sec(chord) }) : t('endsWithFilmPlain');
  }
  return t(plan.ending.kind === 'early' ? 'endsEarly' : 'endsCut', { seconds: sec(plan.ending.seconds) });
}
export function makeText(t: MusicFitT, plan: Pick<MusicFitPlan, 'make' | 'wantedSeconds'>): string {
  const m = plan.make;
  if (m.kind === 'builtin') return t('makeBuiltin', { seconds: sec(plan.wantedSeconds) });
  if (m.kind === 'fitted') { const c = m.candidates[m.chosen]; return t('makeFitted', { seconds: sec(c ? c.madeSeconds : plan.wantedSeconds) }); }
  return t('makeNone');
}
export function chosenCandidate(plan: Pick<MusicFitPlan, 'make'>): { candidate: JoinCandidate; index: number; count: number } | null {
  const m = plan.make;
  if (m.kind !== 'fitted') return null;
  const c = m.candidates[m.chosen];
  return c ? { candidate: c, index: m.chosen, count: m.candidates.length } : null;
}
/** The next candidate's removal (wraps), or null when the plan has fewer than two. */
export function nextRemoval(plan: Pick<MusicFitPlan, 'make'>): JoinCandidate['removal'] | null {
  const m = plan.make;
  if (m.kind !== 'fitted' || m.candidates.length < 2) return null;
  return m.candidates[(m.chosen + 1) % m.candidates.length]!.removal;
}
export const joinSentence = (lang: Lang, c: JoinCandidate): string => joinMeasuredSentence(c.measured)[lang];
export function joinOffText(t: MusicFitT, c: JoinCandidate): string {
  const off = Math.abs(c.offBySeconds);
  return t('joinOff', { sign: c.offBySeconds < 0 ? '−' : '+', seconds: sec(off) });
}

/** One note of a plan (warning or blocking) in the interface language: the server's Hebrew when it sent one, else the sentence of its code, else its own text. */
export function noteText(lang: Lang, t: MusicFitT, n: MusicFitNote): string {
  const d = n.details as Record<string, unknown>;
  if (lang === 'he' && typeof d.he === 'string' && d.he) return d.he;
  const num = (k: string, digits = 0) => (typeof d[k] === 'number' ? ((d[k] as number).toFixed(digits)) : '?');
  const vars: Record<string, string | number> = {
    similarity: num('similarity', 3), ms: num('tempoSpreadMs', 1), count: typeof d.count === 'number' ? d.count : '?',
    before: typeof d.before === 'number' ? d.before : '?', after: typeof d.after === 'number' ? d.after : '?',
    n: Array.isArray(d.clipIds) ? d.clipIds.length : '?',
  };
  const text = t(`note.${n.code}`, vars);
  if (text === `note.${n.code}`) return (lang === 'he' ? translateRefusal('he', n.message) : undefined) ?? n.message;
  return text;
}

export interface TableRow { key: string; text: string }
/** The "what changes" table of a film or template swap (and a clip's): only what the plan says; nothing it does not know. */
export function whatChanges(t: MusicFitT, plan: MusicFitPlan): TableRow[] {
  const rows: TableRow[] = [];
  const r = plan.recut;
  if (r) {
    rows.push({ key: 'cuts', text: t('swapCuts', { before: r.before.cuts, after: r.after.cuts }) });
    if (r.after.minGapFrames !== null) rows.push({ key: 'gap', text: t('minGap', { frames: r.after.minGapFrames }) });
    if (r.thinned > 0) rows.push({ key: 'thinned', text: t('thinned', { n: r.thinned }) });
    if (r.kept.length) rows.push({ key: 'kept', text: t('kept', { n: r.kept.length }) });
    if (r.movedBack.length) rows.push({ key: 'moved', text: t('movedBack', { n: r.movedBack.length }) });
    if (r.blocked.length) rows.push({ key: 'blocked', text: t('blocked', { names: r.blocked.join(', ') }) });
  }
  const off = plan.impacts.filter((i) => i.framesFromBeatAfter !== null && i.framesFromBeatAfter !== 0).length;
  if (off) rows.push({ key: 'off', text: t('offBeat', { n: off }) });
  const keys = plan.warnings.find((w) => w.code === 'music_keys_dropped');
  if (keys && typeof (keys.details as { count?: unknown }).count === 'number') rows.push({ key: 'keys', text: t('keysDropped', { n: (keys.details as { count: number }).count }) });
  if (!rows.length) rows.push({ key: 'nothing', text: t('swapWhatNothing') });
  return rows;
}
/** Plan notes that the table already says (so they are not listed twice). */
export const TABLE_CODES = new Set(['music_keys_dropped', 'impacts_off_beat', 'template_blocked', 'kept_cuts_close']);
export const realignCount = (plan: Pick<MusicFitPlan, 'impacts'>): number => plan.impacts.filter((i) => i.framesFromBeatAfter !== null && i.framesFromBeatAfter !== 0).length;

// ---------- the join of a shortened song ----------
export interface JoinState { fitted: true; heard: boolean; by?: string; at?: string; joinSeconds: number; sourceAssetId: string; removed: { from: T.RationalTime; to: T.RationalTime }; startAt: T.RationalTime }
export function joinState(asset: Pick<Asset, 'provenance'> | undefined): JoinState | null {
  const f = asset?.provenance.fitted;
  if (!f) return null;
  return { fitted: true, heard: !!f.heard, ...(f.heard ? { by: f.heard.by, at: f.heard.at } : {}), joinSeconds: T.toSeconds(f.joinAt), sourceAssetId: f.sourceAssetId, removed: f.removed, startAt: f.startAt };
}
/** The chip on a clip: a shortened song until the owner marks it heard, and built-in music always (nobody has listened). null: nothing to label. */
export function chipFor(lang: Lang, t: MusicFitT, asset: Pick<Asset, 'provenance'> | undefined): { kind: 'unheard-join' | 'heard-join' | 'unheard-builtin'; text: string } | null {
  const j = joinState(asset);
  if (j) return j.heard ? { kind: 'heard-join', text: t('chipHeard', { at: (j.at ?? '').slice(0, 10) }) } /* the day, not the stored instant with milliseconds (integration) */ : { kind: 'unheard-join', text: MUSICFIT_UNHEARD_LABEL[lang] };
  if (asset?.provenance.procedural && /^music\./.test(asset.provenance.procedural.id)) return { kind: 'unheard-builtin', text: MUSIC_UNHEARD_LABEL[lang] };
  return null;
}
/** The audition removal of a shortened song's own clip: the removal it was made from (source times of the original). */
export const auditionRemoval = (j: JoinState) => ({ removal: { from: j.removed.from, to: j.removed.to }, startAt: j.startAt });

// ---------- impact ----------
/** The source time of the file the playhead shows inside this clip, or null when the playhead is outside it (or the clip cannot hold a moment). */
export function momentAtPlayhead(doc: ProjectDocument, clipId: string, playhead: T.RationalTime): T.RationalTime | null {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media' || !canHoldMoment(doc, clipId)) return null;
  const c = f.clip;
  if (T.lt(playhead, c.start) || !T.lt(playhead, T.add(c.start, c.duration))) return null;
  return sourceAt(c, playhead);
}
export type ImpactView =
  | { kind: 'cannot' }
  | { kind: 'unmarked' }
  | { kind: 'marked'; momentSeconds: number; line: string | null; refusal: string | null; plan: { frames: number; ms: number; targetFrame: number } | null; onBeat: boolean };
/** What the controls show for a clip now: from core planImpact, the same function the operation uses, so the line and the edit agree. */
export function impactView(doc: ProjectDocument, clip: MediaClip, lang: Lang, t: MusicFitT, to: 'beat' | 'bar' = 'beat'): ImpactView {
  if (!canHoldMoment(doc, clip.id)) return { kind: 'cannot' };
  if (clip.impact === undefined) return { kind: 'unmarked' };
  const momentSeconds = T.toSeconds(clip.impact);
  const p = planImpact(doc, clip.id, undefined, to);
  if ('refusal' in p) {
    if (p.refusal === 'alreadyOnBeat') return { kind: 'marked', momentSeconds, line: t('impactRealigned'), refusal: null, plan: null, onBeat: true };
    return { kind: 'marked', momentSeconds, line: null, refusal: refusalLine(lang, p.refusal, p.details), plan: null, onBeat: false };
  }
  return { kind: 'marked', momentSeconds, line: offsetLine(t, p.offsetBefore.frames), refusal: null, plan: { frames: Math.abs(p.offsetBefore.frames), ms: Math.abs(p.offsetBefore.ms), targetFrame: p.targetFrame }, onBeat: false };
}
/** «הרגע 4 פריימים אחרי הפעימה» / before the beat. */
export const offsetLine = (t: MusicFitT, frames: number): string => (frames >= 0 ? t('impactAfter', { frames }) : t('impactBefore', { frames: -frames }));
/** After sync_impact: the offset it measured before and the signed residual after, both said (the stated before-and-after). */
export function afterSyncText(t: MusicFitT, out: Pick<SyncImpactOutput, 'offsetBefore' | 'residualMs'>): string {
  const before = offsetLine(t, out.offsetBefore.frames);
  const after = t('impactOnBeat', { ms: (Math.round(out.residualMs * 10) / 10).toString() });
  return t('impactBeforeAfter', { before, after });
}

// ---------- the swap dialog's music list ----------
export interface SwapRow { id: string; kind: 'builtin' | 'song'; assetId?: string; styleId?: string; name: string; sub: string; choice: MusicChoice }
export function swapRows(doc: ProjectDocument, lang: Lang, t: MusicFitT, exceptAssetId?: string): SwapRow[] {
  const rows: SwapRow[] = [];
  for (const s of listMusicStyles()) rows.push({ id: s.id, kind: 'builtin', styleId: s.id, name: s.name[lang], sub: `${t('swapBpm', { bpm: s.bpm })} · ${t('swapKnownBeats')}`, choice: { builtin: { styleId: s.id } } });
  for (const a of Object.values(doc.assets)) {
    if (a.kind !== 'audio' || a.id === exceptAssetId || a.provenance.voice) continue;
    const own = ownBeats(doc, a.id);
    if (!own || own.beats.length < 2) continue;
    rows.push({ id: a.id, kind: 'song', assetId: a.id, name: a.name, sub: t('swapMeasuredBeats'), choice: { assetId: a.id } });
  }
  return rows;
}

// ---------- the ops the surfaces send ----------
export const markOp = (clipId: string, moment: T.RationalTime | null) => ({ op: 'set_clip_impact', args: { clipId, moment } });
export const syncOp = (clipId: string, to: 'beat' | 'bar', pick?: 'earlier' | 'later') => ({ op: 'sync_impact', args: { clipId, to, ...(pick ? { pick } : {}) } });
/** «ליישר שוב»: one sync_impact (nearest beat) per marked clip that is off its beat now, to commit as ONE transaction. Clips already on a beat, or with no room, are left out. */
export function realignOps(doc: ProjectDocument, clipIds: readonly string[]): ReturnType<typeof syncOp>[] {
  const out: ReturnType<typeof syncOp>[] = [];
  for (const id of clipIds) {
    const f = findClip(doc, id);
    if (!f || f.clip.type !== 'media' || f.clip.impact === undefined) continue;
    if ('refusal' in planImpact(doc, id, undefined, 'beat')) continue;
    out.push(syncOp(id, 'beat'));
  }
  return out;
}
