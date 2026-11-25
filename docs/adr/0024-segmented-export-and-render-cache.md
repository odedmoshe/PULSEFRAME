# ADR-0024: Segmented export and the render cache («ייצוא מהיר»)

Status: **Accepted — built and verified (see PROGRESS)** (2026-11-18) for wave 1. Built by three workers on
shared contracts, each reviewed and repaired, merged. MP4/H.264 only.
The fast export is optional; the single-pass export stays available and unchanged.

## Context
- Export piped every frame into one encoder run. A recorded baseline (docs/evidence/av-sync-long.json) took
  161.2 s for 16,879 frames at 640×360, and there was no checkpoint or resume.
- Every picture comes from `evaluate` + `drawGraph` (ADR-0005), which reads the document only. Times are exact
  (ADR-0003). Flash safety is ADR-0009 (with its 2026-11-18 amendment).
- The plan (`.artifacts/segment-cache-plan.md`) came back "needs changes"; its Verifier and Corrected notes
  win. Lead decisions: `.artifacts/wave5-decisions.md`.

## Decision
1. **No schema fields and no ops.** The cache is derived data keyed by content. Export options gain `mode`
   (`single-pass` default, or `incremental`) and a self-check setting; «ייצוא מהיר» is a per-viewer tick, not
   project state.
2. **One key.** `frameKey` hashes the canonical `evaluate` result of the frame as handed to `drawGraph` (minus
   `audio`, so a gain change does not re-render pictures) plus content hashes of every asset and font it reads
   and effect versions.
   `segmentKey` adds an engine fingerprint: a hash of the whole web bundle plus the browser version and launch
mode of the browser rendering this job, taken per job. The fingerprint changes with every update, so the cache
is emptied on every update (accepted: correctness first).
   Non-finite numbers and −0 are tagged tokens, so a strobe before its first flash stays cacheable; a frame
that cannot be keyed is uncacheable and rendered every time. GPU frames are cacheable only on a software
adapter (`gpu_not_reproducible` otherwise).
3. **Segments and join.** Closed-GOP segments of about 2 s on a grid anchored at programme frame 0
   (`segFrames` at least 3); a head or tail part under 3 frames merges into its neighbour (a 1–2 frame segment
   cannot be joined at constant frame rate; found by the verifier).
   Each segment is its own encoder run; the join is a stream copy with `setts` on an exact timescale, so no
float seconds are stored. Sound is mixed whole as before.
4. **Self-check.** Every incremental export re-renders sampled frames of reused segments and compares
   per-frame hashes; a mismatch fails loudly (`render_cache_self_check_failed`), purges what this export
   reused, and publishes nothing.
   `auto` checks every reused segment until 20 clean exports for this engine fingerprint, then samples; the
counter resets on any failure. It proves the sampled frames only. Per-frame flash cells are stored with each
segment and one analyser runs over the whole programme across joins.
5. **Store.** `<dataDir>/render-cache/` with its own SQLite index, least-recently-used eviction, never
   touching keys pinned by a running export. Default cap 2 GiB with auto-clear on; counted against the storage
   ceiling;
   a registered reclaimer lets every storage check trim it. If a segment cannot be stored the export carries
on from a job-local file (`notStored`). Cancel or crash keeps committed segments, so a retry resumes.
6. **Privacy over speed.** A change to privacy regions purges that project's cached segments at once, also for
   an export already running; `deleteProject` purges them; the cache is not backed up or archived.
7. **Typed refusals** (422 `render_blocked`): unsupported format, cache disabled, join self-test failed
   (`incremental_unavailable`), cache full with auto-clear off. The laptop's ffmpeg is detected, never
   assumed.

## Consequences / what is not promised
- Stated limits: a ripple edit re-renders everything after it (absolute time is in the key); moving or
  trimming analysed music re-renders every frame under it (`beat` is in the graph);
  the self-check covers sampled frames only; under a storage ceiling a segmented export needs about twice the
output size while it joins.
- A scratch trial (ffmpeg 6.1.1, one run) gave 3 segments 314,166 bytes against 303,217 for one pass (+3.6 %
  on that synthetic source).
- Not built (wave 2): playback from the same store, WebM, hardware encoder after the laptop qualification run.

## Verified / not verified
- One run, this CPU: `pnpm proof:incremental` 32/32 on the merged tree (it was 31/32 first: I2 failed with a
  worst frame of 37.87 dB against the 38 dB floor; fixed in the product by making segments take the single
  pass's coding decisions at scene cuts, before a join and at a segment's first keyframe).
  Worst frame 38.35 dB, size ratio 1.028 (the single pass itself is 37.66 dB against the source at that
frame); I12 A/V offset 0.063 ms; incremental 27.1 s against 216.3 s clean.
- Phase 0 55, Phase 4 22, browser export 26, accessibility 0 findings, 3526 unit tests (PROGRESS 19b). Faults
  fixed: lane and sheet planning different qualities.
- Not verified: the owner's laptop encoder, a long real export.

## Amendment 2026-11-25: size fit («מתאים לשליחה», wave 7 send)
- An MP4 export with `sizeFit.targetBytes` encodes the compositor's frames a second time: the single pass or the segmented join
  first writes a full-quality intermediate (CRF 16, at the planned picture size), and after its validation that file is encoded
  again to the target by two-pass libx264, with the sound encoded from the export's own WAV (`apps/server/src/sizeFit.ts`,
  `SIZE_FIT_METHOD`, stated in the job output's `fit.method`). The bytes on disk are checked, with one retry; on a miss the job
  fails `size_fit_missed` and nothing is published.
- It changes no frame the compositor draws and no segment key (segments are keyed without `sizeFit`, so a second target at the
  same scale reuses every segment). Only the file size is promised: the second encode loses detail as any encode at a lower rate
  does, and nothing is said about how an app treats the file.
