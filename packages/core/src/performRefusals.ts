/**
 * Every refusal of perform mode's op apply_take and of its route (ADR-0025): code, fixed English wording and hint. Lead
 * contract. The Hebrew table recognises the messages by their shape (packages/i18n/src/perform.ts HE_PERFORM) and
 * packages/evals/src/perform-wording.test.ts keeps the two in step. No runtime import of ops.ts (ops.ts must not depend on it).
 *
 * The op's codes are existing OpErrorCodes: a step outside TAKE_STEP_OPS → forbidden_op; a binding, a repeated bind name or an
 * $asset → invalid_args; more tracks than MAX_TAKE_TRACKS → out_of_bounds; the flash rule (performFlash.ts) → incompatible with
 * details.reason 'flash_limit' (and details.why gap | light | short, clipId, frame, since, gapFrames). A step's own refusal is
 * passed on in the step's own words, with details.step (index) and details.stepOp added.
 * The route's codes (ApiError): take_not_built 501 while the planner is not built (core PERFORM_PLANNER_BUILT false), take_empty
 * 409 when the planner kept no hit (details.chips), insufficient_scope 403 for propose-mode credentials.
 */
import type { OpErrorCode } from './ops.ts';
import { MAX_TAKE_TRACKS } from './performContract.ts';

/** Every row has a hint: the way forward, not only what is wrong (perform-wording.test.ts checks it, and the Hebrew sentence carries it). */
export interface PerformRefusalRow<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint: string): PerformRefusalRow<A> => ({ code, message, hint });

export const PERFORM_REFUSALS = {
  forbiddenStep: refusal('forbidden_op', (i: number, op: string) => `take step ${i} uses "${op}", which a take may not run`, 'A take only adds tracks, clips, titles and keys (core TAKE_STEP_OPS); make other edits as ordinary edits.'),
  bindTwice: refusal('invalid_args', (i: number, bind: string) => `take step ${i}: the bind name "${bind}" is used twice`, 'Give every bound step its own name.'),
  assetBinding: refusal('invalid_args', (i: number) => `take step ${i}: a take carries no media of its own, so "$asset" cannot be used`, 'Add the sound or element to the library first (it gets an asset id) and name that id in the step.'),
  tooManyTracks: refusal('out_of_bounds', (n: number) => `a take adds at most ${MAX_TAKE_TRACKS} tracks; this one adds ${n}`, 'Use fewer sound pads at the same time, or reuse the tracks earlier takes made.'),
  flashGap: refusal('incompatible', (frame: number, since: number, gap: number) => `the change of light this take makes at frame ${frame} comes ${since} frames after another; changes of light must be at least ${gap} frames apart (flash safety)`, 'Tap that pad less often, or leave a third of a second between pads that change light.'),
  flashLight: refusal('incompatible', (frame: number, gap: number) => `the change of light this take makes at frame ${frame} is within ${gap} frames of a strobe or a light transition (flash safety)`, 'Move the hit away from the strobe or the light transition, or remove one of them.'),
  flashShort: refusal('incompatible', (frame: number, frames: number, gap: number) => `the picture, title or change of light this take makes at frame ${frame} lasts ${frames} frames; it must last at least ${gap} (flash safety)`, 'Hold the pad a little longer, or give the pad a longer shortest length.'),
} as const;
export type PerformRefusalKey = keyof typeof PERFORM_REFUSALS;

/** The route's refusals (apps/server/src/perform.ts raises them as ApiError; their Hebrew wording: i18n perform.ts HE_PERFORM). */
export const PERFORM_API_REFUSALS = {
  notBuilt: { status: 501, code: 'take_not_built', message: () => 'performance takes are not built in this version yet', hint: 'Nothing was changed. The pads can be tried once this part is built.' },
  empty: { status: 409, code: 'take_empty', message: (taps: number) => `none of the ${taps} taps of this take could be kept`, hint: 'The chips say why each tap was left out (details.chips); nothing was changed.' },
  propose: { status: 403, code: 'insufficient_scope', message: () => 'this credential may only propose edits, and a performance take cannot be proposed: it is applied through an internal step that a proposal does not carry', hint: 'Ask the project owner to record the take, or for a grant in edit mode. dryRun: true still shows what it would do.' },
} as const;
export type PerformApiRefusalKey = keyof typeof PERFORM_API_REFUSALS;
