/**
 * Capability descriptor (SPEC §18 + Amendment A1 FF-04). One registry entry describes one reviewed,
 * pinned piece of logic: a ComfyUI graph (provider 'comfyui') or a PULSEFRAME-owned local tool whose
 * reviewed code files are pinned by digest (provider 'local', ADR-0017). Seven qualification dimensions
 * are tracked separately; nothing is "ready" because its JSON validates. Publication blockers are
 * computed, never asserted.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const QUALIFICATION_DIMENSIONS = ['schemaValid', 'dependencyReady', 'licenseReviewed', 'executed', 'qualityReviewed', 'hebrewQualified', 'hardwareQualified'] as const;
export type QualificationDimension = (typeof QUALIFICATION_DIMENSIONS)[number];
const Evidence = z.object({ status: z.enum(['pass', 'fail', 'not_assessed', 'not_applicable']), evidence: z.string().optional(), at: z.string().optional() }).strict();
const Bilingual = z.object({ he: z.string(), en: z.string() }).strict();

export const ComfyGraphSchema = z.record(z.string(), z.object({ class_type: z.string().min(1), inputs: z.record(z.string(), z.unknown()), _meta: z.unknown().optional() }));
export type ComfyGraph = z.infer<typeof ComfyGraphSchema>;

export const InputSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
    label: Bilingual,
    type: z.enum(['int', 'float', 'string', 'boolean', 'enum', 'seed', 'image', 'video', 'audio', 'mask', 'transcript']),
    /** ComfyUI graph field. null for local tools: the runner receives resolved params by name. */
    binding: z.object({ nodeId: z.string(), input: z.string() }).strict().nullable(),
    required: z.boolean(),
    default: z.union([z.number(), z.string(), z.boolean()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string()).optional(),
    maxLength: z.number().int().positive().optional(),
    /** Reviewed discrete numeric values; when present the value must be one of them (scale_by 0.5|0.75|1, multiplier 2|4). */
    allowed: z.array(z.number()).min(1).max(16).optional(),
    /** False until a human reviewer has confirmed role, bounds, unit and default (FF-03). */
    reviewed: z.boolean(),
  })
  .strict();

/** Declared size contract, checked on the downloaded file before the job may succeed. */
export const ExpectSizeSchema = z
  .union([
    z.object({ fromParams: z.tuple([z.string(), z.string()]) }).strict(),
    z.object({ sameAsInput: z.string() }).strict(),
    /** Each side = input side × factor (Real-ESRGAN x4 → factor 4). */
    z.object({ scaleOfInput: z.object({ input: z.string(), factor: z.number().int().min(1).max(8) }).strict() }).strict(),
    /** Each side = round(input side × base × params[param]); `param` must declare `allowed` values that make the result an integer. */
    z.object({ scaleOfInputByParam: z.object({ input: z.string(), param: z.string(), base: z.number().int().min(1).max(8) }).strict() }).strict(),
  ])
  .nullable()
  .default(null);

export const OutputSchema = z
  .object({
    name: z.string(),
    role: z.enum(['primary', 'matte', 'depth', 'normals', 'guide', 'audio', 'preview']),
    mediaType: z.enum(['image', 'video', 'audio', 'data']),
    /** ComfyUI output node; null for local tools. */
    nodeId: z.string().nullable(),
    /** FF-15: an RGB picture of depth is not numeric depth. */
    encoding: z.enum(['display', 'rgb-visualization', 'numeric']).default('display'),
    expectSize: ExpectSizeSchema,
    /** Frame-count contract of a frame-job video output: same = N, pairwise = N·m (after the m−1 trailing holds), sampled = number of samples. */
    expectFrames: z.enum(['same', 'pairwise', 'sampled']).nullable().default(null),
    /** Required iff mediaType === 'data'. */
    dataSchema: z.enum(['translation.v1']).nullable().default(null),
    reviewed: z.boolean(),
  })
  .strict();

export const ModelSchema = z
  .object({
    role: z.string(),
    path: z.string(),
    publisher: z.string().nullable(),
    revision: z.string().nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    bytes: z.number().int().positive().nullable(),
    license: z.string().nullable(),
    licenseEvidence: z.string().nullable(),
    commercialUse: z.enum(['allowed', 'conditional', 'prohibited', 'unknown']),
    gated: z.boolean(),
    /** Immutable download URL (pinned revision). Never taken from an imported graph. */
    source: z.string().url().nullable(),
    /** Attribution text the licence requires (CC-BY), shown in notices/credits. */
    attribution: z.string().max(400).nullable().default(null),
  })
  .strict();

