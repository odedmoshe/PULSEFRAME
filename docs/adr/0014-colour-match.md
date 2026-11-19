# ADR-0014: Colour match «התאמת צבע» and automatic colour balance «איזון צבע אוטומטי»

Status: **accepted** (2026-11-17); built, reviewed, repaired and merged. Proof: `pnpm proof:colourmatch` 17/17 after a repair (2026-11-17): the first run failed 6/8; the tint runaway and the fit's
starting points were product faults (fixed), the flat test pattern hid tint from any statistics fit (M2 now on a picture with mid-tones, the
flat pattern kept as M2b against the runaway), the M3 cast was already "close" before any match (fixture changed), and an independent
verifier then showed the fit minimised another measure than the distance it reports (fixed: see Consequences). Nobody has compared a match with its reference by
eye on real footage;
the fit has been measured only on synthetic and fixture pictures.

## Context
- Clips shot at different times or on different cameras differ in brightness and colour cast; editors offer "match this clip to that one". This editor
  had a colour grade
  (`color.grade`: exposure, temperature, tint, contrast, saturation, shadows, highlights, fade) and looks, but no way to derive the values.
- Invariants: the result must be ordinary editable state through registered ops (ADR-0004); the picture is drawn only by the WGSL pass, with no CPU
  twin as a renderer
  (ADR-0008 decision 2); a static grade per clip cannot add flashing (ADR-0009), and every export still runs the flash check.

## Decision
1. **No new effect and no new storage.** A match produces values for the existing `color.grade` effect. The public op `set_colour_grade` (`clipId`,
   partial `params`, `mode` replace|merge, `dropKeyframes`) puts the grade where `apply_look` would: the clip's first colour grade is replaced in
   place (same id, turned on), or one is added first in the effect list (after a time effect). It refuses animated values unless `dropKeyframes` is
   set. Every value stays editable with `update_effect`, and one transaction of N such ops is one undo.
2. **A model of the pass, used to fit and to prove, never to render.** `gradePixel` (`engine/colourMatch.ts`) follows the `color.grade` WGSL step for
   step (the `digicamTone` precedent). `pnpm proof:gpu` check M1 compares the real pass with it on a 9×9×9 colour grid at six seeded parameter sets.
3. **Statistics, not content.** `pictureStats` measures, in CIELAB (D65) on straight pixels sampled on a fixed grid (up to 4096 points): lightness
   percentiles (2, 10, 50, 90, 98), the mean a* and b* and chroma of the mid-tones (L* about 20–85, soft edges), and the median colour.
   `statsDistance` is the colour distance of the mean a*, b* and spread plus the mean absolute percentile difference; verdicts are close (≤ 2),
   noticeable (≤ 5), partial.
4. **The fit** (`fitGrade`): exposure, temperature, tint, contrast and saturation are fitted by a closed-form start from the channel medians, a coarse
   grid and coordinate search, then a Gauss-Newton refinement, with a small pull toward defaults. Shadows, highlights and fade are held at the
   reference clip's own grade values so its tinted shadows and faded blacks carry over. `amount` 0..1 blends toward no change. Values are clamped to
   the effect's ranges (`limitedBy` lists those that hit a limit). `balanceGrade` is the no-reference variant: it fits exposure, temperature, tint and
   contrast toward `balanceGoal` of the picture itself (neutral mid-tones, a wider lightness range, median halfway to 50); saturation is kept.
5. **Measuring is read-only and goes through the real compositor** (`apps/server/src/colourMatch.ts`): REST `POST
   /api/v1/projects/:id/analysis/colour-match` (durable job kind `colour`), MCP `match_colour`. Each clip is rendered alone in a scratch document
   (`isolateClip`, never committed) at 25, 50 and 75 % of its length, at a quarter of the frame size, through `Exporter.renderStill`; the reference as
   it is shown, a target with its own grade and later effects off. The result is verified by a second render with the real `set_colour_grade` op
   applied (dry run); `residual` has `model` and `verified`. The answer carries candidate ops to send as one transaction.
6. **Warnings, in words.** `replaces_grade` (the match replaces the clip's existing grade, a look included; a stacked match grade is wave 2),
   `changes_within_clip` (the sample frames differ by more than a set limit, so one grade will not fit all of the clip), `animated_grade` (left out of
   the ops), `not_verified`.
7. **Honest limits.** A red wall or green grass pulls the statistics the wrong way: the user picks the reference and `amount`. `color.grade` has no
   curves and a limited white balance range, so a strong cast is `partial`. Without a graphics adapter the render worker cannot render the grade: the
   result then says `unavailable`, carries only model residuals, and the panel is disabled with the reason; a reference that itself needs an adapter
   answers 503 `renderer_unavailable`.
8. **Surface.** A panel «התאמת צבע» in the look panel of a picture clip (`ColourMatchPanel.tsx`): set the selected clip as reference, scope (selected
   clip, track, all), method (match to a reference, or auto balance), amount, measure, still before/after/reference tiles, one «apply» that commits
   all ops at once.

## Where the build differs from the plan
- The panel is its own file mounted in `LookPanel`, with `matchColour` in a server file of its own; scope includes track and all clips.
- When no adapter exists the measurement still runs on the model and reports `unavailable`, rather than refusing outright; the panel itself is
  disabled.
- Fitting from browser drafts, a "full" fit of shadows, highlights and fade, a generated colour table for partial residuals and a CPU fallback grade
  are wave 2.

## Consequences / what is not promised
- The match fit searches on a sum of squares of the statistics and finishes with iteratively reweighted least squares on the distance it
  reports (statsDistance: |mid-tone colour difference| + mean |L* percentile error|), anchored at the search's estimate and never accepting a
  worse result by that measure. On pictures of flat colours this distance has minima narrower than the 0.001 step of a grade value and than an
  8-bit render (on the proof's first M3 stills the fit reaches 0.41, 0.42 rounded to 8 bits, where a search finds 0.28 in the model but only
  0.40 rounded), so the verified figure, not the model residual, is the one to trust there.
- A match is a static grade per clip: a clip that changes light inside itself is matched on three frames and warned about.
- Each match replaces an existing grade; undo restores it.
- The numbers (residual, verdict) describe statistics of three frames, not how the clip looks. Nothing here is called "looks right".

- Every export still runs the flash check; a static grade per clip adds no flashing of its own, and the proof for that (M7) is part of the failing colourmatch run above.
