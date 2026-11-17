# ADR-0012: Trend pack — 18 new transitions, transition options, light transitions under flash safety, title looks

Status: **accepted** (2026-11-17); built, reviewed, repaired and merged. Proof so far: trend-baseline: the 348 existing frame hashes are identical
after the merge;
trend-transitions proof 15/15; trend-light proof 15/15; trend-text proof 25/25 after a repair (2026-11-17): the gradient of a title over 256 px ended
about 5 px below the ink (a product fault: Chromium measures ink boxes in 1/64-em steps above 256 px; fixed, baseline unchanged); the long
shadow and the extrude export were faults of the check (unequal coverage thresholds; a 4:2:0 encode of the still itself scores 35.97 dB),
both now measured as corrected with a control each; an independent verifier found no loosened check. Nobody has looked at any of this on real footage, and the seven new GPU
transitions have been
run only on a software renderer in the cloud, never on a real graphics card (ADR-0011:85: they count as verified only after the owner's run on the
laptop).

## Context
- The market survey lists the transitions and title looks that consumer editors now lead with (film burn, light leak, ink, brush, page turn, push-in
  punches, colour
  blocks, gradient and extruded titles), and beat-locked and speed-ramped transitions. This wave adds them without breaking the invariants: every edit
  is a registered op
  through `Store.commit` (ADR-0004), time is exact (ADR-0003), preview, stills and export use one `evaluate` + `drawGraph` (ADR-0005), nothing may
  flash (ADR-0009).
- Two designs and a judge (read-only workflow, `.artifacts/trendpack-plan.md`) chose the Canvas2D-first design with a few grafts. Wave-3 decisions
  numbered this ADR 0012 and
  accepted the light plan as an amendment to ADR-0009 decision 1 (ADR-0009 now says so in its status line).

## Decision
1. **Registry.** `TRANSITIONS` (core `effects.ts`) goes from 51 to 69 rows, appended so the order of the old rows is unchanged; GPU ids go from 39 to
   46. Each row now names a `kernel`, a `category` (11 in `TRANSITION_CATEGORIES`, new: `light`, `mask`, `mg`, `paper`, with Hebrew group names under
   `look.trcat.*`) and optional flags (`singleCrossing`, `shapeDependent`, `cover`, `light`, `options`, `defaults`). No schema version change: new
   fields are optional and a clip without them draws as before.
2. **Eleven Canvas2D transitions** (no graphics adapter needed): punch-in and punch-out, blur-dissolve, split-open-h/v, shape-heart and shape-star
   (colour rim), block-left/right (colour bars), slices-h/v (seeded). Canvas kernels are chosen by the registry's kernel name through `CANVAS_KERNELS`
   (`canvasTransitions.ts`), not by id prefix; a test pins that every non-GPU id has a kernel, so an unknown id cannot silently become a hard cut. The
   five older kernels moved there unchanged.
3. **Scratch canvas slot 13** (`CANVAS_TRANSITION_SLOT`) belongs to these kernels, next to the existing slot 6; punch and blur-dissolve use it. Slots
   10–12 are the title looks (decision 8), 14 the adjustment pass (ADR-0016), 15–16 redaction (ADR-0015).
4. **Seven GPU transitions** (WGSL, no CPU twin, ADR-0008): film-burn «צריבת פילם», light-leak «דליפת אור», ink-bleed «כתם דיו», brush-left «משיכת
   מכחול שמאלה», brush-right «משיכת מכחול ימינה», page-turn-left «דפדוף שמאלה», page-turn-right «דפדוף ימינה». The transition uniform is v2: 12 floats
   (`transitionUniforms`), a = (p, v0, v1, v2), b = (W/H, W, H, light), c = (tint r, g, b, seed); shared `fbm`/`vnoise` helpers; the old kernel bodies
   are unchanged. JavaScript models of the geometry (`burnThreshold`, `brushFront`, `pageFold`, `pageTurnSource`) exist for the proofs only and never
   render.
