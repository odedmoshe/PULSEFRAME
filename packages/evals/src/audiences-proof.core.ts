/**
 * pnpm proof:audiences, part core (builder W2): checks 1–5 and 9 of audiences-proof.ts, in Node, through the server's Store (commit,
 * undo: the path every edit takes) and core's projectVariant / audienceChanges — W1's real functions, never a stand-in. Until W1's
 * rules are merged (core AUDIENCE_PROJECTION_BUILT false) each check builds its master fixture, then answers "BLOCKED: …" (it cannot
 * run here), never a pass.
 *
 * Fixtures are TYPED documents only: two picture files and three sound files described by their facts (no media is read; the
 * server part renders real synthetic media). "Music" is a sound file with built-in-music provenance (procedural music.calm, the
 * synthesiser's generator line) — a typed stand-in for a file the synthesiser made, as the lineage tests type derived files; "speech" is
 * a sound file on a track that another track ducks under; "camera sound" is the linked sound of a picture clip. No owner clip is used.
 * Expected numbers are computed here by hand from the fixture and the rule table literals (×4/3 with its caps, DB_GAIN[−8], +6 dB),
 * and the counts of check 9 from a field-by-field diff of master and projection, never from the change list itself.
 * Nothing here looks at or listens to anything: every check is a comparison of document fields.
 * Run alone: `tsx packages/evals/src/audiences-proof.core.ts` (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import {
  audienceChanges, AUDIENCE_PROJECTION_BUILT, AUDIENCE_TABLE_V1, CALM_OFF_EFFECTS, CALM_SOFTENED_TRANSITIONS, canonical, createProject, DB_GAIN,
  MUSIC_GENERATOR, projectVariant, validateProject,
  type Asset, type AudienceChange, type Clip, type ProjectDocument, type Track,
} from '@pulseframe/core';
import { Store } from '../../../apps/server/src/store.ts';

export interface AudiencesProofPart { built: boolean; checks: Record<string, () => Promise<true | string>>; evidence: Record<string, unknown> }
const evidence: Record<string, unknown> = {};

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const frameOf = (t: T.RationalTime) => T.frameIndexAt(t, R);
const OWNER = 'user:owner';
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'proof' };
const hashOf = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const docHash = (d: ProjectDocument) => hashOf(canonical(d));
const fail = (what: string, got: unknown) => `${what}: ${JSON.stringify(got).slice(0, 700)}`;
const NOT_BUILT = 'BLOCKED: W1\'s audience rules are not merged in this build (core AUDIENCE_PROJECTION_BUILT is false), so no version for an audience can be made or projected';
const tmpDirs: string[] = [];
const check = (run: () => true | string | Promise<true | string>) => async (): Promise<true | string> => {
  try { return await run(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 700)}`; } finally { for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }
};

// ---------------------------------------------------------------- the typed fixture
const facts = (id: string, kind: 'video' | 'audio', seconds: number, extra: Partial<Asset['provenance']> = {}, origin: Asset['provenance']['origin'] = 'fixture'): Asset => ({
  id, kind, name: `${id}.${kind === 'video' ? 'mp4' : 'wav'}`, contentHash: hashOf(id), byteSize: 1, container: kind === 'video' ? 'mp4' : 'wav', mimeType: kind === 'video' ? 'video/mp4' : 'audio/wav',
  duration: f(seconds * 30),
  ...(kind === 'video' ? { video: { width: 320, height: 180, frameRate: R, codec: 'h264', rotation: 0, frameCount: seconds * 30 } } : {}),
  audio: { sampleRate: 48000, channels: 2, codec: kind === 'video' ? 'aac' : 'pcm_s16le' },
  provenance: { ...prov, origin, ...extra },
} as unknown as Asset);
/** built-in music provenance (musicStyles.ts): what the synthesiser writes on a file it made; a typed stand-in here */
const MUSIC_PROV = { procedural: { id: 'music.calm', version: 1, generator: MUSIC_GENERATOR } };

