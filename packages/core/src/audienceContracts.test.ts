/**
 * Lead contracts of «גרסה לכל קהל» (wave 8 audiences): the exhaustive stir classification of every effect and transition row
 * (verifier C12 — fails when a registry row is added without a class, or a class changes without review here), the dB table, the
 * schema fields and their validation, the three operations (registered, refusing notBuilt until W1 builds the projection; their bodies
 * are tested here and run once AUDIENCE_PROJECTION_BUILT is true), and the todo list of what W1 must make pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyAudience, applyTransaction, AUDIENCE_CHANGES_METHOD, AUDIENCE_NOT_HANDLED, AUDIENCE_PROJECTION_BUILT, audienceCaptionSize, audienceChanges, creativeProjection, diffEntities, projectVariant, restoreEntities, SOUND_ROLE_ORDER, soundRoleOf, type AudienceChange, AUDIENCE_REFUSALS, CALM_OFF_EFFECTS, CALM_SOFTENED_TRANSITIONS, createProject, DB_GAIN, EFFECTS, getOp,
  hasFormatOverride, KEEPABLE, KEEP_RULES, OpError, ProjectSchema, STIR_CLASSES, TRANSITIONS, validateProject, assistantOps, type ProjectDocument,
} from './index.ts';

/**
 * THE TABLE. Reviewed by hand (lead pre-pass, 2026-11-26) from each row's description and parameters and ADR-0009's measurements.
 * A new registry row fails the test below until it is added here with a class someone chose. Rows the lead was unsure of are
 * marked "unsure" (listed in the pre-pass report for the lead to overrule).
 */
const EFFECT_STIR: Record<string, string> = {
  'color.adjust': 'none', 'color.grayscale': 'none', 'color.sepia': 'none', 'color.invert': 'none', 'color.tint': 'none', 'blur.gaussian': 'none',
  'light.vignette': 'none', 'light.diffusion': 'none', 'stylize.shadow': 'none', 'stylize.pixelate': 'none',
  'stylize.grain': 'none', // unsure: seeded noise that changes every frame, small amplitude
  'digital.rgb-split': 'none', 'key.chroma': 'none',
  'distort.wave': 'shake', // unsure: moves at `speed` waves a second; ADR-0009 measured fast wave flashing on high-contrast pictures
  'distort.bulge': 'none', 'distort.swirl': 'none', 'distort.mirror': 'none',
  'blur.zoom': 'none', // unsure: static; named by the verifier as a candidate
  'stylize.posterize': 'none', 'stylize.edges': 'none', 'digital.glitch': 'light-shake', 'color.grade': 'none', 'color.lut': 'none',
  'stylize.duotone': 'none', 'stylize.halftone': 'none', 'stylize.scanlines': 'none',
  'stylize.vhs': 'light-shake', // unsure: changes `speed` (24) times a second; wobble and colour trails
  'distort.kaleidoscope': 'none', 'distort.fisheye': 'none', 'blur.directional': 'none', 'blur.tilt-shift': 'none', 'light.glow': 'none',
  'motion.shake': 'shake', 'motion.pulse': 'shake',
  'motion.sway': 'none', // unsure: gentle at its default (0.4 a second) but allows up to 5 a second
  'motion.spin': 'shake',
  'light.leak': 'light', // unsure: slow drifting light at its default
  'light.strobe': 'light',
  'stylize.film': 'light-shake', // unsure: flicker kept under a tenth of the range (ADR-0009 decision 3) but the frame weaves
  'digital.rgb-shake': 'shake',
  'light.sparkle': 'light', // unsure: streaks on bright spots; a verifier candidate
  'time.echo': 'none', // unsure: trails, no flash of its own; a verifier candidate
  'time.split': 'none', 'time.shutter': 'none', 'time.stutter': 'shake',
  'overlay.snow': 'none',
  'overlay.confetti': 'none', // unsure: the burst mode
  'overlay.hearts': 'none', // unsure: swells on the beats when following the music
  'overlay.bokeh': 'none',
  'overlay.speed-lines': 'shake', // lead: fast streaks; the owner can keep them per clip
  'stylize.date-stamp': 'none', 'stylize.digicam': 'none', 'stylize.crt': 'none',
};
const TRANSITION_STIR: Record<string, string> = {
  dissolve: 'none', 'dip-black': 'light', 'dip-white': 'light',
  'wipe-left': 'none', 'wipe-right': 'none', 'wipe-up': 'none', 'wipe-down': 'none',
  'push-left': 'none', 'push-right': 'none', 'push-up': 'none', 'push-down': 'none',
  zoom: 'none', // unsure
  'cross-zoom-in': 'shake', 'cross-zoom-out': 'shake', // lead: a fast zoom blur through the cut is motion a calm version softens
  'swirl-cw': 'none', 'swirl-ccw': 'none', 'wave-h': 'none', 'wave-v': 'none',
  'glitch-cut': 'light-shake', pixelate: 'none',
  'clock-cw': 'none', 'clock-ccw': 'none',
  'soft-wipe-right': 'none', 'soft-wipe-left': 'none', 'soft-wipe-down': 'none', 'soft-wipe-up': 'none',
  'soft-wipe-down-right': 'none', 'soft-wipe-down-left': 'none', 'soft-wipe-up-right': 'none', 'soft-wipe-up-left': 'none',
  'blinds-h': 'none', 'blinds-v': 'none', 'iris-open': 'none', 'iris-close': 'none', 'diamond-open': 'none', 'diamond-close': 'none',
  flash: 'light', 'luma-bright': 'none', 'luma-dark': 'none', 'squeeze-h': 'none', 'squeeze-v': 'none', checker: 'none',
  'bars-h': 'none', 'bars-v': 'none', // unsure: random bars
  ripple: 'none',
  'whip-left': 'shake', 'whip-right': 'shake', 'whip-up': 'shake', 'whip-down': 'shake', 'spin-cw': 'shake', 'spin-ccw': 'shake',
  'punch-in': 'shake', 'punch-out': 'shake', 'blur-dissolve': 'none', 'split-open-h': 'none', 'split-open-v': 'none',
  'shape-heart': 'none', 'shape-star': 'none', 'block-left': 'light', 'block-right': 'light',
  'slices-h': 'shake', 'slices-v': 'shake', // unsure: "velocity slices" of the glitch group; the plan softens slices
  'film-burn': 'light', 'light-leak': 'light', 'ink-bleed': 'none', 'brush-left': 'none', 'brush-right': 'none', 'page-turn-left': 'none', 'page-turn-right': 'none',
};

