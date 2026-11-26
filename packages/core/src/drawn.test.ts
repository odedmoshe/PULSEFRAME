/**
 * The drawn-clip carrier (wave 8, drawn.ts) with the TEST-ONLY kind of drawn.testKind.ts: the registry decides what a document
 * may hold, a drawn clip lives on a text track, every text op refuses it with drawn_not_text, placement edits treat it like a
 * title, and split / trim-start keep its content continuous through the kind's shift. Each accepted edit leaves a valid project
 * whose entity diff applied backwards restores the previous one exactly (undo).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, drawnKinds, drawnSummary, isDrawnClip, OpError, ProjectSchema, restoreEntities,
  timeline, unregisterDrawnKind, validateProject, type DrawnClip, type OpCall, type ProjectDocument,
} from './index.ts';
import { registerTestDrawnOp, testDrawn } from './drawn.testKind.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `drw${n++}_`, actor: 'test', allowInternal: true });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const clips = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips.map((clip) => ({ track: t, clip })));
const drawnOf = (doc: ProjectDocument) => clips(doc).filter((x) => isDrawnClip(x.clip)).map((x) => x.clip as DrawnClip);
function acceptAndUndo(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const back = structuredClone(r.doc);
  restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  return r;
}

/** A title at 0…60 and a test shape at 30…120 on another text track (the title's track is busy there). */
function edit() {
  registerTestDrawnOp();
  let r = tx(createProject({ id: 'prj_drawn', name: 'D', width: 640, height: 360 }), [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }]);
  const titleId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_test_drawn', args: { start: f(30), duration: f(90), drawn: testDrawn({ offset: 5 }) } }]);
  return { doc: r.doc, titleId, drawnId: r.results[0]!.output!.clipId as string, trackId: r.results[0]!.output!.trackId as string };
}

describe('the registry decides what a document may hold', () => {
  it('without a registered kind a drawn clip cannot be parsed; with it, it can; an unknown kind or a bad payload is refused', () => {
    const { doc } = edit();
    expect(drawnKinds()).toContain('test'); // production kinds (ink, map) are registered on import beside it
    expect(ProjectSchema.safeParse(doc).success).toBe(true);
    unregisterDrawnKind('test');
    try {
      const r = ProjectSchema.safeParse(doc);
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain('drawn kind \\"test\\" is not known to this build');
    } finally { registerTestDrawnOp(); }
    const bad = structuredClone(doc);
    (drawnOf(bad)[0]!.drawn as Record<string, unknown>).extra = 1; // the kind schema is strict
    expect(ProjectSchema.safeParse(bad).success).toBe(false);
    const words = structuredClone(doc);
    (drawnOf(words)[0] as unknown as Record<string, unknown>).text = 'hi'; // a drawn clip has no words
    expect(ProjectSchema.safeParse(words).success).toBe(false);
  });
  it('a document without a drawn clip parses to exactly what it was (nothing added)', () => {
    const plain = tx(createProject({ id: 'prj_plain', name: 'P', width: 640, height: 360 }), [{ op: 'add_text', args: { text: 'a', start: f(0), duration: f(10) } }]).doc;
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(plain)))).toStrictEqual(plain);
  });
});

describe('validation', () => {
  it('a drawn clip on any other track than a text track is refused (drawn_track); the kind hook adds its own issues', () => {
    const { doc, drawnId } = edit();
    const moved = structuredClone(doc);
    const seq = moved.sequences[moved.mainSequenceId]!;
    const from = seq.tracks.find((t) => t.clips.some((c) => c.id === drawnId))!;
    const clip = from.clips.splice(0, 1)[0]!;
    seq.tracks.push({ id: 'trk_v9', kind: 'video', name: 'V', locked: false, muted: false, hidden: false, clips: [clip] });
    expect(validateProject(moved).map((i) => i.code)).toContain('drawn_track');
    const magenta = structuredClone(doc);
    (drawnOf(magenta)[0]!.drawn as Record<string, unknown>).color = '#FF00FF';
    expect(validateProject(magenta).map((i) => i.code)).toEqual(['drawn_test_colour']);
  });
  it('placement on a video track or an occupied range is refused, a free text track is found or made', () => {
    const { doc, trackId } = edit();
    const e = refusal(() => tx(doc, [{ op: 'add_test_drawn', args: { trackId, start: f(60), duration: f(10), drawn: testDrawn() } }]));
    expect(e.code).toBe('overlap');
    const v = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }]);
    const vid = v.results[0]!.output!.trackId as string;
    expect(refusal(() => tx(v.doc, [{ op: 'add_test_drawn', args: { trackId: vid, start: f(0), duration: f(10), drawn: testDrawn() } }])).code).toBe('incompatible');
    expect(refusal(() => tx(doc, [{ op: 'add_test_drawn', args: { start: f(0), duration: f(10), drawn: { ...testDrawn(), color: 'red' } } }])).code).toBe('invalid_args');
  });
});

