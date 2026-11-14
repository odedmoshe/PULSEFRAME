/**
 * Built-in reviewed capabilities. Phase G0 ships exactly one: a model-free smoke graph that proves
 * the provider path (submit → progress → collect → validate) without any model download or GPU.
 */
import { DescriptorSchema, graphDigest, type CapabilityDescriptor, type ComfyGraph } from './descriptor.ts';

const smokeGraph: ComfyGraph = {
  '1': { class_type: 'EmptyImage', inputs: { width: 256, height: 256, batch_size: 1, color: 0x3de0c8 } },
  '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'pulseframe_smoke' } },
};
const NA = { status: 'not_applicable' as const };
/** Qualification evidence for `executed`/`hardwareQualified` is attached at runtime from a real run, not asserted here. */
export const SMOKE_SOLID_IMAGE: CapabilityDescriptor = DescriptorSchema.parse({
  id: 'comfy.smoke.solid-image',
  version: '1.0.0',
  provider: 'comfyui',
  state: 'published',
  title: { he: 'בדיקת עשן: תמונה בצבע אחיד', en: 'Smoke test: solid-colour image' },
  description: { he: 'גרף ללא מודלים שמוודא שספק ComfyUI מחובר ומחזיר פלט תקין.', en: 'Model-free graph that verifies the ComfyUI provider is connected and returns a valid output.' },
  source: { repository: null, commit: null, notices: 'Authored for PULSEFRAME; uses ComfyUI core nodes only.' },
  graph: smokeGraph,
  graphDigest: graphDigest(smokeGraph),
  inputs: [
    { name: 'width', label: { he: 'רוחב', en: 'Width' }, type: 'int', binding: { nodeId: '1', input: 'width' }, required: false, default: 256, min: 16, max: 1024, reviewed: true },
    { name: 'height', label: { he: 'גובה', en: 'Height' }, type: 'int', binding: { nodeId: '1', input: 'height' }, required: false, default: 256, min: 16, max: 1024, reviewed: true },
    { name: 'color', label: { he: 'צבע (RGB שלם)', en: 'Colour (RGB integer)' }, type: 'int', binding: { nodeId: '1', input: 'color' }, required: false, default: 0x3de0c8, min: 0, max: 0xffffff, reviewed: true },
  ],
  outputs: [{ name: 'image', role: 'primary', mediaType: 'image', nodeId: '2', encoding: 'display', reviewed: true }],
  requiredNodes: [{ classType: 'EmptyImage', pack: 'core', packVersion: null }, { classType: 'SaveImage', pack: 'core', packVersion: null }],
  models: [],
  runtime: { comfyuiCommit: null, imageDigest: null },
  limits: { maxFrames: 1, maxPixels: 1024 * 1024 },
  resources: { downloadBytes: 0, estimatedResidencyBytes: 0, hostRamBytes: null, measuredProfiles: [] },
  egress: 'none',
  languages: [],
  limitations: ['Diagnostic only: produces no creative media and is not attachable to a timeline.'],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'DescriptorSchema + graph digest' },
    dependencyReady: { status: 'pass', evidence: 'no models; core nodes only (checked against /object_info at run time)' },
    licenseReviewed: { status: 'pass', evidence: 'no model weights; graph authored in this repository' },
    executed: { status: 'not_assessed', evidence: 'set from a recorded run on a named profile' },
    qualityReviewed: NA,
    hebrewQualified: NA,
    hardwareQualified: { status: 'not_assessed', evidence: 'set from a recorded run on a named profile' },
  },
});
export const BUILTIN_CAPABILITIES: CapabilityDescriptor[] = [SMOKE_SOLID_IMAGE];
