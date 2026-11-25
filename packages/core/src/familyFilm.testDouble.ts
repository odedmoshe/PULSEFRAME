/**
 * TEST BUILDERS for the family film planner (familyFilm.test.ts). Labelled test data, never used outside tests: synthetic
 * documents with videos, stills and music, synthetic moments records (as the moments job would attach them) and synthetic beat
 * analyses (as the beat measurement would). Nothing here is a measurement and nothing here stands in for a provider.
 *
 * `regenerateFilm` repeats, in a few lines, what the server does on regeneration (apps/server/src/familyFilm.ts
 * filmRegeneration: kept by content fingerprint plus link partners, except a clip that a delete which closed the gap moved
 * (core closedGapOnly; the run records its places), the document without the rest, the planner's context and the apply_template
 * arguments), so the core tests can apply a regeneration through the REAL apply_template op. What was deleted by
 * hand (slot records, the picks' windows, the mix and the cut the run left) comes from core filmRegenerationRemoved, which the
 * server uses too, and the run params are recorded by core filmRunRecordParams, as the server records them. The server's own code
 * is tested in apps/server.
 */
import * as T from '@pulseframe/time';
import {
  applyTransaction, clipEnd, closedGapOnly, createProject, findClip, fingerprint, onOtherTrack, FAMILY_FILM_TEMPLATE_ID, FAMILY_FILM_VERSION, filmRunParams, filmRunRecordParams, MOMENTS_ALGO, MOMENTS_METHOD,
  type Asset, type FamilyFilmPlan, type FilmKeptClip, type FilmPlanContext, type FilmRemovedPick, type MomentsItem, type MomentWindow, type ProjectDocument, type RecipeRun, type SlotRecord,
} from './index.ts';
import { filmRegenerationRemoved, planFamilyFilm } from './familyFilm.ts';

export type Rate = { num: number; den: number };
export const R30: Rate = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00.000Z', importedBy: 'test' };
let hashSeq = 1;
const hash = () => `sha256:${(hashSeq++).toString(16).padStart(64, '0')}`;

/** A seeded generator (mulberry32): the same seed gives the same numbers. Test data only. */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function video(id: string, seconds: number, o: { rate?: Rate; startTime?: T.RationalTime; audio?: boolean; w?: number; h?: number; frameCount?: number | null } = {}): Asset {
  const rate = o.rate ?? R30;
  return {
    id, kind: 'video', name: `${id}.mp4`, contentHash: hash(), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4',
    duration: T.fromSeconds(seconds),
    video: { width: o.w ?? 1920, height: o.h ?? 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: o.frameCount === undefined ? null : o.frameCount, ...(o.startTime ? { startTime: o.startTime } : {}) },
    ...(o.audio === false ? {} : { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } }), provenance: prov,
  } as Asset;
}
export const still = (id: string, w = 1920, h = 1080): Asset => ({ id, kind: 'image', name: `${id}.jpg`, contentHash: hash(), byteSize: 100, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: w, height: h, codec: 'mjpeg', hasAlpha: false }, provenance: prov } as Asset);
export const song = (id: string, seconds: number): Asset => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: hash(), byteSize: 100, container: 'wav', mimeType: 'audio/wav', duration: T.fromSeconds(seconds), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as Asset);

