import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, cutoutsOf, diffEntities, findClip, OpError, planRecipe, RecipeError, restoreEntities, validateProject, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';
import { dictionaries, translateRefusal, PORTRAIT_REFUSAL_PATTERNS } from '../../i18n/src/index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `r${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const music = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };

describe('beat montage recipe: cutting on beats or on bar starts', () => {
  function setup(downbeats: boolean) {
    let r = tx(createProject({ id: 'prj_r', name: 'R' }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: video } }], true);
    const musicId = r.results[0]!.output!.assetId as string, videoId = r.results[1]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: musicId, start: f(0), duration: f(300) } }]);
    const clipId = (r.results[0]!.output as any).clipId as string;
    const beats = Array.from({ length: 19 }, (_, k) => f(15 * (k + 1))); // every half second from 0.5 s
    const d = tx(r.doc, [{ op: 'attach_analysis', args: { assetId: musicId, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: beats, bpm: 120, ...(downbeats ? { downbeats: beats.filter((_, k) => k % 4 === 2), meter: 4 } : {}) } }], true).doc;
    return { d, clipId, videoId };
  }
  const starts = (plan: { ops: OpCall[] }) => plan.ops.map((o) => T.frameIndexAt((o.args as any).start, R));
  it('on beats it counts from the first beat in the clip; on bars it cuts on the bar starts, wherever in the count they fall', () => {
    const { d, clipId, videoId } = setup(true);
    expect(starts(planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats: 4 }))).toEqual([15, 75, 135, 195, 255]);
    // bar starts are beats 3, 7, 11, 15, 19 → frames 45, 105, 165, 225, 285
    const bars = planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats: 1, cutOn: 'bars' });
    expect(starts(bars)).toEqual([45, 105, 165, 225, 285]);
    expect(bars.steps[0]).toMatch(/every 1 bar/);
    expect(starts(planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats: 2, cutOn: 'bars' }))).toEqual([45, 165, 285]);
    expect(bars.alternatives.some((x) => x.label === 'Cut on beats')).toBe(true);
    // the planned operations apply cleanly
    expect(() => tx(d, bars.ops)).not.toThrow();
  });
  it('asking for bars when the analysis has none is refused with a way forward; on beats no bar alternative is offered', () => {
    const { d, clipId, videoId } = setup(false);
    let err: unknown;
    try { planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], cutOn: 'bars' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RecipeError);
    expect((err as RecipeError).code).toBe('needs_analysis');
    expect(planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId] }).alternatives.some((x) => /bar/.test(x.label))).toBe(false);
  });
});

describe('beat montage on fast music: at most three cuts a second (ADR-0009)', () => {
  it('beats 0.1 s apart (600 per minute): cuts are left out so that no clip is shorter than a third of a second, and the plan says so', () => {
    let r = tx(createProject({ id: 'prj_fast', name: 'F' }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: video } }], true);
    const musicId = r.results[0]!.output!.assetId as string, videoId = r.results[1]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: musicId, start: f(0), duration: f(300) } }]);
    const clipId = (r.results[0]!.output as any).clipId as string;
    const d = tx(r.doc, [{ op: 'attach_analysis', args: { assetId: musicId, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: Array.from({ length: 99 }, (_, k) => f(3 * (k + 1))), bpm: 600 } }], true).doc;
    for (const everyBeats of [1, 2] as const) {
      const plan = planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats });
      const at = plan.ops.map((o) => T.frameIndexAt((o.args as any).start, R));
      for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!, `every ${everyBeats}`).toBeGreaterThanOrEqual(11); // ⌈30/3⌉ + 1 frames
      let most = 0; for (let i = 0, j = 0; i < at.length; i++) { while (at[i]! - at[j]! >= 30) j++; most = Math.max(most, i - j + 1); }
      expect(most).toBeLessThanOrEqual(3);
      expect(plan.steps.some((x) => /Leave out \d+ cut/.test(x)), `every ${everyBeats}`).toBe(true);
    }
    // slower music is not changed: every 4 beats of this music is 0.4 s
    const slow = planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats: 4 });
    expect(slow.steps.some((x) => /Leave out/.test(x))).toBe(false);
  });
});


