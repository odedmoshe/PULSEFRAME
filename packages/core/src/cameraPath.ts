/**
 * Perform mode's virtual camera («צלם»; ADR-0025, W2): the spring, the clamp inside the picture, simplification to keys and the
 * camera plan (three replace_clip_keyframes calls with the take's clip-local range: a partial retake, keys outside the range
 * stay). Typed by performContract.ts (lead). This pre-pass fixes the signatures and refuses honestly: every function throws
 * until W2 builds it; nothing here returns a made-up path.
 *
 * W2 brief: geometry from the MASTER (doc.settings width, height, fit) and the asset's own picture size, as compositor2d.ts
 * placedSize; round scale up to 1e-4 and x, y toward zero to 1e-5, then re-check the picture still covers the frame; at most
 * MAX_CAMERA_KEYS key times, overTolerance when the residual stays above CAMERA_TOLERANCE; refusals CAMERA_REFUSALS; warning
 * 'linked_formats' when a linked format does not override the clip's transform. Pure; no engine import.
 */
import type { CameraLimits, PlanCamera, PoseToClip, SimplifyPath, SpringPath } from './performContract.ts';

const notBuilt = (name: string): never => { throw new Error(`${name} is not built yet (perform W2)`); };
export const cameraLimits: CameraLimits = () => notBuilt('cameraLimits');
export const poseToClip: PoseToClip = () => notBuilt('poseToClip');
export const springPath: SpringPath = () => notBuilt('springPath');
export const simplifyPath: SimplifyPath = () => notBuilt('simplifyPath');
export const planCamera: PlanCamera = () => notBuilt('planCamera');