export function project(rate: Rate = R30, w = 1920, h = 1080): ProjectDocument {
  return createProject({ id: 'prj_film', name: 'film', width: w, height: h, frameRate: rate });
}
/** Beats (source times, ms) at `bpm` from `first` ms, each gap varied by up to +-drift (a share, e.g. 0.03) with a seeded generator. */
export function beatTimes(bpm: number, count: number, o: { first?: number; drift?: number; seed?: number } = {}): T.RationalTime[] {
  const rnd = seeded(o.seed ?? 1);
  const out: T.RationalTime[] = [];
  let t = o.first ?? 0;
  for (let i = 0; i < count; i++) { out.push(T.rt(Math.round(t), 1000)); t += (60_000 / bpm) * (1 + (o.drift ?? 0) * (2 * rnd() - 1)); }
  return out;
}
/** Attach a beat analysis to a sound asset: downbeats every `meter` beats from `downFrom` (null = none). */
export function withBeats(doc: ProjectDocument, assetId: string, beats: T.RationalTime[], o: { meter?: number; downFrom?: number | null; bpm?: number | null; confidence?: number | null } = {}): ProjectDocument {
  const meter = o.meter ?? 4, from = o.downFrom === undefined ? 0 : o.downFrom;
  doc.analyses[assetId] = { ...(doc.analyses[assetId] ?? { assetId }), assetId, beats: {
    origin: { method: 'test beats', params: {}, createdAt: '2026-11-18T00:00:00Z', createdBy: 'test', edited: false },
    bpm: o.bpm === undefined ? 120 : o.bpm, confidence: o.confidence === undefined ? 0.9 : o.confidence, beats,
    ...(from !== null ? { downbeats: beats.filter((_, i) => i >= from && (i - from) % meter === 0), meter } : { meter }),
  } };
  return doc;
}
export const win = (o: Partial<MomentWindow> = {}): MomentWindow => ({ peakFrame: 150, fromFrame: 90, toFrame: 300, basis: ['inner-motion'], motion: 40, level: null, sharp: 1.0, luma: 120, ...o });
/** Attach a moments record through the real internal op attach_moments (as the moments job does). */
export function withMoments(doc: ProjectDocument, assetId: string, o: Partial<Omit<MomentsItem, 'assetId' | 'algo' | 'data'>> = {}): ProjectDocument {
  const windows = o.windows ?? [win()];
  const item: MomentsItem = { assetId, algo: MOMENTS_ALGO, data: `sha256:${'a'.repeat(64)}`, measured: o.measured ?? { picture: true, sound: windows.some((w) => w.basis.includes('sound')) }, file: o.file ?? { motion: 8, level: -300 }, flat: o.flat ?? windows.length === 0, windows };
  return applyTransaction(doc, [{ op: 'attach_moments', args: { method: MOMENTS_METHOD, createdAt: '2026-11-18T10:00:00Z', items: [item] } }], { idSeed: `mo_${assetId}_`, actor: 'server:moments', allowInternal: true }).doc;
}
export const emptyCtx = (capture: Record<string, string | null> = {}): FilmPlanContext => ({ capture, title: null, closing: null });

/** Apply a plan as the server does: ONE apply_template with params.picked (a regeneration adds runId and the keep lists). */
export function applyFilm(doc: ProjectDocument, plan: FamilyFilmPlan, extra: Record<string, unknown> = {}, seed = 'film_', removedPicks: readonly FilmRemovedPick[] = []) {
  return applyTransaction(doc, [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION, params: filmRunRecordParams(plan, removedPicks), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true, ...extra } }], { idSeed: seed, actor: 'test', allowInternal: true });
}
export const runOf = (doc: ProjectDocument, runId: string): RecipeRun => doc.recipeRuns[runId]!;

