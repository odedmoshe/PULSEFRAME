/**
 * Plans of the command bar (ADR-0027, plan §4.4–4.5, §8 W1 "Plans"): every emitted op is registered and public; every plan
 * passes its own dry run; identical input gives byte-identical plans; delete equals deleteOps byte for byte; gain +3 dB
 * from 1 is 1.412538 and the ceiling is refused; the transitions planner leaves out handle-less cuts by name and refuses
 * more than 200; the ops are injected before the dry run and the hash; a refused op is refused with its own code.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, BAR_PREVIEW_OPTIONS, barPlanHash, COMMAND_BAR_LABEL, createProject, deleteOps, getOp, INTENT_IDS, MAX_BAR_OPS, rippleDeleteOn,
  type BarPlan, type BarResult, type OpCall, type ProjectDocument,
} from '../index.ts';
import { interpret } from './index.ts';
import { INTENT_EXAMPLES } from './lexicon.ts';
import { gainAfter } from './plans.ts';
import { context, ctxFor, fixture, R30, tx, variants } from './fixture.testFixture.ts';

const fx = fixture();
/** Every plan inside a result (a plan, or the plans among its choices). */
const plansIn = (r: BarResult): BarPlan[] => (r.kind === 'plan' ? [r] : r.kind === 'ambiguous' || r.kind === 'refused' ? (r.choices ?? []).flatMap((c) => plansIn(c.result)) : []);
const allExamples = INTENT_IDS.flatMap((intent) => [...INTENT_EXAMPLES[intent].he, ...INTENT_EXAMPLES[intent].en].map((text) => ({ intent, text })));
const EXTRA = ['פצל כאן', 'מחק את הקליפ', 'החל מראה חם על הקליפ', 'הגבר את הקול ב־3 דציבל', 'הוסף כותרת "x" ב־3 שניות', 'סנכרן לקצב', 'הוסף מעבר דרך שחור בין כל הקליפים'];

describe('every plan', () => {
  const cases: { text: string; r: BarResult; doc: ProjectDocument }[] = [
    ...allExamples.map(({ intent, text }) => { const c = ctxFor(intent); return { text, r: interpret(text, c), doc: c.rawDoc }; }),
    ...EXTRA.flatMap((text) => [context(fx.doc, { selection: [fx.c1, fx.c3] }), context(fx.doc), context(fx.doc, { selection: [fx.c2] })].map((c) => ({ text, r: interpret(text, c), doc: c.rawDoc }))),
  ];
  const plans = cases.flatMap((c) => plansIn(c.r).map((p) => ({ ...c, p })));
  it('there are plans to check', () => expect(plans.length).toBeGreaterThan(60));
  it('emits only registered, public ops', () => {
    for (const { text, p } of plans) for (const op of p.ops) { expect(getOp(op.op), `${text}: ${op.op}`).toBeTruthy(); expect(getOp(op.op)!.internal, `${text}: ${op.op}`).toBeFalsy(); }
  });
  it('passes its own dry run on the fixture, with the bar\'s options', () => {
    for (const { text, p, doc } of plans) expect(() => applyTransaction(doc, p.ops, { ...BAR_PREVIEW_OPTIONS }), text).not.toThrow();
  });
  it('has one step per op, the intent label, the basis revision and the hash of exactly its ops', () => {
    for (const { text, p } of plans) {
      expect(p.steps.length, text).toBe(p.ops.length);
      expect(p.steps.map((s) => s.op), text).toEqual(p.ops.map((o) => o.op));
      expect(p.label).toBe(COMMAND_BAR_LABEL(p.intent));
      expect(p.label).not.toContain(text);
      expect(p.basisRevision).toBe(7);
      expect(p.planHash).toBe(barPlanHash(p.intent, p.ops, 7));
      expect(p.ops.length).toBeLessThanOrEqual(MAX_BAR_OPS);
    }
  });
  it('is byte-identical for identical input (same context twice, and a freshly built fixture)', () => {
    const fresh = fixture();
    for (const { intent, text } of allExamples) {
      const a = JSON.stringify(interpret(text, ctxFor(intent)));
      expect(JSON.stringify(interpret(text, ctxFor(intent))), text).toBe(a);
      expect(JSON.stringify(interpret(text, ctxFor(intent, fresh))), text).toBe(a);
    }
  });
});

