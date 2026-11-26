/**
 * ADR-0017 descriptor contract: one registry with two providers, reviewed discrete values, new size and frame contracts, local-tool
 * blockers. The local descriptor below is a test fixture (labelled), not a registry entry.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_WAVE_PINS, ALL_CAPABILITIES, BUILTIN_CAPABILITIES, DescriptorSchema, expectedOutputSize, IMAGE_UPSCALE_4X, graphDigest, IMAGE_SOFT_BLUR, LOCAL_TOOLS, logicDigest, publicationBlockers, pythonRound, resolveGraph, resolveParams,
  type CapabilityDescriptor, type ComfyDescriptor, type LocalToolDescriptor,
} from './index.ts';

const thrown = (fn: () => unknown) => { try { fn(); } catch (e: any) { return e.code as string; } return 'ok'; };
const pass = Object.fromEntries(['schemaValid', 'dependencyReady', 'licenseReviewed', 'executed', 'qualityReviewed', 'hebrewQualified', 'hardwareQualified'].map((k) => [k, { status: 'pass' }]));
const codes = (d: CapabilityDescriptor, ctx = {}) => publicationBlockers(d, 'commercial', ctx).map((b) => b.code);

/** Test fixture only: a local tool shaped like the voice-cleanup descriptor W2 will add. */
const LOCAL_FIXTURE = DescriptorSchema.parse({
  id: 'test.local.fixture', version: '0.1.0', provider: 'local', state: 'published',
  title: { he: 'בדיקה', en: 'Fixture' }, description: { he: 'בדיקה', en: 'Fixture' },
  source: { repository: null, commit: null, notices: null },
  inputs: [
    { name: 'audio', label: { he: 'קול', en: 'Sound' }, type: 'audio', binding: null, required: true, reviewed: true },
    { name: 'attenLimitDb', label: { he: 'הנחתה', en: 'Attenuation' }, type: 'int', binding: null, required: false, default: 24, allowed: [6, 12, 24, 100], reviewed: true },
  ],
  outputs: [{ name: 'audio', role: 'audio', mediaType: 'audio', nodeId: null, reviewed: true }],
  models: [], limits: { maxFrames: null, maxPixels: null },
  resources: { downloadBytes: 0, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
  egress: 'none', languages: [], limitations: [], qualification: pass,
  engine: { kind: 'binary', configVar: 'PF_DENOISE_BIN' }, task: 'voice-clean', codeFiles: ['apps/server/tools/pf_tools.py'], codeDigest: `sha256:${'c'.repeat(64)}`,
}) as LocalToolDescriptor;

describe('one registry, two providers', () => {
  it('the union parses both kinds; defaults fill the new fields; the registry lists built-ins then local tools', () => {
    expect(LOCAL_FIXTURE.provider).toBe('local');
    expect(LOCAL_FIXTURE.engine.verifiedBinaries).toEqual([]);
    expect(LOCAL_FIXTURE.outputs[0]).toMatchObject({ expectSize: null, expectFrames: null, dataSchema: null, encoding: 'display' });
    for (const d of BUILTIN_CAPABILITIES) { expect(d.frames === null, d.id).toBe(d.outputs.every((o) => o.expectFrames === null)); for (const m of d.models) expect(m.attribution).toBeNull(); } // a frame plan exactly on the frame jobs (W1)
    expect(ALL_CAPABILITIES).toEqual([...BUILTIN_CAPABILITIES, ...LOCAL_TOOLS]);
    expect(logicDigest(IMAGE_SOFT_BLUR)).toBe(IMAGE_SOFT_BLUR.graphDigest);
    expect(logicDigest(LOCAL_FIXTURE)).toBe(LOCAL_FIXTURE.codeDigest);
    expect(DescriptorSchema.safeParse({ ...LOCAL_FIXTURE, graph: {} }).success).toBe(false); // a local tool has no graph
  });
  it('local-tool blockers: graph bindings, egress and a code digest that differs from the installed code', () => {
    expect(codes(LOCAL_FIXTURE)).toEqual([]);
    expect(codes(LOCAL_FIXTURE, { codeDigest: `sha256:${'c'.repeat(64)}` })).toEqual([]);
    expect(codes(LOCAL_FIXTURE, { codeDigest: `sha256:${'d'.repeat(64)}` })).toEqual(['code_digest_mismatch']);
    const bound = { ...LOCAL_FIXTURE, inputs: [{ ...LOCAL_FIXTURE.inputs[0]!, binding: { nodeId: '1', input: 'x' } }], outputs: [{ ...LOCAL_FIXTURE.outputs[0]!, nodeId: '9' }] };
    expect(codes(bound)).toEqual(['binding_on_local_tool', 'binding_on_local_tool']);
    expect(codes({ ...LOCAL_FIXTURE, egress: 'graph-defined' })).toEqual(['local_tool_egress']);
  });
  it('allowed values: shape checks, and resolveParams accepts only them', () => {
    const at = (allowed: number[], type: 'int' | 'float' | 'string' = 'int', extra = {}) => codes({ ...LOCAL_FIXTURE, inputs: [LOCAL_FIXTURE.inputs[0]!, { ...LOCAL_FIXTURE.inputs[1]!, type, allowed, default: allowed[0], ...extra }] });
    expect(at([6, 12])).toEqual([]);
    expect(at([0.5])).toEqual(['invalid_allowed']);
    expect(at([6, 6])).toEqual(['invalid_allowed']);
    expect(at([6], 'string')).toEqual(['invalid_allowed']);
    expect(at([6, 200], 'int', { min: 0, max: 100 })).toEqual(['invalid_allowed']);
    expect(resolveParams(LOCAL_FIXTURE, { audio: 'ast_abc', attenLimitDb: 12 })).toEqual({ resolved: { audio: 'ast_abc', attenLimitDb: 12 }, media: [{ name: 'audio', type: 'audio', assetId: 'ast_abc', nodeId: null, input: null }] });
    expect(thrown(() => resolveParams(LOCAL_FIXTURE, { audio: 'ast_abc', attenLimitDb: 13 }))).toBe('invalid_parameter');
    expect(thrown(() => resolveParams(LOCAL_FIXTURE, { audio: '/etc/passwd' }))).toBe('invalid_parameter');
    expect(thrown(() => resolveParams(LOCAL_FIXTURE, {}))).toBe('missing_parameter');
  });
});

describe('ComfyUI contracts: size by a reviewed scale, frame plans, data outputs', () => {
  const graph = {
    '1': { class_type: 'LoadImage', inputs: { image: 'in.png' } },
    '2': { class_type: 'ImageScaleBy', inputs: { image: ['1', 0], upscale_method: 'lanczos', scale_by: 1 } },
    '3': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'x' } },
  };
  const scaled = (allowed: number[]): ComfyDescriptor => ({
    ...IMAGE_SOFT_BLUR, id: 'test.scale', graph, graphDigest: graphDigest(graph), qualification: pass as any,
    requiredNodes: ['LoadImage', 'ImageScaleBy', 'SaveImage'].map((classType) => ({ classType, pack: 'core', packVersion: null })),
    inputs: [IMAGE_SOFT_BLUR.inputs[0]!, { name: 'scaleBy', label: { he: 'קנה מידה', en: 'Scale' }, type: 'float', binding: { nodeId: '2', input: 'scale_by' }, required: false, default: allowed[allowed.length - 1], allowed, reviewed: true }],
    outputs: [{ ...IMAGE_SOFT_BLUR.outputs[0]!, nodeId: '3', expectSize: { scaleOfInputByParam: { input: 'image', param: 'scaleBy', base: 4 } } }],
  });
  it('scaleOfInputByParam needs allowed values that give a whole-number scale; 0.6 is refused at run time', () => {
    expect(codes(scaled([0.5, 0.75, 1]))).toEqual([]);
    expect(codes(scaled([0.5, 0.6]))).toEqual(['invalid_allowed']);
    const noAllowed = scaled([1]);
    delete noAllowed.inputs[1]!.allowed;
    expect(codes(noAllowed)).toContain('invalid_allowed');
    const r = resolveGraph(scaled([0.5, 0.75, 1]), { image: 'ast_x', scaleBy: 0.75 });
    expect(r.graph['2']!.inputs.scale_by).toBe(0.75);
    expect(thrown(() => resolveGraph(scaled([0.5, 0.75, 1]), { image: 'ast_x', scaleBy: 0.6 }))).toBe('invalid_parameter');
  });
  it('a null binding on a ComfyUI input is dangling; a data output needs a schema', () => {
    const d = scaled([1]);
    expect(codes({ ...d, inputs: [{ ...d.inputs[0]!, binding: null }, d.inputs[1]!] })).toEqual(['dangling_binding']);
    expect(codes({ ...LOCAL_FIXTURE, outputs: [{ ...LOCAL_FIXTURE.outputs[0]!, mediaType: 'data' }] })).toEqual(['data_output_without_schema']);
    expect(codes({ ...LOCAL_FIXTURE, outputs: [{ ...LOCAL_FIXTURE.outputs[0]!, mediaType: 'data', dataSchema: 'translation.v1' }] })).toEqual([]);
  });
  it('video inputs resolve only through a frame plan that reads them; frame plans are checked', () => {
    const vg = {
      '1': { class_type: 'LoadVideo', inputs: { file: 'in.mkv' } },
      '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
      '3': { class_type: 'FrameInterpolate', inputs: { images: ['2', 0], multiplier: 2 } },
      '4': { class_type: 'PreviewImage', inputs: { images: ['3', 0] } },
    };
    const base: ComfyDescriptor = {
      ...IMAGE_SOFT_BLUR, id: 'test.frames', graph: vg, graphDigest: graphDigest(vg), qualification: pass as any,
      requiredNodes: ['LoadVideo', 'GetVideoComponents', 'FrameInterpolate', 'PreviewImage'].map((classType) => ({ classType, pack: 'core', packVersion: null })),
      inputs: [
        { name: 'video', label: { he: 'וידאו', en: 'Video' }, type: 'video', binding: { nodeId: '1', input: 'file' }, required: true, reviewed: true },
        { name: 'multiplier', label: { he: 'פי', en: 'Times' }, type: 'int', binding: { nodeId: '3', input: 'multiplier' }, required: false, default: 2, allowed: [2, 4], reviewed: true },
      ],
      outputs: [{ name: 'frames', role: 'primary', mediaType: 'video', nodeId: '4', encoding: 'display', expectSize: { sameAsInput: 'video' }, expectFrames: 'pairwise', dataSchema: null, reviewed: true }],
      frames: { input: 'video', mode: 'pairwise', chunkFrames: 48, multiplierParam: 'multiplier', maxOutputRate: 120 },
    };
    expect(codes(base)).toEqual([]);
    expect(resolveGraph(base, { video: 'ast_v', multiplier: 4 }).media).toEqual([{ name: 'video', type: 'video', assetId: 'ast_v', nodeId: '1', input: 'file' }]);
    expect(thrown(() => resolveGraph({ ...base, frames: null }, { video: 'ast_v' }))).toBe('unsupported_input_type');
    expect(codes({ ...base, frames: null })).toEqual(['frames_input_missing']); // the output's frame-count contract has no plan
    expect(codes({ ...base, frames: { ...base.frames!, input: 'nope' } })).toEqual(['frames_input_missing']);
    expect(codes({ ...base, frames: { ...base.frames!, multiplierParam: undefined } })).toEqual(['frames_input_missing']);
  });
});

