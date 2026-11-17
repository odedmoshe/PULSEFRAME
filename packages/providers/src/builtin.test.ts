/**
 * The AI-wave built-in descriptors (ADR-0017): photo upscale 2x/3x/4x, smooth slow motion and video enhance. Pure: no network,
 * no ComfyUI, no model files.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_WAVE_PINS, BUILTIN_CAPABILITIES, ComfyDescriptorSchema, DescriptorSchema, expectedOutputSize, graphDigest, IMAGE_UPSCALE, imageUpscaleDescriptor, importComfyWorkflow,
  KNOWN_CORE_NODES, publicationBlockers, resolveGraph, VIDEO_ENHANCE, VIDEO_SMOOTH_SLOWMO, videoEnhanceDescriptor, type ComfyDescriptor,
} from './index.ts';

const thrown = (fn: () => unknown) => { try { fn(); } catch (e: any) { return e.code as string; } return 'ok'; };
const codes = (d: ComfyDescriptor, profile: 'commercial' | 'research' = 'commercial') => publicationBlockers(d, profile).map((b) => b.code).sort();
/** Blockers that only a recorded run or a human review can clear; they never stop a run (capabilities.ts EARNED_BY_RUNNING). */
const RUN_EARNED = ['not_executed', 'not_hardwareQualified', 'not_qualityReviewed'];
const NEW = [IMAGE_UPSCALE, VIDEO_SMOOTH_SLOWMO, VIDEO_ENHANCE];