interface World { store: Store; pid: string; ids: Record<string, string>; tracks: Record<string, string> }
const tx = (w: World, ops: { op: string; args: unknown }[]) => w.store.commit({ projectId: w.pid, actor: OWNER, ops });
const out1 = (r: ReturnType<typeof tx>, i = 0, k = 'clipId') => r.results[i]!.output![k] as string;
const whole = (w: World) => w.store.wholeProject(w.pid).doc;
const allClips = (d: ProjectDocument): { clip: Clip; track: Track }[] => d.sequences[d.mainSequenceId]!.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })));
const clipIn = (d: ProjectDocument, id: string) => allClips(d).find((x) => x.clip.id === id)?.clip;
const trackIn = (d: ProjectDocument, id: string) => d.sequences[d.mainSequenceId]!.tracks.find((t) => t.id === id);

/**
 * The master: V1 four 2 s picture clips (pic, pic2, pic3, pic4; pic and pic2 with camera sound on A-cam), an adjustment clip, two titles
 * (0.09 and 0.45 of the height, the second with the jitter loop), a manual caption track with one cue, A-music (two built-in music
 * clips, gain 0.8, ducked 10 dB under A-speech), A-speech (one sound file), A-mixed (a music clip and a camera-sound clip: not all
 * music), A-cam (the linked camera sound). Effects: every CALM_OFF_EFFECTS type spread over the picture clips and the adjustment, a
 * blur with a beat modulator (class none: stays on, its modulator goes), a colour adjust (class none: stays as it is).
 */
