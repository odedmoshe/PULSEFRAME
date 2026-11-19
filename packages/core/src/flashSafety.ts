/**
 * The one number behind the product's flash limits (ADR-0009): two flash starts (or cuts that can flash) at least this
 * many frames apart are more than a third of a second apart, so no one-second period holds more than three of them.
 */
/** Frames between flash starts at a frame rate: a third of a second, up to whole frames, and one more. */
export const flashGapFrames = (fps: number) => Math.ceil(fps / 3 - 1e-9) + 1;