describe('stir classification of the registries (C12)', () => {
  it('every effect row and every transition row carries a class, and the table above lists exactly the registry', () => {
    for (const e of EFFECTS) expect(STIR_CLASSES as readonly string[], e.id).toContain((e as { stir?: string }).stir);
    for (const t of TRANSITIONS) expect(STIR_CLASSES as readonly string[], t.id).toContain((t as { stir?: string }).stir);
    expect(Object.fromEntries(EFFECTS.map((e) => [e.id, e.stir]))).toEqual(EFFECT_STIR);
    expect(Object.fromEntries(TRANSITIONS.map((t) => [t.id, t.stir]))).toEqual(TRANSITION_STIR);
    expect([EFFECTS.length, TRANSITIONS.length]).toEqual([53, 69]);
  });
  it('the flags agree with the other registry flags: light and cover transitions and the strobe change light', () => {
    for (const t of TRANSITIONS) if ((t as { light?: true }).light || (t as { cover?: true }).cover) expect(['light', 'light-shake'], t.id).toContain(t.stir);
    expect(EFFECTS.find((e) => e.id === 'light.strobe')!.stir).toBe('light');
    expect(TRANSITIONS.find((t) => t.id === 'dissolve')!.stir).toBe('none'); // what the others soften into
  });
  it('the calm lists are derived from the flags (the plan\'s named items are all in them)', () => {
    expect([...CALM_OFF_EFFECTS].sort()).toEqual(EFFECTS.filter((e) => e.stir !== 'none').map((e) => e.id).sort());
    for (const id of ['light.strobe', 'motion.shake', 'digital.rgb-shake', 'digital.glitch', 'motion.pulse', 'time.stutter', 'motion.spin']) expect(CALM_OFF_EFFECTS).toContain(id);
    for (const id of ['flash', 'dip-white', 'dip-black', 'light-leak', 'film-burn', 'glitch-cut', 'whip-left', 'spin-cw', 'slices-h', 'punch-in', 'block-left']) expect(CALM_SOFTENED_TRANSITIONS).toContain(id);
    expect(CALM_SOFTENED_TRANSITIONS).not.toContain('dissolve');
  });
});

describe('the dB table', () => {
  it('holds every integer dB from −20 to 0, each within 1e-15 of 10^(dB/20)', () => {
    expect(Object.keys(DB_GAIN).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, i) => i - 20));
    for (const [k, g] of Object.entries(DB_GAIN)) expect(Math.abs(g - 10 ** (Number(k) / 20)), k).toBeLessThan(1e-15);
  });
});

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
function base(): { doc: ProjectDocument; title: string; pic: string } {
  let doc = createProject({ id: 'prj_aud', name: 'A', width: 640, height: 360, frameRate: R });
  const r = applyTransaction(doc, [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(30) } }], { idSeed: 'aud_', actor: 'test' });
  doc = r.doc;
  return { doc, title: r.results[0]!.output!.clipId as string, pic: '' };
}
const withVariant = (doc: ProjectDocument, extra: Record<string, unknown>) => {
  const d = structuredClone(doc) as ProjectDocument;
  d.variants.var_a = { id: 'var_a', name: 'A', width: 640, height: 360, fit: 'contain', profileId: null, safeArea: null, overrides: {}, ...extra } as never;
  return d;
};
const codes = (d: ProjectDocument) => validateProject(d).map((i) => i.code);