describe('delete is the Delete key', () => {
  it('equals deleteOps(doc, selection, rippleDeleteOn(doc)) byte for byte, and Shift+Delete\'s keep-gap form', () => {
    for (const sel of [[fx.c2], [fx.c1, fx.c3], [fx.c2, fx.c2a], [fx.title]]) {
      const c = context(fx.doc, { selection: sel });
      const r = interpret('מחק', c) as BarPlan;
      expect(JSON.stringify(r.ops), sel.join()).toBe(JSON.stringify(deleteOps(fx.doc, sel, rippleDeleteOn(fx.doc))!.ops));
      const k = interpret('מחק והשאר רווח', c) as BarPlan;
      expect(JSON.stringify(k.ops), sel.join()).toBe(JSON.stringify(deleteOps(fx.doc, sel, false)!.ops));
    }
  });
  it('«מחק את הקליפים» with nothing selected deletes every clip on unlocked tracks, the title and the music too, as deleteOps does', () => {
    for (const text of ['מחק את הקליפים', 'מחקי את הקליפים', 'delete the clips']) {
      const c = context(fx.doc, { selection: [] });
      const r = interpret(text, c) as BarPlan;
      expect(r.kind, text).toBe('plan');
      const all = fx.doc.sequences.seq_main!.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.map((x) => x.id));
      const after = applyTransaction(c.rawDoc, r.ops, { ...BAR_PREVIEW_OPTIONS }).doc;
      const left = after.sequences.seq_main!.tracks.flatMap((t) => t.clips.map((x) => x.id)).filter((id) => all.includes(id));
      expect(left, text).toEqual([]); // nothing left behind silently (the title and the song were, before deleteOps was fixed)
      expect(r.steps.map((s) => s.op), text).toEqual(r.ops.map((o) => o.op));
    }
    // a locked track is left alone and named
    const locked = interpret('מחק את הקליפים', context(variants.lockedTrack(fx.doc, fx.musicTrack), { selection: [] })) as BarPlan;
    expect(JSON.stringify(locked.ops)).not.toContain(fx.song);
    expect(locked.notes.map((n) => n.code)).toContain('skipped_locked');
  });
  it('says how many later clips move', () => {
    const r = interpret('מחק את הקליפ', context(fx.doc, { selection: [fx.c2] })) as BarPlan;
    expect(r.notes).toContainEqual({ code: 'ripple_moves', data: { moved: deleteOps(fx.doc, [fx.c2], true)!.moved } });
  });
});

describe('gain', () => {
  it('+3 dB from 1 is 1.412538 (rounded to 1e-6), −6 dB from 1 is 0.501187', () => {
    expect(gainAfter(1, { num: 3n, den: 1n })).toBe(1.412538);
    expect(gainAfter(1, { num: -6n, den: 1n })).toBe(0.501187);
    const r = interpret('הגבר את המוזיקה ב־3 דציבל', context(fx.doc)) as BarPlan;
    expect(r.ops).toEqual([{ op: 'set_track_audio', args: { trackId: fx.musicTrack, gain: 1.412538 } }]);
    expect(r.steps[0]!.detail).toEqual({ kind: 'gain', fromLinear: 1, toLinear: 1.412538, db: '+3' });
  });
  it('refuses the op\'s ceiling in words (×4 for a track), never clamps', () => {
    expect(interpret('הגבר את המוזיקה ב־20 דציבל', context(fx.doc))).toMatchObject({ kind: 'refused', code: 'gain_ceiling' });
    expect(interpret('הגבר את המוזיקה ב־12 דציבל', context(fx.doc))).toMatchObject({ kind: 'plan' }); // 3.981072 ≤ 4
  });
});

