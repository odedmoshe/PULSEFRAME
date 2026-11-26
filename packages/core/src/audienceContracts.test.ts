/**
 * Lead contracts of «גרסה לכל קהל» (wave 8 audiences): the exhaustive stir classification of every effect and transition row
 * (verifier C12 — fails when a registry row is added without a class, or a class changes without review here), the dB table, the
 * schema fields and their validation, the three operations (registered, refusing notBuilt until W1 builds the projection; their bodies
 * are tested here and run once AUDIENCE_PROJECTION_BUILT is true), and the todo list of what W1 must make pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, AUDIENCE_PROJECTION_BUILT, AUDIENCE_REFUSALS, CALM_OFF_EFFECTS, CALM_SOFTENED_TRANSITIONS, createProject, DB_GAIN, EFFECTS, getOp,
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
  // «תמונה חיה» (wave 8 living, verifier C12): unsure — parallax; capped by LIVING_MAX_RATE, gentler than the Ken Burns both versions keep
  'depth.living': 'none',
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
    expect([EFFECTS.length, TRANSITIONS.length]).toEqual([54, 69]);
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

describe('W1: the rules (audience.ts)', () => {
  it.todo('1: a calm version turns off every CALM_OFF_EFFECTS effect on picture and adjustment clips; the master document hash is unchanged');
  it.todo('2: every softened transition becomes a dissolve with the same frames and no velocity, colour or seed; projected calm and grandparents documents pass validateProject');
  it.todo('3: a strobe added to the master after the version exists is off in the version, with no op on the variant');
  it.todo('4: a kept strobe stays on; a split of that clip keeps the exception on both pieces; undo returns the exact document hash');
  it.todo('5: grandparents titles and captions are ×4/3 within their caps; the music track gain equals DB_GAIN[−8] × master; ducking +6 dB only on an already ducked track; a speech track is unchanged; the owner\'s role correction wins');
  it.todo('C3: a size the version sets itself is absolute — set 0.08 through set_variant_override, read 0.08 from the projection (set-then-read round trip); only an inherited size is scaled');
  it.todo('C3: audienceCaptionSize leaves the version\'s own captionStyle.sizeFrac as set');
  it.todo('C13: soundRoleOf — a track of library music, built-in and fitted music is music; one camera-sound clip on it makes it mixed (other); a duck source is speech; a track that ducks under narration is NOT music by that alone; first rule wins in SOUND_ROLE_ORDER');
  it.todo('C1: every rule is a pure function of (master, variant): two projections of the same master and variant are byte-identical (property over random documents)');
  it.todo('C7: applyAudience never throws (property over random documents, unknown ids and kept rules on deleted clips)');
  it.todo('9: every change\'s jump frame lies inside its clip; kept items are listed with kept true; the count of changes equals the rule applications');
  it.todo('the list agrees with the picture: audienceChanges and projectVariant come from the same pass');
});
