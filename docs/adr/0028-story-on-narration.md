# ADR-0028: «ספרו מה היה» — a film built on the owner's recorded narration and taps

Status: **Accepted (lead, 2026-11-26)** — built by three workers on the lead's contracts, merged, integrated, and read by the
lead (the recorder's release of the microphone and `storyRegeneration.ts` were reviewed line by line). `pnpm proof:story` passes
on the merged wave 7 tree (numbers below). Nobody has listened to it, used a real microphone or tapped with real sound.

## Context
- The owner tells what happened, in their own voice, and taps «התמונה הבאה» while listening back; the editor lays the chosen
  pictures on those taps. It stands on the family film (ADR-0026: the window rule, pick keys, slots, regeneration with hand edits),
  the import queue (ADR-0023: how a file enters), perform mode (ADR-0025: the tap capture on the player's clock) and one `evaluate`
  for preview, still and export (ADR-0005).
- The plan (`.artifacts/wave7/story-plan.md`) and its "Corrected" part were cut and settled in
  `.artifacts/wave7/story-decisions.md`, which binds where they differ. No schema field, no schema version bump, no new op (the
  story is the existing internal `apply_template`), no engine change, no new route, no new MCP tool, no dependency, model or download.

## Decision
1. **The recording is a file like any other.** The recorder (`apps/web/src/editor/story/recorder.ts`, static worklet
   `public/pf-recorder.js`) takes the microphone raw (no echo cancellation, noise suppression or gain control; mono), shows the
   level as numbers (dBFS and clipped samples, never "good"), stops by sample count at ten minutes, and writes a 16-bit WAV at the
   audio context's own rate. «שמירה» hands it to the import queue (`Editor.importFiles`, `via: 'browser'`) and nothing else; it is
   never put in browser storage. The microphone is released on stop, record again, page hidden, pagehide, a track that ends, the
   dialog closed by any path (Escape, button, backdrop, «מהטלפון», a build) and unmount. A voice memo can also come through the
   phone page's third picker «הקלטת קול» (`accept="audio/*"`; routes and the upload-only rule unchanged).
2. **The voice is measured, never stored.** `voiceActivity` (core) reads the waveform peaks the import already made (level 0, origin
   per derive.ts `first_pts`), clamps digital silence (`noise = max(noise, 16)`), takes the floor at the 10th and the speech level at
   the 90th percentile (as multicamAuto.ts), and returns ranges in source samples at 48 kHz. Why a fourth level heuristic rather than
   an existing one: `detectSilences` has an absolute threshold, float-second text output and a decode per call; the multicam envelope
   needs a decode under `heavy()` and is not made at import; the peaks are ready at import. The server measures on every plan, apply
   and regenerate (no decode, no job); a waveform not ready within 5 s answers `voice_pending`, a flat one `voice_flat` with both
   levels. The measurement feeds only the automatic cuts and the pause ticks of the tap lane; nothing of it is written to the
   document or to any derivative row.
3. **Cuts: taps, then pauses, then even.** `planStory` (core, pure, integer ms) places each picture on its tap's frame; a tap closer
   than the flash gap (ADR-0009), after the narration, beyond the last picture or inside a clip kept by hand is held with its reason
   (chips). Pictures without a tap are cut at a measured pause near the even split, else evenly, labelled «חולק אוטומטית». The film's
   window rule (`filmSourceWindow`, lifted from the film's closure) chooses each video's stretch; a video shorter than its slot plays
   whole and the next picture starts at its end (`clip_ended_early` with the seconds). The music is ducked 12 dB under the narration
   for its whole length (the existing `set_ducking` rule: an untranscribed clip is speech throughout); with a transcript the duck
   follows the phrases. The clips' own sound sits 12 dB under the narration (`ownSound: under`, gain 0.25) or is muted.
4. **One apply, one undo.** The story is applied as ONE `apply_template` (`tpl.story`, run recipe `template:tpl.story`) at the plan's
   revision; the run record holds each pick's file and recorded cut (`params.picked[i] = {key, assetId, cutMs, how}`, C1).
5. **The browser plans the ghost with the server's inputs.** The plan view carries no ops; it carries `context` (the exact
   `StoryPlanContext` the server planned with, the voice measure included), so the tap view's live picture and review are made by
   the same pure code from the same inputs; after «אישור» the UI compares its cut frames with the server's `predicted` and says
   «התוכנית בשרת יצאה שונה — בדקו שוב» when they differ.
6. **Rebuilding keeps hand edits** (`apps/server/src/storyRegeneration.ts`, C2). `runHandEdits(…, 'any-move')`: a picture whose only
   change is its place goes back to its recorded cut (`moved_back`, worded in Hebrew and shown in the bar after the rebuild); any
   other change (trimmed, replaced, retimed) keeps it exactly. The picture before a kept clip runs to its start; the one after starts
   at its end (`filled_next_to_kept`). A picture deleted by hand stays out (its record travels in `removedPicks`) until «החזרת החלקים
   שנמחקו» brings it back at its own cut (or after the kept clips covering that frame). The narration clip is never made again: it is
   read as it lies (dragged 2 s later, every cut moves 2 s); deleted → blocking `narration_removed`; reversed or at another speed →
   blocking `kept_narration_not_followable`. A rebuild that sends other `cutsMs` is refused 409 `story_retap_not_built`.
   - *Integration fix (2026-11-25):* the rebuilt run record now also keeps the pick records of the pictures kept by hand
     (`storyRegenRecordParams`). Without them a second rebuild (or «החזרת החלקים שנמחקו» after a rebuild) no longer knew that a clip
     replaced by hand holds its pick, placed the replaced file again, and squeezed the restored picture out (found by the editor half
     of S11; pinned by `storyRegeneration.test.ts` "a second rebuild" and proof S11/S11e).
7. **Access as for the family film.** Plan needs observe; apply and rebuild need edit; a propose-mode agent and a grant limited to
   tracks or a range are refused (403); an agent without the people scope is refused a title with `{age:…}`. The narration is never
   sent anywhere; agents plan from names-only documents and never record (the recorder is the owner's browser).
8. **Honest states.** A narration the browser cannot play (e.g. ALAC) shows «הקובץ לא מתנגן בעורך (קודק …). הקליטו כאן או המירו
   אותו» and both build buttons are disabled (the `<audio>` metadata probe is a proxy for "plays in the editor"). Speech recognition
   not installed: «תמלול: לא מותקן — הסרט נבנה בלי תמלול».

## Consequences / what is not built
- **Pause snapping** (`snap: 'pause'`, moving a tap to the nearest pause): cut. Taps stand where they were pressed.
- **Sound conform** (converting a narration the editor cannot play): cut; the honest unplayable state ships instead.
- **Re-tap of an applied story**: cut (first follow-up). The bar offers «בנייה מחדש» (other options, same taps), «החזרת החלקים
  שנמחקו» and undo; to change the timing, undo the story and tap again.
- **Music rising in the pauses** (the `voice` analysis field, `attach_voice_activity`, the `speechRanges` branch): cut; the music
  stays low for the whole narration. The first audio follow-up, after the owner listens.
- A gap the owner leaves between two clips kept by hand (a plain trim with «]», which does not ripple) has no story picture that
  can fill it, and stays a gap after a rebuild; W (ripple trim) closes it as the editor's magnet expects.
- The ghost is planned in the browser; the server's plan wins, and a difference is said, not hidden.
- Hebrew wording, the pause thresholds on a real voice, tap latency with real sound and how the music under the voice sounds are
  unreviewed.

## Verified / not verified
- One run each on this shared 4-CPU machine (integration, 2026-11-25): `pnpm proof:story` 34/34 (S1–S20 server, U1–U15 and
  S11e in the browser); `proof:family-film` 45/45; `proof:phone-drop` 31 passed, 2 blocked (as before); `proof:perform` 27/28 (N1
  live path 150 ms on the slowest of 10 runs under load, budget 33 ms; K1 passed); `audit:testids` PASS (803 ids, none lost);
  `audit:a11y` the 20 story states (5 × he/en × dark/light) without findings, in a run with the pearls scenarios set aside (they
  stopped the audit before the story states; the pearls integration owns them); editor interactions 121/121; `pnpm test` 6281
  passed, 2 timing tests failed under load and passed alone (music M10, overlays speed limit).
- In the first full proof run U1 and U2 timed out opening the dialog while the server part's server was still busy; the entry now
  stops that server before the browser part. U7 (taps within one frame of the player's painted frame) failed once in a separate
  run (one tap 2 frames off under load) and passed three times alone and in the full run.
- Faults found by integration and fixed: a second rebuild placed the file of a picture replaced by hand again (decision 6); the
  dialog lost the picture order when the owner went to the phone page.
- Final regression of wave 7 (2026-11-26, the merged tree 0311eaa, one worker alone on a quiet machine, one sample each):
  `proof:story` 34/34, `proof:family-film` 45/45, `pnpm test` 6,825 passed and 0 failed, `audit:a11y` 0 findings (135 dark and
  51 light states per language, the story and pearls states included), `proof:perform` N1 8.9–20.8 ms over ten runs at load 1.5
  (the 150 ms above was one sample at load 15–20).
- Not verified: a real microphone and Windows' permission settings, a Bluetooth headset, tap latency with real sound, real phone
  voice memos (AMR cannot be made here), the music under the voice by ear, the Hebrew.
