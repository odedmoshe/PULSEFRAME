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
  outputs: [{ name: 'image', role: 'primary', mediaType: 'image', nodeId: '2', encoding: 'display', reviewed: true, expectSize: { fromParams: ['width', 'height'] } }],
  requiredNodes: [{ classType: 'EmptyImage', pack: 'core', packVersion: null }, { classType: 'SaveImage', pack: 'core', packVersion: null }],
  models: [],
  runtime: { comfyuiCommit: null, imageDigest: null },
  limits: { maxFrames: 1, maxPixels: 1024 * 1024 },
  resources: { downloadBytes: 0, estimatedResidencyBytes: 0, hostRamBytes: null, measuredProfiles: [] },
  egress: 'none',
  languages: [],
  limitations: ['Diagnostic only: the output is a flat colour. It can be placed on the timeline solely to exercise the attachment path.'],
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
const blurGraph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'pulseframe_input.png' } },
  '2': { class_type: 'ImageBlur', inputs: { image: ['1', 0], blur_radius: 8, sigma: 4 } },
  '3': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'pulseframe_blur' } },
};
/**
 * First reviewed MEDIA-INPUT workflow (G0): model-free Gaussian blur of a project still.
 * It exists to qualify source staging, lineage and output contracts with a real source asset; it needs no weights.
 */
export const IMAGE_SOFT_BLUR: CapabilityDescriptor = DescriptorSchema.parse({
  id: 'comfy.image.soft-blur',
  version: '1.0.0',
  provider: 'comfyui',
  state: 'published',
  title: { he: 'טשטוש רך לתמונה', en: 'Soft blur (image)' },
  description: { he: 'טשטוש גאוסיאני של תמונת מקור מהפרויקט. ללא מודלים.', en: 'Gaussian blur of a still from the project. No models.' },
  source: { repository: null, commit: null, notices: 'Authored for PULSEFRAME; uses ComfyUI core nodes only.' },
  graph: blurGraph,
  graphDigest: graphDigest(blurGraph),
  inputs: [
    { name: 'image', label: { he: 'תמונת מקור', en: 'Source image' }, type: 'image', binding: { nodeId: '1', input: 'image' }, required: true, reviewed: true },
    { name: 'radius', label: { he: 'רדיוס (פיקסלים)', en: 'Radius (pixels)' }, type: 'int', binding: { nodeId: '2', input: 'blur_radius' }, required: false, default: 8, min: 1, max: 31, reviewed: true },
    { name: 'sigma', label: { he: 'רכות', en: 'Softness (sigma)' }, type: 'float', binding: { nodeId: '2', input: 'sigma' }, required: false, default: 4, min: 0.1, max: 10, reviewed: true },
  ],
  outputs: [{ name: 'image', role: 'primary', mediaType: 'image', nodeId: '3', encoding: 'display', reviewed: true, expectSize: { sameAsInput: 'image' } }],
  requiredNodes: [{ classType: 'LoadImage', pack: 'core', packVersion: null }, { classType: 'ImageBlur', pack: 'core', packVersion: null }, { classType: 'SaveImage', pack: 'core', packVersion: null }],
  models: [],
  runtime: { comfyuiCommit: null, imageDigest: null },
  limits: { maxFrames: 1, maxPixels: 4096 * 4096 },
  resources: { downloadBytes: 0, estimatedResidencyBytes: 0, hostRamBytes: null, measuredProfiles: [] },
  egress: 'none',
  languages: [],
  limitations: ['Still images only. Alpha is not preserved (output is opaque RGB).', 'A native compositor blur effect (Phase 7) will supersede this for timeline use; it stays as the reference media-input workflow.'],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'DescriptorSchema + graph digest' },
    dependencyReady: { status: 'pass', evidence: 'no models; core nodes only (checked against /object_info at run time)' },
    licenseReviewed: { status: 'pass', evidence: 'no model weights; graph authored in this repository' },
    executed: { status: 'not_assessed', evidence: 'set from a recorded run on a named profile' },
    qualityReviewed: { status: 'not_assessed', evidence: 'needs a reviewed fixture set; a single edge-profile check is not a quality review' },
    hebrewQualified: NA,
    hardwareQualified: { status: 'not_assessed', evidence: 'set from a recorded run on a named profile' },
  },
});
const matteGraph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'pulseframe_input.png' } },
  '2': { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
  '3': { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['2', 0], image: ['1', 0] } },
  '4': { class_type: 'MaskToImage', inputs: { mask: ['3', 0] } },
  '5': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'pulseframe_matte' } },
  '6': { class_type: 'InvertMask', inputs: { mask: ['3', 0] } },
  '7': { class_type: 'JoinImageWithAlpha', inputs: { image: ['1', 0], alpha: ['6', 0] } },
  '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'pulseframe_cutout' } },
};
/**
 * First MODEL-BASED candidate (Amendment A1 G1): BiRefNet still-image matting through ComfyUI core nodes.
 * EXPERIMENTAL: executed only as a bounded CPU functional trial. Not quality-reviewed, not GPU-qualified.
 */