/** A frame job's plan (ADR-0017): which `video` input it reads and how frames are grouped into provider runs. */
export const FramesSchema = z
  .object({
    /** Name of the `video` input this plan reads. */
    input: z.string(),
    mode: z.enum(['per-frame', 'pairwise', 'sampled']),
    chunkFrames: z.number().int().min(2).max(240),
    sampleFps: z.number().positive().max(30).optional(),
    /** Pairwise: the int input holding m (its `allowed` gives the reviewed multipliers). */
    multiplierParam: z.string().optional(),
    /** Refuse plans whose output rate would exceed this (frames per second). */
    maxOutputRate: z.number().positive().max(240).default(120),
  })
  .strict();

/** FF-06: four different quantities, never merged into one "size". */
export const ResourcesSchema = z
  .object({
    downloadBytes: z.number().int().nonnegative(),
    estimatedResidencyBytes: z.number().int().nonnegative().nullable(),
    hostRamBytes: z.number().int().nonnegative().nullable(),
    measuredProfiles: z.array(z.object({ device: z.string(), runtime: z.string(), workload: z.string(), peakDeviceMemoryBytes: z.number().nullable(), wallSeconds: z.number(), measuredAt: z.string() }).strict()),
  })
  .strict();
/** What one run is expected to cost the user, in cents. Reserved against the caller's budget before submission. 0 = runs on the user's own machine. */
export const CostSchema = z.object({ cents: z.number().int().nonnegative(), basis: z.string().max(200) }).strict().default({ cents: 0, basis: 'runs locally; no charge' });
export const QualificationSchema = z.object(Object.fromEntries(QUALIFICATION_DIMENSIONS.map((d) => [d, Evidence])) as Record<QualificationDimension, typeof Evidence>).strict();

const shared = {
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  state: z.enum(['draft', 'published']),
  title: Bilingual,
  description: Bilingual,
  source: z.object({ repository: z.string().nullable(), commit: z.string().nullable(), notices: z.string().nullable() }).strict(),
  inputs: z.array(InputSchema),
  outputs: z.array(OutputSchema),
  models: z.array(ModelSchema),
  limits: z.object({ maxFrames: z.number().int().positive().nullable(), maxPixels: z.number().int().positive().nullable() }).strict(),
  resources: ResourcesSchema,
  cost: CostSchema,
  egress: z.enum(['none', 'graph-defined']),
  languages: z.array(z.string()),
  limitations: z.array(z.string()),
  qualification: QualificationSchema,
};
export const ComfyDescriptorSchema = z
  .object({
    ...shared,
    provider: z.literal('comfyui'),
    graph: ComfyGraphSchema,
    graphDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    requiredNodes: z.array(z.object({ classType: z.string(), pack: z.string().nullable(), packVersion: z.string().nullable() }).strict()),
    runtime: z.object({ comfyuiCommit: z.string().nullable(), imageDigest: z.string().nullable() }).strict(),
    frames: FramesSchema.nullable().default(null),
  })
  .strict();
export const LocalEngineSchema = z
  .object({
    kind: z.enum(['python-worker', 'binary', 'ffmpeg']),
    configVar: z.enum(['PF_TOOLS_PYTHON', 'PF_DENOISE_BIN']).nullable(),
    /** Reviewed builds of an operator-installed binary. An unlisted build reports engine_unverified. */
    verifiedBinaries: z
      .array(z.object({
        platform: z.enum(['linux-x64', 'win-x64', 'darwin-arm64']), version: z.string(),
        bytes: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/), source: z.string().url(),
      }).strict())
      .default([]),
  })
  .strict();