describe('schema fields and their validation', () => {
  it('a version for an audience and kept rules parse and validate; nothing else changes for documents without them', () => {
    const { doc, title } = base();
    const d = withVariant(doc, { audience: { profile: 'grandparents', rules: 1, musicDb: -10, sound: { trk_x: 'music' } }, overrides: { [title]: { keep: ['effect', 'title_size'] } } });
    expect(ProjectSchema.safeParse(d).success).toBe(true);
    expect(codes(d)).toEqual([]);
    expect(codes(doc)).toEqual([]);
  });
  it('the schema refuses an unknown profile, another rule-table version, a level outside −20..0 or not whole, and an `applied` marker', () => {
    const { doc } = base();
    for (const audience of [{ profile: 'share', rules: 1 }, { profile: 'calm', rules: 2 }, { profile: 'calm', rules: 1, musicDb: 3 }, { profile: 'calm', rules: 1, musicDb: -6.5 }, { profile: 'calm', rules: 1, applied: true }])
      expect(ProjectSchema.safeParse(withVariant(doc, { audience })).success, JSON.stringify(audience)).toBe(false);
  });
  it('validation: exclusive with a translation; keep only in an audience version, keepable for its profile, each rule once', () => {
    const { doc, title } = base();
    expect(codes(withVariant(doc, { audience: { profile: 'calm', rules: 1 }, language: 'en' }))).toContain('audience_with_translation');
    expect(codes(withVariant(doc, { overrides: { [title]: { keep: ['effect'] } } }))).toEqual(['audience_keep_outside_version']);
    expect(codes(withVariant(doc, { audience: { profile: 'calm', rules: 1 }, overrides: { [title]: { keep: ['title_size'] } } }))).toEqual(['audience_keep_not_keepable']);
    expect(codes(withVariant(doc, { audience: { profile: 'calm', rules: 1 }, overrides: { [title]: { keep: ['effect', 'effect'] } } }))).toEqual(['audience_keep_duplicate']);
  });
  it('KEEPABLE: calm keeps the picture rules, grandparents also the title size; hasFormatOverride ignores keep (C14)', () => {
    expect(KEEPABLE.calm).toEqual(['effect', 'modulator', 'transition', 'text_loop']);
    expect(KEEPABLE.grandparents).toEqual([...KEEPABLE.calm, 'title_size']);
    for (const r of [...KEEPABLE.calm, ...KEEPABLE.grandparents]) expect(KEEP_RULES).toContain(r);
    expect(hasFormatOverride({ keep: ['effect'] })).toBe(false);
    expect(hasFormatOverride({ keep: ['effect'], hidden: true })).toBe(true);
    expect(hasFormatOverride(undefined)).toBe(false);
  });
});

