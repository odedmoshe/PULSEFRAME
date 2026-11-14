/**
 * Capability descriptor (SPEC §18 + Amendment A1 FF-04). One registry entry describes one reviewed,
 * pinned workflow. Seven qualification dimensions are tracked separately; nothing is "ready" because
 * its JSON validates. Publication blockers are computed, never asserted.
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
    type: z.enum(['int', 'float', 'string', 'boolean', 'enum', 'seed', 'image', 'video', 'audio', 'mask']),
    binding: z.object({ nodeId: z.string(), input: z.string() }).strict(),
    required: z.boolean(),
    default: z.union([z.number(), z.string(), z.boolean()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string()).optional(),
    maxLength: z.number().int().positive().optional(),
    /** False until a human reviewer has confirmed role, bounds, unit and default (FF-03). */
    reviewed: z.boolean(),
  })
  .strict();
export const OutputSchema = z
  .object({
    name: z.string(),
    role: z.enum(['primary', 'matte', 'depth', 'normals', 'guide', 'audio', 'preview']),
    mediaType: z.enum(['image', 'video', 'audio']),
    nodeId: z.string(),
    /** FF-15: an RGB picture of depth is not numeric depth. */
    encoding: z.enum(['display', 'rgb-visualization', 'numeric']).default('display'),
    /** Declared size contract, checked on the downloaded file before the job may succeed. */
    expectSize: z.union([z.object({ fromParams: z.tuple([z.string(), z.string()]) }).strict(), z.object({ sameAsInput: z.string() }).strict()]).nullable().default(null),
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
  })
  .strict();
export const DescriptorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    provider: z.literal('comfyui'),
    state: z.enum(['draft', 'published']),
    title: Bilingual,
    description: Bilingual,
    source: z.object({ repository: z.string().nullable(), commit: z.string().nullable(), notices: z.string().nullable() }).strict(),
    graph: ComfyGraphSchema,
    graphDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    inputs: z.array(InputSchema),
    outputs: z.array(OutputSchema),
    requiredNodes: z.array(z.object({ classType: z.string(), pack: z.string().nullable(), packVersion: z.string().nullable() }).strict()),
    models: z.array(ModelSchema),
    runtime: z.object({ comfyuiCommit: z.string().nullable(), imageDigest: z.string().nullable() }).strict(),
    limits: z.object({ maxFrames: z.number().int().positive().nullable(), maxPixels: z.number().int().positive().nullable() }).strict(),
    /** FF-06: four different quantities, never merged into one "size". */
    resources: z
      .object({
        downloadBytes: z.number().int().nonnegative(),
        estimatedResidencyBytes: z.number().int().nonnegative().nullable(),
        hostRamBytes: z.number().int().nonnegative().nullable(),
        measuredProfiles: z.array(z.object({ device: z.string(), runtime: z.string(), workload: z.string(), peakDeviceMemoryBytes: z.number().nullable(), wallSeconds: z.number(), measuredAt: z.string() }).strict()),
      })
      .strict(),
    egress: z.enum(['none', 'graph-defined']),
    languages: z.array(z.string()),
    limitations: z.array(z.string()),
    qualification: z.object(Object.fromEntries(QUALIFICATION_DIMENSIONS.map((d) => [d, Evidence])) as Record<QualificationDimension, typeof Evidence>).strict(),
  })
  .strict();
export type CapabilityDescriptor = z.infer<typeof DescriptorSchema>;
export type CapabilityInput = z.infer<typeof InputSchema>;
export type DistributionProfile = 'commercial' | 'research';

