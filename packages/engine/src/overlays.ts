/**
 * Overlay effects (snow, confetti, hearts, bokeh, speed lines): a closed-form lattice model of the particles of one frame,
 * a pure function of its arguments, drawn by look.ts in Canvas2D.
 *
 * STUB (lead pre-pass): the signatures below are the contract; the bodies are placeholders until W2 builds them.
 */
import type { BeatPosition } from '@pulseframe/core';

export interface Particle { x: number; y: number; r: number; rot: number; alpha: number; layer: 0 | 1 | 2; colour: string; shape: 'disc' | 'rect' | 'heart' | 'ring' | 'hexagon' }
/** Every particle of an overlay effect on one frame, in frame pixels: a pure function of its arguments (timeline seconds for motion, clip-local seconds for bursts). */
export function overlayParticles(type: string, params: Record<string, number | string | boolean>, width: number, height: number, seconds: number, local: number, beat: BeatPosition | null): Particle[] { return []; }
export interface SpeedLine { a0: number; a1: number; r0: number; r1: number }
export function speedLines(params: Record<string, number | string | boolean>, width: number, height: number, seconds: number): { cx: number; cy: number; lines: SpeedLine[] } { return { cx: width / 2, cy: height / 2, lines: [] }; }
