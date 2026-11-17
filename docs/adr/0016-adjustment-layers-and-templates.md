# ADR-0016: Adjustment layers, replace media and templates (rule-based, no model)

Status: **accepted** (2026-11-17) for wave 1. Built by three workers on shared contracts, each reviewed and repaired, merged. Proofs: see docs/PROGRESS.md.

## Context
- The market survey (docs/MARKET_RESEARCH.md) lists three things this editor lacked: a look that covers a whole edit or a section without being copied
  onto every clip (adjustment layers), a one-step way to swap the picture in a clip while keeping its edits, and "use template" that turns media and
  music into an edit cut on the beat. R-11.2 names adjustment tracks as a new track kind; SPEC.md:839 asks templates to compile to editable native clips.
- Two designs were judged (read-only workflow, 2026-11-17, `.artifacts/templates-plan.md`). Design A made templates stored projects with compound
  clips; design B made them versioned data compiled by a pure planner into the public ops. B won, with A's validation rules, linked-partner handling
  and propose-mode finding grafted in. Compound clips (nested sequences) are a later ADR.
- The invariants stay: every edit is a registered op through `Store.commit` (ADR-0004), time is exact (ADR-0003), preview, `render_frame` and export
  use one `evaluate` + `drawGraph` (ADR-0005), nothing may flash (ADR-0009), no models are installed or downloaded by a template (ADR-0007).

## Decision
1. **Schema version 2, identity migration.** `SCHEMA_VERSION` is 2 (`schema.ts`). The v1 to v2 migration only changes the number: adjustment clips and
   tracks and run slot records are new and optional. A build that knows only version 1 refuses a version 2 file with "newer than supported".
2. **Adjustment clips and tracks.** A clip of type `adjustment` lives only on a track of kind `adjustment` (validation: `incompatible_track`).
   - It has no picture of its own. Its enabled effects, mask, opacity and blend act on everything already drawn below it in its sequence at that time:
     pictures and titles on lower tracks. Captions are drawn last and are never affected.
   - Only opacity can be set or animated. Position, scale and rotation must be identity and have no keyframes (`adjustment_transform`); the transform,
     keyframe and variant ops refuse the other properties. No transition, no speed, no source ops (each refused by name). The mask is in frame space.
   - Refused as effects on an adjustment (`adjustmentRefusal`, `adjustment_effect`): time effects (they need a clip's own source and cannot act on the
     picture below), `key.chroma` (it would cut holes through to the background), `stylize.shadow` (no visible result on a full-frame picture).
   - Tracks are ordered bottom to top: picture tracks, adjustment tracks, title tracks, audio. A new picture track lands below the FX track, a new title
     track above it, so a look covers pictures added later and titles stay clean by default. Moving an FX track above a title makes the look cover it.
     Default names are FX1, FX2 and so on, shown in Hebrew as «התאמה».
   - Op `add_adjustment`: `span` is `"edit"` (from 0 to the end of the last picture or title clip) or an exact `{start, duration}`.
   - Rendering: `evaluate` emits an `adjust` layer in track order, before captions. `drawGraph` copies the canvas so far into scratch slot 14
     (`ADJUST_PASS_SLOT`), runs the effects with a whole-frame box, applies the mask, then composites back with opacity and blend. For the normal blend
     that is frame·(1 − α·m) + adjusted·α·m; masked-out pixels are byte-identical. No picture is requested, so decoder counts do not change.
   - Flash safety (ADR-0009): the strobe schedule skips only hidden, audio and caption tracks, so a strobe on an adjustment layer joins the one
     timeline schedule with every other strobe.
3. **replace_clip_media** (public op). The clip keeps its id and everything on it; only `assetId` and `sourceIn` change. It refuses a file too short
   for the clip or for the next clip's transition handle, a still where speed, reverse, freeze or a ramp is set, and privacy regions that no longer
   fit. A linked sound partner takes the new file too (`linked: 'follow'`, the default); `linked: 'detach'` unlinks it instead.