export const LocalToolDescriptorSchema = z
  .object({
    ...shared,
    provider: z.literal('local'),
    engine: LocalEngineSchema,
    task: z.enum(['translate', 'voice-clean', 'vocals-classic']),
    /** Repo-relative reviewed code files (e.g. apps/server/tools/pf_tools.py). */
    codeFiles: z.array(z.string()).min(1),
    /** sha256 over the codeFiles' bytes, concatenated in listed order. */
    codeDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();
export const DescriptorSchema = z.discriminatedUnion('provider', [ComfyDescriptorSchema, LocalToolDescriptorSchema]);
export type CapabilityDescriptor = z.infer<typeof DescriptorSchema>;
export type ComfyDescriptor = z.infer<typeof ComfyDescriptorSchema>;
export type LocalToolDescriptor = z.infer<typeof LocalToolDescriptorSchema>;
export type FramesPlanSpec = z.infer<typeof FramesSchema>;
export type CapabilityInput = z.infer<typeof InputSchema>;
export type CapabilityOutput = z.infer<typeof OutputSchema>;
export type CapabilityModel = z.infer<typeof ModelSchema>;
export type DistributionProfile = 'commercial' | 'research';

const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}` : JSON.stringify(v);
/** Digest of the canonical (key-sorted) graph, so reviewers approve exact bytes of logic. */
export const graphDigest = (graph: ComfyGraph) => `sha256:${createHash('sha256').update(canonical(graph)).digest('hex')}`;
/** The reviewed-logic digest used for run evidence (Capabilities.withEvidence / store.lastSucceeded). */
export const logicDigest = (d: CapabilityDescriptor): string => (d.provider === 'comfyui' ? d.graphDigest : d.codeDigest);

export interface Blocker { code: string; message: string }
export interface BlockerContext { /** Digest of the installed code files; omitted = not checked (pure tests). */ codeDigest?: string }
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'mask', 'transcript']);
/** An `allowed` value is "integral" for a size contract when base × value is a whole number (within float noise). */
const integral = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;
/**
 * Every reason this capability may not be published/run under a distribution profile. Empty = eligible.
 * Shared codes: unreviewed_control, unbounded_control, invalid_allowed, no_outputs, unreviewed_output, data_output_without_schema,
 *   unresolved_model, model_license_unknown, model_not_commercially_eligible, not_<dimension>.
 * comfyui only: graph_digest_mismatch, dangling_binding (including null bindings), unknown_node_pack, unpinned_node_pack,
 *   frames_input_missing, graph_defined_egress.
 * local only: code_digest_mismatch (when ctx.codeDigest differs), binding_on_local_tool, local_tool_egress (a local tool has no graph,
 *   so egress other than 'none' is reported under this code instead of graph_defined_egress).
 */
export function publicationBlockers(d: CapabilityDescriptor, profile: DistributionProfile = 'commercial', ctx: BlockerContext = {}): Blocker[] {
  const out: Blocker[] = [];
  const add = (code: string, message: string) => out.push({ code, message });
  const comfy = d.provider === 'comfyui' ? d : null;
  if (comfy && graphDigest(comfy.graph) !== comfy.graphDigest) add('graph_digest_mismatch', 'the graph differs from the digest that was reviewed');
  if (d.provider === 'local' && ctx.codeDigest !== undefined && ctx.codeDigest !== d.codeDigest) add('code_digest_mismatch', 'the installed tool code differs from the digest that was reviewed');
  for (const i of d.inputs) {
    if (comfy) {
      if (!i.binding) add('dangling_binding', `input "${i.name}" is not bound to a graph field`);
      else if (!comfy.graph[i.binding.nodeId] || !(i.binding.input in comfy.graph[i.binding.nodeId]!.inputs)) add('dangling_binding', `input "${i.name}" is bound to a missing graph field ${i.binding.nodeId}.${i.binding.input}`);
    } else if (i.binding) add('binding_on_local_tool', `input "${i.name}" names a graph field, but a local tool has no graph`);
    if (!i.reviewed) add('unreviewed_control', `input "${i.name}" has not been reviewed (role, bounds, unit, default)`);
    if ((i.type === 'int' || i.type === 'float') && (i.min === undefined || i.max === undefined) && !i.allowed) add('unbounded_control', `numeric input "${i.name}" has no bounds`);
    if (i.type === 'enum' && !i.options?.length) add('unbounded_control', `enum input "${i.name}" has no options`);
    if (i.allowed) {
      if (i.type !== 'int' && i.type !== 'float') add('invalid_allowed', `input "${i.name}" lists allowed values, which only numeric inputs can have`);
      else if (i.type === 'int' && i.allowed.some((v) => !Number.isInteger(v))) add('invalid_allowed', `whole-number input "${i.name}" lists an allowed value that is not a whole number`);
      else if (new Set(i.allowed).size !== i.allowed.length) add('invalid_allowed', `input "${i.name}" lists an allowed value twice`);
      else if (i.allowed.some((v) => (i.min !== undefined && v < i.min) || (i.max !== undefined && v > i.max))) add('invalid_allowed', `input "${i.name}" lists an allowed value outside its own bounds`);
      if (i.default !== undefined && typeof i.default === 'number' && !i.allowed.includes(i.default)) add('invalid_allowed', `the default of input "${i.name}" is not one of its allowed values`);
    }
  }
  if (d.outputs.length === 0) add('no_outputs', 'no output node is declared');
  for (const o of d.outputs) {
    if (comfy) { if (o.nodeId === null || !comfy.graph[o.nodeId]) add('dangling_binding', `output "${o.name}" refers to missing node ${o.nodeId}`); }
    else if (o.nodeId !== null) add('binding_on_local_tool', `output "${o.name}" names a graph node, but a local tool has no graph`);
    if (!o.reviewed) add('unreviewed_output', `output "${o.name}" role has not been reviewed`);
    if ((o.mediaType === 'data') !== (o.dataSchema !== null)) add('data_output_without_schema', o.mediaType === 'data' ? `data output "${o.name}" declares no data schema` : `output "${o.name}" declares a data schema but is not a data output`);
    const s = o.expectSize;
    if (s && 'scaleOfInputByParam' in s) {
      const p = d.inputs.find((i) => i.name === s.scaleOfInputByParam.param);
      if (!p?.allowed) add('invalid_allowed', `output "${o.name}" is sized by parameter "${s.scaleOfInputByParam.param}", which must list its allowed values`);
      else if (p.allowed.some((v) => !integral(v * s.scaleOfInputByParam.base))) add('invalid_allowed', `output "${o.name}": an allowed value of "${p.name}" does not give a whole-number scale`);
    }
    if (o.expectFrames !== null && (!comfy?.frames || o.mediaType !== 'video')) add('frames_input_missing', `output "${o.name}" declares a frame-count contract, which needs a video output of a frame plan`);
  }
  if (comfy) {
    for (const n of comfy.requiredNodes)
      if (n.pack === null) add('unknown_node_pack', `node class "${n.classType}" is not attributed to a reviewed node pack`);
      else if (n.pack !== 'core' && !n.packVersion) add('unpinned_node_pack', `custom node pack "${n.pack}" has no pinned version`);
    const f = comfy.frames;
    if (f) {
      if (!comfy.inputs.some((i) => i.name === f.input && i.type === 'video')) add('frames_input_missing', `the frame plan reads input "${f.input}", which is not a video input`);
      if (f.mode === 'pairwise' && !f.multiplierParam) add('frames_input_missing', 'a pairwise frame plan must name its multiplier parameter');
      if (f.multiplierParam && !comfy.inputs.some((i) => i.name === f.multiplierParam && i.type === 'int' && i.allowed)) add('frames_input_missing', `the frame plan's multiplier "${f.multiplierParam}" must be a whole-number input with allowed values`);
      if (f.mode === 'sampled' && !f.sampleFps) add('frames_input_missing', 'a sampled frame plan must give its sampling rate');
    }
  }
  for (const m of d.models) {
    if (!m.publisher || !m.revision || !m.sha256 || !m.bytes) add('unresolved_model', `model "${m.path}" is an unresolved placeholder (publisher, revision, digest and size are required)`);
    if (!m.license || !m.licenseEvidence) add('model_license_unknown', `model "${m.path}" has no recorded licence evidence`);
    if (profile === 'commercial' && m.commercialUse !== 'allowed') add('model_not_commercially_eligible', `model "${m.path}" is "${m.commercialUse}" for commercial use and is excluded from the commercial profile`);
  }
  if (d.egress !== 'none') { if (comfy) add('graph_defined_egress', 'the graph references external endpoints'); else add('local_tool_egress', 'a local tool must not contact external endpoints'); }
  for (const dim of QUALIFICATION_DIMENSIONS) {
    const q = d.qualification[dim];
    if (q.status === 'pass' || q.status === 'not_applicable') continue;
    add(`not_${dim}`, `qualification "${dim}" is ${q.status}${q.evidence ? ` (${q.evidence})` : ''}`);
  }
  return out;
}

