/**
 * Lead contracts of the templates and adjustment layers track (ADR-0016): schema version 2 and its migration, the
 * validation branch of adjustment clips, adjustment tracks in the track order, add_adjustment, and the template contract
 * schemas. The workers' own suites (adjustment.test.ts, applyTemplate.test.ts, templatePlan.test.ts, …) go further.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, ApplyTemplateArgsSchema, BindName, createProject, creativeProjection, diffEntities, findGatedTemplate, findTemplate, gatedTemplateError, gatedTemplateSummary,
  migrateProject, MODEL_GATED_TEMPLATES, OpError, planTemplate, ProjectSchema, RecipeRunSchema, RefSchema, restoreEntities, SCHEMA_VERSION, TemplateError, TEMPLATES, validateProject,
  type AdjustmentClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `v2${n++}_`, actor: 'test', allowInternal });
const fail = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return { code: e.code, message: e.message }; throw e; } throw new Error('not refused'); };
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance };
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance };

/** A picture 0…90, a title 30…120 and music 0…300 (the music does not count for span 'edit'). */
function edit() {
  let r = tx(createProject({ id: 'prj_v2', name: 'V2' }), [{ op: 'import_asset', args: { asset: still } }, { op: 'import_asset', args: { asset: song } }], true);
  const pic = r.results[0]!.output!.assetId as string, music = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: pic, start: f(0), duration: f(90) } }, { op: 'add_text', args: { text: 'שלום', start: f(30), duration: f(90) } }, { op: 'add_clip', args: { assetId: music, start: f(0), duration: f(300) } }]);
  return { doc: r.doc, pictureId: r.results[0]!.output!.clipId as string };
}
const kinds = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.map((t) => `${t.kind}:${t.name}`);
const adjustments = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips.filter((c): c is AdjustmentClip => c.type === 'adjustment').map((clip) => ({ track: t, clip })));

describe('schema version 2', () => {
  it('new documents are version 2; a version-1 document migrates unchanged apart from its version; a newer one is refused', () => {
    expect(SCHEMA_VERSION).toBe(2);
    const doc = createProject({ id: 'prj_m', name: 'M' });
    expect(doc.schemaVersion).toBe(2);
    const v1 = { ...JSON.parse(JSON.stringify(edit().doc)), schemaVersion: 1 };
    const migrated = migrateProject(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated).toEqual({ ...v1, schemaVersion: 2 });
    expect(validateProject(migrated)).toEqual([]);
    expect(ProjectSchema.safeParse(v1).success).toBe(false); // only through the migration
    expect(() => migrateProject({ ...doc, schemaVersion: 3 })).toThrow(/newer than supported 2/);
  });
  it('a recipe run may carry template slot records; older runs without them stay valid', () => {
    const run = { id: 'run_1', recipeId: 'template:tpl.x', params: {}, createdIds: ['clp_1'], fingerprints: {}, steps: [] };
    expect(RecipeRunSchema.safeParse(run).success).toBe(true);
    expect(RecipeRunSchema.safeParse({ ...run, slots: [{ key: 'a', kind: 'picture', clipId: 'clp_1', accept: 'any', beats: { from: 0, count: 4, unit: 'beat' } }] }).success).toBe(true);
    expect(RecipeRunSchema.safeParse({ ...run, slots: [{ key: '__proto__', kind: 'picture', clipId: 'clp_1' }] }).success).toBe(false);
    expect(RecipeRunSchema.safeParse({ ...run, slots: [{ key: 'a', kind: 'video', clipId: 'clp_1' }] }).success).toBe(false);
  });
});