const OPS = ['add_audience_version', 'update_audience_version', 'set_audience_keep'] as const;
const run = (doc: ProjectDocument, op: string, args: unknown) => applyTransaction(doc, [{ op, args }], { idSeed: 'aop_', actor: 'user:owner' });
const refused = (doc: ProjectDocument, op: string, args: unknown): OpError => { try { run(doc, op, args); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error(`${op} was accepted`); };

describe('the three operations', () => {
  it('are registered, public, and left out of the assistant', () => {
    for (const op of OPS) { expect(getOp(op), op).toBeTruthy(); expect(getOp(op)!.internal ?? false).toBe(false); expect(assistantOps()).not.toContain(op); }
  });
  it.runIf(!AUDIENCE_PROJECTION_BUILT)('refuse notBuilt and change nothing while the projection is not built', () => {
    const { doc, title } = base();
    const before = JSON.stringify(doc);
    for (const [op, args] of [['add_audience_version', { profile: 'calm' }], ['update_audience_version', { variantId: 'var_a', musicDb: -3 }], ['set_audience_keep', { variantId: 'var_a', clipId: title, rule: 'effect', keep: true }]] as const) {
      const e = refused(doc, op, args);
      expect(e.code).toBe('unknown_op');
      expect(e.message).toBe(AUDIENCE_REFUSALS.notBuilt.message(op));
      expect(e.hint).toBe(AUDIENCE_REFUSALS.notBuilt.hint);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
  it.runIf(AUDIENCE_PROJECTION_BUILT)('bodies: add over the master frame, update level and roles, keep and give back; every refusal in order', () => {
    const { doc, title } = base();
    const added = run(doc, 'add_audience_version', { profile: 'grandparents' });
    const id = added.results[0]!.output!.variantId as string;
    let d = added.doc;
    expect(d.variants[id]).toEqual({ id, name: 'For grandparents', width: 640, height: 360, fit: 'contain', profileId: null, safeArea: null, overrides: {}, audience: { profile: 'grandparents', rules: 1 } });
    const audio = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')!;
    const video = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!;
    d = run(d, 'update_audience_version', { variantId: id, musicDb: -12, sound: { trackId: audio.id, role: 'other' } }).doc;
    expect(d.variants[id]!.audience).toEqual({ profile: 'grandparents', rules: 1, musicDb: -12, sound: { [audio.id]: 'other' } });
    d = run(d, 'update_audience_version', { variantId: id, musicDb: null, sound: { trackId: audio.id, role: null } }).doc;
    expect(d.variants[id]!.audience).toEqual({ profile: 'grandparents', rules: 1 });
    d = run(d, 'set_audience_keep', { variantId: id, clipId: title, rule: 'title_size', keep: true }).doc;
    d = run(d, 'set_audience_keep', { variantId: id, clipId: title, rule: 'effect', keep: true }).doc;
    expect(d.variants[id]!.overrides[title]).toEqual({ keep: ['effect', 'title_size'] });
    expect(codes(d)).toEqual([]);
    d = run(d, 'set_audience_keep', { variantId: id, clipId: title, rule: 'effect', keep: false }).doc;
    d = run(d, 'set_audience_keep', { variantId: id, clipId: title, rule: 'title_size', keep: false }).doc;
    expect(d.variants[id]!.overrides).toEqual({});
    const calm = run(d, 'add_audience_version', { profile: 'calm', name: 'רגועה' });
    const cid = calm.results[0]!.output!.variantId as string;
    const fmt = withVariant(d, {});
    const msg = (k: keyof typeof AUDIENCE_REFUSALS, ...v: string[]) => (AUDIENCE_REFUSALS[k].message as (...a: string[]) => string)(...v);
    expect(refused(d, 'update_audience_version', { variantId: 'var_none' }).message).toBe(msg('notFound', 'var_none'));
    expect(refused(fmt, 'update_audience_version', { variantId: 'var_a' }).message).toBe(msg('notAudience', 'var_a'));
    expect(refused(d, 'update_audience_version', { variantId: id, sound: { trackId: 'trk_none', role: 'music' } }).message).toBe(msg('trackNotFound', 'trk_none'));
    expect(refused(d, 'update_audience_version', { variantId: id, sound: { trackId: video.id, role: 'music' } }).message).toBe(msg('trackNotSound', video.id));
    expect(refused(calm.doc, 'set_audience_keep', { variantId: cid, clipId: title, rule: 'title_size', keep: true }).message).toBe(msg('notKeepable', 'title_size', 'calm'));
    expect(refused(d, 'set_audience_keep', { variantId: id, clipId: 'clp_none', rule: 'effect', keep: true }).message).toBe(msg('clipNotFound', 'clp_none'));
    expect(refused(d, 'set_audience_keep', { variantId: id, clipId: title, rule: 'transition', keep: true }).message).toBe(msg('ruleNotForClip', 'transition', title));
  });
});

// ---------- W1: a small synthetic film (no file is read) ----------
const HASH = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
const PROV = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const LIB = { itemId: 'syn/song.wav', sourceId: 'syn', kind: 'music' as const, title: 'Song', sourceSha256: 'a'.repeat(64), ledger: { item: 'syn' }, licence: { id: 'CC0-1.0' }, credit: { text: 'Song (synthetic)', placement: 'description' as const }, flags: {} };
interface Film { doc: ProjectDocument; v1: string; v2: string; title: string; camera: string; music: string; captions: string; cue: string }
function film(): Film {
  let doc = createProject({ id: 'prj_w1', name: 'W1', width: 640, height: 360, frameRate: R });
  doc.assets.ast_v = { id: 'ast_v', kind: 'video', name: 'v.mp4', contentHash: HASH(1), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: PROV } as never;
  doc.assets.ast_m = { id: 'ast_m', kind: 'audio', name: 'm.wav', contentHash: HASH(2), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { ...PROV, origin: 'upload', library: LIB } } as never;
  const step = (op: string, args: Record<string, unknown>) => { const r = applyTransaction(doc, [{ op, args }], { idSeed: `w1${Object.keys(doc.assets).length}_${JSON.stringify(args).length}_${op}_`, actor: 'test' }); doc = r.doc; return r.results[0]!.output ?? {}; };
  const v1 = step('add_clip', { assetId: 'ast_v', start: f(0), duration: f(60) }).clipId as string;
  const v2 = step('add_clip', { assetId: 'ast_v', start: f(60), sourceIn: f(60), duration: f(60) }).clipId as string;
  const seq = () => doc.sequences[doc.mainSequenceId]!;
  const camera = seq().tracks.find((t) => t.kind === 'audio' && t.clips.length)!.id;
  const music = step('add_track', { kind: 'audio', name: 'music' }).trackId as string;
  step('add_clip', { assetId: 'ast_m', trackId: music, start: f(0), duration: f(120) });
  step('set_ducking', { trackId: music, sourceTrackIds: [camera], reductionDb: 10 });
  step('add_effect', { clipId: v1, type: 'light.strobe' });
  step('add_effect', { clipId: v1, type: 'color.grayscale' });
  const blur = step('add_effect', { clipId: v2, type: 'blur.gaussian' }).effectId as string;
  step('set_effect_modulator', { clipId: v2, effectId: blur, param: 'radius', modulator: { depth: 0.01 } });
  step('set_transition', { clipId: v2, type: 'flash', frames: 10 });
  const title = step('add_text', { text: 'שלום', start: f(0), duration: f(60) }).clipId as string;
  step('set_text_animation', { clipId: title, animation: { loop: 'jitter' } });
  const captions = step('add_caption_track', { mode: 'manual', style: { background: null, preset: 'karaoke' } }).trackId as string;
  const cue = step('add_cue', { start: f(10), duration: f(20), text: 'שלום לכולם' }).clipId as string;
  return { doc, v1, v2, title, camera, music, captions, cue };
}
const addVersion = (doc: ProjectDocument, profile: 'calm' | 'grandparents') => { const r = run(doc, 'add_audience_version', { profile }); return { doc: r.doc, id: r.results[0]!.output!.variantId as string }; };
const clipIn = (d: ProjectDocument, id: string) => Object.values(d.sequences).flatMap((s) => s.tracks).flatMap((t) => t.clips).find((c) => c.id === id)! as never as Record<string, any>;
const trackIn = (d: ProjectDocument, id: string) => Object.values(d.sequences).flatMap((s) => s.tracks).find((t) => t.id === id)!;
const hash = (d: ProjectDocument) => JSON.stringify(d);

describe('W1: the rules (audience.ts)', () => {
  it.runIf(AUDIENCE_PROJECTION_BUILT)('the W1 film is a valid document', () => { expect(codes(film().doc)).toEqual([]); });
  it('1: a calm version turns off every CALM_OFF_EFFECTS effect on picture and adjustment clips; the master document hash is unchanged', () => {
    const fm = film();
    // one adjustment clip with a shake over everything
    let doc = applyTransaction(fm.doc, [{ op: 'add_adjustment', args: { span: 'edit' } }], { idSeed: 'adj_', actor: 'test' }).doc;
    const adj = Object.values(doc.sequences).flatMap((s) => s.tracks).find((t) => t.kind === 'adjustment')!.clips[0]!.id;
    doc = applyTransaction(doc, [{ op: 'add_effect', args: { clipId: adj, type: 'motion.shake' } }], { idSeed: 'adj2_', actor: 'test' }).doc;
    const { doc: d, id } = addVersion(doc, 'calm');
    const before = hash(d);
    const p = projectVariant(d, id);
    expect(hash(d)).toBe(before);
    const fx = (c: string) => (clipIn(p, c).effects as { type: string; enabled: boolean }[]).map((e) => [e.type, e.enabled]);
    expect(fx(fm.v1)).toEqual([['light.strobe', false], ['color.grayscale', true]]);
    expect(fx(adj)).toEqual([['motion.shake', false]]);
    for (const c of Object.values(p.sequences).flatMap((s) => s.tracks).flatMap((t) => t.clips)) for (const e of c.effects ?? []) if (e.enabled) expect(CALM_OFF_EFFECTS).not.toContain(e.type);
    expect(fx(fm.v1).map(([t]) => t)).toEqual(['light.strobe', 'color.grayscale']); // nothing removed, only turned off
    expect((clipIn(d, fm.v1).effects as { enabled: boolean }[]).every((e) => e.enabled)).toBe(true); // the master keeps them
  });
  it('2: every softened transition becomes a dissolve with the same frames and no velocity, colour or seed; projected calm and grandparents documents pass validateProject', () => {
    const fm = film();
    for (const type of CALM_SOFTENED_TRANSITIONS) {
      const d0 = structuredClone(fm.doc);
      const opts = (TRANSITIONS.find((t) => t.id === type)!.options ?? []) as readonly string[];
      clipIn(d0, fm.v2).transition = { type, frames: 12, sync: 'beat', velocity: 3, ...(opts.includes('color') ? { color: '#FF0000' } : {}), ...(opts.includes('seed') ? { seed: 7 } : {}) };
      expect(codes(d0), type).toEqual([]);
      for (const profile of ['calm', 'grandparents'] as const) {
        const { doc, id } = addVersion(d0, profile);
        const p = projectVariant(doc, id);
        expect(clipIn(p, fm.v2).transition, `${type} ${profile}`).toEqual({ type: 'dissolve', frames: 12, sync: 'beat' });
        expect(codes(p), `${type} ${profile}`).toEqual([]);
      }
    }
    const d1 = structuredClone(fm.doc);
    clipIn(d1, fm.v2).transition = { type: 'wipe-left', frames: 9 };
    const { doc, id } = addVersion(d1, 'calm');
    expect(clipIn(projectVariant(doc, id), fm.v2).transition).toEqual({ type: 'wipe-left', frames: 9 }); // a calm transition stays
  });
  it('3: a strobe added to the master after the version exists is off in the version, with no op on the variant', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'calm');
    const variantBefore = JSON.stringify(doc.variants[id]);
    const r = applyTransaction(doc, [{ op: 'add_effect', args: { clipId: fm.v2, type: 'light.strobe' } }], { idSeed: 'late_', actor: 'test' });
    expect(JSON.stringify(r.doc.variants[id])).toBe(variantBefore);
    const fx = (clipIn(projectVariant(r.doc, id), fm.v2).effects as { type: string; enabled: boolean }[]).find((e) => e.type === 'light.strobe')!;
    expect(fx.enabled).toBe(false);
    expect((clipIn(r.doc, fm.v2).effects as { type: string; enabled: boolean }[]).find((e) => e.type === 'light.strobe')!.enabled).toBe(true);
  });
  it('4: a kept strobe stays on; a split of that clip keeps the exception on both pieces; undo returns the exact document hash', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'calm');
    const kept = applyTransaction(doc, [{ op: 'set_audience_keep', args: { variantId: id, clipId: fm.v1, rule: 'effect', keep: true } }], { idSeed: 'keep_', actor: 'user:owner' });
    const strobe = (d: ProjectDocument, c: string) => (clipIn(projectVariant(d, id), c).effects as { type: string; enabled: boolean }[]).find((e) => e.type === 'light.strobe')!.enabled;
    expect(strobe(kept.doc, fm.v1)).toBe(true);
    const split = applyTransaction(kept.doc, [{ op: 'split_clip', args: { clipId: fm.v1, at: f(30) } }], { idSeed: 'split_', actor: 'test' });
    const pieces = trackIn(split.doc, Object.values(split.doc.sequences).flatMap((s) => s.tracks).find((t) => t.clips.some((c) => c.id === fm.v1))!.id).clips.filter((c) => T.lt(c.start, f(60)));
    expect(pieces.length).toBe(2);
    for (const c of pieces) { expect(split.doc.variants[id]!.overrides[c.id]?.keep).toEqual(['effect']); expect(strobe(split.doc, c.id)).toBe(true); }
    // undo of the keep: the entity diff applied backwards restores the document exactly
    const back = structuredClone(kept.doc);
    restoreEntities(back, diffEntities(doc, kept.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
    expect(strobe(back, fm.v1)).toBe(false);
  });
  it('5: grandparents titles and captions are ×4/3 within their caps; the music track gain equals DB_GAIN[−8] × master; ducking +6 dB only on an already ducked track; a speech track is unchanged; the owner\'s role correction wins', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'grandparents');
    const p = projectVariant(doc, id);
    expect(clipIn(p, fm.title).style.sizeFrac).toBe(Math.min(0.5, (clipIn(doc, fm.title).style.sizeFrac * 4) / 3));
    const cs = trackIn(p, fm.captions).caption!.style, ms = trackIn(doc, fm.captions).caption!.style;
    expect(cs.sizeFrac).toBe(Math.min(0.2, (ms.sizeFrac * 4) / 3));
    expect(cs.maxCharsPerLine).toBe(Math.min(ms.maxCharsPerLine, 26));
    expect([ms.background, cs.background, ms.preset, cs.preset]).toEqual([null, '#000000B3', 'karaoke', 'classic']);
    const masterGain = trackIn(doc, fm.music).audio?.gain ?? 1;
    expect(trackIn(p, fm.music).audio!.gain).toBe(masterGain * DB_GAIN[-8]!);
    expect(trackIn(p, fm.music).audio!.duck!.reductionDb).toBe(16);
    expect(trackIn(p, fm.camera)).toEqual(trackIn(doc, fm.camera)); // the duck source: speech, unchanged
    // a big master title stays within the cap
    const big = structuredClone(doc); clipIn(big, fm.title).style.sizeFrac = 0.45;
    expect(clipIn(projectVariant(big, id), fm.title).style.sizeFrac).toBe(0.5);
    // the owner says the music track is other: nothing on it changes
    const corrected = run(doc, 'update_audience_version', { variantId: id, sound: { trackId: fm.music, role: 'other' } }).doc;
    expect(trackIn(projectVariant(corrected, id), fm.music)).toEqual(trackIn(doc, fm.music));
    // and that the camera track is music: it is lowered, and not ducked deeper (it has no ducking of its own)
    const cam = run(doc, 'update_audience_version', { variantId: id, sound: { trackId: fm.camera, role: 'music' } }).doc;
    const camP = trackIn(projectVariant(cam, id), fm.camera);
    expect([camP.audio!.gain, camP.audio!.duck]).toEqual([DB_GAIN[-8], trackIn(doc, fm.camera).audio?.duck ?? null]);
    // calm: −6 dB and no deeper ducking
    const calm = addVersion(fm.doc, 'calm');
    const cp = trackIn(projectVariant(calm.doc, calm.id), fm.music);
    expect([cp.audio!.gain, cp.audio!.duck!.reductionDb]).toEqual([masterGain * DB_GAIN[-6]!, 10]);
  });
  it('C3: a size the version sets itself is absolute — set 0.08 through set_variant_override, read 0.08 from the projection (set-then-read round trip); only an inherited size is scaled', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'grandparents');
    const inherited = clipIn(projectVariant(doc, id), fm.title).style.sizeFrac as number;
    expect(inherited).toBe((0.06 * 4) / 3);
    const set = run(doc, 'set_variant_override', { variantId: id, clipId: fm.title, textStyle: { sizeFrac: 0.08 } }).doc;
    expect(clipIn(projectVariant(set, id), fm.title).style.sizeFrac).toBe(0.08);
    // the inspector's write-back: commit the projected value as the version's own size; reading it again gives the same number
    const back = run(doc, 'set_variant_override', { variantId: id, clipId: fm.title, textStyle: { sizeFrac: inherited } }).doc;
    expect(clipIn(projectVariant(back, id), fm.title).style.sizeFrac).toBe(inherited);
    expect(clipIn(projectVariant(projectVariant(back, id), id), fm.title).style.sizeFrac).toBe(inherited); // ×4/3 never twice, even projected again
  });
  it('C3: audienceCaptionSize leaves the version\'s own captionStyle.sizeFrac as set', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'grandparents');
    const own = run(doc, 'update_variant', { variantId: id, captionStyle: { sizeFrac: 0.05, maxCharsPerLine: 40, background: null, preset: 'word-pop' } }).doc;
    const st = trackIn(projectVariant(own, id), fm.captions).caption!.style;
    expect([st.sizeFrac, st.maxCharsPerLine, st.background, st.preset]).toEqual([0.05, 40, null, 'word-pop']);
    expect(audienceCaptionSize(0.045, 0.05, 'grandparents')).toBe(0.05);
    expect(audienceCaptionSize(0.045, undefined, 'grandparents')).toBe(0.06);
    expect(audienceCaptionSize(0.045, undefined, 'calm')).toBe(0.045);
    expect(audienceCaptionSize(0.3, undefined, 'grandparents')).toBe(0.3); // above the cap already: never made smaller
  });
  it('C13: soundRoleOf — a track of library music, built-in and fitted music is music; one camera-sound clip on it makes it mixed (other); a duck source is speech; a track that ducks under narration is NOT music by that alone; first rule wins in SOUND_ROLE_ORDER', () => {
    const fm = film();
    const d = structuredClone(fm.doc);
    d.assets.ast_b = { ...d.assets.ast_m!, id: 'ast_b', contentHash: HASH(3), provenance: { ...PROV, origin: 'generated', procedural: { id: 'music.calm', version: 1, generator: 'x' } } } as never;
    d.assets.ast_f = { ...d.assets.ast_m!, id: 'ast_f', contentHash: HASH(4), provenance: { ...PROV, origin: 'derived', fitted: {} } } as never;
    const tr = trackIn(d, fm.music);
    const base = tr.clips[0]!;
    tr.clips = [{ ...base, duration: f(40) }, { ...base, id: 'clp_b', start: f(40), duration: f(40), assetId: 'ast_b' } as never, { ...base, id: 'clp_f', start: f(80), duration: f(40), assetId: 'ast_f' } as never];
    expect(soundRoleOf(d, tr)).toEqual({ trackId: fm.music, role: 'music', why: 'music_files' });
    tr.clips[2] = { ...tr.clips[2]!, assetId: 'ast_v' } as never;
    expect(soundRoleOf(d, tr)).toEqual({ trackId: fm.music, role: 'other', why: 'mixed' });
    expect(soundRoleOf(d, trackIn(d, fm.camera))).toEqual({ trackId: fm.camera, role: 'speech', why: 'duck_source' });
    // camera sound ducked under a narration track: ducked, but not music
    const n = structuredClone(fm.doc);
    n.assets.ast_n = { ...n.assets.ast_m!, id: 'ast_n', contentHash: HASH(5), provenance: { ...PROV, voice: { jobId: 'j', engine: 'e', model: 'm', language: 'he', text: 'שלום', seed: 1, voice: 'built-in', watermark: null } } } as never;
    const mt = trackIn(n, fm.music);
    mt.clips[0] = { ...mt.clips[0]!, assetId: 'ast_n' } as never;
    mt.audio = { gain: 1, pan: 0, duck: null };
    trackIn(n, fm.camera).audio = { gain: 1, pan: 0, duck: { sourceTrackIds: [fm.music], reductionDb: 10, attackMs: 50, releaseMs: 300 } };
    expect(soundRoleOf(n, trackIn(n, fm.camera))).toEqual({ trackId: fm.camera, role: 'other', why: 'unknown' });
    expect(soundRoleOf(n, mt)).toEqual({ trackId: fm.music, role: 'speech', why: 'duck_source' }); // duck_source comes before narration
    expect(soundRoleOf(n, { ...trackIn(n, fm.camera), clips: [] })).toEqual({ trackId: fm.camera, role: 'other', why: 'empty' });
    // the owner first
    expect(soundRoleOf(d, trackIn(d, fm.camera), { profile: 'calm', rules: 1, sound: { [fm.camera]: 'music' } })).toEqual({ trackId: fm.camera, role: 'music', why: 'owner' });
    expect(SOUND_ROLE_ORDER[0]).toBe('owner');
  });
  it('C1: every rule is a pure function of (master, variant): two projections of the same master and variant are byte-identical (property over random documents)', () => {
    // the random documents are in audience.property.test.ts; here the film with both profiles and kept rules
    const fm = film();
    for (const profile of ['calm', 'grandparents'] as const) {
      const { doc, id } = addVersion(fm.doc, profile);
      const k = run(doc, 'set_audience_keep', { variantId: id, clipId: fm.title, rule: 'text_loop', keep: true }).doc;
      expect(hash(projectVariant(k, id))).toBe(hash(projectVariant(k, id)));
      expect(hash(projectVariant(structuredClone(k), id))).toBe(hash(projectVariant(k, id)));
    }
  });
  it('C7: applyAudience never throws (property over random documents, unknown ids and kept rules on deleted clips)', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'grandparents');
    let d = run(doc, 'set_audience_keep', { variantId: id, clipId: fm.v1, rule: 'effect', keep: true }).doc;
    d = run(d, 'update_audience_version', { variantId: id, sound: { trackId: fm.music, role: 'other' } }).doc;
    d = applyTransaction(d, [{ op: 'delete_clip', args: { clipId: fm.v1, includeLinked: true } }], { idSeed: 'del_', actor: 'test' }).doc;
    expect(d.variants[id]!.overrides[fm.v1]?.keep).toEqual(['effect']); // a dangling entry, as every format's overrides outlive their clips
    expect(codes(d)).toEqual([]);
    const v = structuredClone(d.variants[id]!);
    v.overrides.clp_unknown = { keep: ['transition', 'title_size'] };
    v.audience!.sound = { trk_unknown: 'music' };
    expect(() => applyAudience(projectVariant(d, id), v, [])).not.toThrow();
    expect(codes(projectVariant(d, id))).toEqual([]);
  });
  it('9: every change\'s jump frame lies inside its clip; kept items are listed with kept true; the count of changes equals the rule applications', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'grandparents');
    const k = run(doc, 'set_audience_keep', { variantId: id, clipId: fm.v2, rule: 'transition', keep: true }).doc;
    const list = audienceChanges(k, id, 7);
    const rows = list.changes.map((c) => `${c.rule}:${c.clipId ?? c.trackId}:${c.kept}`).sort();
    expect(rows).toEqual([
      `caption_look:${fm.captions}:false`, `caption_look:${fm.captions}:false`, `caption_look:${fm.captions}:false`, `caption_look:${fm.captions}:false`,
      `ducking:${fm.music}:false`, `effect:${fm.v1}:false`, `modulator:${fm.v2}:false`, `music_level:${fm.music}:false`,
      `text_loop:${fm.title}:false`, `title_size:${fm.title}:false`, `transition:${fm.v2}:true`,
    ].sort());
    const rate = k.settings.frameRate;
    for (const c of list.changes) {
      const clip = c.clipId ? clipIn(k, c.clipId) : (trackIn(k, c.trackId!).clips[0] as never as Record<string, any> | undefined);
      if (!clip) { expect([c.startFrame, c.endFrame]).toEqual([0, 1]); continue; }
      expect(c.startFrame, c.key).toBeGreaterThanOrEqual(T.frameIndexAt(clip.start, rate));
      expect(c.startFrame, c.key).toBeLessThan(T.frameIndexAt(T.add(clip.start, clip.duration), rate));
      expect(c.endFrame, c.key).toBeGreaterThan(c.startFrame);
    }
    expect(list.changes.find((c) => c.rule === 'transition')).toMatchObject({ kept: true, keepable: true, before: 'flash', after: 'dissolve' });
    expect(clipIn(projectVariant(k, id), fm.v2).transition.type).toBe('flash'); // kept: not applied
    expect(new Set(list.changes.map((c) => c.key)).size).toBe(list.changes.length);
    expect(list.changes.map((c) => c.key)).toEqual(audienceChanges(k, id, 7).changes.map((c) => c.key)); // stable within one revision
    expect([list.revision, list.profile, list.rules, list.musicDb, list.notHandled, list.method]).toEqual([7, 'grandparents', 1, -8, AUDIENCE_NOT_HANDLED, AUDIENCE_CHANGES_METHOD]);
    expect(() => audienceChanges(k, 'var_none', 7)).toThrow(Error);
    expect(() => audienceChanges(withVariant(k, {}), 'var_a', 7)).toThrow(Error);
  });
  it('the list agrees with the picture: audienceChanges and projectVariant come from the same pass', () => {
    const fm = film();
    const { doc, id } = addVersion(fm.doc, 'grandparents');
    const report: AudienceChange[] = [];
    const p = projectVariant(doc, id, report);
    expect(hash(p)).toBe(hash(projectVariant(doc, id))); // a report changes nothing in the document
    expect(audienceChanges(doc, id, 1).changes).toEqual(report);
    for (const c of report.filter((r) => !r.kept)) {
      if (c.rule === 'title_size') expect(clipIn(p, c.clipId!).style.sizeFrac).toBe(c.after);
      if (c.rule === 'music_level') expect(trackIn(p, c.trackId!).audio!.gain).toBe(c.after);
      if (c.rule === 'ducking') expect(trackIn(p, c.trackId!).audio!.duck!.reductionDb).toBe(c.after);
      if (c.rule === 'transition') expect(clipIn(p, c.clipId!).transition.type).toBe(c.after);
      if (c.rule === 'caption_look') expect((trackIn(p, c.trackId!).caption!.style as Record<string, unknown>)[c.key.split(':')[2]!]).toBe(c.after);
    }
  });
});
