# ADR-0026: Family film in one click — an editable, explained first cut of an event

Status: **Accepted — built and verified (see PROGRESS)** (2026-11-18) for wave 1. Built last by three workers
on shared contracts, each reviewed and repaired, merged.
A heuristic draft: never a quality score, and nobody has watched a film from real footage.

## Context
- The flagship wish is "it edits for me". The film stands on the life line (capture order, event, dated
  titles; ADR-0021) and content packs (built-in music, title looks; ADR-0022).
- Every picture comes from `evaluate` (ADR-0005); edits are registered ops (ADR-0004). The plan
  (`.artifacts/family-film-plan.md`) came back "needs changes"; its Verifier and Corrected notes win. Lead
  decisions: `.artifacts/wave5-decisions.md`.

## Decision
1. **Moments are measured without a model** (job `moments`, durable, cancelable,
   `apps/server/src/moments.ts`): per-second motion and sharpness read from the editing proxy (the thumbnail
   sprite holds at most 60 tiles), loudness from the waveform peaks.
   Whip pans are gated (a search of ±12 box pixels; border rule). The series stays in a data file keyed by
content hash; the document holds only `analyses.moments`: a reference, what was measured, file-level values
and at most 4 candidate windows in source frames
   (internal op `attach_moments`). Frames become times only through `sourceTimeOfFrame`, which includes the
picture's start offset.
2. **The planner is pure** (`packages/core/src/familyFilm.ts`): best window per clip, capture-time order, by
   hand, or an energy arc; cuts on the music's measured bars and half-bars (an even meter only for half-bars)
   no closer than the flash gap (ADR-0009 and its 2026-11-18 amendment);
   an opening card with live fields (ADR-0021) and a closing card. Target 30, 60 or 90 s. A clip with no
usable measurement gets the middle window and says so. Every pick lists its measured reason (e.g.
`inner_motion`, `loud_sound`, `active_throughout`, `measured_moment`);
   `steady_camera` was dropped because no camera-movement value is stored. Every film says it is a heuristic
draft.
3. **Applied as the recipe `family-film` through one internal `apply_template`** (`tpl.family-film`): one
   apply is one undo; the run gets slot records. Regeneration keeps hand edits, kept clips and a hand-set gain
   by fingerprint
   and reuses the film's own tracks by role; track gain and ducking are set again only when the mix changes. A
kept picture beyond the new end stays and the plan warns. `picks.include` pins an asset against being dropped
for lack of room.
   - *Amendment (2026-11-24): a clip that was only moved is not a hand edit* (ADR-0016 decision 6 has the rule
     and its test, `movedOnly`). Before, one Delete of a pick that closed the gap moved every later pick, and each
     of them then counted as edited by hand in every later regeneration: kept where the delete left it, off the
     beat grid, with a restored file placed after them. Now a film run records where it placed each clip, with
     its track (`run.ranges`, optional, written by `apply_template` when the film asks with `recordRanges`), and a
     clip whose only change is its start on that track goes with the untouched clips: the film is laid out again.
     After such a Delete a regeneration leaves the deleted file out and lays the others on the grid, and
     `restoreRemoved` puts the file back at its place. The answer says it in one sentence only when it happened:
     warning `moved_back` (keys in `details.keys`, the same in `movedBack`), worded in Hebrew and English and shown
     in the film bar. A pick changed in any other way is kept exactly as before, also when it was moved as well
     (the planner lays the new picks around it), and so is a pick taken to another track than recorded. This also
     means a pick dragged to another time on its own track, with nothing else changed, is no longer kept there:
     to keep an arrangement, the order of the chosen files is the film's `order: given`. A film made before
     places were recorded: its places are worked out from its own plan made again (same parameters, the film's
     tracks, what had been deleted before that run) and a clip counts as moved only when its fingerprint agrees;
     when the plan comes out differently (another film version, other measured moments, a clip kept in that run)
     the moved picks stay kept, as before.
4. **Sound.** Clips' own sound sits on a dedicated track; "under the music" is a track gain (−12 dB, only when
   there is music). The «הקולות מובילים» mix ("lead") is kept: the music is lowered 9 dB while a clip has
   sound; it rises over stills and silent clips (warning `lead_music_rises`).
5. **Faces are not used:** no face model is approved, and the plan says so. Nothing is downloaded; the owner's
   clips stay local.
6. **Privacy (ADR-0021).** An agent without the people scope plans from the names-only document and is refused
   a film whose titles hold an `{age:…}` field (403 `people_scope_required`), in every format. A title typed
   as plain text is shown as typed.
7. **Optional schema key only;** no version bump. Stubs answered 501 `film_not_built` / `moments_not_built`
   until the planner and job landed.

## Consequences / what is not promised
- No claim that a chosen moment is "best". Unmeasured or flat clips fall back to the middle window. A very
  fast subject close to the camera can be gated as a camera move.
- The film is not made from faces, speech meaning or story parts; those are wave 2 (named story parts, music
  sections, auto sound design, faces if a model is approved).
- Hebrew reasons and strings are unreviewed.

## Verified / not verified
- One run each, this CPU: `pnpm proof:family-film` 41/41 after a measurement fix (F9b first failed: an audio
  pre-echo made the shoulder of one activity a second moment; a second moment must now be a distinct activity,
  moments algorithm 2, so older measurements are measured again;
  one load-related flake of F18 seen once); editor interactions 56/56, Phase 0 55, Phase 12 20, browser export
26, life line 17, accessibility 0 findings, 3876 unit tests (PROGRESS 19b).
- Faults found by the wiring and fixed: reasons naming a moment the clip does not show, a silent black gap
  after regeneration (now warned), the own-sound track lost on regeneration.
- Not verified: real footage; the owner watching or listening; Hebrew wording.
