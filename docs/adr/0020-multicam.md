# ADR-0020: Multicam — flattened groups, sync by sound, switching in group time, a labelled auto-switch

Status: **Accepted — built; end-to-end proofs being run at the time of writing** (2026-11-18) for wave 1.
Built by three workers on shared contracts, each reviewed and repaired, merged.
No proof result is claimed here: `pnpm proof:multicam` and `pnpm proof:multicam-ui` are written; their outcome
belongs in docs/PROGRESS.md.

## Context
- The survey lists multicam (R-19.2) as missing: several cameras and recorders of one event, synced, then cut
  between.
- Every picture comes from `evaluate` + the compositor (ADR-0005); every edit is a registered op (ADR-0004);
  times are exact (ADR-0003); privacy regions and follows are ADR-0015.
- Two designs and a judge (read-only workflow, 2026-11-17, `.artifacts/multicam-plan.md`) chose a flattened
  design. The plan file has no verifier section; the lead's wave-4 decisions settle its open questions.

## Decision
1. **Flattened, never nested.** A project-level entity `doc.multicam[groupId]` (kind `multicamGroup`, keyed by
   its own id like motion tracks) holds 2–9 angles (picture or sound), each with up to 16 pieces (files),
   a sync map per piece, a look per angle, speakers (at most 8) and the wide angle. The edit is ordinary media
clips carrying an inert tag `{groupId, angleId}` plus continuous unlinked sound clips.
   `evaluate`, the compositor, the audio plan and both exports are unchanged; the program costs one decoder
per frame (two in a transition).
2. **Group time follows the main sound recorder:** it is the source time of the reference angle's piece 0,
   whose single anchor is `{0,0}`. Other pieces have monotone piecewise-linear anchors, sample-aligned.
   Maps are evaluated in BigInt fractions and quantised once, round half up, to the grid of lcm(sample rate,
frame-rate numerator); offset-only maps are therefore exact in both directions.
3. **Clock drift never becomes speed.** Picture segments longer than the drift tolerance (0.5 frame) get
   invisible frame-aligned through-edits, each re-anchored. A second sound recorder drifting by more than 1 ms
   is laid as consecutive sound chunks (error at most 0.5 ms, one-frame overlap with one-frame crossfades).
4. **Switching happens in group time.** `switch_angles` remaps a segment through group time, so it stays right
   after cuts, gaps, trims and splits. A look stays with the angle: a switch takes the target angle's framing,
   grade, effects, mask, privacy regions, follow and per-format framing; per-shot punch-ins are dropped and
reported in `output.dropped`. A missing privacy region warns (`redaction_missing`) and never blocks.
   Other ops: `create_multicam`, `set_multicam_sync`, `update_multicam`, `set_angle_look`, `place_multicam`,
`detach_from_multicam`, `remove_multicam`, and the internal `attach_multicam_sync`.
   One call carries up to 1000 cuts and refuses above 4500 touched entities. AI-derived copies on multicam
segments are refused in wave 1 (detach first); `remove_asset` refuses a file a group uses.
5. **Sync by sound is model-free and server-side** (`apps/server/src/multicamSync.ts`): 10 ms level envelopes
   (rebuildable derivatives, never in the document), a coarse GCC-PHAT stage on spectral flux, a fine stage on
   up to 12 windows,
   a Theil–Sen fit. Verdicts: reference, confident, check, ambiguous, no-shared-sound, inconsistent, manual.
Only confident and check attach anchors. The thresholds (`SYNC_THRESHOLDS`) are starting values recorded in
`origin.params`.
   Capture dates (ADR-0021) give a sync prior only. Hand corrections are public and become verdict `manual`.
6. **Auto-switch** (recipe `multicam-auto`, pure) is a labelled heuristic: "the clearly loudest mic, not who
   is speaking". It uses hysteresis, a minimum shot of 2 s and refuses two speakers on one mic.
   No diarisation model is pinned; the UI shows an honest "not installed" state. «סנכרון וחיתוך» stops for
review whenever any angle is not confident. Dual-mono recorders are suggested, not applied.
7. **Editor.** A non-modal panel with an angle viewer (4 live tiles plus labelled thumbnails, a second player
   with its own decoder pool), digits 1–9 for angles and 0 for the wide angle, live recording of switches
   committed as one `switch_angles` on stop (re-sent once on a 409, since group-time cuts stay valid), and a
sync dialog with verdicts in words. Preflight `multicam_out_of_sync` warns and never blocks.
   Perform mode (ADR-0025) must not bind 1–9 while this panel is live.
8. **Schema:** optional fields only on the version-3 bump owned by ADR-0018.

## Consequences / what is not promised
- Thresholds are tuned on synthetic speech only; nothing is called right until the owner reviews one real
  podcast. Nobody has listened to the sound-chunk joins; they are labelled.
- Whether four live tiles and cut-time decoder start-up are fast enough on the owner's laptop is unmeasured;
  wave-2 prefetch is decided by that run.
- Not built: audio follow mode, timecode sync, nested multicam, a server-side sync-and-cut job, diarisation,
  reversed or ramped segments.

## Verified / not verified
- Verified: the builders' unit tests in their worktrees (core maths, ops, sync, store, player); some tests are
  gated until the merge and some stub tests were updated at merge.
- Not verified at the time of writing: `pnpm proof:multicam` (including the optional 60-minute run), `pnpm
  proof:multicam-ui`, the operations fuzz's "accepted at least once" gate after the merge, accessibility
  audit, real recordings, the owner's hardware.
