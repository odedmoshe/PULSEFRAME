# ADR-0015: Motion tracking — model-free point and box tracks, follow for titles and pictures, privacy regions

Status: **accepted** (2026-11-17) for wave 1. Built by three workers on shared contracts, each reviewed and repaired, merged. Proofs: see docs/PROGRESS.md.
Nothing here is quality-reviewed on real footage: the tracker has only been measured on a synthetic fixture (a textured disc, an occluder, a look-alike).

## Context
- The market survey lists motion tracking, and privacy blur that follows a moving subject, as missing. Before this wave the capability list said "needs models (B-4)".
- Every picture comes from `evaluate` + `drawGraph` (ADR-0005); every persistent edit is a registered op applied through `Store.commit` (ADR-0004); times are exact (ADR-0003).
- Two designs and a judge (read-only workflow, 2026-11-17) chose design A (analysis first, then attach; privacy regions resolved on each bare picture) with grafts from design B
  (tracks as entities under their own id, an explicit follow offset, progress as a stage string, smaller caps).
  Design B's privacy blur as an ordinary effect was rejected: effects run after the time taps are merged, so an echo or trail would show sharp ghosts of the face.

## Decision
1. **Tracks are stored per source frame, in integers.** A track belongs to one video asset (`doc.motionTracks[id]`) and holds one sample per source frame index, numbered as
   `barePicture` numbers frames (`sourceFrameIndexAt`: 0 is the first picture of the stream). Positions are integers in 1/10,000 of the picture's width and height (`TRACK_UNIT`);
   a region track also stores its size in per mille of its seed box (`SIZE_UNIT`) and confidence 0–100. Every consumer reads the evaluated layer's own `sourceFrameIndex`, so trim, split, slip,
   speed (exact rationals), velocity ramps, reverse, freeze, stutter, transition handles and every format are exact by construction: no float seconds are stored, nothing is rounded and accumulated,
   and the same track serves the proxy, the original, every project size and every format. No decode lane is added.