function makeWorld(): World {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aud-core-'));
  tmpDirs.push(dir);
  const store = new Store(dir);
  const doc = createProject({ id: 'prj_aud_core', name: 'audiences core', width: 320, height: 180, frameRate: R });
  for (const a of [facts('ast_pic', 'video', 8), facts('ast_music', 'audio', 8, MUSIC_PROV, 'generated'), facts('ast_speech', 'audio', 8), facts('ast_cam', 'video', 8)]) doc.assets[a.id] = a;
  const pid = store.importProject(doc).doc.id;
  const w: World = { store, pid, ids: {}, tracks: {} };
  (closeAfter as Store[]).push(store);
  const seqTracks = () => whole(w).sequences[whole(w).mainSequenceId]!.tracks;
  // pictures on V1 with camera sound
  for (const [k, start, asset] of [['pic', 0, 'ast_pic'], ['pic2', 60, 'ast_cam'], ['pic3', 120, 'ast_pic'], ['pic4', 180, 'ast_pic']] as const) {
    const r = tx(w, [{ op: 'add_clip', args: { assetId: asset, start: f(start), duration: f(60), sourceIn: f(start), ...(k === 'pic' || k === 'pic2' ? {} : { withLinkedAudio: false }) } }]);
    w.ids[k] = out1(r);
  }
  w.tracks.v1 = allClips(whole(w)).find((x) => x.clip.id === w.ids.pic)!.track.id;
  w.tracks.cam = allClips(whole(w)).find((x) => x.track.kind === 'audio')!.track.id;
  // sound tracks
  for (const k of ['music', 'speech', 'mixed'] as const) w.tracks[k] = (tx(w, [{ op: 'add_track', args: { kind: 'audio', name: k } }]).results[0]!.output!.trackId as string);
  w.ids.music1 = out1(tx(w, [{ op: 'add_clip', args: { assetId: 'ast_music', trackId: w.tracks.music, start: f(0), duration: f(90) } }]));
  w.ids.music2 = out1(tx(w, [{ op: 'add_clip', args: { assetId: 'ast_music', trackId: w.tracks.music, start: f(90), duration: f(60), sourceIn: f(90) } }]));
  w.ids.speech = out1(tx(w, [{ op: 'add_clip', args: { assetId: 'ast_speech', trackId: w.tracks.speech, start: f(150), duration: f(90) } }]));
  w.ids.mixedMusic = out1(tx(w, [{ op: 'add_clip', args: { assetId: 'ast_music', trackId: w.tracks.mixed, start: f(0), duration: f(60) } }]));
  // camera sound on the mixed track: a picture placed above V1 whose linked sound goes to A-mixed
  w.ids.mixedPic = out1(tx(w, [{ op: 'add_clip', args: { assetId: 'ast_cam', start: f(60), duration: f(60), audioTrackId: w.tracks.mixed } }]));
  w.ids.mixedCam = whole(w).sequences[whole(w).mainSequenceId]!.tracks.find((t) => t.id === w.tracks.mixed)!.clips.find((c) => c.type === 'media' && c.assetId === 'ast_cam')!.id;
  tx(w, [{ op: 'set_track_audio', args: { trackId: w.tracks.music, gain: 0.8 } }, { op: 'set_ducking', args: { trackId: w.tracks.music, sourceTrackIds: [w.tracks.speech], reductionDb: 10 } }]);
  // effects: every class that is not 'none', spread over the pictures (at most 4 a clip) and the adjustment
  const pics = ['pic', 'pic2', 'pic3', 'pic4'];
  const refused: Record<string, string> = {};
  const placed: Record<string, string> = {};
  CALM_OFF_EFFECTS.forEach((type, i) => {
    const target = w.ids[pics[i % pics.length]!]!;
    try { tx(w, [{ op: 'add_effect', args: { clipId: target, type } }]); placed[type] = target; } catch (e) { refused[type] = String((e as Error).message).slice(0, 160); }
  });
  w.ids.adj = out1(tx(w, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(60) }, effects: [{ type: 'light.strobe' }, { type: 'color.adjust' }] } }]));
  tx(w, [{ op: 'add_effect', args: { clipId: w.ids.pic3!, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId: w.ids.pic4!, type: 'color.adjust' } }]);
  const blur = (clipIn(whole(w), w.ids.pic3!) as { effects?: { id: string; type: string }[] }).effects!.find((e) => e.type === 'blur.gaussian')!;
  tx(w, [{ op: 'set_effect_modulator', args: { clipId: w.ids.pic3!, effectId: blur.id, param: 'radius', modulator: { depth: 0.1 } } }]);
  // a light transition with velocity on pic2, a shaking one on pic3, a dissolve (class none) on pic4
  tx(w, [{ op: 'set_transition', args: { clipId: w.ids.pic2!, type: 'flash', frames: 10 } }, { op: 'set_transition', args: { clipId: w.ids.pic3!, type: 'whip-left', frames: 8 } }, { op: 'set_transition', args: { clipId: w.ids.pic4!, type: 'dissolve', frames: 6 } }]);
  // titles and captions
  w.ids.title = out1(tx(w, [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60) } }]));
  w.ids.bigTitle = out1(tx(w, [{ op: 'add_text', args: { text: 'גדולה', start: f(60), duration: f(60) } }]));
  tx(w, [{ op: 'update_text', args: { clipId: w.ids.title, style: { sizeFrac: 0.09 } } }, { op: 'update_text', args: { clipId: w.ids.bigTitle, style: { sizeFrac: 0.45 } } }]);
  tx(w, [{ op: 'set_text_animation', args: { clipId: w.ids.bigTitle, animation: { by: 'letter', in: null, out: null, loop: 'jitter', inFrames: 10, outFrames: 10 } } }]);
  w.tracks.cap = tx(w, [{ op: 'add_caption_track', args: { mode: 'manual', style: { sizeFrac: 0.06, maxCharsPerLine: 40, background: null, preset: 'karaoke' } } }]).results[0]!.output!.trackId as string;
  w.ids.cue = out1(tx(w, [{ op: 'add_cue', args: { trackId: w.tracks.cap, start: f(0), duration: f(60), text: 'שלום' } }]));
  evidence.fixture = { clips: allClips(whole(w)).length, tracks: seqTracks().map((t) => `${t.kind}:${t.name}`), effectsPlaced: Object.keys(placed).length, effectsRefused: refused };
  return w;
}
const closeAfter: Store[] = [];
function closeWorlds() { for (const s of closeAfter.splice(0)) s.close(); }
const addVersion = (w: World, profile: 'calm' | 'grandparents') => tx(w, [{ op: 'add_audience_version', args: { profile } }]).results[0]!.output!.variantId as string;
const fx = (c: Clip | undefined) => ((c as { effects?: { id: string; type: string; enabled: boolean; modulate?: unknown }[] } | undefined)?.effects ?? []);