describe('the new descriptors parse, are listed once, and their digests match their graphs', () => {
  it('parse through the registry schema; graph digest and required nodes follow the graph; every node class is a reviewed core class', () => {
    for (const d of NEW) {
      expect(DescriptorSchema.parse(d), d.id).toEqual(d);
      expect(d.graphDigest, d.id).toBe(graphDigest(d.graph));
      expect(d.requiredNodes.map((n) => n.classType).sort(), d.id).toEqual([...new Set(Object.values(d.graph).map((n) => n.class_type))].sort());
      expect(d.requiredNodes.every((n) => n.pack === 'core' && KNOWN_CORE_NODES.has(n.classType)), d.id).toBe(true);
      expect(BUILTIN_CAPABILITIES.filter((x) => x.id === d.id), d.id).toEqual([d]);
    }
    expect(IMAGE_UPSCALE).toMatchObject({ id: 'comfy.image.upscale', version: '0.2.0' });
    expect(VIDEO_SMOOTH_SLOWMO).toMatchObject({ id: 'comfy.video.smooth-slowmo', version: '0.1.0', frames: { input: 'video', mode: 'pairwise', chunkFrames: 48, multiplierParam: 'multiplier', maxOutputRate: 120 } });
    expect(VIDEO_ENHANCE).toMatchObject({ id: 'comfy.video.enhance', version: '0.1.0', frames: { input: 'video', mode: 'per-frame', chunkFrames: 24, maxOutputRate: 120 } });
    expect(VIDEO_SMOOTH_SLOWMO.outputs[0]).toMatchObject({ mediaType: 'video', expectFrames: 'pairwise', expectSize: { sameAsInput: 'video' } });
    expect(VIDEO_ENHANCE.outputs[0]).toMatchObject({ mediaType: 'video', expectFrames: 'same', expectSize: { scaleOfInputByParam: { input: 'video', param: 'scale', base: 4 } } });
  });
  it('the graphs are the reviewed ones: x4plus → ImageScaleBy(lanczos); LoadVideo → GetVideoComponents → RIFE v4.25 → FrameInterpolate → PreviewImage; x4v3 → ImageScaleBy', () => {
    const classes = (d: ComfyDescriptor) => Object.keys(d.graph).sort((a, b) => Number(a) - Number(b)).map((k) => d.graph[k]!.class_type);
    expect(classes(IMAGE_UPSCALE)).toEqual(['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScaleBy', 'SaveImage']);
    expect(IMAGE_UPSCALE.graph['2']!.inputs.model_name).toBe('RealESRGAN_x4plus.pth');
    expect(IMAGE_UPSCALE.graph['4']!.inputs.upscale_method).toBe('lanczos');
    expect(classes(VIDEO_SMOOTH_SLOWMO)).toEqual(['LoadVideo', 'GetVideoComponents', 'FrameInterpolationModelLoader', 'FrameInterpolate', 'PreviewImage']);
    expect(VIDEO_SMOOTH_SLOWMO.graph['3']!.inputs.model_name).toBe('rife_v4.25.safetensors');
    expect(VIDEO_SMOOTH_SLOWMO.inputs.find((i) => i.name === 'video')!.binding).toEqual({ nodeId: '1', input: 'file' });
    expect(VIDEO_SMOOTH_SLOWMO.inputs.find((i) => i.name === 'multiplier')).toMatchObject({ binding: { nodeId: '4', input: 'multiplier' }, allowed: [2, 4] });
    expect(classes(VIDEO_ENHANCE)).toEqual(['LoadVideo', 'GetVideoComponents', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScaleBy', 'PreviewImage']);
    expect(VIDEO_ENHANCE.graph['3']!.inputs.model_name).toBe('realesr-general-x4v3.pth');
    expect(VIDEO_ENHANCE.inputs.find((i) => i.name === 'scale')!.allowed).toEqual([0.5, 1]);
  });
  it('model records come from the pin table: publisher URL, exact bytes and SHA-256, under the ComfyUI model folders', () => {
    const [x4plus] = IMAGE_UPSCALE.models, [rife] = VIDEO_SMOOTH_SLOWMO.models, [x4v3] = VIDEO_ENHANCE.models;
    expect(x4plus).toMatchObject({ path: 'upscale_models/RealESRGAN_x4plus.pth', sha256: AI_WAVE_PINS.realesrganX4plus.sha256, bytes: AI_WAVE_PINS.realesrganX4plus.bytes, source: AI_WAVE_PINS.realesrganX4plus.url, license: 'BSD-3-Clause' });
    expect(rife).toMatchObject({ path: 'frame_interpolation/rife_v4.25.safetensors', sha256: AI_WAVE_PINS.rifeV425.sha256, bytes: AI_WAVE_PINS.rifeV425.bytes, source: AI_WAVE_PINS.rifeV425.url, license: 'MIT', commercialUse: 'allowed' });
    expect(x4v3).toMatchObject({ path: 'upscale_models/realesr-general-x4v3.pth', sha256: AI_WAVE_PINS.realesrGeneralX4v3.sha256, bytes: AI_WAVE_PINS.realesrGeneralX4v3.bytes, source: AI_WAVE_PINS.realesrGeneralX4v3.url });
    for (const d of NEW) expect(d.resources.downloadBytes, d.id).toBe(d.models[0]!.bytes);
    // the licence evidence cites the publisher licence, the digest of the pinned file and the training-data residual risk
    for (const m of [x4plus!, x4v3!]) {
      expect(m.licenseEvidence).toContain('https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE');
      expect(m.licenseEvidence).toContain(m.sha256!);
      expect(m.licenseEvidence).toMatch(/DIV2K/);
    }
    expect(rife!.licenseEvidence).toMatch(/repack/);
  });
});

describe('photo upscale: exact output sizes from the reviewed scale values', () => {
  it('scaleOfInputByParam on the real descriptor gives exactly 2W, 3W and 4W for 320x240 and 333x199', () => {
    const exp = IMAGE_UPSCALE.outputs[0]!.expectSize!;
    for (const [w, h] of [[320, 240], [333, 199]] as const)
      for (const [scale, m] of [[0.5, 2], [0.75, 3], [1, 4]] as const) {
        const { resolved } = resolveGraph(IMAGE_UPSCALE, { image: 'ast_x', scale });
        expect(expectedOutputSize(exp, resolved, () => ({ width: w, height: h })), `${w}x${h} at ${scale}`).toEqual({ width: w * m, height: h * m });
      }
    // the default is 4x
    expect(resolveGraph(IMAGE_UPSCALE, { image: 'ast_x' }).graph['4']!.inputs.scale_by).toBe(1);
  });
  it('allowed rejects 0.6 (and any value a reviewer did not list), for photos and video alike', () => {
    expect(thrown(() => resolveGraph(IMAGE_UPSCALE, { image: 'ast_x', scale: 0.6 }))).toBe('invalid_parameter');
    expect(thrown(() => resolveGraph(IMAGE_UPSCALE, { image: 'ast_x', scale: 2 }))).toBe('invalid_parameter');
    expect(thrown(() => resolveGraph(VIDEO_ENHANCE, { video: 'ast_v', scale: 0.75 }))).toBe('invalid_parameter');
    expect(thrown(() => resolveGraph(VIDEO_SMOOTH_SLOWMO, { video: 'ast_v', multiplier: 3 }))).toBe('invalid_parameter');
    expect(resolveGraph(VIDEO_SMOOTH_SLOWMO, { video: 'ast_v', multiplier: 4 }).graph['4']!.inputs.multiplier).toBe(4);
  });
});

describe('Real-ESRGAN licence: both states, commercial versus research profile', () => {
  it('owner-accepted (shipped): the weights are allowed and reviewed; only run-earned blockers remain in either profile', () => {
    const d = imageUpscaleDescriptor('owner-accepted');
    expect(d).toEqual(IMAGE_UPSCALE);
    expect(d.models[0]!.commercialUse).toBe('allowed');
    expect(d.qualification.licenseReviewed.status).toBe('pass');
    expect(d.models[0]!.licenseEvidence).toMatch(/accepted this residual risk on 2026-11-17/);
    expect(codes(d, 'commercial')).toEqual(RUN_EARNED);
    expect(codes(d, 'research')).toEqual(RUN_EARNED);
    expect(codes(videoEnhanceDescriptor('owner-accepted'), 'commercial')).toEqual(RUN_EARNED);
  });
  it('pending: excluded from the commercial profile (commercial use unknown, licence not reviewed); in research only the review is open', () => {
    const d = imageUpscaleDescriptor('pending');
    expect(d.models[0]!.commercialUse).toBe('unknown');
    expect(d.qualification.licenseReviewed.status).toBe('not_assessed');
    expect(d.models[0]!.licenseEvidence).toMatch(/Pending/);
    expect(codes(d, 'commercial')).toEqual([...RUN_EARNED, 'model_not_commercially_eligible', 'not_licenseReviewed'].sort());
    expect(codes(d, 'research')).toEqual([...RUN_EARNED, 'not_licenseReviewed'].sort());
    expect(codes(videoEnhanceDescriptor('pending'), 'commercial')).toContain('model_not_commercially_eligible');
    // the graph is the same in both states; only the licence record differs
    expect(d.graphDigest).toBe(IMAGE_UPSCALE.graphDigest);
  });
  it('slow motion (RIFE, MIT at the publisher) has only run-earned blockers', () => {
    expect(codes(VIDEO_SMOOTH_SLOWMO, 'commercial')).toEqual(RUN_EARNED);
  });
});

describe('workflow import: the reviewed video and upscale core nodes are attributed to core', () => {
  it('a graph shaped like ComfyUI\'s "Frame Interpolation" blueprint (API format) imports with no unknown_node_pack', () => {
    // The blueprint (blueprints/Frame Interpolation.json at eee59185) in API form: load a video, split it, interpolate, rebuild, save.
    const blueprint = {
      '1': { class_type: 'FrameInterpolationModelLoader', inputs: { model_name: 'film_net_fp16.safetensors' } },
      '3': { class_type: 'GetVideoComponents', inputs: { video: ['20', 0] } },
      '9': { class_type: 'PrimitiveInt', inputs: { value: 2 } },
      '13': { class_type: 'PrimitiveBoolean', inputs: { value: true } },
      '11': { class_type: 'ComfyMathExpression', inputs: { expression: 'min(abs(b), 16) * a', a: ['3', 2], b: ['9', 0] } },
      '10': { class_type: 'ComfySwitchNode', inputs: { switch: ['13', 0], on_true: ['11', 0], on_false: ['3', 2] } },
      '2': { class_type: 'FrameInterpolate', inputs: { interp_model: ['1', 0], images: ['3', 0], multiplier: ['9', 0] } },
      '5': { class_type: 'CreateVideo', inputs: { images: ['2', 0], audio: ['3', 1], fps: ['10', 0] } },
      '20': { class_type: 'LoadVideo', inputs: { file: 'input.mp4' } },
      '21': { class_type: 'SaveVideo', inputs: { video: ['5', 0], filename_prefix: 'video/interpolated', format: 'auto', codec: 'auto' } },
    };
    const r = importComfyWorkflow(blueprint, { id: 'imported.frame-interpolation', title: 'Frame Interpolation' });
    expect(r.draft.state).toBe('draft');
    expect(r.blockers.map((b) => b.code)).not.toContain('unknown_node_pack');
    expect(r.draft.requiredNodes.every((n) => n.pack === 'core')).toBe(true);
    expect(r.draft.inputs.find((i) => i.binding?.nodeId === '20')?.type).toBe('video');
    expect(r.draft.outputs.map((o) => ({ nodeId: o.nodeId, mediaType: o.mediaType }))).toEqual([{ nodeId: '21', mediaType: 'video' }]);
    expect(r.draft.models.map((m) => m.path)).toEqual(['film_net_fp16.safetensors']);
    // still a draft: the model is an unresolved placeholder and nothing is reviewed
    expect(r.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['unresolved_model', 'unreviewed_control', 'unreviewed_output']));
  });
  it('the upscale graph imports with no unknown_node_pack either', () => {
    const r = importComfyWorkflow(IMAGE_UPSCALE.graph, { id: 'imported.upscale', title: 'Upscale' });
    expect(r.blockers.map((b) => b.code)).not.toContain('unknown_node_pack');
  });
});

describe('schema guard', () => {
  it('a frame plan on a still capability or a non-integral allowed scale is caught', () => {
    expect(ComfyDescriptorSchema.safeParse({ ...VIDEO_SMOOTH_SLOWMO, frames: { ...VIDEO_SMOOTH_SLOWMO.frames!, chunkFrames: 1 } }).success).toBe(false);
    const bad = { ...VIDEO_ENHANCE, inputs: VIDEO_ENHANCE.inputs.map((i) => (i.name === 'scale' ? { ...i, allowed: [0.5, 0.6] } : i)) };
    expect(publicationBlockers(bad).map((b) => b.code)).toContain('invalid_allowed');
  });
});