/** The server's regeneration in short (see the header), planned only: the plan, its context and the apply_template keep lists. */
export function regenerationPlan(doc: ProjectDocument, runId: string, newParams: Record<string, unknown> = {}, restoreRemoved = false) {
  const run = runOf(doc, runId);
  const rate = doc.settings.frameRate;
  const live = run.createdIds.filter((id) => !!findClip(doc, id));
  // as the server's runHandEdits with the film's rule: a clip a gap-closing delete moved is not edited (closedGapOnly); one taken
  // to another track than recorded is (onOtherTrack)
  const closed = closedGapOnly(doc, run, live), elsewhere = onOtherTrack(doc, run, live);
  const edited = live.filter((id) => elsewhere.includes(id) || (fingerprint(findClip(doc, id)!.clip) !== run.fingerprints[id] && !closed.includes(id)));
  const groups = new Set(edited.flatMap((id) => { const c = findClip(doc, id)!.clip; return c.type === 'media' && c.linkGroupId ? [c.linkGroupId] : []; }));
  const protectedIds = live.filter((id) => { const c = findClip(doc, id)!.clip; return edited.includes(id) || (c.type === 'media' && !!c.linkGroupId && groups.has(c.linkGroupId)); });
  const removable = live.filter((id) => !protectedIds.includes(id));
  const slots: SlotRecord[] = run.slots ?? [];
  const { removedSlots, removedPicks, previousMusic, previousCut } = filmRegenerationRemoved(doc, run, restoreRemoved);
  const keepSlots = [...slots.filter((s) => protectedIds.includes(s.clipId)), ...removedSlots];
  const without = structuredClone(doc);
  for (const id of removable) { const f = findClip(without, id); if (f) f.track.clips.splice(f.index, 1); }
  const kept: FilmKeptClip[] = protectedIds.map((id) => {
    const f = findClip(doc, id)!;
    const slot = slots.find((s) => s.clipId === id);
    const kind: FilmKeptClip['kind'] = slot?.kind === 'text' ? 'text' : slot?.kind === 'music' ? 'music' : f.track.kind === 'audio' ? 'sound' : 'picture';
    return { key: slot?.key ?? null, clipId: id, assetId: f.clip.type === 'media' ? f.clip.assetId : null, kind, startFrame: T.nearestFrameIndex(f.clip.start, rate), endFrame: T.nearestFrameIndex(clipEnd(f.clip), rate) };
  });
  const tracks = new Set(Object.values(doc.sequences).flatMap((q) => q.tracks.map((t) => t.id)));
  const keepIds = [...protectedIds, ...run.createdIds.filter((id) => tracks.has(id))];
  const params = { ...filmRunParams(run.params), ...newParams };
  const prevOwn = run.params.ownSound as FilmPlanContext['previousOwnSound'];
  // the run's tracks by role (the server's filmRunTracks, in short): the tracks holding a picture slot's clip, its linked sound and the music.
  // The own-sound track is found from the linked sound WITHOUT requiring it among run.createdIds: when the planner reuses an empty
  // track that was already in the project (A1 of a new project), no step outputs that track's id. The server's filmRunTracks does the
  // same since the lead's fix (roles from the slots' clips on any track; the found tracks are recorded in the new run's keepIds).
  const made = new Set(run.createdIds);
  const holder = (clipId: string) => findClip(doc, clipId)?.track;
  const pics = slots.filter((x) => x.kind === 'picture').map((x) => findClip(doc, x.clipId)).filter((f) => !!f);
  const links = new Set(pics.flatMap((f) => (f!.clip.type === 'media' && f!.clip.linkGroupId ? [f!.clip.linkGroupId] : [])));
  const reuseTracks: NonNullable<FilmPlanContext['reuseTracks']> = {};
  const pictures = pics.find((f) => made.has(f!.track.id))?.track;
  if (pictures) reuseTracks.pictures = pictures.id;
  const musicTrack = slots.filter((x) => x.kind === 'music').map((x) => holder(x.clipId)).find((t) => t && made.has(t.id));
  if (musicTrack) reuseTracks.musicTrack = musicTrack.id;
  const ownTrack = Object.values(doc.sequences).flatMap((q) => q.tracks).find((t) => t.kind === 'audio' && t.id !== reuseTracks.musicTrack && t.clips.some((c) => c.type === 'media' && !!c.linkGroupId && links.has(c.linkGroupId)));
  if (ownTrack) reuseTracks.ownSound = ownTrack.id;
  const ctx: FilmPlanContext = { capture: {}, title: null, closing: null, kept, keptKeys: keepSlots.filter((s) => !removedSlots.includes(s)).map((s) => s.key), removedKeys: removedSlots.map((s) => s.key), removedPicks, previousCut, reuseTracks, previousOwnSound: prevOwn, previousMusic };
  const plan = planFamilyFilm(without, params, ctx);
  return { plan, ctx, kept, protectedIds, removedPicks, extra: { runId, removeClipIds: removable, keepIds, keepSlots } };
}
/** regenerationPlan, then applied through the real apply_template as the server commits it. */
export function regenerateFilm(doc: ProjectDocument, runId: string, newParams: Record<string, unknown> = {}, seed = 'regen_', restoreRemoved = false) {
  const r = regenerationPlan(doc, runId, newParams, restoreRemoved);
  return { ...r, applied: applyFilm(doc, r.plan, r.extra, seed, r.removedPicks) };
}
let editSeq = 0;
/** A person's edit: ordinary public ops in one transaction. */
export const edit = (doc: ProjectDocument, ops: { op: string; args: unknown }[]) => applyTransaction(doc, ops, { idSeed: `hand${editSeq++}_`, actor: 'person' }).doc;