describe('transitions between all clips', () => {
  it('leaves out, and names, the cut without enough material; keeps existing transitions', () => {
    const r = interpret('הוסף מעבר בין כל הקליפים', context(fx.doc)) as BarPlan;
    expect(r.ops.map((o) => (o.args as { clipId: string }).clipId)).toEqual([fx.c2, fx.c3, fx.c5]);
    const skipped = r.notes.find((n) => n.code === 'skipped_no_handle')!.data.clips as { clipId: string; name: string }[];
    expect(skipped.map((s) => [s.clipId, s.name])).toEqual([[fx.c4, 'a.mp4']]);
    expect(r.steps[0]!.detail).toEqual({ kind: 'transition', type: 'dissolve', frames: 15, clipId: fx.c2, name: 'b.mp4' });
    // after it, the same request keeps the three and adds nothing
    const after = applyTransaction(fx.doc, r.ops, { idSeed: 't_', actor: 'user:local' }).doc;
    const again = interpret('הוסף מעבר בין כל הקליפים', context(after));
    expect(again).toMatchObject({ kind: 'refused', code: 'nothing_to_do' });
  });
  it('a named type («דרך שחור») is used, half a second rounded once to frames (13 at 25 fps)', () => {
    const r = interpret('הוסף מעבר דרך שחור בין כל הקליפים', context(fixture({ num: 25, den: 1 }).doc)) as BarPlan;
    expect(r.ops.every((o) => (o.args as { type: string; frames: number }).type === 'dip-black' && (o.args as { frames: number }).frames === 13)).toBe(true);
  });
  it('refuses more than 200 cuts rather than splitting them into several undos', () => {
    const img = { kind: 'image' as const, name: 'p.jpg', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.rt(0, 1), video: { width: 10, height: 10, frameRate: R30, codec: 'mjpeg', rotation: 0, frameCount: 1 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' } };
    let r = tx(createProject({ id: 'prj_many', name: 'Many', frameRate: R30 }), [{ op: 'import_asset', args: { asset: img } }], 'm0_', true);
    const id = r.results[0]!.output!.assetId as string;
    const adds: OpCall[] = Array.from({ length: MAX_BAR_OPS + 2 }, (_, k) => ({ op: 'add_clip', args: { assetId: id, trackId: 'trk_video', start: T.frameTime(k * 20, R30), duration: T.frameTime(20, R30) } }));
    r = tx(r.doc, adds, 'm1_');
    expect(interpret('הוסף מעבר בין כל הקליפים', context(r.doc))).toMatchObject({ kind: 'refused', code: 'too_many_ops' });
  }, 60_000);
});

describe('injection, the dry run and refusals', () => {
  it('passes every op through ctx.inject, dry-runs and hashes the injected ops', () => {
    const inject = (c: OpCall): OpCall => (getOp(c.op)!.args as unknown as { shape: Record<string, unknown> }).shape.sequenceId !== undefined ? { ...c, args: { ...(c.args as object), sequenceId: 'seq_main' } } : c;
    const r = interpret('הוסף כותרת "x" כאן', context(fx.doc, { inject })) as BarPlan;
    expect(r.ops[0]!.args).toMatchObject({ sequenceId: 'seq_main' });
    expect(r.planHash).toBe(barPlanHash('add_title', r.ops, 7));
  });
  it('an op that would be refused gives refused with the op\'s own code and message, and no preview', () => {
    const r = interpret('סגור רווחים', context(fx.doc));
    expect(r).toMatchObject({ kind: 'refused', code: 'op_refused', opError: { code: 'not_found', index: 0 } });
    expect((r as { opError: { message: string } }).opError.message).toBe('there is no empty time to close');
    expect(interpret('האט פי 2', context(fx.doc, { selection: [fx.c2] }))).toMatchObject({ kind: 'refused', opError: { code: 'overlap' } });
  });
  it('rounding is shown: «בשנייה 3» at 30000/1001 is stored as frameTime(90) with a rounded note', () => {
    const rate = { num: 30000, den: 1001 };
    const f = fixture(rate);
    const r = interpret('הוסף כותרת "x" בשנייה 3', context(f.doc)) as BarPlan;
    expect(T.eq((r.ops[0]!.args as { start: T.RationalTime }).start, T.frameTime(90, rate))).toBe(true);
    expect(r.notes).toContainEqual({ code: 'rounded_to_frame', data: { field: 'start', frame: 90, time: T.frameTime(90, rate), seconds: '3' } });
  });
  it('a timecode copied from the editor at 30000/1001 is the frame it names, as a position and after «מכאן»', () => {
    const rate = { num: 30000, den: 1001 };
    const f = fixture(rate);
    const tc = T.toTimecode(T.frameTime(300, rate), rate); // 00:00:10:00
    const r = interpret(`הוסף סמן ב־${tc}`, context(f.doc)) as BarPlan;
    expect(r.kind).toBe('plan');
    expect(T.eq((r.ops[0]!.args as { time: T.RationalTime }).time, T.frameTime(300, rate))).toBe(true);
    expect(r.notes.map((n) => n.code)).not.toContain('rounded_to_frame');
    const rel = interpret('הוסף סמן אחרי 00:00:01:12 מכאן', context(f.doc, { playheadFrame: 100 })) as BarPlan;
    expect(T.eq((rel.ops[0]!.args as { time: T.RationalTime }).time, T.frameTime(100 + 30 + 12, rate))).toBe(true);
    expect(interpret('הוסף סמן ב־00:00:01:30', context(f.doc))).toMatchObject({ kind: 'refused', code: 'out_of_range' });
  });
  it('a linked format being viewed is noted: the change applies to the original', () => {
    const r = interpret('הוסף סמן', context(fx.doc, { viewVariantId: 'var_9x16' })) as BarPlan;
    expect(r.notes).toContainEqual({ code: 'applies_to_master', data: { variantId: 'var_9x16' } });
  });
  it('speed: a factor on the current speed, an absolute value, and the 0.1–8 range', () => {
    const c = context(variants.roomy(fx), { selection: [fx.c4], playheadFrame: 300 });
    expect((interpret('האט פי 2', c) as BarPlan).steps[0]!.detail).toEqual({ kind: 'speed', from: 1, to: 0.5 });
    expect(interpret('מהירות 20', c)).toMatchObject({ kind: 'refused', code: 'out_of_range' });
    expect(interpret('מהירות 1', c)).toMatchObject({ kind: 'refused', code: 'nothing_to_do' });
  });
  it('fades go on the sound of the clip; a length a frame long or more', () => {
    const r = interpret('עמעום בסוף של שנייה', context(fx.doc, { selection: [fx.c2] })) as BarPlan;
    expect(r.ops).toEqual([{ op: 'set_clip_fades', args: { clipId: fx.c2a, fadeOut: { value: '1', timescale: 1 } } }]);
    expect(r.steps[0]!.detail).toEqual({ kind: 'span', fromFrame: 150, toFrame: 180 });
  });
});