4. **A template is data.** A `TemplateDef` (`templateContract.ts`) holds slots, rules and a look, with no frame numbers and no code. Versions are
   integers. It is compiled by a pure planner, `planTemplate` (`templatePlan.ts`): same document and input give the same plan.
   - Beat-synced when the template carries music: boundaries come from the analysed beats (or bars) mapped onto the timeline, or from an exact
     steady grid without music. Every boundary is snapped to a frame once, from absolute times; slot lengths are differences of snapped ends
     (ADR-0003). Cuts closer than the flash gap are merged; slots past the end of the music are dropped. Both are reported as warnings.
   - A medium shorter than its slot blocks the plan (`slot_too_short`, naming the slot and the frames needed). Nothing is padded. Hebrew mirrors
     left and right transitions and moves.
   - Alternatives are offered with the plan (tempo normal, half, double; shuffle with the next seed; no camera moves for reduced motion).
5. **One internal op applies it.** `apply_template` (`templateOps.ts`) is internal, like `apply_recipe`. Its arguments carry everything (asset
   records, the resolved ops, the slots), so replay never reads the catalogue. It runs the planned ops as steps in one undoable transaction against
   the revision the plan was made from, and records a run (`recipeRuns`, recipe id `template:<id>`) with fingerprints and slot records.
   - Bindings: a step may use `{"$ref": name}` (an earlier step's output), optionally with `out` and `at`, or `{"$asset": key}`. They are resolved
     before the step's own parse and refused with `invalid_args` for any extra key, forward or unknown name, wrong value type or duplicate bind.
     Steps may be public ops only; at most 2000 ops, 400 slots, 64 levels of nesting.
   - Ids that name `Object.prototype` members (`constructor`, `toString`, `__proto__`) are handled with Maps and `Object.hasOwn`. Review found that the
     tests for `toString` and `constructor` cannot fail without the guard; it is defence in depth, not something a test observes.
6. **Regenerate** (shuffle, another tempo) replaces what the run made and nobody changed. It protects hand-edited slots by fingerprint, and a
   protected clip protects its whole link group (a slot's picture and its own sound stay together, unchanged). A kept picture that no longer lies on
   the range the new plan gives its slot is refused (409 `template_blocked`, listing each slot) instead of leaving frames without a picture.
7. **Built-in catalogue** (`templateCatalog.ts`, all on Canvas2D effects, Hebrew and English names): `tpl.travel-montage`, `tpl.photo-dump`,
   `tpl.birthday`, `tpl.quote-card`, `tpl.countdown-list`, `tpl.home-video`. Your own clips are muted by default and the music carries the sound
   (`keepAudio` false); Home Video keeps each clip's own sound. Two more are listed unavailable with a reason: `tpl.text-behind-subject` (needs video
   segmentation) and `tpl.3d-zoom` (needs depth estimation). Plan and apply of those answer 409 `needs_capability`; nothing is downloaded or run.
8. **Surfaces and permission.** REST: list, plan (read-only), apply, regenerate; MCP: `plan_template`, `apply_template`, `regenerate_template`; the
   editor has a Templates drawer, a plan dialog and a "Shuffle" bar. A credential in propose mode is refused with 403 `insufficient_scope`: a
   proposal runs without internal ops, so a template cannot be proposed (the same as recipes). Planning stays allowed.

## Consequences / what is not promised
- Projects saved by this build use version 2 and do not open in older builds.
- Nobody has judged the six templates on real footage: the cuts, titles and looks are checked by measurement, not by eye. Text width in Hebrew is not
  measured by the planner (`maxChars` and a browser-side warning only).
- Scratch slot 14 is this ADR's; slots 10 to 13 and 15 to 16 belong to other tracks (docs/adr and wave-3 decisions).
- A full-frame pass costs time in software Canvas2D. It is measured, not gated.
- No animated template previews in wave 1. "Slow down to fill" for a short clip, best-fit assignment of media to slots, and the other templates of
  SPEC.md are later.
- Compound clips (nested sequences) and save-as-template are wave 2, each with its own ADR. Server-built proposals for propose-mode agents are not built.