const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}` : JSON.stringify(v);
/** Digest of the canonical (key-sorted) graph, so reviewers approve exact bytes of logic. */
export const graphDigest = (graph: ComfyGraph) => `sha256:${createHash('sha256').update(canonical(graph)).digest('hex')}`;

export interface Blocker { code: string; message: string }
/** Every reason this capability may not be published/run under a distribution profile. Empty = eligible. */
export function publicationBlockers(d: CapabilityDescriptor, profile: DistributionProfile = 'commercial'): Blocker[] {
  const out: Blocker[] = [];
  const add = (code: string, message: string) => out.push({ code, message });
  if (graphDigest(d.graph) !== d.graphDigest) add('graph_digest_mismatch', 'the graph differs from the digest that was reviewed');
  for (const i of d.inputs) {
    if (!d.graph[i.binding.nodeId] || !(i.binding.input in d.graph[i.binding.nodeId]!.inputs)) add('dangling_binding', `input "${i.name}" is bound to a missing graph field ${i.binding.nodeId}.${i.binding.input}`);
    if (!i.reviewed) add('unreviewed_control', `input "${i.name}" has not been reviewed (role, bounds, unit, default)`);
    if ((i.type === 'int' || i.type === 'float') && (i.min === undefined || i.max === undefined)) add('unbounded_control', `numeric input "${i.name}" has no bounds`);
    if (i.type === 'enum' && !i.options?.length) add('unbounded_control', `enum input "${i.name}" has no options`);
  }
  if (d.outputs.length === 0) add('no_outputs', 'no output node is declared');
  for (const o of d.outputs) {
    if (!d.graph[o.nodeId]) add('dangling_binding', `output "${o.name}" refers to missing node ${o.nodeId}`);
    if (!o.reviewed) add('unreviewed_output', `output "${o.name}" role has not been reviewed`);
  }
  for (const n of d.requiredNodes) if (n.pack === null) add('unknown_node_pack', `node class "${n.classType}" is not attributed to a reviewed node pack`);
    else if (n.pack !== 'core' && !n.packVersion) add('unpinned_node_pack', `custom node pack "${n.pack}" has no pinned version`);
  for (const m of d.models) {
    if (!m.publisher || !m.revision || !m.sha256 || !m.bytes) add('unresolved_model', `model "${m.path}" is an unresolved placeholder (publisher, revision, digest and size are required)`);
    if (!m.license || !m.licenseEvidence) add('model_license_unknown', `model "${m.path}" has no recorded licence evidence`);
    if (profile === 'commercial' && m.commercialUse !== 'allowed') add('model_not_commercially_eligible', `model "${m.path}" is "${m.commercialUse}" for commercial use and is excluded from the commercial profile`);
  }
  if (d.egress !== 'none') add('graph_defined_egress', 'the graph references external endpoints');
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
/**
 * Validate caller parameters against the reviewed inputs and write them into a private copy of the
 * pinned graph. Callers can only set what a reviewer exposed; nothing else in the graph is reachable.
 */
export interface MediaBinding { name: string; type: 'image' | 'video' | 'audio' | 'mask'; assetId: string; nodeId: string; input: string }
export function resolveGraph(d: CapabilityDescriptor, params: Record<string, unknown>): { graph: ComfyGraph; resolved: Record<string, number | string | boolean>; media: MediaBinding[] } {
  const known = new Set(d.inputs.map((i) => i.name));
  for (const k of Object.keys(params)) if (!known.has(k)) throw new CapabilityError('unknown_parameter', `"${k}" is not a parameter of ${d.id}`, { allowed: [...known] });
  const graph: ComfyGraph = structuredClone(d.graph);
  const resolved: Record<string, number | string | boolean> = {};
  const media: MediaBinding[] = [];
  for (const i of d.inputs) {
    let v = params[i.name] ?? i.default;
    if (v === undefined) {
      if (i.required) throw new CapabilityError('missing_parameter', `parameter "${i.name}" is required`, { name: i.name });
      continue;
    }
    const bad = (why: string) => new CapabilityError('invalid_parameter', `parameter "${i.name}" ${why}`, { name: i.name, min: i.min, max: i.max, options: i.options });
    if (i.type === 'int' || i.type === 'float' || i.type === 'seed') {
      if (typeof v !== 'number' || !Number.isFinite(v) || (i.type !== 'float' && !Number.isInteger(v))) throw bad(`must be a ${i.type === 'float' ? 'number' : 'whole number'}`);
      if ((i.min !== undefined && v < i.min) || (i.max !== undefined && v > i.max)) throw bad(`must be between ${i.min} and ${i.max}`);
    } else if (i.type === 'boolean') {
      if (typeof v !== 'boolean') throw bad('must be true or false');
    } else if (i.type === 'enum') {
      if (typeof v !== 'string' || !i.options?.includes(v)) throw bad('is not one of the allowed options');
    } else if (i.type === 'string') {
      if (typeof v !== 'string' || v.length > (i.maxLength ?? 2000)) throw bad('must be text within the length limit');
    } else if (i.type === 'image') {
      // Media parameters are project asset ids. The caller never supplies a path or URL; the server stages the asset itself.
      if (typeof v !== 'string' || !/^ast_[A-Za-z0-9]+$/.test(v)) throw bad('must be the id of an image asset in this project');
      media.push({ name: i.name, type: i.type, assetId: v, nodeId: i.binding.nodeId, input: i.binding.input });
      resolved[i.name] = v;
      continue;
    } else throw new CapabilityError('unsupported_input_type', `${i.type} input "${i.name}" needs range extraction and staging, which is not implemented yet`, { name: i.name });
    graph[i.binding.nodeId]!.inputs[i.binding.input] = v;
    resolved[i.name] = v as number | string | boolean;
  }
  return { graph, resolved, media };
}
