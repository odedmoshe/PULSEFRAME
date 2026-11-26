# ADR-0003: Exact time representation

Status: accepted (Phase 0)

## Decision
All persisted times are rationals `{ "value": "<decimal integer string>", "timescale": <positive integer> }` (seconds = value / timescale).
Rates are `{ num, den }` (30000/1001 is stored as such). Arithmetic uses BigInt in `packages/time`.

Rules implemented and tested:
- Intervals are half-open `[start, start + duration)`.
- Frame `k` starts at exactly `k * den / num`. Frame containing `t` is `floor(t * num / den)`. Snapping rounds to the nearest boundary (ties up).
- Clip `start` and `duration` must be aligned to the project frame grid. An unaligned value is rejected and the error carries the nearest valid value.
- Audio positions are converted to sample indices from **absolute** times with round-half-away-from-zero; durations are differences of rounded positions, never accumulated.
- API microseconds are produced only at the boundary (`toMicros`), with the same rounding.
- Source frame selection (schema v1): `sourceTime = sourceIn + (t - clipStart)`, `sourceFrame = floor(sourceTime * assetRate)`, clamped to the last frame.
  Float-second decoder APIs receive the mid-frame time `(index + 0.5) / rate` to avoid boundary ambiguity.

## Limits today (updated Phase 2)
Speed is fixed at 1 (no ramps/reverse/freeze). Editable sources are constant-frame-rate, upright H.264/VP8/VP9/AV1.
Anything else (variable frame rate, rotation metadata, other codecs such as HEVC) goes through the **conform route** at ingest: the original bytes are kept
unchanged and a constant-rate, upright H.264 copy is what the timeline references; the asset records `conform` (reasons, original stream facts, frame mapping).
For VFR the target is the standard rate nearest the average rate and each conformed frame is the source frame nearest in time (`cfr-nearest-timestamp`);
rotation and codec-only conforms keep an identity frame mapping (tested: `apps/server/src/conform.test.ts`).
Source timestamps of the original are therefore not editable to sub-frame precision for VFR media; a first PTS of 0 is still assumed and unchecked.
Drop-frame timecode display is not implemented; display timecode is non-drop at the rounded-up base.
