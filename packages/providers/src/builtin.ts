/**
 * Built-in reviewed capabilities. Phase G0 shipped a model-free smoke graph that proves the provider path
 * (submit → progress → collect → validate) without any model download or GPU; later phases add reviewed media workflows.
 * The AI-model wave (ADR-0017) adds photo upscale 2x/3x/4x and two frame jobs (smooth slow motion, video enhance), all
 * from ComfyUI core nodes at the pinned commit, with model records taken from the pin table (aiPins.ts).
 */
import { AI_WAVE_PINS, type FilePin } from './aiPins.ts';
import { ComfyDescriptorSchema, graphDigest, type CapabilityModel, type ComfyDescriptor, type ComfyGraph } from './descriptor.ts';

const smokeGraph: ComfyGraph = {
  '1': { class_type: 'EmptyImage', inputs: { width: 256, height: 256, batch_size: 1, color: 0x3de0c8 } },
  '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'pulseframe_smoke' } },
};
const NA = { status: 'not_applicable' as const };
/** Qualification evidence for `executed`/`hardwareQualified` is attached at runtime from a real run, not asserted here. */
export const SMOKE_SOLID_IMAGE: ComfyDescriptor = ComfyDescriptorSchema.parse({
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
export const IMAGE_SOFT_BLUR: ComfyDescriptor = ComfyDescriptorSchema.parse({
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
export const IMAGE_REMOVE_BACKGROUND: ComfyDescriptor = ComfyDescriptorSchema.parse({
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
// ---------------------------------------------------------------------------------------------------------------------------
// AI-model wave (ADR-0017): reviewed ComfyUI-core graphs for photo upscale, smooth slow motion and video enhance.
// ---------------------------------------------------------------------------------------------------------------------------
const COMFY_COMMIT = 'eee59185ff4f43ae2d9ad122b245619d27d9daad';
const COMFY_REPO = 'https://github.com/comfyanonymous/ComfyUI';
const core = (classes: string[]) => classes.map((classType) => ({ classType, pack: 'core', packVersion: null }));
/**
 * How far the licence of the Real-ESRGAN weights has been settled. 'owner-accepted': the owner approved Real-ESRGAN by name and
 * accepted the DIV2K training-data residual risk (2026-11-17, lead decision in .artifacts/wave3-decisions.md; BLOCKERS B-4), so the
 * weights are commercialUse 'allowed' and licenseReviewed 'pass'. 'pending': the state before that decision (commercialUse
 * 'unknown', licenseReviewed 'not_assessed'), kept so both states stay tested and the descriptor can be rebuilt either way.
 */
export type RealEsrganLicence = 'owner-accepted' | 'pending';
const DIV2K_RISK = 'Residual risk: the DIV2K training data is labelled academic-research-only; recorded on the same footing as BiRefNet.';
/** A Real-ESRGAN weights record from the pin table (publisher URL, exact bytes and SHA-256). */
function realEsrganModel(pin: FilePin, release: string, licence: RealEsrganLicence): CapabilityModel {
  const accepted = licence === 'owner-accepted';
  return {
    role: 'upscale',
    path: `upscale_models/${pin.file}`,
    publisher: `xinntao (Real-ESRGAN), GitHub release ${release}`,
    revision: `xinntao/Real-ESRGAN@${release} (release asset ${pin.file})`,
    sha256: pin.sha256,
    bytes: pin.bytes,
    license: 'BSD-3-Clause',
    licenseEvidence: [
      'Publisher LICENSE https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE (BSD-3-Clause; no separate weight terms).',
      `Pinned file: ${pin.url}, ${pin.bytes} bytes, sha256 ${pin.sha256} (${pin.evidence}).`,
      DIV2K_RISK,
      accepted
        ? 'The owner approved Real-ESRGAN by name and accepted this residual risk on 2026-11-17 (lead decision; docs/BLOCKERS.md B-4).'
        : 'Pending: the owner has not accepted this residual risk, so commercial use is not settled.',
    ].join(' '),
    commercialUse: accepted ? 'allowed' : 'unknown',
    gated: false,
    source: pin.url,
    attribution: null,
  };
}
const realEsrganQualification = (licence: RealEsrganLicence) => ({
  licenseReviewed: licence === 'owner-accepted'
    ? { status: 'pass' as const, evidence: `publisher licence BSD-3-Clause; publisher file digest-identical to the pin; ${DIV2K_RISK} Accepted by the owner on 2026-11-17.` }
    : { status: 'not_assessed' as const, evidence: `publisher licence BSD-3-Clause and digest match recorded; ${DIV2K_RISK} Owner acceptance pending.` },
});
const NOT_RUN = { status: 'not_assessed' as const, evidence: 'set from a recorded run on a named profile' };

const upscaleGraph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'pulseframe_input.png' } },
  '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: AI_WAVE_PINS.realesrganX4plus.file } },
  '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
  '4': { class_type: 'ImageScaleBy', inputs: { image: ['3', 0], upscale_method: 'lanczos', scale_by: 1 } },
  '5': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'pulseframe_upscale' } },
};
/**
 * Photo upscale 2x, 3x or 4x (replaces comfy.image.upscale-4x 0.1.0): Real-ESRGAN x4plus makes 4x, then ImageScaleBy (lanczos)
 * takes it to the reviewed size: scale 0.5 → 2x, 0.75 → 3x, 1 → 4x. The output size is contract-checked exactly as ComfyUI
 * computes it (Python round of side × 4 × scale, nodes.py:1939-1940). EXPERIMENTAL: not quality-reviewed, not hardware-qualified.
 */
export function imageUpscaleDescriptor(licence: RealEsrganLicence = 'owner-accepted'): ComfyDescriptor {
  return ComfyDescriptorSchema.parse({
    id: 'comfy.image.upscale',
    version: '0.2.0',
    provider: 'comfyui',
    state: 'published',
    title: { he: 'הגדלת תמונה פי 2, 3 או 4 (ניסיוני)', en: 'Upscale photo 2x, 3x or 4x (experimental)' },
    description: {
      he: 'הגדלת תמונה סטילית באמצעות Real-ESRGAN: פי 4 מהמודל, ואז הקטנה מדויקת לפי 2, פי 3 או פי 4. רץ על המעבד; האיכות לא נבדקה.',
      en: 'Still-photo upscale with Real-ESRGAN: 4x from the model, then an exact resize to 2x, 3x or 4x. Runs on the CPU; quality not reviewed.',
    },
    source: { repository: COMFY_REPO, commit: COMFY_COMMIT, notices: 'Graph authored for PULSEFRAME from ComfyUI core nodes (comfy_extras.nodes_upscale_model, nodes.ImageScaleBy). Not copied from Freefield.' },
    graph: upscaleGraph,
    graphDigest: graphDigest(upscaleGraph),
    inputs: [
      { name: 'image', label: { he: 'תמונת מקור', en: 'Source image' }, type: 'image', binding: { nodeId: '1', input: 'image' }, required: true, reviewed: true },
      { name: 'scale', label: { he: 'הגדלה (0.5 = פי 2, 0.75 = פי 3, 1 = פי 4)', en: 'Enlargement (0.5 = 2x, 0.75 = 3x, 1 = 4x)' }, type: 'float', binding: { nodeId: '4', input: 'scale_by' }, required: false, default: 1, min: 0.5, max: 1, allowed: [0.5, 0.75, 1], reviewed: true },
    ],
    outputs: [{ name: 'image', role: 'primary', mediaType: 'image', nodeId: '5', encoding: 'display', reviewed: true, expectSize: { scaleOfInputByParam: { input: 'image', param: 'scale', base: 4 } } }],
    requiredNodes: core(['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScaleBy', 'SaveImage']),
    models: [realEsrganModel(AI_WAVE_PINS.realesrganX4plus, 'v0.1.0', licence)],
    runtime: { comfyuiCommit: COMFY_COMMIT, imageDigest: null },
    // Limits apply to the INPUT (up to 16x the pixels come out). 1 MP is the CPU bound of the plan.
    limits: { maxFrames: 1, maxPixels: 1024 * 1024 },
    resources: { downloadBytes: AI_WAVE_PINS.realesrganX4plus.bytes, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
    egress: 'none',
    languages: [],
    limitations: [
      'Still images only; video uses comfy.video.enhance.',
      'Not quality-reviewed: no reviewed fixtures. Upscaling invents detail and can alter faces, text and fine patterns.',
      'Inputs up to 1 megapixel on the CPU; memory and speed are measured per profile, not promised. Model file size is not runtime memory.',
      'Alpha is not kept: the model works on the colour channels only.',
      'The model file is a PyTorch .pth, read by ComfyUI through its weights-only loader (nodes_upscale_model.py, safe_load=True).',
    ],
    qualification: {
      schemaValid: { status: 'pass', evidence: 'DescriptorSchema + graph digest' },
      dependencyReady: { status: 'pass', evidence: 'core nodes at eee59185; model file verified by size and SHA-256 at run time' },
      ...realEsrganQualification(licence),
      executed: NOT_RUN,
      qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed fixture set' },
      hebrewQualified: NA,
      hardwareQualified: NOT_RUN,
    },
  });
}
export const IMAGE_UPSCALE: ComfyDescriptor = imageUpscaleDescriptor('owner-accepted');
/**
 * @deprecated comfy.image.upscale-4x 0.1.0 is replaced by comfy.image.upscale 0.2.0 (ADR-0017). This name is kept only so older
 * imports compile; it is the new descriptor, and the registry lists it once.
 */
export const IMAGE_UPSCALE_4X: ComfyDescriptor = IMAGE_UPSCALE;

const rifePin = AI_WAVE_PINS.rifeV425;
const slowmoGraph: ComfyGraph = {
  '1': { class_type: 'LoadVideo', inputs: { file: 'pulseframe_input.mkv' } },
  '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
  '3': { class_type: 'FrameInterpolationModelLoader', inputs: { model_name: rifePin.file } },
  '4': { class_type: 'FrameInterpolate', inputs: { interp_model: ['3', 0], images: ['2', 0], multiplier: 2 } },
  '5': { class_type: 'PreviewImage', inputs: { images: ['4', 0] } },
};
/**
 * Smooth slow motion: RIFE v4.25 makes m−1 new frames between every pair of source frames (FrameInterpolate copies the source
 * frames through unchanged, nodes_frame_interpolation.py). A frame job (ADR-0017): chunks of 48 source frames overlapping by one,
 * the result has exactly N·m frames at m times the source rate (the last frame is held m−1 times), and in place of a clip it is
 * placed together with set_clip_speed(1/m) so the clip becomes exactly m times longer. EXPERIMENTAL.
 */
export const VIDEO_SMOOTH_SLOWMO: ComfyDescriptor = ComfyDescriptorSchema.parse({
  id: 'comfy.video.smooth-slowmo',
  version: '0.1.0',
  provider: 'comfyui',
  state: 'published',
  title: { he: 'הילוך איטי חלק (ניסיוני)', en: 'Smooth slow motion (experimental)' },
  description: {
    he: 'יוצר פריימי ביניים עם RIFE כדי להאט קטע פי 2 או פי 4 בלי קפיצות. פריימי המקור נשמרים כמו שהם. רץ על המעבד; האיכות לא נבדקה.',
    en: 'Makes in-between frames with RIFE so a clip can play 2x or 4x slower without stutter. Source frames are kept unchanged. Runs on the CPU; quality not reviewed.',
  },
  source: { repository: COMFY_REPO, commit: COMFY_COMMIT, notices: 'Graph authored for PULSEFRAME from ComfyUI core nodes (comfy_extras.nodes_video, comfy_extras.nodes_frame_interpolation). Not copied from Freefield.' },
  graph: slowmoGraph,
  graphDigest: graphDigest(slowmoGraph),
  inputs: [
    { name: 'video', label: { he: 'וידאו מקור', en: 'Source video' }, type: 'video', binding: { nodeId: '1', input: 'file' }, required: true, reviewed: true },
    { name: 'multiplier', label: { he: 'האטה (פי)', en: 'Slow down (times)' }, type: 'int', binding: { nodeId: '4', input: 'multiplier' }, required: false, default: 2, min: 2, max: 4, allowed: [2, 4], reviewed: true },
  ],
  outputs: [{ name: 'video', role: 'primary', mediaType: 'video', nodeId: '5', encoding: 'display', reviewed: true, expectSize: { sameAsInput: 'video' }, expectFrames: 'pairwise' }],
  requiredNodes: core(['LoadVideo', 'GetVideoComponents', 'FrameInterpolationModelLoader', 'FrameInterpolate', 'PreviewImage']),
  models: [{
    role: 'frame_interpolation',
    path: `frame_interpolation/${rifePin.file}`,
    publisher: rifePin.publisher,
    revision: 'Comfy-Org/Frame-Interpolation@aa7009be4d1471ea0bac91d6fe4d7e4b637cbbfc',
    sha256: rifePin.sha256,
    bytes: rifePin.bytes,
    license: 'MIT',
    licenseEvidence: `${rifePin.licence} Pinned file: ${rifePin.url}, ${rifePin.bytes} bytes, sha256 ${rifePin.sha256} (${rifePin.evidence}).`,
    commercialUse: 'allowed',
    gated: false,
    source: rifePin.url,
    attribution: null,
  }],
  runtime: { comfyuiCommit: COMFY_COMMIT, imageDigest: null },
  limits: { maxFrames: 150, maxPixels: 1280 * 720 },
  resources: { downloadBytes: rifePin.bytes, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
  frames: { input: 'video', mode: 'pairwise', chunkFrames: 48, multiplierParam: 'multiplier', maxOutputRate: 120 },
  egress: 'none',
  languages: [],
  limitations: [
    'Not quality-reviewed: fast motion, occlusion, thin structures and text can smear or warp in the new frames.',
    'On the CPU: up to 1280x720 and 150 source frames per run; the output rate may not exceed 120 frames per second.',
    'Pairs across a scene cut found by the scenes analysis are held, not interpolated; without that analysis a cut is blended.',
    'The last frame is held m−1 times so the result has exactly m times the frames and the same length as the source range.',
    'Clips that change speed gradually, play backwards or freeze are refused.',
    'The model file is a key-renamed repack by Comfy-Org of the publisher\'s RIFE v4.25; Vimeo-90K training terms not reviewed.',
  ],
  qualification: {
    schemaValid: { status: 'pass', evidence: 'DescriptorSchema + graph digest' },
    dependencyReady: { status: 'pass', evidence: 'core nodes at eee59185; model file verified by size and SHA-256 at run time' },
    licenseReviewed: { status: 'pass', evidence: 'MIT per the original publisher (hzwer/Practical-RIFE); the file is a key-renamed repack recorded as such; training-data terms not reviewed. Metadata-level check.' },
    executed: NOT_RUN,
    qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed fixture set' },
    hebrewQualified: NA,
    hardwareQualified: NOT_RUN,
  },
});

const x4v3Pin = AI_WAVE_PINS.realesrGeneralX4v3;
const enhanceGraph: ComfyGraph = {
  '1': { class_type: 'LoadVideo', inputs: { file: 'pulseframe_input.mkv' } },
  '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
  '3': { class_type: 'UpscaleModelLoader', inputs: { model_name: x4v3Pin.file } },
  '4': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['3', 0], image: ['2', 0] } },
  '5': { class_type: 'ImageScaleBy', inputs: { image: ['4', 0], upscale_method: 'lanczos', scale_by: 1 } },
  '6': { class_type: 'PreviewImage', inputs: { images: ['5', 0] } },
};
/**
 * Video enhance: realesr-general-x4v3 per frame (the core node tiles at 512 px, nodes_upscale_model.py), then ImageScaleBy to 2x or
 * 4x. A frame job (ADR-0017) in chunks of 24 frames; frame count and rate equal the source, the source sound is copied back. EXPERIMENTAL.
 */
export function videoEnhanceDescriptor(licence: RealEsrganLicence = 'owner-accepted'): ComfyDescriptor {
  return ComfyDescriptorSchema.parse({
    id: 'comfy.video.enhance',
    version: '0.1.0',
    provider: 'comfyui',
    state: 'published',
    title: { he: 'שיפור והגדלת וידאו (ניסיוני)', en: 'Enhance and upscale video (experimental)' },
    description: {
      he: 'מנקה רעש ומגדיל וידאו פי 2 או פי 4, פריים אחר פריים, עם Real-ESRGAN (general x4v3). מספר הפריימים והקצב נשארים. רץ על המעבד; האיכות לא נבדקה.',
      en: 'Cleans up and upscales video 2x or 4x, frame by frame, with Real-ESRGAN (general x4v3). Frame count and rate stay the same. Runs on the CPU; quality not reviewed.',
    },
    source: { repository: COMFY_REPO, commit: COMFY_COMMIT, notices: 'Graph authored for PULSEFRAME from ComfyUI core nodes (comfy_extras.nodes_video, comfy_extras.nodes_upscale_model, nodes.ImageScaleBy). Not copied from Freefield.' },
    graph: enhanceGraph,
    graphDigest: graphDigest(enhanceGraph),
    inputs: [
      { name: 'video', label: { he: 'וידאו מקור', en: 'Source video' }, type: 'video', binding: { nodeId: '1', input: 'file' }, required: true, reviewed: true },
      { name: 'scale', label: { he: 'הגדלה (0.5 = פי 2, 1 = פי 4)', en: 'Enlargement (0.5 = 2x, 1 = 4x)' }, type: 'float', binding: { nodeId: '5', input: 'scale_by' }, required: false, default: 1, min: 0.5, max: 1, allowed: [0.5, 1], reviewed: true },
    ],
    outputs: [{ name: 'video', role: 'primary', mediaType: 'video', nodeId: '6', encoding: 'display', reviewed: true, expectSize: { scaleOfInputByParam: { input: 'video', param: 'scale', base: 4 } }, expectFrames: 'same' }],
    requiredNodes: core(['LoadVideo', 'GetVideoComponents', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScaleBy', 'PreviewImage']),
    models: [realEsrganModel(x4v3Pin, 'v0.2.5.0', licence)],
    runtime: { comfyuiCommit: COMFY_COMMIT, imageDigest: null },
    limits: { maxFrames: 300, maxPixels: 640 * 360 },
    resources: { downloadBytes: x4v3Pin.bytes, estimatedResidencyBytes: null, hostRamBytes: null, measuredProfiles: [] },
    frames: { input: 'video', mode: 'per-frame', chunkFrames: 24, maxOutputRate: 120 },
    egress: 'none',
    languages: [],
    limitations: [
      'This model file is the strongest denoising setting of Real-ESRGAN general x4v3 (no blend with the weak-denoise model): fine texture can be smoothed away.',
      'Frame-to-frame flicker has not been reviewed; each frame is processed on its own.',
      'On the CPU: inputs up to 640x360 and 300 frames per run.',
      'Not quality-reviewed: upscaling invents detail and can alter faces, text and fine patterns.',
      'Clips that change speed gradually, play backwards or freeze are refused.',
    ],
    qualification: {
      schemaValid: { status: 'pass', evidence: 'DescriptorSchema + graph digest' },
      dependencyReady: { status: 'pass', evidence: 'core nodes at eee59185; model file verified by size and SHA-256 at run time' },
      ...realEsrganQualification(licence),
      executed: NOT_RUN,
      qualityReviewed: { status: 'not_assessed', evidence: 'no reviewed fixture set; flicker not reviewed' },
      hebrewQualified: NA,
      hardwareQualified: NOT_RUN,
    },
  });
}
export const VIDEO_ENHANCE: ComfyDescriptor = videoEnhanceDescriptor('owner-accepted');

export const BUILTIN_CAPABILITIES: ComfyDescriptor[] = [SMOKE_SOLID_IMAGE, IMAGE_SOFT_BLUR, IMAGE_REMOVE_BACKGROUND, IMAGE_UPSCALE, VIDEO_SMOOTH_SLOWMO, VIDEO_ENHANCE];