export const IMAGE_REMOVE_BACKGROUND: CapabilityDescriptor = DescriptorSchema.parse({
  id: 'comfy.image.remove-background',
  version: '0.1.0',
  provider: 'comfyui',
  state: 'published',
  title: { he: 'הסרת רקע מתמונה (ניסיוני)', en: 'Remove background, image (experimental)' },
  description: { he: 'חיתוך נושא מתמונה עם מסכת אלפא, באמצעות BiRefNet. נבדק פונקציונלית על CPU בלבד.', en: 'Subject cutout with an alpha matte using BiRefNet. Functionally tried on CPU only.' },
  source: { repository: 'https://github.com/comfyanonymous/ComfyUI', commit: 'eee59185ff4f43ae2d9ad122b245619d27d9daad', notices: 'Graph authored for PULSEFRAME from ComfyUI core nodes (comfy_extras.nodes_bg_removal). Not copied from Freefield.' },
  graph: matteGraph,
  graphDigest: graphDigest(matteGraph),
  inputs: [{ name: 'image', label: { he: 'תמונת מקור', en: 'Source image' }, type: 'image', binding: { nodeId: '1', input: 'image' }, required: true, reviewed: true }],
  outputs: [
    { name: 'cutout', role: 'primary', mediaType: 'image', nodeId: '8', encoding: 'display', reviewed: true, expectSize: { sameAsInput: 'image' } },
    { name: 'matte', role: 'matte', mediaType: 'image', nodeId: '5', encoding: 'numeric', reviewed: true, expectSize: { sameAsInput: 'image' } },
  ],
  requiredNodes: ['LoadImage', 'LoadBackgroundRemovalModel', 'RemoveBackground', 'MaskToImage', 'InvertMask', 'JoinImageWithAlpha', 'SaveImage'].map((classType) => ({ classType, pack: 'core', packVersion: null })),
  models: [{
    role: 'background_removal',
    path: 'background_removal/birefnet.safetensors',
    publisher: 'ZhengPeng7 (BiRefNet); file as packaged by Comfy-Org',
    revision: 'Comfy-Org/BiRefNet@884af709e9b795d89dafbf97f29c8d6a2386f5c6',
    sha256: '9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154',
    bytes: 444473596,
    license: 'MIT',
    licenseEvidence: 'Original publisher model card https://huggingface.co/ZhengPeng7/BiRefNet (revision e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4) is tagged license:mit and its model.safetensors has the identical SHA-256. Checked 2026-11-14 from repository metadata only; training-data terms were not reviewed.',
    commercialUse: 'allowed',
    gated: false,
    source: 'https://huggingface.co/Comfy-Org/BiRefNet/resolve/884af709e9b795d89dafbf97f29c8d6a2386f5c6/background_removal/birefnet.safetensors',
  }],
  runtime: { comfyuiCommit: 'eee59185ff4f43ae2d9ad122b245619d27d9daad', imageDigest: null },
  limits: { maxFrames: 1, maxPixels: 2048 * 2048 },
  // Three different quantities (FF-06). Residency and device memory are unknown until measured on a GPU profile.
  resources: { downloadBytes: 444473596, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
  egress: 'none',
  languages: [],
  limitations: [
    'Still images only. Applying an image matting model to video needs separate flicker, hair, blur and occlusion tests.',
    'Not quality-reviewed: no reviewed fixtures for hair, fine edges, motion blur or occlusion.',
    'Only run on a CPU device so far; no GPU memory or speed figures exist. Model file size is not runtime memory.',
    'The matte isolates existing pixels; it does not reconstruct what was behind the subject.',
  ],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'DescriptorSchema + graph digest' },
    dependencyReady: { status: 'pass', evidence: 'core nodes; model file verified by size and SHA-256 at run time' },
    licenseReviewed: { status: 'pass', evidence: 'weights tagged MIT by the original publisher; digest-identical file (see model record). Metadata-level check, pending owner/legal confirmation.' },
    executed: { status: 'not_assessed', evidence: 'set from a recorded run on a named profile' },
    qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed fixture set' },
    hebrewQualified: NA,
    hardwareQualified: { status: 'not_assessed', evidence: 'set from a recorded run; a CPU run is not GPU qualification' },
  },
});
const upscaleGraph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'pulseframe_input.png' } },
  '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: 'RealESRGAN_x4plus.pth' } },
  '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
  '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'pulseframe_upscale' } },
};
/**
 * Still-image 4x upscale with Real-ESRGAN x4plus through ComfyUI core nodes (comfy_extras.nodes_upscale_model).
 * EXPERIMENTAL: implemented only. Never executed, not quality-reviewed, not hardware-qualified.
 * The output is 4x the input size; the descriptor schema cannot express a size multiple, so `expectSize` is left unset.
 */
