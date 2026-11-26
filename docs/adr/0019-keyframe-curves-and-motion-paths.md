# ADR-0019: Keyframe curves, key strip, curve picker and motion path

Status: **Accepted — built; end-to-end proofs being run at the time of writing** (2026-11-18) for wave 1.
Built by three workers on shared contracts, each reviewed and repaired, merged.
No proof result is claimed here: `pnpm proof:keyframes` is written; its outcome belongs in docs/PROGRESS.md.

## Context
- Keys had five easings (linear, hold, ease and two more) and no way to see or shape them; the survey and
  R-14.1 ask for curves and a motion path.
- Every picture comes from one sampler (ADR-0005), every edit is a registered op (ADR-0004), times are exact
  (ADR-0003), flash safety is ADR-0009.
- Two designs and a judge (read-only workflow, 2026-11-17, `.artifacts/keyframes-plan.md`) chose design B with
  grafts from design A (shape-keeping insertion, an old-sampler oracle, a channel gate).
  The plan file has no verifier section; the lead's wave-4 decisions settle its open questions.

## Decision
1. **One key definition** in `packages/core/src/keyframe.ts`: `{time, value, easing, bezier?}`. Thirteen
   easings: the five of v1 plus `smooth`, `gentle`, `sharp`, `overshoot`, `anticipate`, `bounce`, `spring`,
   `bezier`.
   `bezier` is four numbers (x in 0..1, y in −1..2) and is present exactly when the easing is `bezier`
(validation code `keyframe_curve`).
   Handle x is a fraction of the segment's own duration and y a fraction of the value change, never times, so
trims, splits, freezes, cuts, gaps and speed changes keep every shape.
2. **One sampler.** `sampleKeyframes(keys, t, range)` takes a required value range. The v1 branches are
   byte-identical to before (an old-sampler oracle test keeps them honest, `pnpm baseline:keys --check`).
   `gentle`, `sharp`, `overshoot`, `anticipate` and `bezier` are solved by exactly 48 bisection halvings and
clamped to the range. `smooth` is a monotone cubic Hermite (Steffen) from the neighbouring keys:
   it never overshoots, equals smoothstep with two keys, and is the only curve whose shape depends on its
neighbours (accepted by the lead as wave 1's automatic curve).
3. **Flash rule (ADR-0009 decision 3).** Overshoot, anticipate, bounce, spring and turn-back custom curves are
   refused on opacity (adjustment opacity included) and on every effect parameter outside `modulatableParams`
   (validation code `keyframe_curve_flash`). Every curve allowed on a light channel is monotone.
4. **Ops.** `set_keyframe` and `set_effect_keyframe` gain `bezier`; an omitted easing on an existing key keeps
   easing and handles. A new key inside a segment whose start key has a non-v1 curve is inserted with
   `splitSegment`
   (the output says `exact` or `approximate`); v1 segments keep today's insertion rule so old op logs replay
byte-identically.
   New: `replace_effect_keyframes`, `set_keyframe_curve` (changes only easing and bezier), and the range form
of ADR-0018's `replace_clip_keyframes`. Helpers are in `keyframeChannels.ts`;
   transform channels go through `replace_clip_keyframes` ranges and effect channels through
`replace_effect_keyframes`. Adjustment clips accept opacity keys only.
5. **Schema.** Version 3 with the identity migration owned by ADR-0018. Before the bump an old build rejected
   the new easings with a zod error; a v3 build from before this track still does, so wave-4 builds ship
   together.
6. **Editor** (session state only: `keySel`, `keyClipboard`, `curvePicker`, `pathOn`; none is in the document
   or in presence). A key strip on the clip, aggregated by exact frame; a curve picker
   (smooth, straight, twelve named tiles drawn by the one sampler, a custom 128×128 editor); a motion path
over the viewer from `pathPoints` (at most 600 points) with draggable vertices and a bend grip.
   A drag writes only the axes it moved. In a format view and for a follower (`clip.follow`) the path is
read-only or hidden with a stated reason: the follower path waits for wave 2 by the lead's decision.
7. **The K key** now keys only the channels the clip carries (`channelsFor`), fixing a bug where K on an
   adjustment clip produced a commit that validation refused.
8. **Keyboard:** commands in group `keyframe` (`keyframe.focus` default Alt+K, others unbound); focused strip
   keys and path points handle their own keys and stop propagation.

## Consequences / what is not promised
- Old op logs replay byte-identically (`keyframe-replay.test.ts` over the v1 fuzz corpus; its golden must be
  re-recorded deliberately if an older op's behaviour changes).
- Hebrew curve names and strip/picker strings are starting points nobody has reviewed; the shorts track words
  `replace_clip_keyframes` differently from this track's UI (the owner should choose one term).
- Not built (wave 2): a multi-channel graph with rate-of-change view, spatial tangents, baked bounce/elastic,
  the follower's resolved path with the tracking overlay, per-format keys, even speed along a path.
- R-14.1 stays "partial".

## Verified / not verified
- Builders ran their unit and engine tests in their own worktrees (curve maths, sampler branches, rules,
  replay, path and strip logic); a few cases are gated until the other tracks' bodies merged.
- Not verified at the time of writing: `pnpm proof:keyframes`, `pnpm baseline:keys --check` and the parity and
  render-fuzz additions on the merged tree, the editor interactions, accessibility audit and Phase 3 reruns.
- Measurements the proof will record (budgets, not results): sampler ns per sample (budget 2 µs), `pathPoints`
  for 600 points (16 ms), commit p95 for 2000 keys (+15 ms).
- Known open item from review: the key strip sets only the segment after the key for S and L while proof P3
  expects both sides; either the strip passes `both` or P3 is narrowed.
