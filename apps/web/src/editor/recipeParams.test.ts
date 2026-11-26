/**
 * The recipes panel sends, for every recipe it lists, parameters that recipe accepts: run through the real planner, a card's
 * defaults never come back as invalid_args (a refusal for missing analysis is fine: that is the recipe speaking, not the form).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, describeRecipes, FAMILY_FILM_RECIPE_ID, MULTICAM_AUTO_RECIPE_ID, planRecipe, STORY_RECIPE_ID, RecipeError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { RECIPE_FORM_IDS, recipeParams, recipeSources } from './recipeParams.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (d: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(d, ops, { idSeed: `rp${n++}_`, actor: 'test', allowInternal });
// Hand-built fixtures (labelled: no provider ran). A cut-out is recognised by its derived provenance.
const prov = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const music = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const photo = { kind: 'image' as const, name: 'portrait.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
const cutoutOf = (src: string, importedAt: string, hash: string) => ({
  ...photo, name: `cutout-${hash}.png`, contentHash: `sha256:${hash.repeat(64)}`, image: { width: 640, height: 360, codec: 'png', hasAlpha: true },
  provenance: { origin: 'derived' as const, importedAt, importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId: 'comfy.image.remove-background', capabilityVersion: '0.1.0', graphDigest: `sha256:${'d'.repeat(64)}`, params: {}, sourceAssetIds: [src], outputName: 'cutout', outputRole: 'primary', encoding: 'display', provider: {} } },
});

function setup() {
  let r = tx(createProject({ id: 'prj_rp', name: 'P', frameRate: R }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: photo } }, { op: 'import_asset', args: { asset: { ...photo, name: 'other.png', contentHash: `sha256:${'b'.repeat(64)}` } } }], true);
  const [song, pic, other] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = tx(r.doc, [{ op: 'import_asset', args: { asset: cutoutOf(pic, '2026-11-16T00:00:00Z', 'e') } }, { op: 'import_asset', args: { asset: cutoutOf(pic, '2026-11-17T00:00:00Z', 'f') } }], true);
  const [older, newer] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: song, start: f(0) } },
    { op: 'add_clip', args: { assetId: other, start: f(0), duration: f(30) } },
    { op: 'add_clip', args: { assetId: pic, start: f(30), duration: f(60) } },
  ]);
  const [songClip, otherClip, picClip] = r.results.map((x) => (x.output!.audioClipId ?? x.output!.clipId) as string) as [string, string, string];
  return { doc: r.doc, song, pic, other, older, newer, songClip, otherClip, picClip };
}
const refusalOf = (fn: () => unknown) => { try { fn(); return null; } catch (e) { if (e instanceof RecipeError) return e; throw e; } };

describe('recipes panel parameters', () => {
  it('every listed recipe gets parameters it accepts: no card sends another recipe\'s form', () => {
    const s = setup();
    // the panel offers only the recipes it has a form for, so every recipe needs one here — except the family film (ADR-0026),
    // which has its own dialog (FamilyFilmDialog) and is planned by its own planner, not by planRecipe — and the multicam
    // auto-switch (ADR-0020), which has its own sheet in the multicam panel
    const panelRecipes = describeRecipes().filter((r) => r.id !== FAMILY_FILM_RECIPE_ID && r.id !== MULTICAM_AUTO_RECIPE_ID && r.id !== STORY_RECIPE_ID); // and the story (wave 7): its own dialog, planned by planStory
    expect(panelRecipes.map((r) => r.id).filter((id) => !RECIPE_FORM_IDS.includes(id))).toEqual([]);
    expect(RECIPE_FORM_IDS).not.toContain(FAMILY_FILM_RECIPE_ID);
    expect(RECIPE_FORM_IDS).not.toContain(STORY_RECIPE_ID);
    for (const selected of [s.picClip, s.songClip, undefined]) {
      const src = recipeSources(s.doc, selected);
      for (const r of panelRecipes) {
        const err = refusalOf(() => planRecipe(s.doc, r.id, recipeParams(r.id, undefined, src)));
        expect(err?.code, `${r.id} with ${selected ?? 'nothing'} selected: ${err?.message}`).not.toBe('invalid_args');
      }
    }
  });

  it('portrait blur: the selected picture clip, else the first picture clip that has a cut-out; the newest cut-out; the form\'s choices win', () => {
    const s = setup();
    expect(recipeParams('portrait-blur', undefined, recipeSources(s.doc, s.picClip))).toEqual({ clipId: s.picClip, radius: 0.02 });
    // the selected clip is music: the picture clip whose picture has a cut-out, not the first picture clip on the timeline
    expect(recipeParams('portrait-blur', undefined, recipeSources(s.doc, s.songClip))).toEqual({ clipId: s.picClip, radius: 0.02 });
    // a selected picture without a cut-out is still what the person pointed at: the plan then says which tool to run
    const plain = recipeParams('portrait-blur', undefined, recipeSources(s.doc, s.otherClip));
    expect(plain).toEqual({ clipId: s.otherClip, radius: 0.02 });
    expect(refusalOf(() => planRecipe(s.doc, 'portrait-blur', plain))?.code).toBe('needs_analysis');
    const plan = planRecipe(s.doc, 'portrait-blur', recipeParams('portrait-blur', undefined, recipeSources(s.doc, s.picClip)));
    expect(plan.params).toMatchObject({ clipId: s.picClip, cutoutAssetId: s.newer });
    const chosen = recipeParams('portrait-blur', { cutoutAssetId: s.older, radius: 0.05 }, recipeSources(s.doc, s.picClip));
    expect(chosen).toEqual({ clipId: s.picClip, cutoutAssetId: s.older, radius: 0.05 });
    expect(planRecipe(s.doc, 'portrait-blur', chosen).ops).toEqual([{ op: 'portrait_blur', args: { clipId: s.picClip, cutoutAssetId: s.older, radius: 0.05 } }]);
    // a cut-out chosen for another clip's picture is not carried over to this clip
    expect(recipeParams('portrait-blur', { clipId: s.otherClip, cutoutAssetId: s.older }, recipeSources(s.doc, s.picClip))).toEqual({ clipId: s.otherClip, radius: 0.02 });
    // the form lists the cut-outs of the chosen clip's picture, newest first
    expect(recipeSources(s.doc, s.picClip).pictureClips.map((c) => [c.clipId, c.cutoutIds])).toEqual([[s.otherClip, []], [s.picClip, [s.newer, s.older]]]);
  });
});
