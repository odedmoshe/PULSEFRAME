# Progress

Last updated: 2026-11-15, checkpoint 13f. Phases 0–5 gate criteria met on the CPU profile; Phases 6–9, 11 and 12 partly met (each row says which gate parts); Phase 10 not started (needs providers); Phase 13 partly done (security review, accessibility audit, soak, archive). The provider proofs were re-run after the owner-session and budget changes against the local ComfyUI on CPU: `pnpm proof:g0` 39/39; the BiRefNet trial 9/9 with weights already present (its four download checks were not repeated; the original 13/13 evidence is kept, the re-run is `g1-birefnet-cpu-rerun.json`). No new download, no paid call.

Status words: **verified-here** = checked on the current CPU profile · **implemented, not qualified** = code exists, needs a runtime/target we lack ·
**blocked** · **not started**. Nothing is "verified on target profile" yet: no GPU reference machine exists.

## Profile used for all evidence (provisional CPU functional-validation profile)
Linux 6.18 x64 · Intel Xeon @ 2.10 GHz, 4 logical CPUs · 15.7 GiB RAM · no GPU · Node 22.23.4 · Chromium 153.0.8010.12 headless (Playwright 1.63.0) ·
FFmpeg 6.1.1-3ubuntu5 · SQLite 3.54.1 · ComfyUI 0.45.0 / PyTorch 2.15.0 on CPU. This is **not** the GPU performance reference.

## Milestones

| Milestone | State | Evidence |
|---|---|---|
| Phase 0 — Readiness and spike | **Gate met, verified-here** | `pnpm proof` (now 54 checks), probe, ADR-0001…0007 |
| Phase 1 — Authoritative core | **Gate met, verified-here** | 69 unit/property/integration tests; convergence 15 seeds × 40 steps (60 seeds also run once); proof 47/47 |
| A1 · G0 — provider path on a model-free workflow, attachment, stale-result | **Verified-here (model-free)** | `pnpm proof:g0` 35/35 against real ComfyUI on CPU |
| A1 · G0 — media-input workflow with source staging (model-free blur) | **Verified-here** | `pnpm proof:g0` now 39/39 |
| A1 · model files: digest-verified readiness + explicit resumable download (FF-05 core, FFG-04) | **Verified-here** | `apps/server/src/models.test.ts`; trial |
| A1 · G1 — BiRefNet image matting | **Implemented, experimental; CPU functional trial passed** — not quality-reviewed, not GPU-qualified | `pnpm trial:birefnet` 13/13, `docs/evidence/g1-birefnet-cpu-trial.json` |
| Phase 2 — Media and playback | **Gate criteria met, verified-here**; scope items still open (below) | seek conformance 7 fixtures × 1,000 random seeks, 0 wrong (`docs/evidence/seek-conformance.json`); 10-minute A/V sync export (`docs/evidence/av-sync-long.json`); proof 52/52 |
| Phase 3 — Editor interaction | **Gate criteria met, verified-here**; scope items still open (below) | `pnpm proof:phase3` 27/27 (`docs/evidence/phase3-proof.json`), baselines in `docs/evidence/baselines/` |
| Phase 4 — Production export | **Gate criteria met, verified-here**; scope items open (below) | `pnpm proof:phase4` 19/19; `pnpm proof:browser-export` 23/23; `pnpm conformance:parity` pass (`docs/evidence/parity-suite.json`) |
| Phase 5 — Complete agent surface | **Gate criteria met, verified-here**; scope items open (below) | `pnpm proof:phase5` 22/22 (`docs/evidence/phase5-proof.json`); `governance.test.ts` |
| Phase 6 — Typography and captions | **Partly met, verified-here on a synthetic transcript.** Gate has three parts: Hebrew/mixed-script golden tests pass (6 renders, small set); transcript removal preserves sync (frame- and sample-checked); **timing corpus not reported — no speech recognition exists here (B-7)** | `pnpm proof:phase6` 33/33 (`docs/evidence/phase6-proof.json`); `captions.test.ts` in core and engine; `subtitles.test.ts` |
| Phase 7 — Motion and creative catalog | **First batch verified-here (Canvas2D look system).** Gate ("every shipped entry has working preview/export and reviewed visual fixtures") holds for the 12 effects, 17 blend modes, 2 mask shapes and 12 transitions that exist; most of the phase scope is not built | `pnpm proof:phase7` 30/30 (`docs/evidence/phase7-proof.json`), `effects.test.ts`, `look.test.ts`, `/lab.html` |
| Phase 8 — Sound and voice | **First batch verified-here.** Gate parts: PCM/DSP and loudness tests pass (synthetic signals); sounds are actual assets (7 synthesised); **voice/narration/cloning not built — needs a provider or model decision (B-8)** | `pnpm proof:phase8` 17/17 (`docs/evidence/phase8-proof.json`), `audio.test.ts`, `/selftest.html` |
| Phase 9 — Analysis intelligence | **Model-free part verified-here on synthetic corpora** (scene cuts, beats: corpus results reported, confidence and manual correction, stored as source-linked editable data, fully local). **Everything model-based is not built** (reframe, segmentation, pose/tracking, depth, semantic search) | `pnpm proof:phase9` 12/12 (`docs/evidence/phase9-proof.json`), `beats.test.ts` |
| Phase 12 — Delivery ecosystems | **Provider-free part verified-here.** Gate parts: variant overrides survive master changes (yes); preflight catches faults (the eight kinds it checks); **publishing flows, thumbnails/metadata, provenance, MCP App not built** | `pnpm proof:phase12` 13/13 (`docs/evidence/phase12-proof.json`), `variants.test.ts` |
| Phase 11 — Director and recipes | **Rule-based recipes verified-here** (editable, grounded in project data, alternatives, whole-task undo, hand edits survive regeneration). **The natural-language Director and every generative recipe are not built** (need a language model / providers: B-9) | `pnpm proof:phase11` 11/11 (`docs/evidence/phase11-proof.json`) |
| Phase 13 — Release qualification | **Started.** Done here: independent security review with fixes, heuristic accessibility audit, 3,000-edit soak with replay/restart, project archive restore, verification of previously unexercised editor interactions. Not done: catalog completion, performance tuning on a target machine, packaging, browser/playback soak, real-media corpora | `docs/evidence/soak.json`, `a11y-audit.json`, `editor-interactions-proof.json`, ADR-0002 amendment |
| Phase 10, G2–G3 | Not started (needs providers and a GPU) | — |

## Completed and verified-here

**Phase 0** — toolchain and scripts; capability probe; brand tokens/logo; he/en i18n; fixture generator with frame-index truth; end-to-end loop
import → edit → preview → MCP agent edit → live UI update → export (all 105 exported frames source-exact; beeps within 0.06 ms; one-frame PSNR 46.7 dB / SSIM 0.998).

**Phase 1** (ADR-0004 updated)
- Entity versions: every commit records the exact entity-level diff; `entity_versions` tracks last change (and deletion) per entity.
- Semantic rebase: `baseRevision` accepts a stale base only when nothing the edit reads or writes changed since; otherwise `conflict` naming entity, revision and actor. Strict `expectedRevision` kept.
- Undo/redo as compensating transactions, per actor; refused with a conflict list if the items changed later or the restore would be invalid; other actors' later edits survive. Replayable from the op log.
- Property test: random op sequences, undo-all then redo-all restore the exact creative projection at every step (60 runs per test run; `PF_PROPERTY_RUNS` raises it). The 10,000-sequence nightly run is not set up.
- Convergence: two REST+SSE clients and one MCP client, seeded interleavings with stale intents, duplicate deliveries, strict-stale sends, reconnects and undo; asserts typed errors only, no lost accepted commits, rebase safety from history, replica convergence, replay equality, authorization. No server bug found.
- OpenAPI 3.1 generated from the op registry (`GET /api/v1/openapi.json`, 26 paths), with a drift test against the running server.
- Idempotency compares canonical operations (key order and unreduced times no longer matter).
- Storage migration step (`PRAGMA user_version` 1).
- UI: undo/redo buttons, Ctrl/Cmd+Z, Shift+Z, Y; edits use `baseRevision` so a concurrent agent edit elsewhere no longer causes a conflict.

**Licence notices (actionable gap closed)** — the web build emits `THIRD_PARTY_NOTICES.txt` with full texts for every bundled third-party package
(Heebo OFL-1.1, Mediabunny MPL-2.0 with source location and "unmodified" statement, react, react-dom, scheduler, zod); the build fails if a bundled package has no licence;
`pnpm check:notices` verifies the built artifact and is part of `pnpm check`. The "build fails on missing licence" path itself is untested.