describe('adjustment tracks and add_adjustment', () => {
  it('an adjustment track sits above the picture tracks and below the titles; later picture tracks go below it and titles above it', () => {
    let doc = createProject({ id: 'prj_o', name: 'O' });
    doc = tx(doc, [{ op: 'add_track', args: { kind: 'adjustment' } }]).doc;
    expect(kinds(doc)).toEqual(['video:V1', 'adjustment:FX1', 'text:T1', 'audio:A1']);
    doc = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'text' } }, { op: 'add_track', args: { kind: 'adjustment' } }]).doc;
    expect(kinds(doc)).toEqual(['video:V1', 'video:V2', 'adjustment:FX1', 'adjustment:FX2', 'text:T1', 'text:T2', 'audio:A1']);
    expect(validateProject(doc)).toEqual([]);
  });
  it('span "edit" covers 0 to the end of the last picture or title; effects, opacity and label are kept; undo is exact', () => {
    const { doc } = edit();
    const r = tx(doc, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }, { type: 'blur.gaussian', params: { radius: 0.01 } }], opacity: 0.5, label: 'שחור לבן' } }]);
    const [a] = adjustments(r.doc);
    expect(a!.track.kind).toBe('adjustment');
    expect(T.eq(a!.clip.start, f(0)) && T.eq(a!.clip.duration, f(120))).toBe(true);
    expect(a!.clip.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5 });
    expect(a!.clip.effects!.map((e) => e.type)).toEqual(['color.grayscale', 'blur.gaussian']);
    expect(a!.clip.label).toBe('שחור לבן');
    expect(r.results[0]!.output).toEqual({ clipId: a!.clip.id, trackId: a!.track.id, effectIds: a!.clip.effects!.map((e) => e.id) });
    expect(validateProject(r.doc)).toEqual([]);
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
  });
  it('a second adjustment over the same time goes on a new adjustment track; a span is frame-aligned and inside the timeline', () => {
    const { doc } = edit();
    const two = tx(doc, [{ op: 'add_adjustment', args: { span: 'edit' } }, { op: 'add_adjustment', args: { span: { start: f(10), duration: f(20) } } }]).doc;
    expect(adjustments(two).map((x) => x.track.name)).toEqual(['FX1', 'FX2']);
    expect(fail(() => tx(doc, [{ op: 'add_adjustment', args: { span: { start: T.rt(1, 100), duration: f(20) } } }])).code).toBe('invalid_args');
    expect(fail(() => tx(doc, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(0) } } }])).code).toBe('invalid_args');
    expect(fail(() => tx(createProject({ id: 'prj_e', name: 'E' }), [{ op: 'add_adjustment', args: { span: 'edit' } }])).message).toBe('the edit has no picture or title to cover yet');
  });
  it('refuses time effects, chroma key and drop shadow, and a track that is not an adjustment track', () => {
    const { doc } = edit();
    for (const type of ['time.echo', 'key.chroma', 'stylize.shadow']) {
      const e = fail(() => tx(doc, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type }] } }]));
      expect(e.code).toBe('incompatible');
      expect(e.message.startsWith(`${type} cannot go on an adjustment: `)).toBe(true);
    }
    const video = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
    expect(fail(() => tx(doc, [{ op: 'add_adjustment', args: { span: 'edit', trackId: video } }])).code).toBe('incompatible');
    expect(fail(() => tx(doc, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'no.such' }] } }])).code).toBe('not_found');
  });
});

describe('validation of adjustment clips', () => {
  const withAdjustment = () => tx(edit().doc, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] } }]).doc;
  const codes = (doc: ProjectDocument) => validateProject(doc).map((i) => i.code);
  it('an adjustment clip lives only on an adjustment track, and an adjustment track holds only adjustment clips', () => {
    const doc = withAdjustment();
    const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
    const fx = tracks.find((t) => t.kind === 'adjustment')!, video = tracks.find((t) => t.kind === 'video')!;
    const moved = structuredClone(doc), mt = moved.sequences[moved.mainSequenceId]!.tracks;
    mt.find((t) => t.id === video.id)!.clips.push(...mt.find((t) => t.id === fx.id)!.clips.splice(0));
    mt.find((t) => t.id === video.id)!.clips.sort((x, y) => T.cmp(x.start, y.start));
    expect(codes(moved)).toContain('incompatible_track');
    const swapped = structuredClone(doc), st = swapped.sequences[swapped.mainSequenceId]!.tracks;
    st.find((t) => t.id === fx.id)!.clips = st.find((t) => t.id === video.id)!.clips.splice(0);
    expect(codes(swapped)).toEqual(['incompatible_track']);
  });
  it('only opacity may be set or animated, and the refused effects are reported', () => {
    const doc = withAdjustment();
    const clip = () => adjustments(doc)[0]!.clip;
    const variant = (change: (c: AdjustmentClip) => void) => { const d = structuredClone(doc); change(adjustments(d)[0]!.clip); return codes(d); };
    expect(variant((c) => { c.transform.x = 0.1; })).toEqual(['adjustment_transform']);
    expect(variant((c) => { c.keyframes = { scale: [{ time: f(0), value: 1, easing: 'linear' }] }; })).toEqual(['adjustment_transform']);
    expect(variant((c) => { c.keyframes = { opacity: [{ time: f(0), value: 0, easing: 'linear' }, { time: f(10), value: 1, easing: 'linear' }] }; c.transform.opacity = 0.3; })).toEqual([]);
    expect(variant((c) => { c.effects = [...c.effects!, { id: 'fx_k', type: 'key.chroma', enabled: true, params: {} }]; })).toContain('adjustment_effect');
    expect(clip().type).toBe('adjustment');
  });
});

