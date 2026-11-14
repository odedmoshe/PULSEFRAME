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

## Limits today
Speed is fixed at 1 (no ramps/reverse/freeze), sources must be constant frame rate and unrotated (VFR and rotated files are rejected at ingest with a typed error). A first PTS of 0 is assumed and not yet checked.
Drop-frame timecode display is not implemented; display timecode is non-drop at the rounded-up base.