// ---------------------------------------------------------------- 1
const c1 = check(() => {
  const w = makeWorld();
  try {
    if (!AUDIENCE_PROJECTION_BUILT) return NOT_BUILT;
    const vid = addVersion(w, 'calm');
    const master = whole(w), before = docHash(master);
    const p = projectVariant(master, vid);
    if (docHash(master) !== before) return 'projecting the calm version changed the master document';
    const offWanted: string[] = [], offWrong: string[] = [], keptWrong: string[] = [];
    for (const { clip } of allClips(master)) for (const e of fx(clip)) {
      const got = fx(clipIn(p, clip.id)).find((x) => x.id === e.id);
      if (CALM_OFF_EFFECTS.includes(e.type)) { offWanted.push(`${clip.id}:${e.type}`); if (!got || got.enabled !== false) offWrong.push(`${clip.id}:${e.type}`); }
      else if (!got || got.enabled !== e.enabled) keptWrong.push(`${clip.id}:${e.type}`);
    }
    const onAdjustment = fx(clipIn(p, w.ids.adj!)).filter((e) => e.type === 'light.strobe' && e.enabled === false).length;
    const masterOn = allClips(master).flatMap(({ clip }) => fx(clip)).filter((e) => CALM_OFF_EFFECTS.includes(e.type) && e.enabled).length;
    evidence.c1 = { offEffects: offWanted.length, wrong: offWrong, classNoneChanged: keptWrong, adjustmentStrobeOff: onAdjustment, masterStillOn: masterOn, masterHash: before };
    if ((evidence.fixture as { effectsRefused: Record<string, string> }).effectsRefused && Object.keys((evidence.fixture as { effectsRefused: Record<string, string> }).effectsRefused).length) return fail('some listed effects could not be placed on the fixture', evidence.fixture);
    return offWrong.length === 0 && keptWrong.length === 0 && onAdjustment === 1 && offWanted.length === CALM_OFF_EFFECTS.length + 1 && masterOn === offWanted.length ? true : fail('calm effects', evidence.c1);
  } finally { closeWorlds(); }
});

// ---------------------------------------------------------------- 2
const c2 = check(() => {
  const w = makeWorld();
  try {
    if (!AUDIENCE_PROJECTION_BUILT) return NOT_BUILT;
    const calm = addVersion(w, 'calm'), gp = addVersion(w, 'grandparents');
    const rows: { type: string; ok: boolean; got: unknown }[] = [];
    for (const type of CALM_SOFTENED_TRANSITIONS) {
      tx(w, [{ op: 'set_transition', args: { clipId: w.ids.pic2!, type, frames: 12 } }]);
      try { tx(w, [{ op: 'set_transition_options', args: { clipId: w.ids.pic2!, velocity: 3 } }]); } catch { /* not every type takes a velocity */ }
      const master = whole(w);
      const want = { type: 'dissolve', frames: 12, ...((clipIn(master, w.ids.pic2!) as { transition?: { sync?: 'beat' } }).transition?.sync ? { sync: 'beat' } : {}) };
      for (const vid of [calm, gp]) {
        const got = (clipIn(projectVariant(master, vid), w.ids.pic2!) as { transition?: unknown }).transition;
        rows.push({ type, ok: canonical(got) === canonical(want), got });
      }
    }
    const master = whole(w);
    const issues = [calm, gp].map((v) => validateProject(projectVariant(master, v)).map((i) => i.code));
    const dissolve = (clipIn(projectVariant(master, calm), w.ids.pic4!) as { transition?: unknown }).transition;
    evidence.c2 = { softened: CALM_SOFTENED_TRANSITIONS.length, wrong: rows.filter((r) => !r.ok).slice(0, 5), validateCalm: issues[0], validateGrandparents: issues[1], dissolveKept: dissolve };
    return rows.every((r) => r.ok) && issues.every((i) => i.length === 0) && canonical(dissolve) === canonical({ type: 'dissolve', frames: 6 }) ? true : fail('softened transitions', evidence.c2);
  } finally { closeWorlds(); }
});