**Amendment A1 · G0 (model-free)** — provider adapter, descriptors with seven separate qualification dimensions, import-as-draft, durable capability jobs,
same job shape from UI/REST/MCP, cancellation of a queued job, restart resume, ambiguous-submission handling (injected faults, labelled),
output validation, **derived assets with lineage**, **attach-or-propose through `add_clip`**, **stale-result protection** (dependency edited while the job waited → nothing placed, asset kept as proposal),
attached provider image verified by pixel through `render_frame`, undo of the placement.

**Checkpoint 3 additions**
- Media-input staging: capability parameters of type image are project asset ids only (paths/URLs rejected); the source is streamed to the provider under a content-addressed name; job and derived asset record source hash and lineage; declared output-size contracts are enforced.
- Model store: ready = exact size + SHA-256; partial or one-bit-wrong files are never ready; explicit owner-only download bound to the exact byte count, resumable, host-restricted, verified before publish.
- Experimental status: open quality/Hebrew reviews do not block a run but label the capability and every result.
- Bounded BiRefNet trial (owner-authorised): 444 MB downloaded and verified in 29 s; one CPU inference ~30 s; matte IoU 0.9997 on one synthetic image with known truth; RGBA cutout attached and alpha pixel-checked through the shared compositor. Functional evidence only.
- Ingest derivatives (worker-built, lead-integrated): JPEG thumbnail sprite selected by frame index, 3-level waveform peaks, H.264 proxy with identical frame count/rate (every proxy frame barcode-checked), restart recovery, served via REST and announced over SSE. Not yet used by the UI or the preview.
- `GET /api/v1/openapi.json` does not list itself (known gap).

**Checkpoint 4 — Phase 2 (media and playback)**
- Conform route at ingest for variable frame rate, rotation metadata and codecs the editor cannot decode (HEVC): original bytes kept, constant-rate upright H.264 copy edited, mapping recorded (`conform.test.ts`).
- Media read by HTTP range requests; budgets of 6 clip decoders (8 in the render worker), 16 stills, 16 MiB byte cache per decoder; preview decodes the frame-identical proxy, export the original.
- Preview audio decoded as a stream with ~1.5 s lookahead on the audio clock (no whole-file decode).
- **Seek conformance:** H.264 (GOP 30 / B2, GOP 250 / B3), 29.97 fps, 60 fps source in a 30 fps project, VP9/WebM, AV1/MP4, 25 fps — 1,000 seeded random seeks each through the real decode + export path plus a sequential control: 0 wrong frames in 7,000 + 1,950 checks. HEVC is not decoded directly (it is conformed).
- **Ten-minute A/V sync export** (640×360, 16,879 frames after a 37 s + 11 frame cut): 563 flash/beep pairs, max offset 0.063 ms, drift first-third→last-third 0 ms, export 3.45× real time on this CPU.
- **Preview sync, one 3.5 s headless run:** beep onsets within 0.06 ms of timeline positions on the audio clock (sample-accurate AudioWorklet tap); frames painted a median 5–15 ms and p95 ≈ 21–24 ms after the clock reached them (two runs). Not a general performance claim.
  A first measurement with a ScriptProcessor tap showed a false 45 ms lag; it was the instrument, confirmed before changing any playback code.
- Open Phase 2 scope: disk storage quota/garbage collection, OPFS/offline drafts, URL import, Phone Drop, recorder, resumable upload, bins/tags, analysis caches, HDR detection/tone-mapping, memory soak test, monotonic-clock fallback not exercised, real camera/phone footage (none available with a usable licence).

**Checkpoint 4 — Phase 3 (editor interaction)**
- Keyframes (x, y, scale, rotation, opacity; linear/hold/ease) with `set_keyframe` / `delete_keyframe` / `clear_keyframes`; animation is preserved exactly across trim and split (property test); available over REST/MCP automatically.
- Editor rebuilt around a session store and a command registry that drives keyboard, palette and buttons.
- Keyboard-only workflow proven: reach import by Tab, add to timeline with Enter, select, split, trim, nudge (linked audio follows), add text, set keyframes, edit an animated value, step between keys, undo.
- Bilingual command palette (search in either language, niqqud-insensitive), remappable shortcuts stored per user, shortcuts inert while typing or while the palette is open.
- Direct manipulation: timeline drag move/trim with snapping and a ghost; canvas move/scale/rotate handles with keyboard equivalents; each gesture is exactly one transaction.
- Presence: other participants' playhead and selection as labelled ghosts (REST + MCP `set_view`); opt-in Follow Agent that any manual seek or selection ends.
- Activity feed described in the interface language from operation names.
- Filmstrips and waveforms on timeline clips from the ingest derivatives.
- Visual baselines: three deterministic screenshots (reduced motion), compared by SSIM on every run.
- Found by looking at screenshots, then fixed: palette screenshot taken mid-fade (now deterministic), English activity text in the Hebrew UI, 17-decimal drag values.
- Open Phase 3 scope: source viewer, minimap, loop range, J/K/L shuttle, I/O marks, markers, copy/paste, groups, multi-select/marquee, cross-track drag, workspaces (Quick/Pro/Motion), saved layouts, tooltips, first-run demo, tablet/mobile layouts, automated accessibility audit and screen-reader walkthrough (not run), text handle bounds approximate.

**Checkpoint 5 — Phase 4 (production export)**
- Every export is planned into an immutable manifest: document snapshot, asset content hashes, bundled font file hashes, engine versions, output geometry, and a size estimate labelled as an estimate.
- Preflight blockers refuse a render that could not be faithful (missing media, non-bundled font, empty range) with typed errors; blockers outside the exported range do not block it.
- Formats: MP4 H.264+AAC, WebM VP9+Opus, WAV audio-only, PNG still; frame range, scale (1, 0.5, 0.25) and quality; audio cut by absolute sample positions.
- Cancel (queued → removed; running → stopped in ~0.2 s, nothing published, scratch removed) and retry from the same snapshot even after the project moved on; available in REST, MCP and the editor.
- **Browser export route** (worker-built, lead-integrated): the tab renders with the same evaluator/compositor and encodes with WebCodecs + Mediabunny under a 15 s tab lease with heartbeats; lease loss fails the job (`lease_lost`), another session cannot take it over, completion is single-use. On this Chromium it produces H.264 + **Opus** in MP4 because no AAC encoder exists, and declares that substitution. 105 frames at 640×360 in 0.59 s in one run; every frame source-exact; SSIM 0.9965–0.998 against the server route.
- **Parity suite:** paused editor preview vs headless still — byte-identical on 30/30 frames, with and without video (after a fix: the paused preview now decodes the original, playback uses the proxy). Compositor vs decoded H.264 export (47 frames): min PSNR 36.8 dB, min SSIM 0.997; colour, temporal and barcode checks clean.
  Measured limit: 14 px text over saturated colour edges drops to 29.1 dB in 4:2:0 at 640×360 (warning, not hidden); 28.8 px at 720p measured 33.9 dB and 43 px at 1080p 35.8 dB on one synthetic scene. The "qualified text size" statement derived from this is weak (the worker flagged it) and is treated as a characterisation, not a guarantee.
- Preview is full project resolution when paused.
- Open Phase 4 scope: streaming output target (browser route buffers in memory), checkpoint/resume of a partly rendered job, animated GIF/WebP, subtitle sidecars, project archive, batch variants, hardware-encoder profile and 4K (no GPU), long-export memory soak, lease state survives only in memory.

**Checkpoint 5 — Phase 5 (agent surface and human control)**
- Named agent grants (token shown once, stored hashed) with modes Observe / Propose / Edit / Autopilot, optional project, track and time-range limits, expiry and revocation. Limits are enforced from the exact entity diff of each edit, so moves across tracks, deletes, bundled transactions and undo are covered.
- Pause Agent / Take Over: owner-only, server-side; agent edits, jobs and proposals return `agent_paused`; reading and the owner's edits continue; jobs already running finish but their results are kept as proposals rather than placed.
- Proposals: a Propose-mode credential gets a proposal from every ordinary editing tool; the owner reviews before/after stills in the editor and accepts or rejects; accepted proposals commit under the owner (so Ctrl+Z works); a proposal written against changed content goes stale instead of overwriting it.
- Approvals: single-use, expiring, bound to a hash of the exact action; only the owner's session can approve; used for agent-requested model downloads.
- Budget ledger: atomic reservation, settle/release, unknown outcomes stay counted; Autopilot only. Unit-tested; **not exercised end to end because no paid provider exists**.
- New senses: `describe_moment`, `render_contact_sheet`, `plan_export`, `get_controls`; 35 MCP tools from one registry.
- **Ten scripted goals through MCP** (deterministic script over the official client, not a language model): rough cut, tighten, Hebrew title with keyframed fade verified from stills, reorder, remove a second and close gaps, inspect-correct-reinspect, propose → owner accepts in the editor → owner undoes, range export verified frame by frame, agent undo, scoped captions-only agent.
- Open Phase 5 scope: MCP Tasks extension (jobs are polled by id; the server does not claim Tasks), MCP resources/prompts/playbooks, OAuth for remote MCP, third-party MCP hosts untested, grants/approvals management UI (REST only), activity/call log dialog, transcript and audio-analysis senses (need Phases 6/9), preview-clip sense, range-limited grant only unit-tested.

