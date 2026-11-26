export * from './evaluate.ts';
export * from './compositor2d.ts';
export * from './captions.ts';
export { grainOffset, COMPOSITE, REGION_COPY_SLOT, REGION_MASK_SLOT, regionBlurPx, regionBlocks } from './look.ts';
export { resolveFollows, resolveRegions, WHOLE_BLUR_MIN_STRENGTH, type Follower, type LayerAt } from './follow.ts';
export * from './audio.ts';
export * from './stretch.ts';
export { motionAt, musicHit, smoothNoise, hash32, unit32, initGpu, gpuStatus, isGpuEffect, isGpuTransition, GPU_EFFECTS, GPU_TRANSITIONS, transitionUniforms, digicamTick, digicamTone, crtMap, thinnedHits, type GpuStatus, type LutStrip, type TransitionState } from './gpu.ts';
export { CANVAS_TRANSITIONS, CANVAS_KERNELS, CANVAS_TRANSITION_SLOT, type CanvasKernel, type CanvasTransitionArgs } from './canvasTransitions.ts';
export { textAtRest, unitPose, unitProgress, type UnitPose } from './textAnimation.ts';
export { flashSchedule, FlashGuard, SCREEN_FLASH_AHEAD_MAX, SCREEN_FLASH_GAP, SCREEN_FLASH_SEEN, SCREEN_FLASH_STEP, layerLights, screenLight, flashSince, flashGapFrames, lightKey, type FlashDecision, type FlashPainted, type FlashSchedule, type LightPlan } from './strobeSchedule.ts';
export { FlashAnalyser, flashCells, FLASH_GRID, type FlashCells, type FlashRange, type FlashReport } from './flashAnalysis.ts';
export * from './audiofx/index.ts';
export { soundEnd, fxSeed, type PlannedVoice, type AudioPlanOptions } from './audio.ts';
export { TAP_PLACE_SLOT, tapOffsets, tapWeights, pieceAt, runStart, tapMerger, stutterFrame, beatStepFrames, maxDecodeLanes, decodeLaneSteps, type TapMerger } from './taps.ts';
export { decodeOverBudget, type DecodeStretch } from './decodeBudget.ts';
export { overlayParticles, speedLines, type Particle, type SpeedLine } from './overlays.ts';
export { stampPolygons, STAMP_TEXT } from './stamp.ts';
export { applyModulators } from './modulate.ts';
export { VOICE_MEASURE_RATE, voiceMeter, recommendedStrength, type VoiceMeasureOptions, type VoiceMeasurement, type VoiceMeter } from './voiceMeasure.ts';
export { GRADE_DEFAULTS, gradePixel, samplePicture, mergeSamples, pictureStats, statsDistance, fitGrade, balanceGrade, type GradeParams, type PictureSample, type PictureStats, type GradeFit } from './colourMatch.ts';
// segmented export and render cache (ADR-0024): the frame key and the segment grid
export * from './frameKey.ts';
export * from './segmentGrid.ts';
// send and keep (wave 7, track send): the limiter (A), sound checks (A) and picture checks (B); stubs until the workers land them
export { limiterCeilingLinear, limiterWindow, MasterLimiter, MASTER_LIMITER_BUILT, type LimiterStats } from './masterLimiter.ts';
export { SoundCheck, SOUND_CHECK_BUILT, type SoundRun } from './soundCheck.ts';
export { PictureCheck, PICTURE_CHECK_BUILT, type PictureRun } from './pictureCheck.ts';
export { registerDrawnPainter, unregisterDrawnPainter, drawnPainter, noPainterId, type DrawnPainter, type DrawnPaintEnv } from './drawnPainters.ts';