describe('template contract', () => {
  it('bind names and references are strict', () => {
    for (const ok of ['a', 'slot_1', 'v-2']) expect(BindName.safeParse(ok).success).toBe(true);
    for (const bad of ['__proto__', 'A', '1a', 'a-B', 'a'.repeat(33)]) expect(BindName.safeParse(bad).success, bad).toBe(false);
    expect(RefSchema.safeParse({ $ref: 'a', out: 'effectIds', at: 0 }).success).toBe(true);
    expect(RefSchema.safeParse({ $ref: 'a', extra: 1 }).success).toBe(false);
    const step = { op: 'add_text', args: {} };
    const base = { templateId: 'tpl.x', templateVersion: 1, params: {}, steps: [], slots: [] };
    expect(ApplyTemplateArgsSchema.safeParse({ ...base, ops: [step] }).success).toBe(true);
    expect(ApplyTemplateArgsSchema.safeParse({ ...base, ops: Array.from({ length: 2001 }, () => step) }).success).toBe(false);
    expect(ApplyTemplateArgsSchema.safeParse({ ...base, templateId: 'x', ops: [step] }).success).toBe(false);
  });
  it('apply_template is internal and, until it is built, refuses and changes nothing', () => {
    const { doc } = edit();
    const call: OpCall = { op: 'apply_template', args: { templateId: 'tpl.x', templateVersion: 1, params: {}, steps: [], slots: [], ops: [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) } }] } };
    expect(fail(() => tx(doc, [call])).code).toBe('forbidden_op');
    expect(fail(() => tx(doc, [call], true)).code).toBe('unknown_op');
  });
  it('the planner is not built yet and says so', () => {
    expect(TEMPLATES).toEqual([]);
    expect(findTemplate('tpl.travel-montage')).toBeUndefined();
    const def = { id: 'tpl.x' } as Parameters<typeof planTemplate>[1];
    expect(() => planTemplate(edit().doc, def, {})).toThrow(TemplateError);
  });
  it('Text-Behind-Subject and 3D-Zoom are listed as unavailable, naming the missing model, and are never built-ins', () => {
    expect(MODEL_GATED_TEMPLATES.map((t) => t.id)).toEqual(['tpl.text-behind-subject', 'tpl.3d-zoom']);
    for (const t of MODEL_GATED_TEMPLATES) {
      const s = gatedTemplateSummary(t);
      expect(s.available).toBe(false);
      expect(s.unavailableReason).toMatch(t.needsModel === 'video-segmentation' ? /segmentation model/ : /depth-estimation model/);
      expect(s.unavailableReason).toMatch(/not installed/);
      expect(s.needs.model).toBe(t.needsModel);
      expect(s.method).not.toMatch(/^rule-based/);
      expect(findGatedTemplate(t.id)).toBe(t);
      expect(findTemplate(t.id)).toBeUndefined();
      const e = gatedTemplateError(t);
      expect([e.code, /not installed/.test(e.message)]).toEqual(['needs_capability', true]);
    }
  });
});