5. **Options through one op, `set_transition_options`** (clip, `sync: 'beat'`, `velocity` 2|3|4, `color`, `seed`; null removes one), sharing
   `checkTransition` with `set_transition`.
   - Beat lock: the decisive moment (progress 0.5) lands on the analysed beat nearest the middle of the window (`beatSwitchFrame`); with no beat
     there, or fewer than 3 frames, it plays as usual. Velocity ramp: picture only, whole-frame offsets (`velocityOffsets`); sound stays a hard cut.
     Refused on reversed or frozen clips, when either side's first effect is a time effect, and when it needs more unused source than there is
     (`velocityLimit` gives the editor the largest allowed). `color` and `seed` only where the type declares them. `set_transition` keeps the options
     of the old transition that the new type supports.
6. **Light transitions amend ADR-0009 decision 1.** film-burn and light-leak carry `light: true`. `lightEnvelope` (core `transitionTiming.ts`) is one
   sin² rise and fall lasting min(0.4 s, the transition), equal to 1 on the switch frame; `lightStartFrame` is its first frame above 0. In
   `flashSchedule` that start joins the strobe starts and is kept by the same rule (`flashGapFrames` after the last kept start of any strobe or
   light). `FlashSchedule.lights` maps the carrying clip id to `{frame, kept, since}`; `evaluate` puts `lightEnvelope` on the incoming layer's `light`
   when the start was kept and 0 otherwise, so a held light adds exactly nothing. `FlashGuard` follows the stronger of the strobe light and the
   transition light on the layer, and a rise that would come too soon is drawn with no strobe and no transition light. The legacy `flash` and `dip-*`
   stay outside the schedule (ADR-0011:80). `FlashAnalyser.peak()` returns the most transitions any one cell had in a one-second window (general and
   red), for the proofs. The inspector says whether a light is shown or held, and for how long since the last flash.
7. **Surfaces.** The picker in the look panel is grouped by category and, with a transition selected, shows an options fieldset: beat lock with a
   status line (the frame it locks to, or that no beat falls there), velocity choices disabled with the frames each needs, colour (picker and hex),
   seed with a shuffle button, and the light line. The effects gallery groups transitions by category; a hovered or focused tile loops frames 56–78 of
   a 60/74 scene through the dialog's `FlashGuard`, never under reduced motion; GPU tiles say «דורש כרטיס מסך» without an adapter. Preflight reports a
   velocity ramp or transition that outgrew its source (`velocity_source`). The Lab draws both frame shapes for `shapeDependent` ids.
8. **Title looks, Canvas2D only** (`textEffects.ts`, scratch slots 10–12: silhouette, two work buffers). Six optional `TextStyle` fields: `gradient`
   (2–3 colours, angle), `tracking`, `stroke2`, `glow`, `extrude` (`depthFrac`, `angle`, `shade`) and `longShadow`. `update_text` sets them (null
   removes one; `normaliseTextStyle` drops "off" values, so a title without a look is stored and drawn as before). Entrance `blur` and `write`, and
   exit `blur`, were added to the text animations. Ten text presets (40 to 50, `TREND_TEXT_PRESET_IDS`) are built on the fields; the inspector has a
   title-effects block (`TextEffectsField`).

## Not in this wave
- The build follows the plan; no deviation was found when the merged code was read against it.
- Left out on purpose: bloom-cut, title templates, emoji, text on a path, the sweep caption preset, the hexagram shape, a reduced-flashing export
  option, a ramped sound crossfade.

## Consequences / what is not promised
- The 18 transitions, the options and the title looks are checked by measurement on synthetic fixtures; nobody has seen them on real footage. The
  seven GPU ids are
  unverified on hardware until the owner runs them (docs/QUICKSTART.he.md).
- A light that the schedule holds is drawn without light: a film burn near a strobe or another light can look weaker than in the gallery. The legacy
  flash and dip transitions can
  still flash by cuts; the export's flash check reads them (ADR-0009 decision 4).
- Moving a beat-locked clip or changing the music's beats moves the switch frame; the plan is a pure function of the document, so preview, still and
  export agree.
- Text on a path, emoji, title templates and the other wave-2 items above are separate work.