**Checkpoint 6 — Phase 6a (captions and transcript editing)**
- Document: `transcripts` by asset in **source time** (phrases, words with stable ids, timing grade `word` / `segment` / `approximate`, original text kept after corrections); caption tracks (`manual` cues or `transcript` mode linked to a media track) with a style (4 presets: classic, karaoke, word-pop, box-highlight).
- Captions in transcript mode are evaluated at render time from source time, so they follow every cut, trim and move with no re-timing step; words that were cut out are not shown. SRT/VTT/ASS export uses the same rule as the picture.
- New ops (all through `Store.commit`, so REST, MCP, undo and proposals apply): `add_caption_track`, `set_caption_style`, `add_cue`, `update_cue`, `merge_cues`, `import_captions`, `set_transcript`, `import_transcript`, `correct_transcript`, `cut_range` (ripple across all tracks; a locked track fails the cut instead of drifting), `delete_transcript_range` (text-based editing). `set_transcript` cannot be labelled as speech recognition by a client.
- Word-level highlight and word-precise cuts need word-level timing: estimated timing draws no highlight and refuses a precise cut with a reason.
- Subtitle codec: SRT/WebVTT parse and serialize, ASS export, exact millisecond rationals, frame snapping with the largest shift reported (36 tests).
- Word-level bidi layout for captions (Hebrew base with embedded Latin/number runs) as a pure, unit-tested function; the six committed renders were inspected by eye once.
- Senses: REST `GET …/transcripts/{assetId}`, `GET …/captions?format=srt|vtt|ass`; MCP `get_transcript`, `export_captions` (37 MCP tools).
- Editor: transcript panel (click a word to seek, shift-click range, delete words, correct a phrase, timing badges, honest empty state with SRT/VTT import) and caption controls (preset, position, size, colours, import, export links). Verified by the proof for these flows only; Inspector is now crowded (needs the workspace/tab layout from Phase 3 carry-over); no accessibility audit.
- Measured in the proof (one fixture, this CPU profile): after deleting two "words", export has exactly 207 frames with the cut at frame 60 → source frame 93, next beep at 2.900 s (max onset error 0.042 ms), caption phrase change on the same frame as the beep; correcting text leaves exported audio bit-identical.
- **Not done in Phase 6:** speech recognition / forced alignment and the timing corpus (B-7), silence/filler candidates, font catalog beyond Heebo, rich text, text animation presets, the other 16 catalog caption styles, reading-speed rules, translation review, per-word manual cue timing UI, transcript entity is one undo unit (two people correcting different phrases at once will conflict rather than merge).

**Checkpoint 6b — silence candidates, clip animation, font catalog**
- Silence candidates: ffmpeg `silencedetect` on the original file (no model) → source ranges → timeline cuts snapped inward with breathing room. Read-only (`POST …/analysis/silences`, MCP `find_silences`); the caller applies the returned ops as one transaction pinned to the analysed revision, so a stale result is refused. Editor panel lists candidates and removes them in one undoable step. Proven on the beep fixture only; quiet speech vs silence on real recordings is **unverified**.
- `animate_clip`: entrance/exit (fade, pop, four slides) written as ordinary keyframes, so they stay editable. Not built: per-character/per-word text animation, the wider preset catalog.
- Font catalog: 5 OFL families with Hebrew subsets (Heebo, Rubik, Assistant, Frank Ruhl Libre, Secular One), exact npm versions, licence text in the bundled notices (build check enforces it), every face verified loaded before any frame is drawn, export manifest pins files by SHA-256. Target is 60 families / 20 Hebrew; this is 5. "Hebrew coverage" here means declared subset + load check, not a typographic review.
- Font pickers for titles and captions. Inspector is long; needs tabs/workspaces.
- Test-harness note: the Phase 0 preview-audio check failed once in a loaded run (scheduled-ahead 2101.3 ms vs a 2100 ms bound; sync error was 0.06 ms). Three reruns passed at 2090.7 ms. The bound was 9 ms tight and is now +650 ms; recorded here rather than hidden.
- Open in Phase 6: ASR/alignment/timing corpus (B-7), filler-word candidates (needs ASR), rich text, per-word text animation, reading-speed rules, translation review, remaining caption styles and fonts.

**Checkpoint 7a — look system on the shared compositor**
- Registry (`packages/core/src/effects.ts`): each effect has id, version, bilingual name, parameter schema with defaults and ranges, cost class, and declares it has no temporal dependency. 12 effects: color adjust, black & white, sepia, invert, tint, gaussian blur (edges extended, not faded), vignette, diffusion glow, drop shadow, pixelate, seeded grain, RGB split. 17 blend modes. Rect/rounded/ellipse masks with feather and invert that follow the clip. 12 transitions (dissolve, dip black/white, 4 wipes, 4 pushes, zoom) that play at the start of a clip over the previous clip's source handle; refused with the usable length when there is no handle.
- One implementation (`packages/engine/src/look.ts`) used by preview, stills and export. Order: place → effects in list order → mask → transition → blend. Clips without a look take the old direct path, so existing output is unchanged (parity suite still byte-identical).
- Ops: `add_effect`, `update_effect` (params, bypass, reorder), `remove_effect`, `set_clip_blend`, `set_clip_mask`, `set_transition`. Unknown effect types are rejected by validation and by export preflight. Export manifest lists effects with versions. Discovery: `GET /api/v1/catalog`, MCP `list_catalog` (40 MCP tools).
- Proof checks pixels, not screenshots: e.g. dissolve frame = (1−p)·A + p·B within 1 level (mean 0.17), wipe edge exact, blend arithmetic within 1 level, grain identical on re-render and different on the next frame, random access byte-identical, export of a range with looks vs stills min PSNR 42.2 dB over 9 frames (one fixture, 640×360).
- Editor: effect list with controls generated from the schemas, bypass/reorder/remove, blend, mask and transition controls. `/lab.html`: 134 tiles for every entry in 16:9 and 9:16, default and extreme, transitions in 5 steps; looked at once by the lead (not a design review).
- **Not built (Phase 7 scope):** GPU compositor and every shader family (distortion, glitch, film, lens, kaleidoscope…), chroma key and mattes, polygon/text masks, tracked masks, keyframed effect parameters, adjustment layers, speed ramps/velocity, motion blur, graph editor, layouts, hover preview/favourites/user presets, Lab export-pairing and loops, audio crossfade in transitions. Performance of heavy looks at 1080p+ is unmeasured. Catalog targets (Appendix A) are far away: 12 effects, 12 transitions.

**Checkpoint 8a — sound**
- One audio plan (`packages/engine/src/audio.ts`) describes every clip in integer samples with its gain, balance, fade envelope and ducking envelope. The server export, the preview and the browser export all consume it.
- Server export audio is now a streaming reference mixer (`apps/server/src/audiomix.ts`): one decoder process per clip, mixed in one-second chunks, so memory does not grow with programme length; the previous ffmpeg filter graph is gone. Existing audio proofs (Phase 0, Phase 4, 10-minute sync) still pass unchanged.
- Ops: `set_clip_fades`, `set_track_audio` (gain, pan, mute), `set_ducking`, `set_loudness_target`. Fades stay on the outer edges through splits and cuts and are clamped when a clip gets shorter.
- Ducking lowers a track under speech on other tracks: transcript phrases where a transcript exists, otherwise the whole clip. It is range-based, not a signal-following compressor.
- Loudness: EBU R128 measurement of the real mix (`POST …/analysis/loudness`, MCP `measure_loudness`); export applies **one static gain** toward the target and never exceeds the true-peak ceiling; no compression or limiting. Clipping of an un-normalised mix is reported in the job result. Browser export refuses projects with a loudness target (it cannot measure) instead of exporting at a different level.
- Built-in sound effects: 7 sounds synthesised by formula (no third-party content), stored as normal content-addressed assets with their recipe in provenance (`POST …/sfx`, MCP `add_sound_effect`).
- Measured (synthetic sines, this CPU profile, one run each): gain −6.0206 dB for 0.5; fades and ducking at 17 points with error below 0.001; ducked level −12.0001 dB; normalised export −16.0 LUFS for a −16 target; 320 s / 40-clip mix continuous across all 39 joins, 47× realtime; WebAudio chain vs reference mixer max error 6.9e-7 of full scale, also when starting mid-clip.
- Editor: Sound tab (track volume in dB, pan, mute, ducking source, clip fades, loudness target, measure, level meter). The meter and audible preview of fades/ducking were **not** verified during live playback — only the WebAudio chain offline and the controls' effect on the document.
- **Not built (Phase 8 scope):** EQ, compressor/limiter, noise reduction, de-esser, audio keyframes (volume automation), crossfades between clips, voice recording, narration/TTS, voice cloning (needs provider + consent flow), stems, licensed SFX/music library, real-speech and real-music tests.