// ---------------------------------------------------------------- 3
const c3 = check(() => {
  const w = makeWorld();
  try {
    if (!AUDIENCE_PROJECTION_BUILT) return NOT_BUILT;
    const vid = addVersion(w, 'calm');
    const variantBefore = canonical(whole(w).variants[vid]);
    const r = tx(w, [{ op: 'add_effect', args: { clipId: w.ids.pic4!, type: 'light.strobe' } }]);
    const master = whole(w);
    const strobe = fx(clipIn(master, w.ids.pic4!)).filter((e) => e.type === 'light.strobe').pop()!;
    const got = fx(clipIn(projectVariant(master, vid), w.ids.pic4!)).find((e) => e.id === strobe.id);
    const variantAfter = canonical(master.variants[vid]);
    evidence.c3 = { opsInTransaction: r.results.map((x) => x.op), masterEnabled: strobe.enabled, versionEnabled: got?.enabled, variantUnchanged: variantBefore === variantAfter };
    return strobe.enabled === true && got?.enabled === false && variantBefore === variantAfter && r.results.every((x) => x.op === 'add_effect') ? true : fail('a strobe added later', evidence.c3);
  } finally { closeWorlds(); }
});

// ---------------------------------------------------------------- 4
const c4 = check(() => {
  const w = makeWorld();
  try {
    if (!AUDIENCE_PROJECTION_BUILT) return NOT_BUILT;
    const vid = addVersion(w, 'calm');
    const clipId = w.ids.pic!;
    const strobeOf = (d: ProjectDocument, id: string) => fx(clipIn(d, id)).filter((e) => e.type === 'light.strobe');
    // pic carries a strobe when CALM_OFF_EFFECTS spread it there; otherwise add one
    if (strobeOf(whole(w), clipId).length === 0) tx(w, [{ op: 'add_effect', args: { clipId, type: 'light.strobe' } }]);
    tx(w, [{ op: 'set_audience_keep', args: { variantId: vid, clipId, rule: 'effect', keep: true } }]);
    const kept = strobeOf(projectVariant(whole(w), vid), clipId).every((e) => e.enabled === true);
    const beforeSplit = docHash(whole(w));
    const split = tx(w, [{ op: 'split_clip', args: { clipId, at: f(30) } }]);
    const after = whole(w);
    const pieces = allClips(after).filter(({ clip, track }) => track.id === w.tracks.v1 && clip.type === 'media' && T.cmp(clip.start, f(60)) < 0).map(({ clip }) => clip.id);
    const p = projectVariant(after, vid);
    const piecesKept = pieces.map((id) => ({ id, keep: after.variants[vid]!.overrides[id]?.keep ?? [], strobeOn: strobeOf(p, id).length > 0 && strobeOf(p, id).every((e) => e.enabled === true) }));
    w.store.undo(w.pid, OWNER, 'undo', split.transactionId ?? undefined);
    const restored = docHash(whole(w)) === beforeSplit;
    evidence.c4 = { keptBeforeSplit: kept, pieces: piecesKept, undoRestoresHash: restored };
    return kept && pieces.length === 2 && piecesKept.every((x) => x.keep.includes('effect') && x.strobeOn) && restored ? true : fail('kept strobe through a split', evidence.c4);
  } finally { closeWorlds(); }
});

