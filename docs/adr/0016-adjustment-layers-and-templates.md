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
   - *Amendment (wave 6): a hand delete survives regeneration.* An item is "deleted by hand" when its run slot record names a clip
     that is no longer in the document (`removedByHand`, templateOps.ts). Nothing new is stored and the schema is unchanged: the
     record already outlives its clip, so the answer follows the document and its history (undo the delete and the slot is live
     again). Regeneration passes those records on as `keepSlots` (so the new run record still holds them) and their keys as
     `removedKeys`: the planner does not emit them, says so in notice `removed_by_hand` (Hebrew and English in i18n
     `template.notice.removed_by_hand`) and offers the alternative `{restoreRemoved: true}`. The regenerate request (REST body,
     MCP `regenerate_template` / `regenerate_recipe`) takes `restoreRemoved: true` as the explicit choice to make them again; the
     result lists the left-out keys in `removed`. The family film (ADR-0026) does the same: a deleted title or closing card is not
     placed; a deleted pick leaves out only the window it showed when its file has another window to give, and the whole file
     (exclusion `removed_by_hand`) when it can give only one pick (a still, an unmeasured or flat video). The warning names each
     file, and each window by its time. The window comes from the run record (`params.picked`; carried on in the optional
     `params.removedPicks`). Music deleted by hand gives the no-music mix (own sound not lowered, ducking turned off); the cuts
     stay on its bars while the length and order are unchanged and move to a steady grid otherwise (warning `music_removed`;
     optional `params.cutOn`). The beat montage records where each clip was placed (optional `run.ranges`, written when
     `apply_recipe` gets `recordRanges`; older runs have none), so a deleted clip's range stays empty on regeneration and is
     carried on (`keepRanges`). The multicam auto-switch regenerates in place and `switch_angles` skips gaps, so a deleted
     segment was already never refilled; a test holds it. All of it travels in the op's arguments, so replay is unchanged and
     byte-identical.
   - *Amendment (2026-11-24): what "edited by hand" means.* A clip a template run made whose ONLY change since the run is its place in
     time on its own track is not edited by hand. It is treated like an untouched clip: replaced, and made again on its place.
     Reason: a new project closes the gap on Delete (ripple delete), which moves every later picture earlier; those clips then
     differed from their fingerprints (the start is part of it), were kept, no longer lay on their slots, and so Shuffle and
     «החזרת החלקים שנמחקו» were both refused with `template_blocked`. Such a clip can never be honoured where it lies (template
     slots are timed to the music), and nothing a person authored in it is lost.

     The test is `movedOnly` (templateOps.ts), per clip: the run recorded where it placed the clip; the clip is on the track
     recorded there; its start differs from the recorded start; and its fingerprint with the recorded start put back equals the
     run's fingerprint, so its length, source range, speed, transform, keyframes, effects, sound, link, text and style are all
     unchanged. It applies to every clip kind of the run (pictures, a slot's own sound, titles, music, looks, elements, sound
     effects). A link group is replaced only when no clip in it has another change: `keptByHand` leaves a moved-only clip out of
     "edited", and still keeps it when a clip linked to it was edited. Everything else is protected exactly as before: a clip
     trimmed, re-sourced, restyled or changed in any other way is kept by fingerprint, and a kept picture off its slot is still
     refused.

     The fingerprint alone cannot tell a move, because it holds neither the old start nor the track, so the run records them:
     `apply_template` takes the optional `recordRanges` and writes `run.ranges` (`{start, end, trackId}` per live clip; `trackId`
     is a new optional field of the range). A clip kept on regeneration keeps the entry of the earlier run, as it keeps that
     run's fingerprint. Additive, no schema version bump; a log without the argument replays to the same document as before.

     *Another track.* A clip on another track than the run recorded for it is edited by hand and kept (`onOtherTrack`), whether
     or not its time changed too: taking a clip to another track is an arrangement made by hand. Its key is not made again. For a
     picture taken to another track at its own time this gives: the other slots are made again on the run's own track, none of
     them shares the kept picture's frames, so it neither covers a slot picture nor is covered by one and no frame is without a
     picture; `template_blocked` follows only as for any kept picture (another tempo re-times its slot). Only a run that recorded
     tracks can tell; in an older run such a clip has the run's fingerprint and is replaced, as it always was.

     *Runs made before places were recorded.* Their places are worked out again (`derivedRanges`): the run's OWN stored
     parameters are planned once more on the document without the run's clips, and each slot's making step gives its clip a
     start, and a track when the step names an existing one. A clip counts as moved only when its fingerprint with that start
     equals the run's and it is on that track, so a plan that comes out differently never puts a clip back wrongly; it only finds
     nothing. Covered: the pictures of a template and of a film, a picture's own sound (it gets its picture's start; its track
     cannot be checked), a film's music, a template's graphic elements. Not covered, because the operation chooses their track:
     titles, looks, sound effects and a template's music; moved in an older run they stay kept, which never refuses anything.
     When the plan cannot be made as it was (the template's version changed since, or the planner refuses now), a moved clip
     counts as edited as before, and the hint of the refusal says so (`details.placesUnknown`). The first successful regeneration
     records the places.

     *The answer says what was done:* notice `moved_back` with the slot keys (a slot's own sound under its picture's key), the
     same keys in `movedBack` of the regenerate result, Hebrew and English in i18n `template.notice.moved_back` and in the bar
     («… פריטים שרק זזו ממקומם חזרו למקומם בתבנית»). The hint of `template_blocked` never proposes the request just refused: the
     run's tempo is offered only to a request for another tempo; a request that already had `restoreRemoved` is told to undo the
     edit, or to delete that clip as well and ask again (which then makes it again with the others). Undo: the regeneration is
     one `apply_template` transaction, so after Delete and the button two undo steps return exactly (the regeneration, then the
     delete).

     *The family film and the beat montage take a narrower rule, and why the two differ.* A template takes every pure move in
     time (the broad rule above): its slots are timed to the music, so a moved clip could never be honoured where it lies, and
     making it again on its slot loses nothing. In a film or a montage a clip dragged to another place IS honoured: it is kept
     and the rest is laid around it (the film's F13 R1 and R3; the montage's "left alone because they hold clips edited by
     hand"), and people arrange a film that way. So there only a move that a delete which closed the gap explains is not an edit
     by hand (`closedGapOnly`, templateOps.ts): besides the conditions of `movedOnly`, the clip's start must be EARLIER than
     recorded by exactly the summed length of the run's own clips that are gone from the document and whose recorded range lay
     before its recorded start on the same track (exact rational arithmetic), which is what `ripple_delete_clips` does to the
     clips after a deleted one; a clip linked to such a clip (a pick's own sound) counts when it moved by exactly as much. Before
     this, one plain Delete of a pick froze every later pick as "edited by hand" in all later regenerations: one segment early,
     worded as hand edits, a restored file out of place.

     What follows from the sum: with no deleted length before it, any move is a move by hand and the clip is kept, as before the
     rule. A clip dragged by hand that also lies after a deleted one does not match the sum and is kept. Several gap-closing
     deletes add up. A delete on another track counts for that track only (the title deleted with its gap closed moves the
     closing card, which is made again; no pick is touched). A delete that kept its gap adds length without a move, so with a
     later gap-closing delete the clips after both do not match and are kept. A ripple that removed a clip the run did not make
     moves the run's clips without any of them being gone: they are kept, as before. In every "kept" case the result is the one
     from before the rule and still a valid project: the film lays its other clips around the kept ones with no picture over
     another and no gap, the montage skips the segments they lie on and fills the free ones (tests hold each case).

     To know the places, film runs record them like template runs, and montage runs record each clip's track with its range
     (`apply_recipe` takes the optional `recordTracks` beside `recordRanges`; a kept clip keeps the track recorded for it). After
     a Delete that closed the gap a regeneration leaves the deleted clip out and lays the clips it moved on the grid again, and
     `restoreRemoved` puts the deleted one back at its place. A film says it with warning `moved_back` (ADR-0026: «קליפים שזזו
     בגלל מחיקה לא נשארו במקום שאליו זזו: הסרט סודר מחדש יחד איתם»), a montage with `movedBack` (clip ids), one step line and
     «חזרו לפעימות אחרי שזזו בגלל מחיקה» in its panel. A clip taken to another track than recorded is kept, as for templates. A
     montage answer names in `removed` only the deleted clips whose place is in fact left empty; one whose whole range a kept
     clip lies on is still carried in `run.ranges`. Older film runs use the worked-out places above with the same narrow test
     (the places of deleted picks come from the plan too). An older montage run (ranges without tracks) keeps the clips a Delete
     moved, as before: the montage planner names no track, so there is nothing to check a place against.
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