**Checkpoint 9a — model-free analysis**
- `doc.analyses[assetId]`: scene cuts and beat grid in source time, with method, parameters and an `edited` flag. Timeline markers are derived through the current clips, so they follow every trim, move and cut (never stored in timeline time).
- Scene cuts: ffmpeg scene score. Corpus (one synthetic 10 s clip, 5 hard cuts, H.264 with B-frames): 5/5 on the exact frame, 0 false cuts; a continuous shot gives 0; **a dissolve is not detected** (stated limit).
- Beats: spectral-flux onsets + dynamic-programming tracking in TypeScript, no model. Corpus (six 24 s synthetic drum loops, 90–140 BPM and one drifting 120→127): F1 0.97–1.00 at ±70 ms, median timing error ≈5 ms, tempo within 1.2 BPM on the steady loops; steady noise scores 0.05 confidence against 0.57–0.99 for the loops. Known limits written in the code and UI: it follows the strongest broadband onsets (can sit on the off-beat), can report double/half tempo, and still returns a low-confidence grid for pulse-less sound.
- Found and fixed while proving: confidence did not separate noise from music (mean not removed); the grid ran on through leading silence.
- Ops: `edit_analysis` (add/remove/replace times by hand; also allows fully manual data), `split_at_scenes` (one transaction, linked sound included). Server: `POST …/assets/{id}/analyze` (refuses to discard hand corrections unless `overwrite`), `GET …/analysis`; MCP `analyze_asset`, `get_analysis`; `get_timeline` returns markers. Scripted agent demo: analyse music, read markers, place picture cuts on bar lines within 3.3 ms of the true beats.
- Editor: analysis panel (run, results with confidence warning, split into shots, add/remove a beat or cut at the playhead), beat and scene markers on the timeline, optional snapping of clip moves to markers. Proven for scene markers and split; **drag snapping to beats and the manual add/remove buttons were not exercised in a browser**.
- Flaky test fixed: `derive.test.ts` used random bytes as a corrupt file and failed once in a full run; it now uses fixed bytes.
- **Not built (Phase 9 scope):** reframe/subject tracking, segmentation, pose, depth, semantic/visual search, assisted colour, downbeat/bar detection, fit-music-to-duration. Real footage and real music are untested (no licensed corpus here). Analysis runs inside the request (fine for short media; long files need the job queue).

**Checkpoint 12a — linked formats, safe areas, preflight**
- A format variant stores only frame size, fill mode (contain/cover), safe-area guide and per-clip overrides (position/scale/hide). The variant document is projected from the master at render time, so every master edit reaches every format and overrides survive moves, trims, splits and cuts (new pieces inherit them). An overridden property stops following the master's animation in that format only.
- Four starting profiles (9:16, 4:5, 1:1, 16:9). Their safe-area insets are **generic guides, not any platform's specification**, and are editable per variant.
- Export takes `variantId` and snapshots the projected document (immutable); `POST …/exports/batch` plans all formats first and creates one job each or none. `GET …/frame?variant=` renders a format still.
- Creative preflight (`GET …/preflight`, MCP `preflight`): render blockers, stretches with no picture, missing loudness target, transitions that lost their handle, pictures enlarged >1.5×, titles/captions outside the safe area, captions over a reading-speed limit. Each issue names the objects; six of them carry a mechanical fix as ops. Title extents are estimates (the server does not shape text); the reading-speed limit is a setting.
- Found while proving: the title safe-area fix could not clear a title wider than the safe rectangle; it now shrinks it for that format first. The headless renderer uses the built web bundle, so engine changes need `pnpm build` before stills/exports reflect them (the proof instructions already say so).
- Editor: format switcher with badge, safe-area overlay, Deliver tab (add/remove formats, fill mode, preflight with fix buttons, export one/all). Proven: switching shape, overlay, adding a profile, preflight list and a fix. **Not exercised in a browser:** dragging on the canvas to create an override, hide-in-format, batch-export job list. Inspector sliders still edit the master while a format is viewed; caption style cannot differ per format.
- **Not built (Phase 12 scope):** publishing connectors, thumbnail and metadata studio, provenance/C2PA, MCP App, per-format caption style, per-format text content.

**Checkpoint 11a — rule-based recipes**
- A recipe plans ordinary ops from data already in the project (no language model): `beat-montage` (pictures cut on the beats of a music clip), `social-pack` (formats, transcript captions, loudness target; only what is missing), `tidy-speech` (measured pauses removed on every track, captions, loudness).
- Plan is read-only and reports steps, the data it rests on (e.g. tempo, confidence, method) and alternative settings. Apply commits one transaction pinned to the planned revision through governance; one undo removes everything including the run record.
- Regeneration replaces the clips a run created that nobody changed and keeps hand-edited ones untouched, planning around them. Hand edits are recognised by a content fingerprint recorded when the run created each clip.
- Found while proving: the first version recognised hand edits by change counters, which an undo resets — after an undo, edited clips were no longer protected. Fingerprints fixed it.
- REST plan/apply/regenerate, MCP `plan_recipe`, `apply_recipe`, `regenerate_recipe`; recipes listed in the catalog.
- **Not built (Phase 11 scope):** natural-language planning, Prompt-to-Draft, Long-to-Shorts, hooks, B-roll, sound design, brand kits, user-authored recipes/macros.

