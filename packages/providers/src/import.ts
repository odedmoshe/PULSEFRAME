/**
 * Reviewed workflow import (Amendment A1 FF-03). Pure parsing: no network, no execution, no installs,
 * no filesystem access. The result is always a DRAFT whose blockers explain why it is not publishable.
 */
import { ComfyGraphSchema, graphDigest, publicationBlockers, type Blocker, type CapabilityDescriptor } from './descriptor.ts';

/** Node classes shipped in ComfyUI core that the importer can attribute without a runtime. Extend only after review. */
export const KNOWN_CORE_NODES = new Set(['EmptyImage', 'SaveImage', 'PreviewImage', 'LoadImage', 'ImageScale', 'ImageInvert', 'ImageBlur', 'ImageBatch', 'SolidMask', 'MaskToImage', 'ImageCompositeMasked', 'ImagePadForOutpaint']);
const OUTPUT_NODES: Record<string, 'image' | 'video' | 'audio'> = { SaveImage: 'image', PreviewImage: 'image', SaveAnimatedWEBP: 'video', SaveAnimatedPNG: 'video', SaveVideo: 'video', SaveWEBM: 'video', VHS_VideoCombine: 'video', SaveAudio: 'audio' };
const MEDIA_LOADERS: Record<string, 'image' | 'video' | 'audio'> = { LoadImage: 'image', LoadVideo: 'video', VHS_LoadVideo: 'video', LoadAudio: 'audio' };
const MODEL_FIELD = /^(ckpt_name|lora_name|vae_name|unet_name|clip_name\d*|control_net_name|model_name|upscale_model|style_model_name|clip_vision_name|gligen_name)$/;
const MODEL_FILE = /\.(safetensors|ckpt|pt|pth|gguf|onnx|bin|sft)$/i;
const isLink = (v: unknown) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
const NA = { status: 'not_assessed' as const };

export class ImportError extends Error {
  constructor(public code: string, message: string, public hint?: string) {
    super(message);
  }
}
export interface ImportResult { draft: CapabilityDescriptor; blockers: Blocker[]; findings: string[] }

export function importComfyWorkflow(json: unknown, meta: { id: string; title: string; sourceRepository?: string; sourceCommit?: string }): ImportResult {
  if (json && typeof json === 'object' && Array.isArray((json as any).nodes) && 'links' in (json as any))
    throw new ImportError('ui_format_not_supported', 'this is a ComfyUI UI-format graph; only API-format export is supported so far', 'In ComfyUI use "Export (API)" and import that file.');
  const parsed = ComfyGraphSchema.safeParse(json);
  if (!parsed.success || Object.keys(parsed.data).length === 0) throw new ImportError('not_a_comfy_graph', 'file is not a ComfyUI API-format graph (expected an object of nodeId → { class_type, inputs })');
  const graph = parsed.data;
  if (Object.keys(graph).length > 2000) throw new ImportError('graph_too_large', 'graph has more than 2000 nodes');
  const findings: string[] = [];
  const inputs: CapabilityDescriptor['inputs'] = [];
  const outputs: CapabilityDescriptor['outputs'] = [];
  const models: CapabilityDescriptor['models'] = [];
  let egress: CapabilityDescriptor['egress'] = 'none';
  const used = new Set<string>();
  const name = (base: string) => { let n = base.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-z]+/, '') || 'p'; n = n[0]!.toLowerCase() + n.slice(1); let k = n; for (let i = 2; used.has(k); i++) k = `${n}_${i}`; used.add(k); return k; };

  for (const [nodeId, node] of Object.entries(graph)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      if (isLink(value)) {
        if (!graph[(value as [string, number])[0]]) throw new ImportError('dangling_link', `node ${nodeId}.${field} links to missing node ${(value as any[])[0]}`);
        continue;
      }
      if (typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) { egress = 'graph-defined'; findings.push(`node ${nodeId} (${node.class_type}) field "${field}" contains a URL; graph-defined endpoints are never contacted on import and block publication`); }
      if (typeof value === 'string' && (MODEL_FIELD.test(field) || MODEL_FILE.test(value))) {
        models.push({ role: field, path: value, publisher: null, revision: null, sha256: null, bytes: null, license: null, licenseEvidence: null, commercialUse: 'unknown', gated: false });
        continue;
      }
      const media = MEDIA_LOADERS[node.class_type];
      const label = { he: `${node.class_type} · ${field}`, en: `${node.class_type} · ${field}` };
      const base = { name: name(`${field}_${nodeId}`), label, binding: { nodeId, input: field }, required: false, reviewed: false };
      if (media && typeof value === 'string' && ['image', 'video', 'audio', 'file'].includes(field)) inputs.push({ ...base, type: media, required: true });
      else if (typeof value === 'number') inputs.push({ ...base, type: /seed/i.test(field) ? 'seed' : Number.isInteger(value) ? 'int' : 'float', default: value });
      else if (typeof value === 'boolean') inputs.push({ ...base, type: 'boolean', default: value });
      else if (typeof value === 'string') inputs.push({ ...base, type: 'string', default: value });
      else findings.push(`node ${nodeId} field "${field}" has a structured literal that is kept fixed`);
    }
    const out = OUTPUT_NODES[node.class_type];
    if (out) outputs.push({ name: name(`out_${nodeId}`), role: 'primary', mediaType: out, nodeId, encoding: 'display', reviewed: false });
  }
  const classes = [...new Set(Object.values(graph).map((n) => n.class_type))].sort();
  const draft: CapabilityDescriptor = {
    id: meta.id, version: '0.0.1', provider: 'comfyui', state: 'draft',
    title: { he: meta.title, en: meta.title }, description: { he: '', en: '' },
    source: { repository: meta.sourceRepository ?? null, commit: meta.sourceCommit ?? null, notices: null },
    graph, graphDigest: graphDigest(graph), inputs, outputs,
    requiredNodes: classes.map((classType) => ({ classType, pack: KNOWN_CORE_NODES.has(classType) ? 'core' : null, packVersion: null })),
    models, runtime: { comfyuiCommit: null, imageDigest: null }, limits: { maxFrames: null, maxPixels: null },
    resources: { downloadBytes: 0, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
    egress, languages: [], limitations: ['Imported draft: not reviewed, not executed, not quality-checked.'],
    qualification: { schemaValid: { status: 'pass', evidence: 'parsed as ComfyUI API-format graph; all links resolve' }, dependencyReady: NA, licenseReviewed: NA, executed: NA, qualityReviewed: NA, hebrewQualified: NA, hardwareQualified: NA },
  };
  if (models.length) findings.push(`${models.length} model reference(s) are unresolved placeholders`);
  return { draft, blockers: publicationBlockers(draft), findings };
}