export const IMAGE_UPSCALE_4X: CapabilityDescriptor = DescriptorSchema.parse({
  id: 'comfy.image.upscale-4x',
  version: '0.1.0',
  provider: 'comfyui',
  state: 'published',
  title: { he: 'הגדלת תמונה פי 4 (ניסיוני, טרם הורץ)', en: 'Upscale image 4x (experimental, not yet run)' },
  description: { he: 'הגדלת תמונה סטילית פי 4 באמצעות Real-ESRGAN. ניסיוני: הגרף עדיין לא הורץ.', en: 'Still-image 4x upscale using Real-ESRGAN. Experimental: this graph has not been run yet.' },
  source: { repository: 'https://github.com/comfyanonymous/ComfyUI', commit: 'eee59185ff4f43ae2d9ad122b245619d27d9daad', notices: 'Graph authored for PULSEFRAME from ComfyUI core nodes (comfy_extras.nodes_upscale_model). Not copied from Freefield.' },
  graph: upscaleGraph,
  graphDigest: graphDigest(upscaleGraph),
  inputs: [{ name: 'image', label: { he: 'תמונת מקור', en: 'Source image' }, type: 'image', binding: { nodeId: '1', input: 'image' }, required: true, reviewed: true }],
  outputs: [{ name: 'image', role: 'primary', mediaType: 'image', nodeId: '4', encoding: 'display', reviewed: true, expectSize: null }],
  requiredNodes: ['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'SaveImage'].map((classType) => ({ classType, pack: 'core', packVersion: null })),
  models: [{
    role: 'upscale',
    path: 'upscale_models/RealESRGAN_x4plus.pth',
    publisher: 'Real-ESRGAN (xinntao); file as mirrored by nateraw on Hugging Face',
    revision: 'nateraw/real-esrgan@42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
    sha256: '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1',
    bytes: 67040989,
    license: 'BSD-3-Clause (as tagged on the mirror)',
    licenseEvidence: 'Metadata-level check on 2026-11-16 of https://huggingface.co/nateraw/real-esrgan at revision 42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094: cardData.license is bsd-3-clause; RealESRGAN_x4plus.pth is 67040989 bytes with LFS sha256 4fa0d389...82f1. The same digest is served by other third-party mirrors. The original publisher repository could not be fetched in this session, so the licence is NOT confirmed against the original publisher and the mirror owner is not the publisher. Training-data terms were not reviewed. Not a .safetensors file (PyTorch .pth, loaded by ComfyUI with safe_load).',
    commercialUse: 'unknown',
    gated: false,
    source: 'https://huggingface.co/nateraw/real-esrgan/resolve/42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094/RealESRGAN_x4plus.pth',
  }],
  runtime: { comfyuiCommit: 'eee59185ff4f43ae2d9ad122b245619d27d9daad', imageDigest: null },
  // Limits apply to the INPUT; the output has 16x the pixels.
  limits: { maxFrames: 1, maxPixels: 1024 * 1024 },
  // Three different quantities (FF-06). Residency and host RAM are unknown until measured.
  resources: { downloadBytes: 67040989, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
  egress: 'none',
  languages: [],
  limitations: [
    'Still images only; not suitable for video without separate temporal-consistency tests.',
    'Experimental: this graph has never been executed.',
    'Not quality-reviewed: no reviewed fixtures.',
    'Upscaling invents detail and can alter faces, text and fine patterns.',
    'The output has 16x the pixels of the input (4x per side); memory use has not been measured, and no GPU memory or speed figures exist. Model file size is not runtime memory.',
    'The output size is not contract-checked (the descriptor schema cannot express a 4x multiple).',
  ],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'DescriptorSchema + graph digest' },
    dependencyReady: { status: 'pass', evidence: 'core nodes; model file verified by size and SHA-256 at run time' },
    licenseReviewed: { status: 'not_assessed', evidence: 'mirror tagged bsd-3-clause; original publisher licence not fetched; owner confirmation pending' },
    executed: { status: 'not_assessed', evidence: 'never run' },
    qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed fixture set' },
    hebrewQualified: NA,
    hardwareQualified: { status: 'not_assessed', evidence: 'never run on any profile' },
  },
});
export const BUILTIN_CAPABILITIES: CapabilityDescriptor[] = [SMOKE_SOLID_IMAGE, IMAGE_SOFT_BLUR, IMAGE_REMOVE_BACKGROUND, IMAGE_UPSCALE_4X];
