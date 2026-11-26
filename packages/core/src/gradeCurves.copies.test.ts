/**
 * Every place that copies an effect instance carries its colour curves (wave 8 grade; grade-plan R3 with grade-verify C4). Two sites
 * lost them before this pre-pass and each has a test that failed first: paste_attributes' colour group (it re-creates each effect
 * with add_effect(type, params)) and multicam's lookKey (it ignored curves, so set_angle_look 'unedited' overwrote a segment whose
 * only change was its curves). The rest are structural rows over every other copier, plus a source scan that fails when a new site
 * rebuilds an instance from `type` and `params` without being classified here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { composeRestore, describeDiff, migrateProject, ProjectSchema, projectVariant, validateProject, type EffectInstance, type MediaClip, type ProjectDocument } from './index.ts';
import { CURVED, clipOf, curvedArgs, f, gradeOf, project, tx, undone } from './gradeCurves.testFixture.ts';
import { podcast, tx as mtx } from './multicam.testFixture.ts';

const curved = () => { const p = project(); return { ...p, doc: tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { exposure: 0.3 } } }, { op: 'set_grade_curves', args: { clipId: p.picture, curves: curvedArgs() } }]).doc }; };
const allClips = (d: ProjectDocument) => Object.values(d.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips));
const gradesOf = (d: ProjectDocument) => allClips(d).flatMap((c) => ((c as { effects?: EffectInstance[] }).effects ?? []).filter((e) => e.type === 'color.grade'));

describe('colour curves survive every copy (R3, C4)', () => {
  it('paste_attributes colour carries the curves of every pasted grade (failed before: add_effect(type, params) dropped them)', () => {
    const p = curved();
    // a second grade with other curves on the source, to show each instance keeps its own
    const src = structuredClone(p.doc);
    const list = (clipOf(src, p.picture) as MediaClip).effects!;
    list.push({ id: 'fx_second', type: 'color.grade', enabled: true, params: { ...list[0]!.params }, curves: { b: [[0, 8], [255, 248]] } });
    expect(validateProject(src)).toEqual([]);
    const r = tx(src, [{ op: 'paste_attributes', args: { fromClipId: p.picture, toClipIds: [p.title], groups: ['colour'] } }]);
    const pasted = ((clipOf(r.doc, p.title) as { effects?: EffectInstance[] }).effects ?? []).filter((e) => e.type === 'color.grade');
    expect(pasted.map((e) => e.curves)).toEqual([curvedArgs(), { b: [[0, 8], [255, 248]] }]);
    expect(pasted[0]!.params.exposure).toBe(0.3);
    expect(validateProject(r.doc)).toEqual([]);
    expect(undone(src, r.doc)).toEqual(src);
  });

  it('set_angle_look unedited keeps a segment whose only change is its curves (failed before: lookKey ignored curves)', () => {
    const p = podcast();
    let d = mtx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, range: { from: T.rt(10, 1), to: T.rt(400, 1) } } }]).doc;
    const sw = mtx(d, [{ op: 'switch_angles', args: { groupId: p.groupId, cuts: [{ at: f(300), angleId: p.camB }, { at: f(600), angleId: p.camA }, { at: f(900), angleId: p.camB }] } }]);
    const [s1, s2] = (sw.results[0]!.output as { switchedClipIds: string[] }).switchedClipIds as [string, string];
    d = sw.doc;
    // the angle takes s1's graded look (with curves); s2 gets it as an unedited segment, curves included (applyLook spreads the instance)
    d = mtx(d, [{ op: 'set_colour_grade', args: { clipId: s1, params: { exposure: 0.2 } } }, { op: 'set_grade_curves', args: { clipId: s1, curves: curvedArgs() } }]).doc;
    d = mtx(d, [{ op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.camB, fromClipId: s1 } }]).doc;
    expect(gradeOf(d, s2)!.curves).toEqual(curvedArgs());
    const angle = d.multicam![p.groupId]!.angles.find((a) => a.id === p.camB)!;
    expect(angle.look!.effects!.find((e) => e.type === 'color.grade')!.curves).toEqual(curvedArgs());
    // a curves-only change by hand on s2, then the angle's look again from s1: s2 is kept, its curves stay
    d = mtx(d, [{ op: 'set_grade_curves', args: { clipId: s2, curves: { r: [[0, 30], [255, 255]] } } }]).doc;
    const r = mtx(d, [{ op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.camB, fromClipId: s1 } }]);
    expect((r.results[0]!.output as { keptClipIds: string[] }).keptClipIds).toContain(s2);
    expect(gradeOf(r.doc, s2)!.curves).toEqual({ r: [[0, 30], [255, 255]] });
  });

  it('duplicate (the editor\'s copy and paste), split and the linked formats keep the curves', () => {
    const p = curved();
    const dup = tx(p.doc, [{ op: 'duplicate_clips', args: { clipIds: [p.picture], at: f(200) } }]).doc;
    expect(gradesOf(dup).filter((g) => g.curves).map((g) => g.curves)).toEqual([curvedArgs(), curvedArgs()]);
    const split = tx(p.doc, [{ op: 'split_clip', args: { clipId: p.picture, at: f(50) } }]).doc;
    expect(gradesOf(split).filter((g) => g.curves).length).toBe(2);
    const v = tx(p.doc, [{ op: 'add_variant', args: { width: 1080, height: 1920 } }]);
    const view = projectVariant(v.doc, v.results[0]!.output!.variantId as string);
    expect(gradeOf(view, p.picture)!.curves).toEqual(curvedArgs());
  });

  it('the neighbouring grade ops change the sliders only (set_colour_grade replace and merge, apply_look, update_effect); remove_effect takes them, undo returns them', () => {
    const p = curved();
    const id = gradeOf(p.doc, p.picture)!.id;
    for (const step of [
      { op: 'set_colour_grade', args: { clipId: p.picture, params: { tint: 0.1 } } },
      { op: 'set_colour_grade', args: { clipId: p.picture, params: { tint: 0.1 }, mode: 'merge' } },
      { op: 'apply_look', args: { clipId: p.picture, lookId: 'warm-sun' } },
      { op: 'update_effect', args: { clipId: p.picture, effectId: id, params: { saturation: 1.2 }, enabled: false, index: 0 } },
    ]) expect(gradeOf(tx(p.doc, [step]).doc, p.picture)!.curves, step.op).toEqual(curvedArgs());
    const removed = tx(p.doc, [{ op: 'remove_effect', args: { clipId: p.picture, effectId: id } }]).doc;
    expect(gradeOf(removed, p.picture)).toBeUndefined();
    expect(gradeOf(undone(p.doc, removed), p.picture)!.curves).toEqual(curvedArgs());
  });

  it('versions: restore brings the curves back and the diff sees a curve change; an archive round trip keeps them', () => {
    const p = curved();
    const changed = tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: { g: [[0, 0], [128, 140], [255, 255]] } } }]).doc;
    expect(gradeOf(composeRestore(changed, p.doc), p.picture)!.curves).toEqual(curvedArgs());
    expect(describeDiff(p.doc, changed).rows.length).toBeGreaterThan(0);
    const back = migrateProject(JSON.parse(JSON.stringify(p.doc)));
    ProjectSchema.parse(back);
    expect(validateProject(back)).toEqual([]);
    expect(gradeOf(back, p.picture)!.curves).toEqual(curvedArgs());
    expect(CURVED.master.length).toBe(4);
  });

  it.todo('own templates (wave 8 owntemplate): the template whitelist\'s key classification lists the instance key `curves` as NOT kept; a template saved from a curved clip carries no curves (integration: needs the owntemplate merge)');

  it('every source site that rebuilds an effect instance from `type` and `params` is classified (a new one fails here)', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const dirs = ['packages/core/src', 'packages/engine/src', 'apps/server/src', 'apps/web/src'];
    const re = /\btype: (\w+)\.type\b.*\bparams: (?:\.\.\.)?\(?\1\.params\b|\btype: (\w+)\.type\b.*\.\.\.\(\2\.params/;
    /** file → why the site needs no curves, or how it carries them. */
    const REVIEWED: Record<string, string> = {
      'packages/core/src/multicamOps.ts': 'lookKey: the key includes curves (C4)',
      'packages/core/src/packs/use.ts': 'a pack look is a spec {type, params}: add_adjustment\'s strict effects carry no curves (C4 "by design")',
      'packages/core/src/pasteAttributes.ts': 'add_effect(type, params), then the curves are copied onto the new instance (C4)',
      'packages/core/src/queries.ts': 'sound effects (audioFx), which have no curves',
      'packages/core/src/ops.ts': 'clean_voice output rows: sound effects',
      'packages/core/src/templatePlan.ts': 'a template look is a spec {type, params} (C4 "by design")',
      'apps/web/src/editor/commands.ts': 'the command bar adds an effect from a catalogue pick (no instance to copy)',
    };
    const found = new Set<string>();
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : /\.tsx?$/.test(e.name) && !/\.test\.|testFixture|testDocs|testKind/.test(e.name) ? [path.join(dir, e.name)] : []));
    for (const d of dirs) for (const file of walk(path.join(root, d))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (fs.readFileSync(file, 'utf8').split('\n').some((l) => re.test(l))) found.add(rel);
    }
    expect([...found].filter((f) => !REVIEWED[f]).sort(), 'unclassified sites: carry `curves` or say why not').toEqual([]);
    // engine evaluate.ts builds {type, params} for the compositor with other names: it passes curves (evaluate.curves.test.ts in the engine)
  });
});