export class CapabilityError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}
export interface MediaBinding { name: string; type: 'image' | 'video' | 'audio' | 'mask' | 'transcript'; assetId: string; nodeId: string | null; input: string | null }
const MEDIA_WORDS: Record<MediaBinding['type'], string> = { image: 'an image asset', video: 'a video asset', audio: 'an asset with sound', mask: 'a mask asset', transcript: 'an asset with a transcript' };
/**
 * Validate caller parameters against the reviewed inputs (bounds, options, `allowed`, `ast_` ids for every media type).
 * Callers can only set what a reviewer exposed. Shared by both providers; never touches a graph.
 */
export function resolveParams(d: CapabilityDescriptor, params: Record<string, unknown>): { resolved: Record<string, number | string | boolean>; media: MediaBinding[] } {
  const known = new Set(d.inputs.map((i) => i.name));
  for (const k of Object.keys(params)) if (!known.has(k)) throw new CapabilityError('unknown_parameter', `"${k}" is not a parameter of ${d.id}`, { allowed: [...known] });
  const resolved: Record<string, number | string | boolean> = {};
  const media: MediaBinding[] = [];
  for (const i of d.inputs) {
    const v = params[i.name] ?? i.default;
    if (v === undefined) {
      if (i.required) throw new CapabilityError('missing_parameter', `parameter "${i.name}" is required`, { name: i.name });
      continue;
    }
    const bad = (why: string) => new CapabilityError('invalid_parameter', `parameter "${i.name}" ${why}`, { name: i.name, min: i.min, max: i.max, options: i.options, allowed: i.allowed });
    if (i.type === 'int' || i.type === 'float' || i.type === 'seed') {
      if (typeof v !== 'number' || !Number.isFinite(v) || (i.type !== 'float' && !Number.isInteger(v))) throw bad(`must be a ${i.type === 'float' ? 'number' : 'whole number'}`);
      if ((i.min !== undefined && v < i.min) || (i.max !== undefined && v > i.max)) throw bad(`must be between ${i.min} and ${i.max}`);
      if (i.allowed && !i.allowed.includes(v)) throw bad(`must be one of ${i.allowed.join(', ')}`);
    } else if (i.type === 'boolean') {
      if (typeof v !== 'boolean') throw bad('must be true or false');
    } else if (i.type === 'enum') {
      if (typeof v !== 'string' || !i.options?.includes(v)) throw bad('is not one of the allowed options');
    } else if (i.type === 'string') {
      if (typeof v !== 'string' || v.length > (i.maxLength ?? 2000)) throw bad('must be text within the length limit');
    } else if (MEDIA_TYPES.has(i.type)) {
      // Media parameters are project asset ids. The caller never supplies a path or URL; the server stages the asset itself.
      const type = i.type as MediaBinding['type'];
      if (typeof v !== 'string' || !/^ast_[A-Za-z0-9]+$/.test(v)) throw bad(`must be the id of ${MEDIA_WORDS[type]} in this project`);
      media.push({ name: i.name, type, assetId: v, nodeId: i.binding?.nodeId ?? null, input: i.binding?.input ?? null });
    } else throw new CapabilityError('unsupported_input_type', `input "${i.name}" has a type this build does not resolve`, { name: i.name });
    resolved[i.name] = v as number | string | boolean;
  }
  return { resolved, media };
}
/**
 * ComfyUI only: validate parameters (resolveParams) and write them into a private copy of the pinned graph. Nothing else in the graph is
 * reachable. Media bindings are left for the server, which stages the asset and binds its staged name. A `video` input is accepted only
 * when the descriptor's frame plan reads it (frame jobs, ADR-0017); audio, mask and transcript inputs are not resolved for ComfyUI.
 */
export function resolveGraph(d: ComfyDescriptor, params: Record<string, unknown>): { graph: ComfyGraph; resolved: Record<string, number | string | boolean>; media: MediaBinding[] } {
  const { resolved, media } = resolveParams(d, params);
  for (const m of media) {
    if (m.type === 'image') continue;
    if (m.type === 'video' && d.frames?.input === m.name) continue;
    throw new CapabilityError('unsupported_input_type', m.type === 'video' ? `video input "${m.name}" is read only through a frame plan, and this capability has none for it` : `${m.type} input "${m.name}" needs range extraction and staging, which is not implemented yet`, { name: m.name });
  }
  const graph: ComfyGraph = structuredClone(d.graph);
  const mediaNames = new Set(media.map((m) => m.name));
  for (const i of d.inputs) {
    if (!(i.name in resolved) || mediaNames.has(i.name)) continue;
    if (!i.binding || !graph[i.binding.nodeId]) throw new CapabilityError('dangling_binding', `input "${i.name}" is not bound to a field of the graph`, { name: i.name });
    graph[i.binding.nodeId]!.inputs[i.binding.input] = resolved[i.name];
  }
  return { graph, resolved, media };
}