// ---------------------------------------------------------------- 5
const c5 = check(() => {
  const w = makeWorld();
  try {
    if (!AUDIENCE_PROJECTION_BUILT) return NOT_BUILT;
    const vid = addVersion(w, 'grandparents');
    const A = AUDIENCE_TABLE_V1;
    const scale = (x: number, cap: number) => Math.min(cap, (x * A.textScale.num) / A.textScale.den);
    // a title of its own size in the version (C3): set 0.08, read 0.08
    const own = out1(tx(w, [{ op: 'add_text', args: { text: 'משלה', start: f(120), duration: f(30) } }]));
    tx(w, [{ op: 'set_variant_override', args: { variantId: vid, clipId: own, textStyle: { sizeFrac: 0.08 } } }]);
    const master = whole(w);
    const p = projectVariant(master, vid);
    const size = (d: ProjectDocument, id: string) => (clipIn(d, id) as { style: { sizeFrac: number } }).style.sizeFrac;
    const cap = (d: ProjectDocument) => trackIn(d, w.tracks.cap!)!.caption!.style;
    const gain = (d: ProjectDocument, id: string) => trackIn(d, id)!.audio?.gain ?? 1;
    const duck = (d: ProjectDocument, id: string) => trackIn(d, id)!.audio?.duck?.reductionDb ?? null;
    const capM = cap(master), capP = cap(p);
    const rows = {
      title: [size(p, w.ids.title!), scale(0.09, A.titleSizeCap)],
      bigTitle: [size(p, w.ids.bigTitle!), scale(0.45, A.titleSizeCap)],
      ownTitle: [size(p, own), 0.08],
      captionSize: [capP.sizeFrac, scale(capM.sizeFrac, A.captionSizeCap)],
      captionChars: [capP.maxCharsPerLine, Math.min(capM.maxCharsPerLine, A.captionMaxCharsPerLine)],
      captionBackground: [capP.background, A.captionBackground],
      captionPreset: [capP.preset, A.captionPreset],
      musicGain: [gain(p, w.tracks.music!), Math.min(A.gainMax, Math.max(A.gainMin, 0.8 * DB_GAIN[-8]!))],
      musicDuck: [duck(p, w.tracks.music!), Math.min(A.duckMaxDb, 10 + A.duckExtraDb)],
      speechGain: [gain(p, w.tracks.speech!), gain(master, w.tracks.speech!)],
      speechDuck: [duck(p, w.tracks.speech!), null],
      mixedGain: [gain(p, w.tracks.mixed!), gain(master, w.tracks.mixed!)],
      camGain: [gain(p, w.tracks.cam!), gain(master, w.tracks.cam!)],
    } as Record<string, [unknown, unknown]>;
    // the owner's role corrections: camera sound called music is lowered; music called other is not
    tx(w, [{ op: 'update_audience_version', args: { variantId: vid, sound: { trackId: w.tracks.cam!, role: 'music' } } }, { op: 'update_audience_version', args: { variantId: vid, sound: { trackId: w.tracks.music!, role: 'other' } } }]);
    const m2 = whole(w), p2 = projectVariant(m2, vid);
    rows.ownerCamAsMusic = [gain(p2, w.tracks.cam!), Math.min(A.gainMax, gain(m2, w.tracks.cam!) * DB_GAIN[-8]!)];
    rows.ownerMusicAsOther = [gain(p2, w.tracks.music!), 0.8];
    const wrong = Object.entries(rows).filter(([, [got, want]]) => got !== want);
    evidence.c5 = { rows, wrong: wrong.map(([k]) => k) };
    return wrong.length === 0 ? true : fail('grandparents text and sound', Object.fromEntries(wrong));
  } finally { closeWorlds(); }
});