describe('size contracts: the exact size every variant promises, failing closed', () => {
  const at = (width: number, height: number) => () => ({ width, height });
  const byParam = (base: number) => ({ scaleOfInputByParam: { input: 'image', param: 'scaleBy', base } });
  it('scaleOfInputByParam at base 4 gives exactly 2W, 3W and 4W for 320x240 and 333x199', () => {
    for (const [w, h] of [[320, 240], [333, 199]] as const)
      for (const [k, m] of [[0.5, 2], [0.75, 3], [1, 4]] as const)
        expect(expectedOutputSize(byParam(4), { scaleBy: k }, at(w, h)), `${w}x${h} at ${k}`).toEqual({ width: w * m, height: h * m });
  });
  it('rounds like Python (an exact half goes to the even neighbour), the way ImageScaleBy sizes its result', () => {
    expect([0.5, 1.5, 2.5, 3.5, 2.4999, 2.5001].map(pythonRound)).toEqual([0, 2, 2, 4, 2, 3]);
    expect(expectedOutputSize(byParam(1), { scaleBy: 0.5 }, at(5, 7))).toEqual({ width: 2, height: 4 }); // 2.5 -> 2, 3.5 -> 4
  });
  it('the other variants: from parameters, same as an input, a whole-number multiple of an input', () => {
    expect(expectedOutputSize({ fromParams: ['width', 'height'] }, { width: 256, height: 128 }, at(1, 1))).toEqual({ width: 256, height: 128 });
    expect(expectedOutputSize({ sameAsInput: 'image' }, {}, at(33, 19))).toEqual({ width: 33, height: 19 });
    expect(expectedOutputSize({ scaleOfInput: { input: 'image', factor: 4 } }, {}, at(33, 19))).toEqual({ width: 132, height: 76 });
  });
  it('a contract that cannot be computed throws size_contract_unresolved instead of being skipped', () => {
    const none = () => null;
    expect(thrown(() => expectedOutputSize({ sameAsInput: 'image' }, {}, none))).toBe('size_contract_unresolved');
    expect(thrown(() => expectedOutputSize({ scaleOfInput: { input: 'image', factor: 4 } }, {}, none))).toBe('size_contract_unresolved');
    expect(thrown(() => expectedOutputSize(byParam(4), { scaleBy: 0.75 }, none))).toBe('size_contract_unresolved');
    for (const scaleBy of [undefined, 0, -1, Number.NaN, '0.75']) expect(thrown(() => expectedOutputSize(byParam(4), { scaleBy }, at(320, 240))), String(scaleBy)).toBe('size_contract_unresolved');
    expect(thrown(() => expectedOutputSize(byParam(1), { scaleBy: 0.01 }, at(10, 10)))).toBe('size_contract_unresolved'); // rounds to 0 pixels
    expect(thrown(() => expectedOutputSize({ fromParams: ['width', 'height'] }, { width: 256 }, at(1, 1)))).toBe('size_contract_unresolved');
    expect(thrown(() => expectedOutputSize({ sameAsInput: 'image' }, {}, at(0, 10)))).toBe('size_contract_unresolved');
    expect(thrown(() => expectedOutputSize({ cropOfInput: 'image' } as never, {}, at(10, 10)))).toBe('size_contract_unresolved');
  });
  it('a contract naming something other than an image or video input, or sized by a non-whole-number input, is a publication blocker', () => {
    const blur = (expectSize: NonNullable<ComfyDescriptor['outputs'][number]['expectSize']>): ComfyDescriptor => ({ ...IMAGE_SOFT_BLUR, qualification: pass as any, outputs: [{ ...IMAGE_SOFT_BLUR.outputs[0]!, expectSize }] });
    expect(codes(blur({ sameAsInput: 'image' }))).toEqual([]);
    expect(codes(blur({ scaleOfInput: { input: 'image', factor: 2 } }))).toEqual([]);
    expect(codes(blur({ sameAsInput: 'picture' }))).toEqual(['invalid_size_contract']);
    expect(codes(blur({ scaleOfInput: { input: 'radius', factor: 2 } }))).toEqual(['invalid_size_contract']);
    expect(codes(blur({ fromParams: ['radius', 'sigma'] }))).toEqual(['invalid_size_contract']); // sigma is a float
    for (const d of ALL_CAPABILITIES) expect(codes(d), d.id).not.toContain('invalid_size_contract');
  });
});

describe('AI-wave pin table', () => {
  it('every pin has an exact size, a sha256 and an https publisher URL; x4plus matches the digest already pinned from the mirror', () => {
    for (const [k, p] of Object.entries(AI_WAVE_PINS)) {
      expect(p.sha256, k).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(p.bytes) && p.bytes > 0, k).toBe(true);
      expect(new URL(p.url).protocol, k).toBe('https:');
      expect(new URL(p.url).hostname, k).toMatch(/^(github\.com|raw\.githubusercontent\.com|huggingface\.co)$/);
    }
    expect(AI_WAVE_PINS.realesrganX4plus.sha256).toBe(IMAGE_UPSCALE_4X.models[0]!.sha256);
    expect(AI_WAVE_PINS.realesrganX4plus.bytes).toBe(IMAGE_UPSCALE_4X.models[0]!.bytes);
  });
});