describe('portrait blur recipe (ADR-0017): a still picture over a blurred copy of itself', () => {
  // Hand-built fixtures stand in for a provider result (labelled: no provider ran). A cut-out is recognised by its derived provenance.
  const photo = { kind: 'image' as const, name: 'portrait.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
  const derivedFrom = (src: string, capabilityId = 'comfy.image.remove-background', outputName = 'cutout', importedAt = '2026-11-17T00:00:00Z') =>
    ({ origin: 'derived' as const, importedAt, importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: `sha256:${'d'.repeat(64)}`, params: {}, sourceAssetIds: [src], outputName, outputRole: outputName === 'cutout' ? 'primary' : 'matte', encoding: 'display', provider: {} } });
  const undoes = (before: ProjectDocument, after: ProjectDocument) => {
    const back = structuredClone(after);
    restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
    return creativeProjection(back) === creativeProjection(before);
  };
  function setup() {
    let r = tx(createProject({ id: 'prj_pb', name: 'P' }), [{ op: 'import_asset', args: { asset: photo } }, { op: 'import_asset', args: { asset: video } }], true);
    const pic = r.results[0]!.output!.assetId as string, vid = r.results[1]!.output!.assetId as string;
    r = tx(r.doc, [
      { op: 'import_asset', args: { asset: { ...photo, name: 'portrait-cutout.png', contentHash: `sha256:${'e'.repeat(64)}`, image: { width: 640, height: 360, codec: 'png', hasAlpha: true }, provenance: derivedFrom(pic) } } },
      { op: 'import_asset', args: { asset: { ...photo, name: 'portrait-matte.png', contentHash: `sha256:${'f'.repeat(64)}`, provenance: derivedFrom(pic, 'comfy.image.remove-background', 'matte') } } },
      { op: 'import_asset', args: { asset: { ...photo, name: 'blurred.png', contentHash: `sha256:${'9'.repeat(64)}`, provenance: derivedFrom(pic, 'comfy.image.soft-blur', 'image') } } },
    ], true);
    const [cut, matte, soft] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
    r = tx(r.doc, [
      { op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(90), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: pic, start: f(30), duration: f(60) } },
      { op: 'add_variant', args: { profileId: 'square-1x1' } },
    ]);
    const under = r.results[0]!.output!.clipId as string, clip = r.results[1]!.output!.clipId as string, square = r.results[2]!.output!.variantId as string;
    r = tx(r.doc, [
      { op: 'set_clip_transform', args: { clipId: clip, transform: { x: 0.1, scale: 0.8, rotation: 5 } } },
      { op: 'set_keyframe', args: { clipId: clip, property: 'opacity', time: f(0), value: 0 } },
      { op: 'set_keyframe', args: { clipId: clip, property: 'opacity', time: f(15), value: 1, easing: 'ease-out' } },
      { op: 'set_variant_override', args: { variantId: square, clipId: clip, transform: { scale: 1.2 } } },
    ]);
    return { doc: r.doc, pic, vid, cut, matte, soft, clip, under, square };
  }
  /** What the server does with a plan: one internal apply_recipe op (apps/server/src/recipes.ts). */
  const applyPlan = (doc: ProjectDocument, params: Record<string, unknown>) => {
    const plan = planRecipe(doc, 'portrait-blur', params);
    return { plan, r: tx(doc, [{ op: 'apply_recipe', args: { recipeId: plan.recipeId, params: plan.params, steps: plan.steps, ops: plan.ops } }], true) };
  };

  it('finds the cut-out by its provenance, not by name: only the background-removal tool\'s cut-out output of this picture counts', () => {
    const s = setup();
    expect(cutoutsOf(s.doc, s.pic).map((a) => a.id)).toEqual([s.cut]);
    expect(cutoutsOf(s.doc, s.vid)).toEqual([]);
  });

  it('gives two clips at the same moments: the cut-out above, the picture with a live blur radius below; undo restores the document exactly', () => {
    const s = setup();
    const { plan, r } = applyPlan(s.doc, { clipId: s.clip });
    expect(plan.ops).toEqual([{ op: 'portrait_blur', args: { clipId: s.clip, cutoutAssetId: s.cut, radius: 0.02 } }]);
    expect(plan.steps).toHaveLength(2);
    expect(validateProject(r.doc)).toEqual([]);
    const seq = r.doc.sequences[r.doc.mainSequenceId]!;
    const top = findClip(r.doc, s.clip)!;
    const out = (r.results[0]!.output as any);
    const run = r.doc.recipeRuns[out.runId]!;
    const bottomId = run.createdIds.find((id) => id !== s.clip && !!findClip(r.doc, id))!;
    const bottom = findClip(r.doc, bottomId)!;
    const before = findClip(s.doc, s.clip)!.clip as MediaClip;
    // the clip itself now shows the cut-out, and nothing else about it changed
    expect((top.clip as MediaClip).assetId).toBe(s.cut);
    expect({ ...(top.clip as MediaClip), assetId: before.assetId }).toEqual(before);
    // the copy shows the picture, with the same start, length, transform and keyframes, and one blur added
    const b = bottom.clip as MediaClip;
    expect(b.assetId).toBe(s.pic);
    expect([b.start, b.duration, b.sourceIn, b.transform, b.keyframes]).toEqual([before.start, before.duration, before.sourceIn, before.transform, before.keyframes]);
    expect(b.effects?.map((e) => [e.type, e.params.radius])).toEqual([['blur.gaussian', 0.02]]);
    // directly below: the new track sits right under the clip's track, and nothing lies between them
    const ti = seq.tracks.indexOf(top.track), bi = seq.tracks.indexOf(bottom.track);
    expect(bi).toBe(ti - 1);
    expect(bottom.track.clips.map((c) => c.id)).toEqual([bottomId]);
    expect(run.createdIds.sort()).toEqual([bottomId, bottom.track.id].sort());
    // the format change of the clip applies to the copy too
    expect(r.doc.variants[s.square]!.overrides[bottomId]).toEqual(r.doc.variants[s.square]!.overrides[s.clip]);
    // two clips (and the unrelated video below) cover the clip's moments
    const at45 = seq.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips.filter((c) => T.lte(c.start, f(45)) && T.lt(f(45), T.add(c.start, c.duration))).map((c) => c.id));
    expect(at45.sort()).toEqual([s.under, bottomId, s.clip].sort());
    // the radius stays live: it is an ordinary effect parameter
    const fx = b.effects![0]!;
    const edited = tx(r.doc, [{ op: 'update_effect', args: { clipId: bottomId, effectId: fx.id, params: { radius: 0.05 } } }]).doc;
    expect(((findClip(edited, bottomId)!.clip as MediaClip).effects![0]!).params.radius).toBe(0.05);
    expect(undoes(s.doc, r.doc)).toBe(true);
    // the same op called directly (UI, REST, MCP) does the same and is undone the same way
    const direct = tx(s.doc, [{ op: 'portrait_blur', args: { clipId: s.clip, cutoutAssetId: s.cut, radius: 0.04 } }]);
    expect(((findClip(direct.doc, direct.results[0]!.output!.backgroundClipId as string)!.clip as MediaClip).effects![0]!).params.radius).toBe(0.04);
    expect(undoes(s.doc, direct.doc)).toBe(true);
  });

  it('the new track takes the clip track\'s visibility: a clip on a hidden track does not gain a visible blurred copy', () => {
    const s = setup();
    const trackId = findClip(s.doc, s.clip)!.track.id;
    for (const hidden of [true, false]) {
      const doc = tx(s.doc, [{ op: 'update_track', args: { trackId, hidden } }]).doc;
      const r = tx(doc, [{ op: 'portrait_blur', args: { clipId: s.clip, cutoutAssetId: s.cut } }]);
      const top = findClip(r.doc, s.clip)!.track, below = findClip(r.doc, r.results[0]!.output!.backgroundClipId as string)!.track;
      expect([top.hidden, below.hidden], `hidden: ${hidden}`).toEqual([hidden, hidden]);
      expect(validateProject(r.doc)).toEqual([]);
      expect(undoes(doc, r.doc)).toBe(true);
    }
  });

  it('a missing cut-out is a clear refusal that names the picture and the tool to run; so are a wrong cut-out and a moving picture', () => {
    const s = setup();
    const noCut = structuredClone(s.doc);
    delete noCut.assets[s.cut];
    let err: unknown;
    try { planRecipe(noCut, 'portrait-blur', { clipId: s.clip }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RecipeError);
    expect((err as RecipeError).code).toBe('needs_analysis');
    expect((err as RecipeError).message).toBe('the picture "portrait.png" has no cut-out yet');
    expect((err as RecipeError).hint).toMatch(/background-removal tool/);
    const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { return e as RecipeError; } return null; };
    expect(refusal(() => planRecipe(s.doc, 'portrait-blur', { clipId: s.clip, cutoutAssetId: s.matte }))?.code).toBe('invalid_args');
    expect(refusal(() => planRecipe(s.doc, 'portrait-blur', { clipId: s.clip, cutoutAssetId: s.soft }))?.code).toBe('invalid_args');
    expect(refusal(() => planRecipe(s.doc, 'portrait-blur', { clipId: s.under }))?.message).toBe('portrait blur works on a still picture clip');
    expect(refusal(() => planRecipe(s.doc, 'portrait-blur', { clipId: 'clp_none' }))?.code).toBe('not_found');
    expect(refusal(() => planRecipe(s.doc, 'portrait-blur', { clipId: s.clip, radius: 0.5 }))?.code).toBe('invalid_args');
  });

  it('the op refuses what would break the picture, and each refusal is worded in Hebrew', () => {
    const s = setup();
    const ops = (args: Record<string, unknown>): OpCall[] => [{ op: 'portrait_blur', args: { clipId: s.clip, cutoutAssetId: s.cut, ...args } }];
    const locked = tx(s.doc, [{ op: 'update_track', args: { trackId: findClip(s.doc, s.clip)!.track.id, locked: true } }]).doc;
    const nextAt = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.pic, start: f(90), duration: f(30), trackId: findClip(s.doc, s.clip)!.track.id } }]);
    const next = nextAt.results[0]!.output!.clipId as string;
    const into = tx(nextAt.doc, [{ op: 'set_transition', args: { clipId: next, type: 'dissolve', frames: 10 } }]).doc;
    const own = tx(nextAt.doc, [{ op: 'set_transition', args: { clipId: next, type: 'dissolve', frames: 10 } }]).doc;
    const cases: [string, ProjectDocument, OpCall[], string][] = [
      ['a moving picture', s.doc, [{ op: 'portrait_blur', args: { clipId: s.under, cutoutAssetId: s.cut } }], 'incompatible'],
      ['a file that is not a cut-out of this picture', s.doc, ops({ cutoutAssetId: s.soft }), 'incompatible'],
      ['a cut-out that is gone', s.doc, ops({ cutoutAssetId: 'ast_gone' }), 'not_found'],
      ['a locked track', locked, ops({}), 'track_locked'],
      ['a transition into the next clip', into, ops({}), 'incompatible'],
      ['a transition at the clip itself', own, [{ op: 'portrait_blur', args: { clipId: next, cutoutAssetId: s.cut } }], 'incompatible'],
    ];
    const matched = new Set<number>();
    for (const [what, doc, call, code] of cases) {
      let e: unknown;
      try { tx(doc, call); } catch (x) { e = x; }
      expect(e, what).toBeInstanceOf(OpError);
      expect((e as OpError).code, what).toBe(code);
      const he = translateRefusal('he', (e as OpError).message);
      expect(he && /[\u0590-\u05FF]/.test(he), `${what}: ${(e as OpError).message}`).toBe(true);
      PORTRAIT_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test((e as OpError).message)) matched.add(i); });
    }
    expect([...matched].sort()).toEqual(PORTRAIT_REFUSAL_PATTERNS.map((_, i) => i));
    for (const lang of ['he', 'en'] as const) expect((dictionaries[lang] as Record<string, string>)['op.portrait_blur']?.trim()).toBeTruthy();
  });
});