// ---------------------------------------------------------------- 9
/** The rule applications of a version, counted from a field-by-field diff of the master and its projection (never from the list). */
function appliedByDiff(master: ProjectDocument, p: ProjectDocument): Record<string, number> {
  const n: Record<string, number> = { effect: 0, modulator: 0, transition: 0, text_loop: 0, title_size: 0, caption_look: 0, music_level: 0, ducking: 0 };
  for (const { clip, track } of allClips(master)) {
    const q = clipIn(p, clip.id);
    if (!q) continue;
    for (const e of fx(clip)) { const g = fx(q).find((x) => x.id === e.id); if (e.enabled && g && !g.enabled) n.effect!++; if (e.modulate !== undefined && g && g.modulate === undefined) n.modulator!++; }
    const tm = (clip as { transition?: unknown }).transition, tp = (q as { transition?: unknown }).transition;
    if (tm && canonical(tm) !== canonical(tp)) n.transition!++;
    if (clip.type === 'text') {
      const lm = (clip as { animation?: { loop?: string | null } }).animation?.loop ?? null, lp = (q as { animation?: { loop?: string | null } }).animation?.loop ?? null;
      if (lm && lm !== lp) n.text_loop!++;
      if ((clip as { style: { sizeFrac: number } }).style.sizeFrac !== (q as { style: { sizeFrac: number } }).style.sizeFrac) n.title_size!++;
    }
    void track;
  }
  for (const t of master.sequences[master.mainSequenceId]!.tracks) {
    const q = p.sequences[p.mainSequenceId]!.tracks.find((x) => x.id === t.id);
    if (!q) continue;
    // one change per changed FIELD of a caption track's style (AudienceChange: one row per changed field of one target), so a track
    // whose size, line length, box and look all change counts four, as the list words them one per row
    if (t.caption) {
      const sm = t.caption.style as unknown as Record<string, unknown>, sp = (q.caption?.style ?? {}) as unknown as Record<string, unknown>;
      for (const k of new Set([...Object.keys(sm), ...Object.keys(sp)])) if (canonical(sm[k] ?? null) !== canonical(sp[k] ?? null)) n.caption_look!++;
    }
    if ((t.audio?.gain ?? 1) !== (q.audio?.gain ?? 1)) n.music_level!++;
    if ((t.audio?.duck?.reductionDb ?? null) !== (q.audio?.duck?.reductionDb ?? null)) n.ducking!++;
  }
  return n;
}
const c9 = check(() => {
  const w = makeWorld();
  try {
    if (!AUDIENCE_PROJECTION_BUILT) return NOT_BUILT;
    const out: Record<string, unknown> = {};
    for (const profile of ['calm', 'grandparents'] as const) {
      const vid = addVersion(w, profile);
      // two kept items: the strobe rule on pic and the loop of the big title
      tx(w, [{ op: 'set_audience_keep', args: { variantId: vid, clipId: w.ids.pic!, rule: 'effect', keep: true } }, { op: 'set_audience_keep', args: { variantId: vid, clipId: w.ids.bigTitle!, rule: 'text_loop', keep: true } }]);
      const { doc: master, revision } = w.store.wholeProject(w.pid);
      const list = audienceChanges(master, vid, revision);
      const p = projectVariant(master, vid);
      const byDiff = appliedByDiff(master, p);
      const applied = list.changes.filter((c) => !c.kept);
      const byList: Record<string, number> = Object.fromEntries(Object.keys(byDiff).map((k) => [k, applied.filter((c) => c.rule === k).length]));
      const span = (c: AudienceChange): [number, number] | null => {
        if (c.clipId) { const x = clipIn(master, c.clipId); return x ? [frameOf(x.start), frameOf(T.add(x.start, x.duration))] : null; }
        const first = trackIn(master, c.trackId ?? '')?.clips.slice().sort((a, b) => T.cmp(a.start, b.start))[0];
        return first ? [frameOf(first.start), frameOf(T.add(first.start, first.duration))] : null;
      };
      const outside = list.changes.filter((c) => { const s = span(c); return !s || !(c.startFrame >= s[0] && c.endFrame <= s[1] && c.startFrame < c.endFrame); });
      const kept = list.changes.filter((c) => c.kept).map((c) => `${c.rule}:${c.clipId}`).sort();
      const keptWant = [...new Set([...fx(clipIn(master, w.ids.pic!)).filter((e) => CALM_OFF_EFFECTS.includes(e.type)).map(() => `effect:${w.ids.pic}`), `text_loop:${w.ids.bigTitle}`])].sort();
      const keysUnique = new Set(list.changes.map((c) => c.key)).size === list.changes.length;
      const again = audienceChanges(master, vid, revision);
      out[profile] = { changes: list.changes.length, byDiff, byList, outside: outside.slice(0, 5), kept, keptWant, keysUnique, stable: canonical(again) === canonical(list) };
      const keptDistinct = [...new Set(kept)];
      if (outside.length || canonical(byDiff) !== canonical(byList) || canonical(keptDistinct) !== canonical(keptWant) || !keysUnique || canonical(again) !== canonical(list)) { evidence.c9 = out; return fail(`${profile}: the change list`, out[profile]); }
    }
    evidence.c9 = out;
    return true;
  } finally { closeWorlds(); }
});

export const AUDIENCES_PROOF_CORE: AudiencesProofPart = { built: AUDIENCE_PROJECTION_BUILT, checks: { 1: c1, 2: c2, 3: c3, 4: c4, 5: c5, 9: c9 }, evidence };

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    let failed = 0, blocked = 0;
    for (const [id, run] of Object.entries(AUDIENCES_PROOF_CORE.checks)) {
      const r = await run();
      if (r === true) console.log(`PASS  ${id}`); else if (r.startsWith('BLOCKED')) { blocked++; console.log(`BLOCKED  ${id}  ${r}`); } else { failed++; console.log(`FAIL  ${id}  ${r}`); }
    }
    console.log(JSON.stringify(evidence, null, 1).slice(0, 4000));
    process.exit(failed ? 1 : blocked ? 2 : 0);
  })();
}