2. **Seven sample states** (`ST`): unknown, tracked, weak, lost, manual, interpolated, reacquired. A lost sample holds the last usable position and is never extrapolated.
   The loss filter (`lossFlags`) marks a frame bad when it is unknown or lost (and weak when the region's `weakIsLost` is set, which is the default), widens each bad run by
   H = ceil(fps/3) source frames each way and clears every good run shorter than H + 1 (10 at 30 fps), including at the track's ends, so a region never flickers between "placed" and "whole picture".
3. **Caps:** 10,800 samples per track, 43,200 per project, 64 tracks, 8 privacy regions per clip, 500 hand samples per edit. The document is rewritten on every commit, so the caps and a measured commit
   latency bound the cost. If the +15 ms budget fails, that is reported and not redesigned in this wave.
4. **Tracks are entities keyed by their own id** (`entities.ts`, like markers). Undo through `restore_entities` is exact, and an edit sent from an out-of-date view of a track
   is refused as a stale-edit conflict through `referencedIds`. Ops, all in the one registry: `create_motion_track` (one manual sample, so a pick is an undoable edit),
   `attach_motion_track` (internal; jobs only; refuses manual samples and keeps the track's own hand samples), `edit_motion_track` (set, mark lost, interpolate, rename; sets `origin.edited`),
   `remove_motion_track` (refused while a clip is bound unless `unbind` is given), `set_clip_follow`, `set_redact_region`. `remove_asset` takes the file's tracks along and refuses while a clip is bound to them.
5. **The tracker is model-free and runs on the CPU** (`apps/server/src/vision`, `TRACKER_METHOD` "pf-track 1"): pyramidal Lucas–Kanade with median flow and a forward-backward check, verified by
   normalised cross-correlation against the seed template and up to 8 adaptive templates. A lost target is re-detected only on a unique match (best NCC ≥ 0.8, at least 0.1 above the runner-up)
   confirmed on 3 frames, so it never jumps silently. The reader decodes with ffmpeg `trim` and the frame counter, at 360 px work height, **from the start of the file**
   (backward passes read 240-frame chunks forward and walk them in reverse); no timestamps are parsed. The kernel is deterministic.
6. **The tracking job is durable.** Type `tracking`; the range is the asset's clips' first and last frames plus 15, and always the hand samples. It runs one at a time, yields with `setImmediate` after every frame
   and holds the shared `heavy` slot for at most 300 frames, so stills and loudness measurements interleave. Progress is a stage string, throttled to 500 ms. Cancel aborts and SIGKILLs ffmpeg and attaches nothing.
   After a restart, running jobs are re-run. Before attaching, the track's entity version and the asset are checked again: a hand correction made while the job runs fails it with `track_changed` and nothing is attached.
   A track with hand edits needs `overwrite` (409 `would_discard_edits`); hand-placed samples are kept even then. More than 5 open jobs: 429 `busy`.
7. **Follow** (`set_clip_follow`): a title, or a picture on a video track, follows the picture of a track's file on a target video track. Its own transform becomes an explicit offset from the tracked point,
   computed by the caller with `evaluate` (so attaching does not jump; core never needs stutter). `resolveFollows` runs after the layer loop and before captions, on the geometry of `placed`/`sourceToFrame`
   shared with the compositor; optional scale follows the tracked size. The target is found in order: the picture drawn on the target track now (the incoming side of a transition first),
   the clip of a hidden track, the nearest clip held at its edge ('target-absent'), else 'target-missing' (the own transform is kept). Refused: captions, audio and adjustment clips; chains (a follower cannot be a target);
   a clip whose first enabled effect is a time effect (and adding one to a follower). A follower does not move with zoom or push transition geometry.
8. **Privacy regions** (`MediaClip.redact`, in mask layer units) are resolved on every bare picture at that picture's own source frame: the layer, each echo or trail tap, the stutter picture, both sides of a
   transition and, found by the lead while merging with ADR-0012, the frame a velocity ramp actually shows (`withPictureOf` carries the regions of the shown picture). `applyRegions` runs right after placement
   and the colour fix and before any effect, in scratch slots 15–16, and draws erase-then-add (destination-out, then lighter), so a partly transparent layer never shows the original through the copy and pixels outside the region stay byte for byte.
   Blur radius is (0.04 + 0.21·strength) of the region's height; pixelate has max(4, round(24 − 20·strength)) blocks across it (strength 1 is the coarsest); fill is the exact colour.
   On loss, `onLoss: 'frame'` (the default) blurs the whole picture, always a blur and at strength ≥ 0.6, so it cannot flash; `'hold'` keeps the held region. A region whose track is gone blurs the whole picture.
   Regions are refused on still images and on tracks of another file.
9. **Preflight and MCP.** Preflight gains `follow_track_loss`, `follow_target_missing` and `redact_track_loss`, mapped to timeline ranges (at most 20 per clip and code, then a counting entry).
   They warn and never block, in preflight, the export report and the editor banner. No extra acknowledgement click. MCP gains `track_motion` and `get_motion_track`; the ops appear as tools automatically;
   `cancel_job` now dispatches speech jobs as REST does.

## What is not promised
- No faces or objects are detected. The user picks what to track (a point or a box); there is no model and nothing is downloaded.
- Tracking quality on real footage is unreviewed. Heavy blur, deformation, flat texture and long occlusion fail; those frames are marked lost or weak and never extrapolated.
- Privacy is the user's responsibility to check. A tracked blur is not guaranteed redaction; the product reports where tracking was lost or weak and warns, and the owner decides.
- Results are identical only on the same build: the proxy is encoded by the local x264, so method and params record the input kind and the ffmpeg version.
- Decoding from the start of the file makes a backward pass from a seed deep in a long file slow; this is accepted for wave 1.
- Event-loop lag is bounded by cooperative yielding, measured and recorded; a worker thread is not used unless that budget fails.

## Wave 2
Timestamp-seek reader proven equal to the frame-counter reader; track cache keyed by content; rotation; `onLoss 'hide'` for followers; confidence strip on the timeline and a path overlay;
bake to keyframes; mask follow; effect-centre follow (GPU only); reframe (a camera follow with a picked track first, a labelled saliency heuristic later); follow for clips with time effects (per-tap resolution);
`cancel {keep: true}`; picking in the source viewer; re-track from here; worker threads if the lag budget fails; planar and corner-pin tracking and stabilisation; optional ComfyUI model upgrades with the owner's permission.