**Checkpoint 13a — independent security review and fixes**
- A separate read-only reviewer traced the server's authorization paths. It confirmed one high, two medium and five low findings and reported the areas it found sound (no caller can inject internal ops; observe/propose credentials cannot persist changes; no command injection; blob and model paths; model downloads; ComfyUI loopback; CORS).
- **High, fixed:** any local program could obtain the owner session (no proof of being the owner's browser). The session now needs a launch secret carried by the owner link the server prints at start-up (ADR-0002 amendment). Consequence for users: open the printed link, not the bare address.
- **Medium, fixed:** track/range-limited grants could change non-clip data through upload, sound-effect import, analysis and provider-job attachment; agents could undo anyone's transaction by id.
- **Low, fixed:** project-limited grants via two MCP tools; cancel ignoring pause/ownership; no limit on heavy read-only work (now two at a time, bounded queue, timeouts); ffmpeg protocol whitelist missing on analysis and mix paths; playlists accepted as media.
- **Recorded, not fixed:** budget ledger is not wired to anything (no paid capability exists); no per-credential rate limits or export quotas.
- Six regression checks added to `pnpm proof:phase5` (30/30) and one to `pnpm proof` (54/54); `analysis.test.ts` covers the limiter.
- This was one review by one reviewer reading code; it is not a penetration test. The browser side was reviewed later (checkpoint 13m).

**Checkpoint 13b — accessibility audit and soak**
- `pnpm audit:a11y` (`docs/evidence/a11y-audit.json`): automated heuristic audit of the editor with every Inspector panel shown and one clip selected, in Hebrew (RTL) and English (LTR): 121 visible controls, all with an accessible name; no text below WCAG contrast thresholds; tab semantics complete; a visible focus indicator on each of the 51 elements reached by Tab; `lang`/`dir` set. The audit first plants three known defects (unnamed button, low-contrast text, removed focus ring) and fails unless it detects them. **This is not a WCAG conformance claim:** no screen reader, no user testing, no check of dialogs/palette states, canvas content, drag operations by keyboard, or reduced-motion behaviour beyond the setting being honoured in tests.
- `pnpm soak` (`docs/evidence/soak.json`): 3,000 pseudo-random mixed transactions by two actors over REST (2,641 committed, 359 correctly refused, 0 server errors), document valid at all 30 checkpoints; full op-log replay equals the live document; reopen after restart identical with undo history intact; SQLite integrity ok.
- Found by the soak: commits slow down with **project size** (not history length). Each commit copies, validates, diffs and stores the whole document. Replacing string-based entity comparison with a structural one (tested against the old one) cut the median at 708 clips from 36 ms to 20 ms; a small project in the same database after 2,600 revisions still commits in 5 ms. Remaining cost ≈ 2.2 ms per 100 clips on this machine. Replaying 2,631 operations takes about 8 s (history view of old revisions is slow on large projects).
- Not done in Phase 13: playback/export soak, memory soak in the browser, failure injection beyond restart (disk full, killed ffmpeg mid-export is covered in Phase 4 only), packaging/installer, catalog completion, performance tuning on a target machine.

**Checkpoint 13c — spending control wired before any paid provider exists**
- Capability descriptors now declare a per-run cost (`cost.cents`, 0 for everything that runs locally). A capability with a cost reserves it against the caller's Autopilot budget before anything is dispatched; without a budget, the right mode or enough left, the job is closed as refused and nothing is submitted.
- The ledger is settled in one place when a job ends: success settles the reserved amount; a cancel before the job ever started releases it; **any other ending (failed, canceled after starting, submission unknown) stays counted** until the owner releases it (`POST /jobs/{id}/budget/release`). Unit-tested (`governance.test.ts`).
- **Not exercised end to end:** no priced capability exists, so the reservation call inside the capability job path has only been type-checked and read, not run. This must be proven with the first paid provider (Phase 10) before it is relied on. Costs are fixed per run; providers that bill by usage will need actual-cost reporting.

**Checkpoint 13d — editor interactions that had been built but not exercised**
- `pnpm proof:editor-interactions` (7/7, `docs/evidence/editor-interactions-proof.json`) drives in headless Chromium: a canvas drag while viewing a format creates a format-only override of exactly the dragged fraction (master untouched); hide-in-format and clear-override; clip moves snapping to beats with the toggle on and not with it off; add/remove a beat at the playhead; the level meter showing a real level during playback; "export all formats" producing one finished download per format at the right size.
- This supersedes the "not exercised in a browser" notes in checkpoints 8a (meter), 9a (beat snapping, manual beat edits) and 12a (canvas override drag, hide-in-format, batch-export list).
- Live playback of fades and ducking was measured afterwards (`pnpm proof:phase8`, now 18 checks): output level per 50 ms window during real-time playback in headless Chromium matches the plan at six points (steady 0.5 and ducked 0.1256 exact; ramps within 0.036 of full scale, which is the window's own resolution). The Inspector/format inconsistency was fixed in checkpoint 13f.
- **Still unverified:** other browsers; touch input; real audio hardware (headless Chromium has no sound device, so output latency to a speaker is not measured).

**Checkpoint 13e — portable project archive**
- `GET …/projects/{id}/archive` streams one tar file (manifest, project document, every media blob by content hash, including untouched originals of conformed media); `POST …/projects/import` creates a new project from one. The tar reader/writer is purpose-built: only the three expected entry kinds are accepted, every blob is hashed against its name, the manifest and document are validated, and nothing is added unless everything checks out.
- Tested: round trip into a different store, deterministic bytes, exact Content-Length, reuse of media already present; rejection of a flipped byte, an entry renamed to escape the blob directory, a truncated file and a non-archive, each leaving no project, blob or temp file behind (`archive.test.ts`); restore over HTTP onto a second server with an empty data directory where a rendered frame is byte-identical (`pnpm soak`); download and re-import through the editor (`pnpm proof:editor-interactions`, now 8/8).
- Not included in an archive by design: edit history (the import starts a new one), derivatives, exports, grants. Not built: media garbage collection, disk quota, automatic backups. Archives are uncompressed and limited to four times the upload limit.

**Test-harness defect found and fixed (2026-11-15)**
- One run of `pnpm proof:phase3` stopped after 6 of its 27 checks and still printed "PASSED: 6/6": the older proofs (Phases 3, 4, 5, browser export, parity, long A/V sync, BiRefNet trial) wrote their report in a `finally` block without recording the crash. A report with that false "6/6 PASSED" was committed once (commit 9007e50) and replaced by a full 27/27 run in the next commit.
- All of those proofs now record a crash as a failed check, so the result is FAILED with the error text. The newer proofs (Phase 6 onward) already did this.
- The early stop itself did not recur in four further runs; its cause is not known. If it recurs it will now be visible.
- Consequence for earlier evidence: every "PASSED n/n" for those proofs in this document was read together with its check count at the time (27, 19, 24/30, 23), so none of the recorded results came from a truncated run; but the count is what made that checkable, not the word PASSED.

**Checkpoint 13f — carry-over items closed**
- Export: animated GIF (one palette for the whole clip, ordered dither; the plan warns that it is silent and when it will be large) and a `captions` option: `burned` (as before), `sidecar-srt` / `sidecar-vtt` (clean picture plus a subtitle file fixed at job creation, shifted and clipped to the exported range, `GET /jobs/{id}/captions`), `none`. Verified in `pnpm proof:phase6` (now 35 checks): clean vs burned picture, cue times for a range, GIF frame count/size and PSNR 38.1 dB against the still of one frame.
- `duplicate_clips` op: copies everything on a clip (trim, keyframes, effects, mask, fades, per-format overrides), keeps picture+sound pairs linked to each other, finds a free track. Editor: Ctrl+C / Ctrl+V (paste at the playhead) / Ctrl+D. No cut command yet.
- The Inspector's transform sliders now follow the viewed format (format-only override, reset to master, keyframe buttons disabled there), which removes the inconsistency noted in checkpoint 12a. Verified in `pnpm proof:editor-interactions` (now 10 checks).
- Still open from earlier phases (unchanged): source viewer, minimap, loop playback, J/K/L, markers, multi-select drag, workspaces; resumable upload, URL import, recorder, HDR, OPFS/offline; streaming export target, checkpoint/resume; MCP Tasks/resources/prompts, OAuth, grants/approvals management UI; keyframed effect parameters, speed changes; audio crossfades and volume automation; per-format caption style; media garbage collection.

**Checkpoint 13g — animation and sound carry-over**
- Keyframed effect parameters: any numeric effect parameter can be animated with clip-local keys (`set_effect_keyframe`, `delete_effect_keyframe`); keys are range-checked, move with the content on trims and splits, and are sampled by the same evaluator. `pnpm proof:phase7` (31): an animated blur softens progressively, holds after the last key, and re-renders identically. Editor: ◆ button per parameter; the slider writes a key when the parameter is animated.
- Audio crossfade (`set_audio_crossfade`): extends the earlier clip into its source handle and overlaps two linear fades that always sum to one; refused with the usable length when there is no handle; removable. `pnpm proof:phase8` (19): the exported level moves 0.5 → 0.25 exactly linearly with no dip.
- Cut (Ctrl+X) then paste moves clips in one transaction; nothing is committed by the cut itself.
- `pnpm proof:editor-interactions` is now 12 checks.
- Not built: volume automation curves, audio crossfade attached to picture transitions, crossfade UI (op and agent tool only).

**Checkpoint 13h — data lifecycle**
- `POST /projects/{id}/delete` (owner only, the exact project name as confirmation, refused while jobs are queued or running) removes the project, its history, jobs, proposals and exported files. Media is kept at that point because other projects may use the same files.
- `GET /storage` reports projects, database size, media in use, exports, and media nothing refers to. `POST /storage/gc` is a dry run unless `apply=true`. A file is collectable only if its content hash appears nowhere in any remaining project (current document, initial document, operation history), job or proposal, and it is older than ten minutes. Derivatives go with their source.
- Tests: `storage.test.ts` (shared media kept, history references kept, dry run removes nothing, grace period, idempotent, owner-only) and one HTTP authorization check in `pnpm proof:phase5` (31).
- **No editor control for either** (REST only), no disk quota, no automatic clean-up, no undo of a deletion (use the archive export first).

**Checkpoint 13i — owner controls in the editor**
- Agent access panel (Review tab): create a named grant (default mode Propose, limited to the open project by default), the token is shown once with the MCP endpoint, list and revoke. This replaces "grants management is REST only" from checkpoint 5.
- Project manager dialog (header): list, open, create, delete with the exact name typed as confirmation (links to the archive download first), storage report and clean-up with a separate dry-run step.
- Sound tab: crossfade control for the selected audio clip. Transport: loop playback (Shift+L).
- `pnpm proof:owner-ui` (7 checks, `docs/evidence/owner-ui-proof.json`): the token created in the editor sees only its project, an edit attempt becomes a proposal rather than a commit, another project is refused, and revoking stops it immediately; crossfade lands in the document; a looped 1-second timeline wraps at least twice; delete stays disabled until the exact name is typed.
- Bug found by this proof and fixed: the project dialog handled Escape only while focus was inside it, and deleting a row removed the focused element, so Escape stopped working and focus was lost. Escape is now handled at document level, focus is pulled back into the dialog, and it returns to the opener on close. **The accessibility audit did not catch this because it does not open dialogs** — its stated limit.
- Regression caught after the first commit of this checkpoint: the access panel requested the grant list before the owner session existed, so every editor load logged a 401, which failed the "no page errors" checks of the Phase 0 and Phase 3 proofs (53/54, 26/27). The new owner-UI proof had not caught it because it filtered 4xx console messages; that filter is removed. The panel now loads after the project. Commit 01e0c33 contains the defect; the next commit fixes it.
- Still open: approvals list UI, activity log dialog, J/K/L, multi-select drag, source viewer, workspaces.

**Checkpoint 13j — clip speed (slow motion and speed-up)**
- A media clip can play its source faster or slower by an exact ratio (`speed {num, den}`, 0.1–8). `set_clip_speed` keeps the same stretch of source and changes the clip's length (rounded down to a whole frame); linked picture and sound change together; it is refused if the longer clip would overlap a neighbour. It is an ordinary registered op, so the editor, REST and MCP all have it.
- One mapping (`packages/core/src/speed.ts`) is used everywhere timeline time meets source time: frame selection, trim limits, split, range cuts, split-at-scenes, transcript cuts, captions, scene/beat markers, silence candidates, transition and crossfade handles, preflight, the audio plan, the server mixer, preview playback and browser export.
- Sound is resampled with the picture ("varispeed"): pitch rises and falls with the speed. **Pitch-preserving time stretch is not implemented.** Keyframes and fades stay in timeline time (they are not rescaled when the speed changes).
- Editor: speed field and 0.25/0.5/1/2/4× presets in the clip Inspector; the clip's thumbnails and waveform follow the speed.
- `pnpm proof:speed` (12 checks, `docs/evidence/speed-proof.json`): every exported frame at 2×, 0.5× and 1.5× shows the predicted source frame (barcode); split keeps the export identical; overlap refused; still render and five preview seeks agree; exported tone pitch within 0.5 Hz of 440 × speed and length within a frame at four speeds; caption cues and a scene marker move with the speed. `speed.test.ts` (5, incl. a property test over speeds and trims).
- Limits: synthetic fixtures only; preview playback sound at speed was not measured (the export was); no speed ramps, reverse, freeze frame or fit-to-duration.

**Checkpoint 13k — timeline markers**
- `doc.markers` holds named, coloured points on the timeline (frame-aligned, one per frame). `add_marker`, `update_marker`, `remove_marker` are registered ops, so the editor, REST and MCP share them; markers are entities (diffed, undoable, restorable) and appear in the timeline query (`markers.user`) and in the project archive. Documents saved before markers existed load with an empty list.
- Editor: markers are real buttons on the ruler (name + timecode as the accessible name); M adds one at the playhead, Shift+M / Alt+M jump to the next / previous; while the playhead rests on a marker a small bar edits its name and colour or removes it.
- Verified: `markers.test.ts` (3) and one end-to-end check in `pnpm proof:editor-interactions` (now 13): add by key, Hebrew + Latin name, colour, a marker added through the API by another participant appears, navigation lands on the exact frames, remove, undo.
- Limits: timeline markers only (no clip markers, no ranges, no chapter export); they stay at their time when clips are cut or moved; a grant limited to tracks or a time range cannot change markers (same rule as other non-clip data).
- Bug found while looking at the screenshot, fixed before commit: marker names were invisible because an existing ruler style applied to them; the proof now also saves `editor-markers.png`, but **no automated check asserts the name is visible** (the accessible name was correct throughout).

**Checkpoint 13l — volume automation, and three editor defects found by its proof**
- Volume automation: a sound clip can carry level keys (`volume`, clip-local frame-aligned times, 0–4, straight lines between keys, held outside). `set_volume_keyframe` and `delete_volume_keyframe` (one key, or all) are registered ops. The keys become a third envelope in the shared audio plan, applied by the server mixer and by the WebAudio chain (preview and browser export) on top of gain, fades and ducking; they stay attached to the sound on trims and splits.
- Sound tab: "level at the playhead" field (shows the interpolated level, typing writes a key there), add / remove-this-key / clear-all.
- Verified: `audio.test.ts` (plan envelope, mixer values, trim, delete, refusals); `pnpm proof:phase8` (now 20): exported level at five points within 0.006 of the expected line, incl. a boost above 1, the same levels 1.5 s earlier after a start trim, plain level after clearing; `/selftest.html` compares the WebAudio chain with the reference mixer on a clip that has a volume envelope; one editor check in `pnpm proof:editor-interactions` (now 14).
- Limits: linear segments only (no curves/easing), no drawing on the clip in the timeline, no track-level automation; preview playback level was not measured separately (the shared chain is compared with the reference in the self-test).
- **Defects found while proving this, all in the editor, all fixed:**
  1. Two quick edits to the same item (name a marker, then pick its colour; a key, then another) were both sent with the same base revision, and the server correctly refused the second as a conflict — with the user's own first edit. The editor now runs its own commits and undo/redo one after another (`apps/web/src/editor/store.ts`); conflicts with other participants are detected as before (Phase 3 and 5 conflict checks pass).
  2. A number field whose value follows the playhead re-committed its old text on blur after the playhead had moved, writing a stray volume key. Number fields in the Sound tab now commit only text typed since the last commit.
  3. The volume handlers used the playhead position of the last render; typing straight after a seek could write the key at the previous position. They read the live playhead now.
- The same check exposed two places where the proof itself raced the page (it waited for the server, then acted on a panel that had not caught up). Those steps now wait for what the panel shows. The Look panel had the same weakness as (3) — its effect-key button and slider chose "write a key" vs "change the static value" from their last render — and is fixed as well: `Editor.commit` accepts a function that is evaluated when the edit's turn comes, so the choice is made from the document as it is then. The proof no longer waits before using the slider and passed 8 runs in a row. Other panels were not audited for this pattern. Markers checkpoint 13k was verified with only one run of this proof before these fixes; with the fixes it passed 8 runs in a row.

**Checkpoint 13m — browser-side security review**
- Scope: what the browser loads and runs. Read through the web app for HTML injection points (one `dangerouslySetInnerHTML`, a constant logo; no `innerHTML`, `eval`, `document.write`, message handlers or user-controlled links), then enforced the result with response headers.
- Every response now carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site`.
- Pages get a content security policy that allows only same-origin scripts, styles, fonts, images and media (plus `blob:`/`data:` images and `blob:` media): no inline scripts or styles, no `eval`, no `blob:` scripts, no plugins, no framing, no `<base>`. API, MCP and stored-file responses get `default-src 'none'; sandbox`, so an uploaded file opened directly as a page can load and run nothing.
- To make that policy possible: the audio measurement worklet moved from a `blob:` URL to a static file; the lab page's inline `<style>` moved to a CSS file; browser pages configure the schema library to interpret schemas (it otherwise probes `Function()`), so a normal page load produces **zero** policy violations.
- **Defect found by the new check (pre-existing):** handlers that return their own response (stored media, exports, range requests) bypassed the header middleware, so user-uploaded files were served without `nosniff` although the code appeared to set it for everything. Headers are now applied after the handler to whatever response goes out.
- `pnpm proof:phase5` (now 33): headers on a page, a JSON response and a media response; markup stored in a project name, a title and a marker name is displayed as text and runs nothing, with no violation at load; inline script, `blob:` script, remote script, inline event handler and `eval` attempts made inside the live editor page are all blocked and reported.
- The accessibility audit's own sensitivity check failed under the new policy (it planted its test defects with inline style attributes, which the policy blocks) and therefore refused to report "no findings"; it now plants them through the DOM API. The audit, the parity suite (Test 1 and 2 pass, same small-text warnings as before) and all proofs were re-run under the policy. `conformance:seek`, `conformance:avsync` and the ComfyUI proofs were **not** re-run under it.
- Limits: one review by one reviewer; not a penetration test. The policy is only applied by the built server (`pnpm start`), not by the Vite dev server. `style-src` does not allow inline styles, so a future dependency that injects `<style>` will fail visibly. No per-credential rate limits or export quotas yet. The session cookie is `HttpOnly; SameSite=Strict` but not `Secure` (loopback HTTP); a TLS deployment needs that flag.

**Checkpoint 13n — multi-select in the timeline**
- `move_clips` (registered op): moves several clips by one frame-aligned amount, keeps their spacing, takes linked picture/sound along, and is all-or-nothing (refused before 0 or onto a clip that is not moving; clips may pass through space the group itself vacates).
- Editor: Shift/Ctrl/⌘-click adds or removes a clip from the selection; Ctrl+A selects every clip on unlocked tracks; dragging one selected clip moves the whole selection (the earliest clip stops at 0); Alt+←/→ nudges the selection; Delete removes all selected clips in one transaction (linked partners are not listed twice). Copy, cut, paste and duplicate already worked on a selection.
- Verified: `moveclips.test.ts` (2) and one end-to-end check in `pnpm proof:editor-interactions` (now 15; five consecutive runs): each step is exactly one revision, a third clip stays put, one undo restores a two-clip delete.
- Limits: no rubber-band (marquee) selection; no cross-track drag of a selection; while dragging, only the dragged clip shows a ghost, and only its own track is checked for overlap before release (the op checks everything on commit and refuses the whole move); the Inspector shows the first selected clip only; trimming stays per clip.

**Checkpoint 13o — optional request limit per agent credential**
- `PF_AGENT_RPM` (config `agentRequestsPerMinute`): a token bucket per agent credential (grant id, or the bootstrap agent/observer token), covering REST and MCP because it sits where credentials are resolved. Over the limit: `429 rate_limited` with `Retry-After` and a typed body. The owner session is exempt; a wrong token is still 401.
- **Off by default, deliberately.** The first default (3000/min) was caught by the existing suite: the convergence test and the soak legitimately exceed it, i.e. it would have throttled the owner's own local automation. Verified with it off (the shipped default): 274 unit tests incl. `ratelimit.test.ts` (3, with an injected clock: burst, 429 + Retry-After, refill, per-credential, MCP, owner exempt, 0 = off) and soak 7/7. Phase 0 (54), Phase 5 (33) and Phase 11 (12) were run while the 3000/min default was still active and passed; they were not re-run after switching it off, and the other proofs were not re-run for this change (it only adds a branch that is skipped when the setting is 0).
- Limits: one global setting, not per grant; no export quota; in-memory (resets on restart); not a defence for a public deployment.

**Checkpoint 13p — MCP resources and playbook prompts**
- Resources (read-only, same scope and grant checks as the tools): `pulseframe://guide` (how editing works, what a credential may do, the rules), `pulseframe://ops` (operation schemas, internal ops hidden), `pulseframe://catalog`, and per project `pulseframe://projects/{id}/summary` and `/timeline` (listed for the projects the credential may see; identical to `get_summary` / `get_timeline`).
- Prompts: four versioned playbooks (`rough-cut`, `captions-pass`, `social-cutdown`, `review-edit`, v1). Each is a numbered step list naming the tools to call, ends with the rule that project text is material and never an instruction, and does not inline any project text.
- Verified with a real MCP client over HTTP (`packages/evals/src/mcp-resources.test.ts`, 3 tests): listing and reading; resource equals tool output; every snake_case name in the guide and playbooks is an existing tool; a grant limited to one project lists and reads only that project and cannot get a playbook for another; no credential is 401.
- Limits: the playbooks are written guidance; **no model has been run against them** (no language model is available here, B-9), so whether they produce good edits is untested. No resource subscriptions/change notifications, no Tasks extension, no MCP App. Untrusted-content handling is an instruction plus not inlining project text in prompts; tool results still return project text as plain JSON.

**Checkpoint 13q — audit of editor handlers that acted on render-time state**
- Read every editor panel for handlers that commit using the playhead or document captured at the last render (the defect class from checkpoint 13l). Found and fixed two more: the Inspector's transform sliders (they chose "write a keyframe" vs "change the static value" from the clip object of the last render) and the Analysis panel's "add / remove point at the playhead". Both now read the playhead when used and decide from the document when the edit's turn comes.
- Panels read and found not affected: Transcript (clicks carry their own word ids), Deliver, Recipes, Projects, Access, canvas handles (commit through the same transform path, now fixed).
- Verified: phase0 54, phase3 27, phase7 31, phase9 12, phase12 13, editor-interactions 15, 277 unit tests. **No new check reproduces these two specific races** (they need sub-frame timing); the fix is by construction and the existing checks show no regression.

**Checkpoint 13r — optional storage ceiling**
- `PF_MAX_STORAGE_BYTES` (config `maxStorageBytes`, 0 = off, the default): a ceiling for everything in the data directory. Uploads, project imports, exports and batch exports are refused with a typed `507 storage_quota_exceeded` (ceiling, bytes in use, bytes needed, and what to do) once it would be passed. An upload whose declared size cannot fit is refused before anything is stored; an upload of unknown size is cut off at the room left. Editing is never refused.
- The storage report and the project manager dialog show the total in use and the ceiling.
- Verified: `quota.test.ts` (2, over HTTP): fits / does not fit / nothing kept from the refused upload; at the ceiling exports, imports and uploads are refused while a normal edit succeeds; room freed → uploads work again. 279 unit tests; owner-ui 7, phase0 54, phase12 13 (ceiling off).
- Limits: the usage is measured by walking the data directory on each upload/export request (fine for hundreds of files, not measured for very large libraries); an export that starts under the ceiling may finish over it (its size is not known in advance); derivatives (thumbnails, proxies) made after an accepted upload are not pre-counted; sound-effect generation and model downloads are not checked; no per-project or per-credential quota; no automatic clean-up.

**Checkpoint 13s — backup of a running server, restore tested**
- `pnpm backup <destination>` (`apps/server/src/backup.ts`): SQLite online backup of the database (consistent, includes the WAL), then media and finished exports (only files that are missing or differ in size), then `tokens.json` (mode 600). Scratch files are skipped. Refuses a destination inside the data directory and a source that is not a data directory.
- Verified by `backup.test.ts` (2): backup taken while a server is running with further edits made afterwards; a second server started on the copy has exactly the project, revision and history of the backup moment (not the later edit), serves byte-identical media, accepts the same token, and can edit and undo; a repeat backup copies nothing; the two refusals. The command itself was run once by hand against a proof data directory.
- Why: the documented "running server" procedure needed the `sqlite3` command-line tool, which is not installed here, so it could not be verified; it is kept in OPERATIONS.md, marked as not covered by a test.
- Limits: no scheduled/automatic backups, no retention, no encryption of the copy; "differs in size" is the change test for files (sufficient for content-addressed media and finished exports, not a general sync); restoring over a live server is not supported (stop it first); a backup taken mid-upload may lack a blob that the database does not reference yet (harmless).

**Regression note (after checkpoints 13o–13s)**
- Full run: 281 unit tests; phase0 54, phase3 27, phase4 19, phase5 33, phase6 35, phase7 31, phase8 20, phase9 12, phase11 12, browser-export 23, editor-interactions 15, owner-ui 7, speed 12, soak 7, accessibility audit clean. **Phase 12 failed once (12/13)** in that run: the check measured the preview canvas before its first paint and read the browser's default 300×150 (ratio 2). The proof now waits for the first painted frame; three further runs passed 13/13. This was a race in the proof, present since the check was written, not a change in the product — but it means earlier Phase 12 passes depended on timing.

**Checkpoint 13t — freeze frame**
- `freeze_frame {clipId, at, duration}` (registered op): holds the picture a video clip shows at a timeline frame for the given time. Time is inserted across the whole sequence: clips from that point on move later; media clips crossing it are split (linked picture and sound stay paired; sound is silent during the hold); titles and manual captions crossing it stay on screen through it; refused if any track is locked. The hold is a new clip (`freeze: true`) with the picture's transform and effect values of that moment; it can be trimmed to any length and has no speed.
- The shared time mapping treats a hold as covering no stretch of source, so every consumer (frame selection, trims, captions, markers, audio plan, preflight) needed no special case.
- Editor: "Freeze frame" with a duration field in the clip Inspector; held clips are marked ❄ on the timeline.
- Verified: `speed.test.ts` (6, incl. split, relinking, titles, trimming the hold, refusals, holding the first frame) and `pnpm proof:speed` (now 16): all 150 exported frames read from their barcodes (play, 30 identical frames, continue), the mix is silent during the hold and later beeps arrive exactly one second later, one undo restores the single clip, and the Inspector control produces the same structure.
- Full regression with this change: 282 unit tests; phase0 54, phase3 27, phase4 19, phase5 33, phase6 35, phase7 31, phase8 20, phase9 12, phase11 12, phase12 13, browser-export 23, editor-interactions 15, owner-ui 7, soak 7, accessibility audit clean. The speed proof failed its new Inspector check once in that run (15/16): the proof counted the ❄ marker before the page had re-rendered. It now waits for the page; four further runs passed 16/16.
- Limits: the hold always inserts time (no "replace the rest of the clip with a still", no freeze at the end without inserting); music crossing the point is cut and resumes after the hold, like all other sound; preview playback across a hold was not measured (export was); transcript-driven captions do not show during a hold (it has no speech); no reverse, no speed ramps.

## In progress
- Remaining work that needs no outside decision is carry-over scope listed per phase above. Everything else is blocked on B-1…B-9.

## Blocked / unverified (with what would unblock)

| Item | State | Affected criterion | Unblocked by |
|---|---|---|---|
| Quality review and GPU qualification of BiRefNet (and every other model workflow) | implemented, not runtime-qualified | A1 G1 gates, FFG-05, FFG-11 | Reviewed real-image fixtures (hair, edges, blur, occlusion) with usable licences; a GPU profile. Further model downloads need a new authorisation (the 1 GB trial grant is used: 0.44 GB) |
| GPU compositor, GPU/VRAM qualification, Appendix C2 performance targets | implementation can proceed; execution cannot be verified (B-1) | Phases 2, 4, 7, 13; FF-06 | A GPU reference machine |
| Browser MP4+AAC export | blocked here (B-2) | Phase 4 browser route | A Chrome build with AAC WebCodecs encode |
| Preview A/V sync; preview/export parity across many frames; long media; real camera/phone footage; other browsers; other MCP hosts | unverified | Phases 2–4 gates | Scheduled in Phase 2/4 below; other browsers are not installed here (Chromium only) |
| Worker lease / prewarm (FF-07) | not started; budget reservation is wired but never run with a priced capability | G3, Phase 10 | A provider |
| Speech recognition, forced alignment, timing corpus (B-7) | blocked on an owner decision | Phase 6 gate (timing corpus), R-16.2, R-C.10 | Authorise a local ASR model download (size/licence to approve) or supply a provider credential |
| Narration / TTS / voice cloning (B-8) | blocked on an owner decision | Phase 8 gate (voice), R-17.x | A provider credential or an approved local model, plus the consent/verification flow the chosen provider requires |
| Natural-language Director, Prompt-to-Draft and other language-model features (B-9) | blocked on an owner decision | Phase 11 gate (Director), R-23.x | A language-model provider credential and spending limit. External agents can already drive the editor through MCP |
| No pull request | deferred by owner | — | Branch organisation later |

## Dependency-aware task list (next first)

Status words used here: **blocked** (cannot be implemented or verified without something external), **implemented, not runtime-qualified**, **verified on the current profile** (this CPU-only container), **verified on the target profile** (nothing yet: no target machine exists).

Unblocked (no decision needed), roughly by value:
1. Editor: J/K/L, source viewer, workspaces, marquee selection (Phase 3 carry-over; markers and multi-select are done).
2. Speed ramps, reverse, pitch-preserving stretch; volume curves and drawing automation on the clip (Phases 7–8 carry-over; constant speed, freeze frame and linear volume keys are done).
4. Scheduled backups and retention (a tested manual backup and an optional storage ceiling exist).
5. Per-format caption style and text; more caption styles, fonts and effects toward the catalog targets (Canvas2D-feasible ones only).
6. Approvals list UI; activity log dialog; dialogs and transient states in the accessibility audit; MCP resource change notifications.
7. Analysis in the job queue for long media; downbeat detection; fit-music-to-duration.
8. Per-grant request limits and export quotas (a global opt-in limit exists); `Secure` cookie flag and deployment notes for TLS.
9. Commit cost grows with project size (≈2.2 ms per 100 clips): incremental validation/diff if large projects matter.

Blocked on an owner decision or resource (see docs/BLOCKERS.md):
- B-1 GPU reference machine → GPU compositor, shader effect families, performance targets, GPU qualification of any model workflow.
- B-4 model downloads/quality review → every model-based analysis (reframe, tracking, segmentation, depth) and generative workflow.
- B-7 speech recognition → automatic transcripts, alignment, timing corpus, filler detection.
- B-8 voice provider/model → narration, TTS, cloning, dubbing.
- B-9 language model → built-in Director, Prompt-to-Draft, Long-to-Shorts.
- Paid providers → Phase 10; the budget path must be exercised end to end with the first one.
- Other browsers, real camera/phone footage, real speech and music, a screen reader: not available in this environment.

## Next executable action
```bash
pnpm install && pnpm build && pnpm test
```
Expect 282 tests. Then the proofs, each of which must print its full check count (a shorter count means it stopped early):
`pnpm proof` 54 · `pnpm proof:phase3` 27 · `pnpm proof:phase4` 19 · `pnpm proof:phase5` 33 · `pnpm proof:phase6` 35 · `pnpm proof:phase7` 31 · `pnpm proof:phase8` 20 · `pnpm proof:phase9` 12 · `pnpm proof:phase11` 12 · `pnpm proof:phase12` 13 · `pnpm proof:browser-export` 23 · `pnpm proof:editor-interactions` 15 · `pnpm proof:owner-ui` 7 · `pnpm proof:speed` 16 · `pnpm soak` 7 · `pnpm audit:a11y` (no findings) · `pnpm conformance:parity`.
To use the editor: `pnpm start` and open the "Editor (owner)" link it prints.
Then take item 1 of the unblocked list (start in `apps/web/src/editor/commands.ts` and `packages/core/src/ops.ts`), or resolve a blocker.

## Agent / model summary

| Checkpoint | Role | Work | Requested | Resolved | Harness-reported usage |
|---|---|---|---|---|---|
| 1 | Lead | Phase 0, G0 first slice, integration | session `claude-opus-5-5` | `claude-fable-5-2` (session-reported) | — |
| 1 | Worker | REQUIREMENTS.md | `sonnet` | not observable | 144,776 tok · 148 s |
| 1 | Worker | licences + tech radar | `haiku` | not observable | 102,039 tok · 74 s |
| 2 | Lead | entity versions, rebase, undo, attachment, stale-result, image assets, integration and review | as above | as above | — |
| 2 | `pf-implementer` | licence notices plugin + check | definition: `sonnet` | not observable | 26,190 tok · 54 s |
| 2 | `pf-implementer` | OpenAPI generation + drift test | definition: `sonnet` | not observable | 37,410 tok · 70 s |
| 2 | `pf-implementer` | convergence test | definition: `sonnet` | not observable | 80,056 tok · 296 s |

| 3 | Lead | media staging, model store, BiRefNet trial, integration | as above | as above | — |
| 3 | `pf-implementer` | ingest derivatives + tests | `sonnet` | not observable | 54,498 tok · 139 s |
| 3 | `pf-implementer` | REQUIREMENTS/CAPABILITIES sync (to checkpoint 2) | `sonnet` | not observable | 52,705 tok · 46 s |
| 3 | `pf-scout` | audit of evidence citations | `haiku` | not observable | 23,751 tok · 24 s |
| 4 | Lead | conform route, range/proxy media, streamed audio + sync measurement, keyframes, editor store/commands, presence, integration, all proofs | as above | as above | — |
| 4 | `pf-implementer` ×6 | seek conformance (61,746 tok · 704 s); filmstrips/waveforms (48,146 · 109 s); OpenAPI sync (36,716 · 33 s); command palette (46,357 · 92 s); drag + canvas handles (53,525 · 121 s); status-doc sync (79,350 · 113 s) | `sonnet` | not observable | as listed |
| 5 | Lead | export options/manifest/cancel/retry, full-quality preview, governance (grants, pause, proposals, approvals, budget), integration, proofs | as above | as above | — |
| 5 | `pf-implementer` ×3 | parity suite (90,457 + 99,731 tok on resume); browser export route (168,016 tok · 510 s); OpenAPI update | `sonnet` | not observable | as listed |
| 6 | Lead | transcript/caption model, ops, evaluation, bidi caption layout, REST/MCP, proof | as above | as above | — |
| 12 | Lead | variant model/projection, cover fit, variant export + batch, preflight, proof | as above | as above | — |
| 12 | `pf-implementer` | format switcher, safe-area overlay, Deliver tab (77,607 tok · 115 s) | `sonnet` | not observable | as listed |
| 9 | Lead | analysis model, beat tracker, scene detection, routes, corpus proof | as above | as above | — |
| 9 | `pf-implementer` | analysis panel, timeline markers, beat snapping (56,386 tok · 88 s) | `sonnet` | not observable | as listed |
| 8 | Lead | audio plan, streaming mixer, loudness, ducking, SFX, self-test page, proof | as above | as above | — |
| 8 | `pf-implementer` | Sound tab + meter (55,487 tok · 98 s) | `sonnet` | not observable | as listed |
| 7 | Lead | effect/blend/mask/transition registry, ops, evaluator, compositor, proof | as above | as above | — |
| 7 | `pf-implementer` ×2 | Inspector tabs (20,231 tok · 35 s); look panel + Lab page (73,450 tok · 140 s) | `sonnet` | not observable | as listed |
| 6 | `pf-implementer` ×3 | subtitle codec (45,369 tok · 158 s); transcript/caption editor UI (60,659 tok · 92 s); silence + animation UI (46,726 tok · 62 s) | `sonnet` | not observable | as listed |

The `pf-implementer` definition was exercised on three real tasks: each stayed inside its file scope and reported defects instead of patching shared code
(it found the undo-body 500 and the raw-JSON idempotency comparison; both fixed by the lead). `pf-scout` was exercised once, read-only, and found two citation mismatches (fixed).
No cost figures are available. No paid call or GPU wake-up has been made. One model download was made under the owner's explicit grant: 444,473,596 bytes.
