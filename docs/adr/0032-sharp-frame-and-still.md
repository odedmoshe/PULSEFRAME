# ADR-0032: «הפריים הכי חד» and «שמירת התמונה» — a frame of a clip as a picture (wave 8, track cover, version 1)

Status: **Accepted (lead, 2026-11-26)** — three builders on the pre-pass's contracts, integrated; `pnpm proof:stills` 26/26 in one
run on the integration branch (`docs/evidence/stills-proof.json`; synthetic fixtures only). Lead decision at integration: the JPEG is
written with `-q:v 1 -qmin 1` (mjpeg's default `qmin` of 2 made `-q:v 1` alone byte-identical to `-q:v 2`: 37.70 dB against 41.59 dB
on the checkerboard; the colour conversion alone measures 52.96 dB). Not rerun on the merged tree yet: the accessibility light pass
and the wider proof list (the machine was killing Chromium for lack of memory during the integration). Nobody has looked at a tile or
a saved picture; no real phone footage; nothing on the laptop's ffmpeg; no print on paper. The cover sequence of the plan is not built.

## Context
Families want one frame of a clip as a picture: for a print, a cover, a message. Two jobs: find candidate frames inside one clip
without stepping through hundreds by hand, and save a chosen frame as a file at the stored file's own pixels, with a paper-shaped
crop. The plan (cover-plan.md) was cut by the verifier (cover-verify.md, C1–C14) and the lead (decisions.md "cover").

## Decisions
1. **What is measured.** Only the selected clip's own source range (core `rangeOfClip`: speed, reverse and freeze honoured), at
   most 600 source frames (longer: 422 `stills_range_too_long`, with the next step), every frame, read from the STORED file (never the
   proxy: its 0.5 s key-frame grid would bias the peaks). Grey at long side 960 (`flags=area`). Per frame: Sobel gradient energy
   (moments' `sharpness()`), Immerkær noise σ (one 3×3 kernel), `sharp = max(0, sobel − round(1.5·σ²))`, motion = mean absolute
   difference to the PREVIOUS frame only (so a frame's record does not depend on the range), clipped white (≥ 250) and crushed black
   (≤ 5) in permille. Ranking: lower median over the whole range, local maxima (a plateau gives its last frame), ordered by sharp
   desc, motion asc, frame; candidates ≥ 1 s apart at the file's own rate; at most three; «נמצאו {n}». Every tile shows its numbers,
   σ, and the label «היוריסטיקה … לא נבדק בעין»; numbers compare frames of one clip only. Cached as a derivative keyed by content
   hash with algo, long side and the ffmpeg version line; merges are a union by frame. Grey self-check before measuring. A durable
   job sharing the moments lane (an export goes first), one per project (409), three per server (429), cancel writes nothing, a
   restart re-runs it. The routes wait for the ffmpeg version line before reading the cache (503 `stills_warming` «עוד רגע» for a
   direct call that did not wait), so a first read never says "nothing measured" for stored frames.
2. **The seek rule and the MPEG-TS finding.** Input seek `-ss S -i file` with S = (from + startOffsetFrames − ½)/rate from the
   rational value, measured from `timeOrigin`; the reader checks the exact frame count AND the first/last frame times within a
   quarter frame. H.264 with B-frames (MP4): exact on the first read (M2: barcodes 912…960 asked and delivered). MPEG-TS with a start
   time of about 1.47 s (ffmpeg 6.1.1): the plain seek delivered LATER frames (960…1008 for 912…960); the reader refuses that read,
   reads once more from 10 s earlier and drops frames by timestamp, which is exact (M3). A second miss fails the job
   `frame_count_mismatch` and saves nothing (its own sentence when the count is right and the times are not).
3. **One renderer for the still.** Core `stillDocument(asset, frame)` is a one-clip document at the file's own width, height (odd
   kept) and rate, fit contain, default transform, `sourceIn = sourceTimeOfFrame`. The server renders it through `renderStill`
   (the same evaluate + compositor as preview and export; never an ffmpeg decode of the source), cuts the crop from the lossless PNG
   with `crop=w:h:x:y:exact=1` and encodes PNG, or JPEG as mjpeg 4:4:4 at quality 1 (`-q:v 1 -qmin 1`; `-q:v 1` alone is clamped to
   2 by mjpeg's default qmin). The editor tile is a paused Player on the same document through its OWN media pool of the stored file
   (every still document has the same clip id, and a pool keys decoders by clip id: sharing the editor's pool left tiles blank). U4:
   the tile equals the server still byte for byte (0 of 921 600 bytes). P1: the PNG crop is pixel-identical; the JPEG measures
   41.59 dB PSNR on a one-pixel checkerboard (bound 40). PNG is the exact form; JPEG is lossy, and the dialog says so. The saved
   picture is the browser's (compositor's) reading of the stored file; a conformed file says so (reasons; «הומר מ־HDR»). Sides over
   8192 are refused (`still_too_large`), under 16 refused (`still_too_small`: the document would be below the schema's minimum),
   above 24 MP labelled untried. ppi lines per paper (10×15, 13×18, A4) are a rule of thumb from the pixel count only.
4. **No metadata.** No date, no EXIF writer, no tags: the output is checked before success (codec, exact size, no ffprobe format
   or stream tags, PNG chunks IHDR/pHYs/IDAT/IEND only, JPEG segments SOI/APP0 JFIF/DQT/SOF0/DHT/SOS/EOI only; anything else is
   `still_tags` and nothing is saved). File name `{asset name} · {frame time}`, never a date.
5. **Owner-only full-size still.** The `still` export option is refused 403 `owner_required` for every credential but the owner's
   own session (REST export, batch, retry; MCP export_project, export_batch, retry_job); the browser export route refuses it 409.
   Agents get numbers only: `find_sharp_frames` (edit) and `read_sharp_frames` (observe) answer JSON with no image part.

## Not built (this wave)
The cover sequence, `make_cover`, a cover origin and the title notice; the contact sheet; the long-range coarse+refine path and
reuse of moments; the capture date (and any EXIF/PNG chunk writer); «כמו בסרט» colour (the film's grade/LUT: GPU, unprovable here);
the Deliver panel entry.

## Not known
- Real phone footage: open-GOP HEVC and edit lists under input seek, sensor noise and low light against the noise term, I-frames
  that measure sharper than their neighbours (not corrected). Every fixture here is synthetic.
- The laptop's ffmpeg 8.1: swscale area/grey output and the TS seek behaviour may differ; cached numbers carry the version line.
- How a print looks on paper: the ppi line is a pixel-count rule of thumb; nobody has printed or looked at a saved picture.
- The Hebrew wording has not been read by the owner.
