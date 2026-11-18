# ADR-0025: Perform mode — effects on the beat, a virtual camera, one take one undo

Status: **Accepted — built; the end-to-end proof is being run at the time of writing** (2026-11-18) for wave 1.
Built by three workers on shared contracts, each reviewed and repaired, merged; then six review findings fixed by
the lead's decisions. Latency is not checked, and nothing is called "in sync" until the owner calibrates.

## Context
- The owner wants an editor that feels like an instrument: tap pads to the music and see the edit happen, then
  steer a camera over a clip by pointing.
- Every persistent edit is a registered op through `Store.commit` (ADR-0004); every picture comes from `evaluate`
  (ADR-0005); flash safety is ADR-0009 with its 2026-11-18 amendment. Keyframe curves and their range form
  `replace_clip_keyframes` (ADR-0019) and multicam live switching (ADR-0020) are merged.
- The plan (`.artifacts/stage-plan.md`) came back "needs changes"; its Verifier and Corrected notes win. Lead
  decisions: `.artifacts/wave5-decisions.md`, sections "Stage / perform mode" and "after the build review".
- "Stage" already names the viewer (`StageHeader.tsx`, `stage.strings.ts`), so the feature is the workspace
  `perform` («הופעה», Shift+7) everywhere in code, ids and strings.

## Decision
1. **Nothing is committed while playing.** Taps are captured against the audio clock (minus a stored calibration
   offset) and shown as a ghost on the live picture (`Player.setPictureDoc`); the sound session is not restarted.
   At stop, one take is planned and, on accept, committed once.
2. **One take = one op = one undo.** The internal op `apply_take` (`packages/core/src/takeOps.ts`) runs only
   ordinary public ops from `TAKE_STEP_OPS` (tracks, adjustment clips, clips, titles, keys; no `freeze_frame`),
   with bindings to earlier steps, and records one run `perform:take`. It is reached only through
   `POST /api/v1/projects/:id/takes` or the agent tool `perform_take`, which plan on the server from the raw taps
   with the same pure core planner the browser uses (`planTakeRequest`); `/transactions` refuses it.
   Propose-mode credentials and grants limited to tracks or a time range are refused.
3. **The planner is pure** (`packages/core/src/moves.ts`): a catalogue of 16 moves and two banks (`canvas`, the
   default, uses no GPU effect; `gpu`), a beat grid from the followed beats (tempo ÷2 by bar-anchored parity, ×2
   and half beats without bridging gaps), quantise to the nearest grid point with a strength, one frame
   conversion from absolute time, then the take rules: caps (200 hits, 2000 steps, 6 tracks, 4 sound lanes),
   merge and retrigger on the realised end, the flash rule, realisation as public steps, clamp to the edit.
   A zoom punch is scale keys on the clip (one look in preview, still and export), clamped where a higher
   picture begins. Sound lanes made by earlier takes are reused.
4. **One flash rule, frozen per op version** (`packages/core/src/performFlash.ts`, `FLASH_TABLE_V1`): strobes
   and light transitions claim their frames widened by the flash gap; every change of light a take makes keeps
   that gap and lasts at least that long; titles and stickers count. A take changes light only on clips it adds,
   works only on its own sequence, and adds no titles with live fields (people and ages stay out of takes). An
   envelope or fade that cannot keep the gap is held `flash_limit`, never stretched. A reclassification of
   effects ships as `apply_take` v2, so a stored take always replays the same.
5. **The virtual camera** (`packages/core/src/cameraPath.ts`): pointer samples become a critically damped
   spring path (ω = k / settle, k solving (1+k)e^−k = 0.02), clamped so the picture always covers the frame,
   simplified (time-parameterised Douglas–Peucker) and written as three `replace_clip_keyframes` range calls
   over the take's range: a partial retake. Keys outside the range stay; a channel with no keys on a side gets
   an edge key holding the current framing, so no frame outside the range changes. Privacy regions follow the
   source. A panorama the camera cannot pan end to end is accepted with a note, not refused.
6. **Keys.** Pads use digits 1–8 and yield the digits to multicam while it is live. While a take is recorded
   only the pads, Space and Escape act; the mode bar ignores Shift+1…7.
7. **Honest states.** Until the owner runs the tap calibration on the laptop, the view says «לא כויל» and never
   calls a take in sync. GPU pads without an adapter say «דורש כרטיס מסך». Freeze is wave 2; the beat strobe is
   offered only with an analysed beat grid and is not in a default bank.
8. **No schema version bump:** a take is a run in the existing `recipeRuns`.

## Consequences / what is not promised
- No latency figure: headless Chromium has no sound device; the calibration absorbs a constant offset, not drift.
- The pad sounds and visual amounts have not been heard or watched by a person; Hebrew strings are unreviewed.
- Shake, glitch and the strobe count as verified on the laptop only after the owner's hardware run (ADR-0008).

## Verified / not verified
- Unit and property tests (one run each, this CPU): 64 jittered taps land on their beat frame at five frame
  rates; 200 random documents apply and validate; key-mashing at 20 taps a second keeps the gap through the real
  op; a retake on a clip with no keys leaves all 300 outside frames unchanged; replay is byte-identical.
- The end-to-end proof `pnpm proof:perform` is being run; its result goes to PROGRESS.
- Not verified: the laptop, a person's ears and eyes, real music.
