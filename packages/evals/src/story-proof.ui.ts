/**
 * proof:story — the interface part (W3): U1–U15 of story-proof.ts, in headless Chromium with the fake microphone fed from a fixture
 * (--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<file>%noloop; one launch per
 * file). LEAD PRE-PASS stub: not built.
 */
import type { StoryProofPart } from './story-proof.ts';

export const STORY_PROOF_UI: StoryProofPart = { built: false, checks: {} };