describe('every text operation refuses a drawn clip with drawn_not_text', () => {
  const cases: [string, (id: string, d: ProjectDocument) => OpCall[]][] = [
    ['update_text (words)', (id) => [{ op: 'update_text', args: { clipId: id, text: 'x' } }]],
    ['update_text (style)', (id) => [{ op: 'update_text', args: { clipId: id, style: { color: '#000000' } } }]],
    ['apply_text_preset', (id) => [{ op: 'apply_text_preset', args: { clipId: id, presetId: 'clean' } }]],
    ['set_text_animation', (id) => [{ op: 'set_text_animation', args: { clipId: id, animation: { in: 'fade' } } }]],
    ['set_text_fields', (id) => [{ op: 'set_text_fields', args: { clipId: id, enabled: true } }]],
    ['replace_text (title)', (id) => [{ op: 'replace_text', args: { edits: [{ at: { kind: 'title', clipId: id }, was: '', text: 'x' } ] } }]],
  ];
  for (const [name, ops] of cases)
    it(name, () => {
      const { doc, drawnId } = edit();
      const e = refusal(() => tx(doc, ops(drawnId, doc)));
      expect(e.code).toBe('drawn_not_text');
      expect(e.message).toBe('clip is a test shape, not a title: it has no words or text style to change');
      expect(e.hint).toMatch(/Select a title/);
    });
  it('per-format wording and text style are refused; per-format placement and hiding are accepted', () => {
    const { doc, drawnId } = edit();
    const v = tx(doc, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    expect(refusal(() => tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: drawnId, text: 'x' } }])).code).toBe('drawn_not_text');
    expect(refusal(() => tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: drawnId, textStyle: { sizeFrac: 0.1 } } }])).code).toBe('drawn_not_text');
    acceptAndUndo(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: drawnId, transform: { x: 0.1 }, hidden: true } }]);
  });
  it('paste attributes: a title\'s text style onto a drawing is left out with drawn_not_text; its placement is pasted', () => {
    const { doc, drawnId, titleId } = edit();
    const r = acceptAndUndo(doc, [{ op: 'paste_attributes', args: { fromClipId: titleId, toClipIds: [drawnId], groups: ['titleStyle', 'transform'] } }]);
    const out = r.results[0]!.output as { applied: { group: string }[]; skipped: { group: string; code: string }[] };
    expect(out.applied.map((a) => a.group)).toEqual(['transform']);
    expect(out.skipped).toEqual([expect.objectContaining({ group: 'titleStyle', code: 'drawn_not_text' })]);
  });
});

describe('placement edits treat a drawn clip like a title', () => {
  it('split: the right half continues the content (offset moved by the left part, in frames); undo is exact', () => {
    const { doc, drawnId } = edit();
    const r = acceptAndUndo(doc, [{ op: 'split_clip', args: { clipId: drawnId, at: f(50) } }]);
    const [left, right] = drawnOf(r.doc);
    expect(left!.drawn.offset).toBe(5);
    expect(right!.drawn.offset).toBe(5 + 20);
    expect(T.frameIndexAt(right!.start, R)).toBe(50);
  });
  it('trim-start moves the offset with the edge, both ways (a negative offset is allowed: the content starts later)', () => {
    const { doc, drawnId } = edit();
    const later = acceptAndUndo(doc, [{ op: 'trim_clip', args: { clipId: drawnId, edge: 'start', to: f(40) } }]);
    expect(drawnOf(later.doc)[0]!.drawn.offset).toBe(15);
    const earlier = acceptAndUndo(doc, [{ op: 'trim_clip', args: { clipId: drawnId, edge: 'start', to: f(20) } }]);
    expect(drawnOf(earlier.doc)[0]!.drawn.offset).toBe(-5);
    const end = acceptAndUndo(doc, [{ op: 'trim_clip', args: { clipId: drawnId, edge: 'end', to: f(100) } }]);
    expect(drawnOf(end.doc)[0]!.drawn.offset).toBe(5);
  });
  it('move, transform, keyframes, duplicate and delete are accepted and undo exactly', () => {
    const { doc, drawnId } = edit();
    acceptAndUndo(doc, [{ op: 'move_clip', args: { clipId: drawnId, start: f(150) } }]);
    acceptAndUndo(doc, [{ op: 'set_clip_transform', args: { clipId: drawnId, transform: { x: 0.2, scale: 1.5, opacity: 0.5 } } }]);
    acceptAndUndo(doc, [{ op: 'set_keyframe', args: { clipId: drawnId, property: 'opacity', time: f(0), value: 0 } }, { op: 'set_keyframe', args: { clipId: drawnId, property: 'opacity', time: f(15), value: 1 } }]);
    const dup = acceptAndUndo(doc, [{ op: 'duplicate_clips', args: { clipIds: [drawnId], at: f(200) } }]);
    const [a, b] = drawnOf(dup.doc);
    expect(b!.drawn).toEqual(a!.drawn);
    expect(b!.id).not.toBe(a!.id);
    acceptAndUndo(doc, [{ op: 'delete_clip', args: { clipId: drawnId } }]);
  });
});

describe('what agents see', () => {
  it('get_timeline shows a drawn clip through its kind summary only', () => {
    const { doc, drawnId } = edit();
    const row = timeline(doc)!.tracks.flatMap((t) => t.clips).find((c) => c.id === drawnId) as Record<string, unknown>;
    expect(row.type).toBe('drawn');
    expect(row.drawn).toEqual({ kind: 'test', name: { he: 'צורת בדיקה', en: 'Test shape' }, color: '#E03030', offset: 5 });
    expect(row).not.toHaveProperty('text');
    expect(drawnSummary(drawnOf(doc)[0]!.drawn)).toEqual(row.drawn);
  });
});
