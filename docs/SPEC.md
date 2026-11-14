# PULSEFRAME Studio Unified Mega Prompt

**Version:** 3.0  
**Prepared:** 14 November 2026  
**Purpose:** a complete product and engineering brief for an AI-assisted coding team.  
**Working brand:** PULSEFRAME Studio; keep branding configurable in one package.  
**Scope:** the feasible union of the original PULSEFRAME brief, the attached AGENT-NATIVE AI VIDEO STUDIO specification, and the attached PULSE STUDIO brief.

This document is self-contained. Do not require the three source prompts during implementation. The requirements below supersede conflicting implementation suggestions in those sources. Source coverage and research references appear in the appendices.

## 0. Mission and success

Act as an integrated team of principal media engineers, product designers, motion designers, audio engineers, AI engineers, accessibility specialists, and quality engineers.

Build a professional browser-based video studio for YouTube, TikTok, Reels, Shorts, music videos, dance edits, tutorials, podcasts, gaming, sports, products, and narrative content.

Combine precise nonlinear editing; contemporary effects, transitions, typography and sound; music and movement understanding; strong Hebrew authoring; natural-language direction; and complete agent access through REST and MCP.

The same project must be editable manually, through the built-in Director, and through authorized external agents. Users see committed agent changes live and retain control.

Optimize for compelling output, fast creative iteration, precise correction, dependable export, and recoverability. A large catalog complements the editing engine; it does not substitute for one.

Build the complete product through runnable milestones. An early milestone is an executable part of the final system, not a declaration that the remaining scope has disappeared. Every claimed feature must have an actual implementation, export path where relevant, and evidence.

### Outcomes to demonstrate

1. Create a polished vertical edit from uploaded footage, music, text, captions and effects.
2. Edit a long YouTube video with dialogue, B-roll, chapters, graphics and clean audio.
3. Create dance/velocity edits, lyric videos, photo montages, reactions, gaming and sports highlights.
4. Extract coherent shorts from a longer source with precise source references.
5. Produce linked landscape, portrait, square and 4:5 versions with local layout overrides.
6. Create an editable first draft from a brief using permitted uploaded, stock or generated media.
7. Complete editing workflows from an external MCP client while the browser remains synchronized.
8. Export without a paid AI account; optional AI providers enhance an already functional editor.

## 1. Working method and project memory

Inspect the repository and environment before changing them. Respect existing user instructions and unrelated work. Do not replace existing AGENTS.md or CLAUDE.md blindly.

Read the current official documentation before adopting a dependency, SDK method, model endpoint or provider feature. Pin tested versions. Treat model IDs in source prompts as candidates, not proof of current access.

Create and maintain:

| File | Purpose |
|---|---|
| docs/SPEC.md | This specification and explicitly accepted amendments |
| docs/PROGRESS.md | Completed gates, current work, next executable steps |
| docs/REQUIREMENTS.md | Requirement IDs, phase, dependency, UI, op/job/tool, export path and evidence |
| docs/CAPABILITIES.md | Implemented, tested, setup-required, experimental and unavailable capabilities by execution profile |
| docs/TECH_RADAR.md | Dependency versions, official references, licenses, checks and live-test status |
| docs/BLOCKERS.md | Reproducible blocker, impact and proposed alternatives |
| docs/adr/ | Concise architecture decisions and their tradeoffs |
| docs/BENCHMARKS.md | Exact machines, fixtures, methods and measurements |
| docs/INTEGRATIONS.md | Provider/account prerequisites and tested contracts |
| THIRD_PARTY_LICENSES.md | Code, fonts, models, media, notices and redistribution details |
| AGENTS.md / CLAUDE.md | Tool-appropriate conventions and pointers, merged with existing instructions |

At session start read the relevant memory files. At session end record actual progress and the next runnable task. Do not mark untested integrations complete.

Keep a buildable main branch. Use vertical slices: schema/operation -> engine -> UI -> REST/MCP -> tests -> documentation. App security and data ownership begin in the foundation.

Use parallel agents for independent packages, catalogs and evaluation tasks when available; assign one owner to shared schema and operation contracts.

Use the Studio's own MCP interface to construct fixtures and demo projects from early phases. Improve the tools when an otherwise straightforward editing task is awkward through them.

Inspect the real UI and rendered frames. Use screenshots, contact sheets and exported preview clips for visual QA. Fix unreadable type, poor spacing, banding, aliasing and weak defaults.

A missing provider is an accurate setup state, not a simulated success. Hide unreleased controls or identify them in the capability/settings surface; never present fake working buttons.

Routine reversible implementation decisions do not require repeated permission. Record decisions and continue. If a requirement cannot be achieved within the verified environment, document the evidence, a feasible alternative and the actual difference in behavior. Preserve the intended outcome where possible.

Critical gates block dependent releases; independent work may continue around documented external blockers.

## 2. Product workspaces and design

Use one document model with workspace presets:

- Quick: guided editing, recipes, transcript editing and essential controls.
- Pro: full timeline, source viewer, precise inspector, audio and color.
- Motion: curves, masks, tracking, typography and signal bindings.
- Specialized panel arrangements: Captions, Color, Sound and Deliver.

Changing workspace never flattens or discards edits.

Create an original vector logo, wordmark and design tokens in packages/brand. Keep the public name configurable; use stable internal IDs.

Default visual direction: graphite/deep neutral surfaces, excellent typography, a consistent icon system, restrained cyan/mint/violet accents, purposeful motion and selective glass. Offer a more expressive Cyber theme using the same tokens. Preserve contrast and media readability.

Use a coherent spacing/type/radius/elevation system. Respect reduced UI motion. Avoid mandatory decoration or animation during precision work.

### Main layout

- Header: brand, project menu/title, save state, workspace, linked format, undo/redo, collaborators/agents, Pause Agent, versions/proposals, API/MCP, Export and configured publishing.
- Center preview: zoom/pan, guides, safe areas, source/output comparison, A/B, snapshots, multiselect, eight resize handles, rotation, anchor, crop, masks and direct text editing.
- Direct layout manipulation: draggable split-screen dividers, PiP positioning, crop focus and alignment/distribution; provide equivalent numeric/keyboard controls.
- Transport: exact timecode, start/end, frame steps, play/pause, J/K/L shuttle, loop selection/sequence, speed, duration, dimensions, FPS, meters and preview quality.
- Library at inline-start and inspector at inline-end, so these naturally reverse between Hebrew and English.
- Library: Media, Text, Captions, Narration, Sound, Effects, Transitions, Elements, Templates, AI and Brand. Open only the relevant drawer.
- Bottom: resizable multitrack timeline, optional minimap, keyframe lanes, beat/scene markers and synchronized transcript/storyboard.
- Director, activity feed and background-jobs tray are available without covering the working canvas.

Support saved panel arrangements, adjustable density, tooltips, keyboard discovery and a bilingual command palette generated from registries.

The clip inspector provides Center, Fit, Fill, Blur-fill, Flip H/V, numeric Scale/X/Y/Rotation/Opacity, per-edge crop and rounded-corner controls. Project backgrounds support solid color, gradient and editable blur-fill layouts. Text includes an uppercase toggle where appropriate to the script.

Provide real empty/loading/offline/error/conflict/missing-media states. First run offers a clearly labeled playable demo and short tour, separate from the user's projects.

Desktop is the full authoring experience. Define a usable tablet layout and a mobile surface for capture, upload, review and selected edits; do not promise the entire desktop workflow on a tiny viewport.

## 3. Hebrew, typography direction and accessibility

Default to Hebrew with a persistent עברית / EN toggle.

Mirror interface chrome and prose. Keep timeline time progression, waveforms, timecodes and numeric editing LTR. Do not reverse an entire interface mechanically where numeric conventions require otherwise.

Use correct bidirectional isolation, Unicode shaping, grapheme segmentation and line breaking. Support mixed Hebrew/Latin, numbers, punctuation, emoji and niqqud.

Translate every user-facing string and use locale-aware plurals. Prefer natural Israeli editing terminology. The core glossary appears later.

Target WCAG 2.2 AA for the editor interface. Provide visible focus, meaningful names, sufficient contrast, keyboard alternatives, screen-reader announcements and reduced UI motion.

If the timeline is rendered on canvas, mirror its meaningful structure in an accessible DOM outline. Do not require an enormous hidden element per video frame.

Preserve shortcuts with Hebrew keyboard layouts. Disable editing shortcuts while typing.

Required shortcuts include Space, J/K/L, S split, Delete, I/O, brackets for ranges, arrows for frame steps, Shift+arrows for larger steps, Home/End, undo/redo, copy/cut/paste, duplicate, markers, snapping, grouping, paste attributes, zoom/fit, export and command palette. Make them remappable.

Caption readability and strong-flash intensity are creative controls. Provide conservative defaults and reduced-flashing alternatives without silently altering an explicitly selected export.

## 4. Architecture and deployment profiles

Use a modular TypeScript core and maintain explicit interfaces between editing, media, rendering, storage, providers and UI.

Suggested repository:

    apps/web
    apps/server
    apps/renderer
    packages/core
    packages/time
    packages/engine
    packages/audio
    packages/media
    packages/catalog
    packages/ai
    packages/providers
    packages/agent
    packages/ui
    packages/brand
    packages/i18n
    packages/fixtures
    packages/evals
    services/ai-pack

Recommended candidates, subject to current verification:

| Responsibility | Candidate approach |
|---|---|
| UI | React, TypeScript, Vite, accessible headless primitives |
| Schemas | Zod or equivalent, generating types and API schemas |
| Media I/O | WebCodecs with Mediabunny or a justified maintained alternative |
| Graphics | WebGPU/WGSL preferred; tested WebGL2 subset or cached/remote preview |
| Text | Shared shaping/layout using HarfBuzz-compatible tooling, bidi and grapheme handling |
| Vector animation | A maintained Lottie/dotLottie renderer with deterministic frame sampling |
| Audio | Shared DSP contract/modules in TS/WASM, AudioWorklet playback and offline host |
| Browser ML | ONNX Runtime Web, Transformers.js and MediaPipe where the selected model/runtime works |
| API | Node LTS with Fastify, Hono or equivalent |
| Persistence | Transactional database, append-only edit log and snapshots |
| Durable jobs | Queue/outbox with crash recovery; Redis/BullMQ or a justified alternative |
| Media workers | Native FFmpeg/ffprobe and controlled compositor workers |
| Optional analysis | Python services with explicitly versioned model/asset contracts |
| Testing | Vitest, property tests, Playwright, media fixtures and agent evaluations |

Choose and document one primary deployment profile before implementing multiple storage backends:

- Lightweight local: single-user local service, transactional SQLite, local files and durable local jobs.
- Hosted/team: authenticated service, PostgreSQL, object storage and durable distributed workers.
- Optional GPU analysis/render worker and an explicitly tested software-renderer profile.

Keep storage adapters and project archives portable. Do not build two unrelated editing engines or maintain two authorities for the same project.

A local UI may have no visible login step, but its backend still binds safely, validates origins and protects API/MCP access. No-login is not permission for unauthenticated remote writes.

Cloud deployment must provide real long-running workers or connect to an external worker service. A function-only host cannot be assumed to execute arbitrary FFmpeg/GPU jobs.

## 5. Canonical project and exact time

Use one versioned, JSON-serializable ProjectDocument with tested migrations, stable IDs and media references. Binary assets remain outside it.

Represent sequences, tracks, clips, linked groups, compounds, source assets, proxy mappings, text, captions, effects, transitions, masks, analysis references, markers, beat maps, motion bindings, grades, audio buses, brand tokens, layouts, variants and provenance.

Keep transient selection/playhead/presence and personal panel arrangements out of creative edit history. Expose separate agent session controls.

Distinguish:

- Immutable original asset identity and source presentation timestamps.
- Source in/out, clip-local time and sequence placement.
- Source-to-sequence time maps, including ramps, freeze and reverse.
- Nested sequence time and linked output variants.
- Processing artifacts and their input/model/effect versions.

Use rational times and rates, or exact frame/sample indices with explicit timebases. Integer microseconds alone are not exact for every frame or audio-sample boundary.

For example, at 60 fps a frame lasts 1/60 second; at 48 kHz an audio sample lasts 1/48000 second. Convert to API microseconds only at the boundary using documented absolute-time rounding. Do not repeatedly add rounded frame durations.

Use JSON-safe exact representations; encode large integers as decimal strings if needed. Store frame rates such as 30000/1001 as rationals, not rounded 29.97.

Support 24/25/30/50/60 and fractional broadcast rates where supported. Specify frame/timecode mapping and optional drop-frame display separately from actual frame timing.

Define half-open intervals, frame snapping, VFR selection rules, audio sample boundaries, source handles and time-remapping interpolation.

Normalized positions help resolution scaling. Aspect-ratio changes additionally require responsive constraints, anchors, text reflow, subject cropping and per-variant overrides.

Validate references, durations, source bounds, nesting cycles, sorted keys, compatible assets, track locks, audio links and overlap rules. Define overlap policies by track/type: intentional audio overlaps and transition regions must remain valid.

## 6. Operations, transactions and concurrency

Every persistent edit passes through a named registered operation. UI, REST, MCP, recipes and the Director call the same command/application layer.

Define each operation with:

- Stable name, schema version, typed inputs/outputs and descriptions.
- Preconditions, authorization, entity dependencies and affected IDs.
- Pure creative-state transition where appropriate.
- Undo/compensation semantics and activity label.
- Deterministic randomness/IDs where required.
- Idempotency and atomic transaction support.

Keep queries, transient session commands and external jobs distinct from pure document mutation. Completing a job attaches results using normal operations.

Example transaction:

    {
      "requestId": "unique-request",
      "expectedRevision": 42,
      "idempotencyKey": "unique-edit-key",
      "label": "Tighten selected dialogue",
      "ops": [
        {
          "op": "cut_range",
          "args": {
            "sequenceId": "seq_main",
            "start": {"value": "744000", "timescale": 60000},
            "end": {"value": "906000", "timescale": 60000},
            "trackIds": ["trk_video", "trk_audio", "trk_captions"],
            "ripple": true
          }
        }
      ]
    }

Derive actor identity from authentication. Return the committed revision, affected IDs, summary, warnings and typed actionable errors. Do not trust client ownership fields.

Provide dry-run validation and dependency-aware diffs. Commit batches all-or-nothing; a drag gesture creates one meaningful undo step.

Persist the op log and materialized project consistently. Use a transactional outbox or equivalent recoverable mechanism for queue dispatch and revision publication.

Serialize authoritative commits per project. Optimistic clients reconcile with committed revisions. Stale operations need semantic preconditions/entity versions; syntactic validation alone is not safe rebasing.

Use inverse patches as an implementation aid, not as a blanket guarantee of correct collaborative undo. Undo appends a compensating transaction and preserves unrelated later edits. Refuse unsafe compensation with a clear conflict or offer a restored branch.

Compare creative state, not revision counters/audit records, when testing undo restoration.

Do not let a separate CRDT write creative state around the op engine. Define any CRDT boundary explicitly.

## 7. Local media, offline work and ingestion

Allow supported local files to be previewed/edited before uploading finishes. Read from a File or permitted file handle while staging media as needed; do not block on a full copy to OPFS.

Use OPFS where supported for media/caches and IndexedDB for metadata and queued draft operations. Probe quotas/persistence, expose storage use, allow cache deletion, and provide recovery/relinking. Browser storage is not an unconditional backup.

Display per-asset states such as local-ready, processing, upload-pending, uploading, synced and missing. Remote agents/render jobs can use only media available to their execution location.

During disconnection preserve a clearly marked local draft with a base revision and queued operations. On reconnect reconcile against server changes; offer conflict resolution or a branch when intent cannot be preserved. Local drafts must not silently overwrite server history.

### Ingestion routes

- File picker, drag/drop, folders where supported and clipboard where permitted.
- Secure direct-media URL import.
- Phone Drop: QR opens a minimal project-scoped upload page using an expiring, revocable, upload-only token with quotas. It does not grant read/edit access to the project.
- Recorder: camera, screen and microphone as separately controllable linked assets, countdown, voiceover and teleprompter.
- Optional stock connectors with verified APIs, account access and recorded licenses.
- Generated/processed assets from provider jobs.

Recorder capabilities, system audio and simultaneous devices must match actual browser/OS permissions. Do not fabricate cursor-event tracks from a screen recording without an explicit capture source.

Preserve immutable originals and stream content hashes. Detect real containers/codecs, duration, source PTS, rotation, color transfer, aspect ratio and channel layout.

Create thumbnails, multiresolution waveform peaks and proxies progressively. Unsupported codecs require a supported conform/transcode route; immediate editing is conditional on available decoding.

Store exact mappings between original, proxy and conform assets. Apply rotation/HDR interpretation without destructively rewriting original files.

Support resumable uploads, checksums, deduplication, bins, tags, favorites, usage counts, missing-media recovery and replace/relink.

Cache transcripts, VAD, beats, loudness, scenes, pose, tracks, mattes, depth and embeddings by content, source ranges, parameters and implementation/model version. Reuse analysis instead of repeatedly paying for it.

## 8. Shared render graph and visual contract

Build a pure timeline evaluator producing a RenderGraph at an exact time.

Resolve source frames, text/vector frames, transforms, keyframes, easing, modulators, effects, masks, blends, transitions, adjustment layers and nested compositions in a documented order.

The same evaluation and supported compositor implementation must serve preview, full-quality stills, thumbnails, agent frames and export.

A shared renderer reduces divergence; it does not make a lossy encoded MP4 mathematically identical to a canvas. Require matching composition/timing/text/effect semantics and measured pixel/perceptual tolerances.

### Renderer requirements

- WebGPU preferred when required adapter features/limits are available.
- Tested WebGL2 fallback subset, cached previews or remote rendered ranges where necessary.
- Capability probes for GPU, pixel formats, codecs, worker canvas, memory and capture paths.
- Pooled render targets, bounded queues/caches, prompt frame disposal and device-loss recovery.
- Documented premultiplied-alpha and color-space conventions.
- Use linear-light/high-precision intermediates where appropriate and supported; keep memory/bandwidth budgets explicit.
- Deterministic seeded noise. Temporal effects sample explicit neighboring source/timeline times with bounded windows.
- A random seek must evaluate the same temporal effect as sequential playback under the same render profile.
- Transform motion blur uses controllable subframe sampling/shutter parameters. It does not automatically provide optical-flow blur for arbitrary scene motion.
- Preview may reduce resolution or use disclosed draft approximations/cached heavy effects. Provide full-quality paused preview. Never silently alter final export semantics.
- Decode from proper keyframes, honor presentation order/B-frames and VFR, and support reverse via bounded GOP/range caching.

Start with SDR Rec.709 output, explicit transfer/range metadata and a documented HDR-to-SDR tone map. Test phone HLG/PQ footage. Faithful HDR output requires a separate validated end-to-end profile.

### Effect contract

Every effect declares ID/version, parameter schema, defaults/ranges, animatability, capabilities, preview/export implementations, temporal dependencies, color/alpha rules, resource budget, fallback, cache key and fixtures.

An unsupported final effect must be baked through a supported worker, deliberately replaced with user acceptance, or reported as a render blocker.

Do not assume an arbitrary shader maps to an FFmpeg filter. Native FFmpeg filters may optimize a verified subset.

## 9. Export backends and execution ownership

Export an immutable revision plus a complete asset/font/effect manifest. Editing may continue without changing the job.

Provide browser, server and auto routing:

- Browser: shared compositor, supported WebCodecs encoders and maintained muxer; stream output to OPFS or a permitted file stream with backpressure.
- Server: same evaluated composition in a pinned controlled renderer; native FFmpeg may encode/mux and render verified audio/filter paths.
- Auto: choose from capabilities, asset locality, output size, user preference and durability. Unattended agent jobs normally use a durable worker.
- Browser execution requires an explicit tab lease/heartbeat and a job ownership policy. A closed tab cannot secretly continue computing. Resume supported checkpoints or restart from the immutable snapshot without duplicating final outputs.

Baseline MP4 H.264 + AAC must work in the documented supported deployment profile. Do not guarantee H.264 High, AAC, hardware encoding or 4K60 on every browser/machine.

Use native encoder fallback when licensed/configured appropriately. Do not make ffmpeg.wasm the required large-project export engine.

GPU-less export is a separate tested software-renderer profile, not an assumption. Pin its runtime, isolate trusted render code, probe software adapter support and measure capabilities. Do not copy unsafe/no-sandbox examples into public browser instructions.

At startup or diagnostics, render a known pattern and verify capture/readback. If a fast canvas capture path fails, use a verified texture-readback path or another supported backend. Do not prescribe permanent platform flags from memory.

Raw video and audio must use properly specified separate streams/files and timestamped muxing; do not mix arbitrary RGBA/audio bytes into one undifferentiated FFmpeg stdin stream.

Offer full/range export, batch variants, clean/captioned masters, audio-only, PNG/JPEG/WebP stills, supported animated GIF/WebP, subtitle sidecars and a portable project archive.

Preserve native styling in the project; SRT/VTT sidecars do not carry the whole motion-design system.

Provide quality/bitrate, resolution, FPS, codec/container, audio settings, estimated size, measured progress/stages, cancellation/retry and playback validation. Clearly label estimates.

## 10. Audio engine and editing

Use a shared audio-render contract and reusable vetted DSP modules. A shared TS/WASM core can run in AudioWorklet playback and an offline host; do not require reimplementing proven compressors, stretch algorithms or metering from scratch.

Audio graph: clip source/time map -> clip effects/gain/pan/fades -> track bus -> master processing/metering.

Playback follows the audio clock. Provide a monotonic fallback without an audio device. Define resampling, block boundaries, effect state, latency compensation, preroll and seek behavior.

Provide gain automation, pan, stereo width, mute/solo, buses, EQ, compression, gate, limiter, de-esser, denoise, reverb, delay, pitch, dialogue enhancement and loudness measurement.

Normalize to a configurable loudness/true-peak target. A preset such as -14 LUFS/-1 dBTP is a user-adjustable starting point, not a universal platform requirement.

Use pitch-preserving stretch where supported and expose its limits. At extreme speeds, define mute, pitch-shift or stretch policy rather than claiming transparent quality.

Support J/L edits as audio/video boundary offsets. Short audio fades/crossfades around discontinuities are a separate feature, with handles, transient checks and adjustable duration.

Music tools include beat grid, tap tempo, downbeat correction, half/double time, bar/phrase-aware fit-to-duration, explicit loop/crossfade edits, ducking and optional stem separation.

Ducking can be a live binding or baked editable gain keys; preview/export use the same envelope.

Generate an original procedural SFX pack from deterministic recipes plus licensed samples. Retain recipe/seed/source metadata; procedural synthesis alone is not a universal rights guarantee.

Voice changers include ordinary DSP presets and separately labeled provider speech-to-speech. Add censor bleep/mute as editable timeline operations.

## 11. Timeline and precise editing

Support video, images, text, captions, audio, SFX, vector elements, adjustment tracks and nested sequences.

Include filmstrips, waveforms, labels, source references, speed/effect/proxy/AI badges, fade handles, keyframe lanes, markers and an optional timeline minimap.

Track controls: lock, visibility, mute, solo, rename, height, reorder and grouping. Define parent/child track behavior and avoid silently changing locked tracks.

Editing tools: source in/out, insert/overwrite, drag/drop, snapping, multiselect, marquee, trim, ripple, roll, slip, slide, split, duplicate, replace, delete, ripple-delete, close gaps, copy/paste attributes, groups, links and compounds.

Provide J/L cuts, detach audio, three/four-point-style insertion where useful, freeze/reverse, playback ramps and nested editing.

Transitions require a model of source handles and overlap. When handles are insufficient, offer shorten, adjust edit, deliberate freeze/hold or another transition. Never silently freeze footage.

Support manual/beat/scene/chapter markers and protected ranges. Display locked or excluded track conflicts before ripple operations.

Scale the document beyond an arbitrary small layer count, while enforcing measured practical decode/render/memory limits. “Unlimited layers” is not a performance promise.

Use virtualization/canvas as justified by measurement and retain accessible keyboard navigation.

## 12. Catalog system and visual Lab

Effects, transitions, text presets, caption styles, looks, fonts, SFX, elements, layouts, templates, platform profiles and providers are versioned catalog entries.

Each entry includes:

- Stable ID, Hebrew/English name, category, tags and provenance.
- Parameter schema, defaults, valid ranges, animation and UI hints.
- Implementation/reference, execution class and prerequisites.
- Preview loop/thumbnail and sample composition.
- Export support, tests and license metadata.

Generate default inspectors, library views, search, command palette and API/MCP discovery from registries. Specialized curve/mask/layout editors may have custom interfaces over the same schema.

Implement /lab with real fixtures in 16:9 and 9:16, default and extreme settings, paired preview/export frames, contact sheets and short loops.

Review each catalog entry for visual quality, readable typography, temporal stability, edges, alpha, banding and resource cost. A golden screenshot alone is not sufficient to detect a broken animation.

Hover preview never commits a permanent edit. Support apply, intensity, bypass, before/after, reorder, favorites, recents and reusable user presets.

Appendix A specifies the production catalog targets. Expand in tested batches; do not block the first working export on authoring the entire catalog.

## 13. Effects, masks, keying and transitions

Preserve clean editorial motion alongside energetic social styles.

Implement families covering camera/energy; color/tone; lens/light; blur/motion; time/echo; distortion; digital/glitch; optional retro/film; illustration/stylization; audio-reactive motion; and subject/depth-aware composition.

Include punch zoom, damped seeded trauma shake, whip motion, perspective tilt, fisheye/barrel lens, diffusion, halation, bloom, light streaks/leaks, chromatic split, vignette, grain, directional/zoom blur, temporal echo, freeze cutouts, halftone, toon, thermal, kaleidoscope, glass/liquid-style distortion and shockwaves.

A shader producing block displacement is a datamosh-style look. Genuine codec-based datamoshing is a different offline feature and must be labeled accordingly.

Provide clean masks: rectangle/rounded rectangle, ellipse, polygon/path, text and preset shapes; feather, expansion, invert, keyframes and tracked corrections.

Support alpha/luma track mattes, chroma key with spill suppression/edge cleanup, and a defined blend set: normal, multiply, screen, overlay, soft/hard light, add/subtract, difference/exclusion, darken/lighten, dodge/burn and hue/saturation/color/luminosity where verified.

Subject workflows: cutout, blur/replace/dim background, color isolation, outline, glow, shadow, ghost/clone trail, text behind subject, tracked sticker and manually correctable blur/mosaic mask.

Transitions include dissolves/dips, whip, push/slide, crash/match zoom, spin, elastic motion, luma/shape/ink/brush/paper reveals, light/glitch transitions and controlled 2.5D cube/flip/fold treatments.

Smart transitions include landmark-aligned match cuts, tracked subject wipe and bounded depth push. They retain manual correction and do not promise invisible continuity.

AI Bridge is a separate asynchronous first/last-frame generation capability using a supported provider. Store its result as an editable clip asset with prompt, references and comparison controls.

## 14. Motion, velocity, depth and responsive layouts

Keyframe transform, crop, opacity, masks, color, effects, typography and audio properties.

Provide linear/hold/ease, cubic Bézier and bounded spring curves, motion paths, anchor control, keyframe navigation, graph editor, copy/paste and parent/child transforms.

Time remapping includes constant speed, ramps, reverse, freeze, boomerang, stutter, fit-to-duration and velocity recipes. Validate requested ranges and audio policy. Frame blending differs from optical-flow/generated interpolation.

Typed signal bindings support wiggle/loop, beat pulse, band-energy follower, speech activity, motion energy and landmark position. Controls include gain, threshold, range, smoothing, attack/release, offset and clamp. Bake to keys, bypass and manually override.

Bind bass to zoom, beats to text, speech to PiP emphasis, movement to camera accents, and a wrist/foot track to graphics or trails. Use cached deterministic signals for final export.

Depth features use an evaluated model and temporally stabilized depth assets: photo 2.5D zoom/parallax, depth haze/blur, restrained depth push and dolly-zoom-style treatments.

Monocular depth is approximate; hidden surfaces are unavailable. Limit camera travel, mask unreliable regions, fill through a supported process or show holes. Do not call this unrestricted true 3D reconstruction.

Provide native layouts: side-by-side, top/bottom reaction, three/four-up, grids, picture-in-picture, circle/squircle creator camera, diagonal split, framed and blur-fill. Dividers and crops are directly editable.

Coordinate scaling, anchors, minimum readable text size, reflow and safe-area rules cooperate. Linked variants preserve their deliberate overrides.

## 15. Text, fonts, elements and animation

Implement one shared shaping/layout/rendering contract for browser and export. HarfBuzz-compatible shaping, a maintained bidi implementation and grapheme-aware processing are candidates; pin exact fonts and runtime behavior.

Do not assume browser DOM text, canvas and FFmpeg drawtext wrap or shape identically. A verified FFmpeg/libass path can render Hebrew; the requirement is parity for the supported styles, not banning FFmpeg text universally.

Provide rich spans; font/weight/size; alignment/wrapping; line height/tracking; variable axes where supported; fit-to-box; multiple strokes; long/drop/glow shadows; per-line backgrounds; solid/gradient/image/video fills; and bounded layered extrusion.

Animate by grapheme, word or line with entrance/exit/loop, stagger, tracking, highlight sweeps, reveals, count-up and lyric treatments. Follow logical bidi layout and keep niqqud attached.

At the Motion milestone, support editable text along Bézier paths with offset/alignment controls, grapheme-aware Hebrew shaping, and preview/export fixtures. Text laid along a path is distinct from moving a text object along a motion path.

Support editable names/titles, lower thirds, meme text, quote cards, chat bubbles, location/hashtag chips, end cards and branded CTAs.

Font catalog targets appear in Appendix A. Candidate families include Heebo, Assistant, Alef, Rubik, Noto Hebrew, Secular One, Karantina, Suez One, Fredoka, Amatic SC and Varela Round; Latin display candidates include Anton, Bebas Neue, Montserrat, Syne, Space Grotesk, Press Start 2P and Permanent Marker. Verify each actual file's license, script coverage and visual shaping; do not assume every family supports Hebrew.

Support licensed TTF/OTF/WOFF2 uploads, font asset manifests, script filters and previews using the user's text. Glyph coverage checks do not replace shaping/niqqud QA. Use an explicit emoji rendering strategy for repeatable output.

Create native vectors, arrows, bubbles, badges, frames, counters, countdowns, progress indicators, CTA graphics and audio visualizers.

Support sanitized SVG and supported Lottie/dotLottie, GIF, APNG and animated WebP imports with deterministic sampling. Document unsupported external assets/expressions rather than executing arbitrary animation code.

## 16. Captions, transcript editing and Hebrew speech

Treat recognition, speaker labels, word timing, alignment, translation and visual styling as separate capabilities.

Normalize transcription into stable word IDs, source-audio timestamps, original text, display corrections, language, speaker labels and available confidence/quality flags.

Support browser, local-service and cloud routes only after model/runtime/language validation. ivrit.ai's Hebrew faster-whisper models are strong local candidates to benchmark; model availability is not a guarantee of word-timing accuracy.

Provide:
- Click word to seek; select text to select time.
- Transcript-guided delete/reorder/insert through source-linked edits.
- Editable word/cue boundaries, cue split/merge and timing offsets.
- Spelling dictionary, find/replace counts, proper names and per-speaker corrections.
- Hebrew/English mixed speech, numbers, slang, punctuation and niqqud.
- Speaker colors, emphasis words, phrase-aware line breaks and bilingual tracks.
- Current-word color/box/underline/scale/karaoke-fill modes.
- Entrance/exit/loop, kinetic lyrics and track styles with per-cue overrides.
- Safe regions, overflow/readability guidance and selected-range restyling.
- SRT/VTT import/export, native rich captions and supported ASS export.

Reading speed, maximum lines, characters per line and cue durations are configurable by language and style. A 17-character/second subtitle preset is not a universal rule.

Optional auto-emoji suggests icons for meaningful keywords, with multilingual maps, density/intensity and manual substitution. It never rewrites the spoken meaning.

Provide suggested silence, filler, breath, stutter and retake cleanup with preview, padding, protected ranges and one logical undo group. Distinguish meaningful hesitation or words such as כאילו and נו from expendable filler. Preserve musical pauses and dance timing by default.

Recognition corrections do not automatically change the audio. Deleting transcript content is an explicit source-range edit.

After cuts, ramps, reverse and nesting, remap captions through exact source-to-timeline mappings. Define whether captions are hidden, held or otherwise handled during reversed/frozen speech.

When word timing is unavailable, use a verified language-supported aligner or segment captions/manual timing. If approximate timing is offered for visual drafting, label it and do not use it for automatic precision cuts or claim accurate karaoke.

Substantially rewritten text and translated captions need independent timing review; never map translated words by positional index.

Evaluate Hebrew/mixed-language speech, names, phone audio, music under speech, accents and overlapping speakers. Store evaluation evidence for the chosen defaults.

## 17. Narration, voices and localization

Support configured TTS, voice selection with sample previews, language/accent labels, pronunciation dictionaries and provider-specific delivery controls.

Generate at the playhead, generate a narration sequence, regenerate one sentence and retain alternate takes. Insert outputs as normal audio clips with provenance.

Expose speed, expression, pauses, stability or markup only when the adapter supports them. Provider controls and minimum clone sample lengths are not universal.

Voice cloning uses the provider's real rights/verification workflow. Do not promise instant high-quality cloning from a fixed 10–30-second sample. Keep recorded evidence/attestation where required; an agent cannot fabricate a person's consent or satisfy provider verification on their behalf.

Handle revoke/delete of cloned voices and associated assets according to actual provider capabilities.

Dubbing separates recognition, translation, speaker mapping, synthesis and duration adjustment. Keep originals and alternatives. Lip sync is a separately available model capability with its own approval, quality and cost checks.

Niqqud pronunciation suggestions may be editable/reviewed assistance. Do not insert unreviewed pronunciation changes that alter meaning.

## 18. AI execution tiers and capability registry

Expose three processing locations:

| Tier | Meaning | Required controls |
|---|---|---|
| Browser | Inference on the user's current device | Runtime/VRAM/RAM checks, download size, worker execution, cache/remove |
| Studio service | Processing on the configured local or hosted backend/sidecar | Worker availability, resources, storage and execution location |
| External provider | A separately authorized API | Credentials, data destination, model capability, usage/cost and limits |

Describe local inference accurately: no per-call cloud-provider fee where true, while hardware, memory, electricity, downloads and hosting still have costs.

Local-only mode prevents remote media inference and silent cloud fallback. Model downloads and any metadata/telemetry behavior are separately disclosed/configurable.

Auto routing considers quality, supported languages, word timing, latency, memory, privacy authorization and cost. Do not blindly try a weak local path merely because it is first in a list.

Manage on-device models with pinned versions/checksums, licenses, sizes, download progress, cancellation, cache quotas and removal. Heavy inference runs off the interaction thread, with bounded concurrency and analysis sampling appropriate to motion.

The registry covers planning, ASR/alignment/diarization, translation, TTS/cloning, voice isolation, stems, beats, segmentation/tracking, landmarks, depth, embeddings, image/video generation, first/last-frame bridges, restyling/extension, upscale/interpolation, dubbing/lip sync, music/SFX and C2PA support.

Each adapter records:
- Provider/model/version and official reference.
- Verified input/output schemas and limits.
- Languages and granular capabilities.
- Account/region access and setup prerequisites.
- Code and model-weight licenses.
- Execution/data retention policy.
- Pricing basis, estimate freshness and cancellation semantics.
- Contract-test, live-test and benchmark status.

Candidates include maintained MediaPipe/ONNX/Transformers.js paths; ivrit.ai/faster-whisper; a suitable Hebrew alignment path; suitable matting/depth/tracking models; ElevenLabs; and documented fal, Runway or other direct provider APIs. The Director uses a configurable LLM adapter.

Current names such as Scribe v3, LTX-2.5 and FLUX 3 Max may be candidate entries. Never infer every advertised feature or endpoint from a family name, or hard-code an unverified list from an old prompt.

## 19. Signature creative workflows

Implement the following as reusable compositions of analysis, operations, catalogs and assets. Every result has explicit dependencies and a path to manual correction.

### 19.1 Rhythm Composer

Select clips/music, duration, energy, minimum shot length, phrase/downbeat rules and protected moments. Propose shot placement, cuts, ramps, motion accents and sound.

Separate tempo/onsets from optional kick/snare/drop/section classification. Show confidence and allow tap tempo, half/double time, downbeat offset and manual event markers.

Regenerate only a selected range after beat correction while retaining pinned edits. Do not cut on every beat by default.

### 19.2 Dance and Movement Lab

Use pose/landmark and motion-energy analysis to suggest jumps, turns, movement peaks, freezes, ramps and match-action cuts.

Support body-aware framing with head/hand/foot priorities, wrist/foot trails, neon/scribble outlines, subject echoes and side-by-side take comparison.

Expose confidence, multiple-person identity selection, occlusions and manual correction. Tracking loss must not silently jump to a different person.

For repeated choreography, propose beat/pose alignment and camera switches; retain all source takes. Full multicam also supports waveform/timecode/manual clap synchronization.

### 19.3 Subject Stage

Select a person/object, generate a mask/track, and build text-behind-subject, background treatments, clean outlines, shadows, echoes or tracked regional blur.

Expose feather, expansion, spill/edge cleanup, temporal smoothing and correction points.

Masks isolate existing pixels. Removing a subject and reconstructing its background requires a separate inpainting workflow. Store the processed result non-destructively.

### 19.4 Depth and Photo Motion

Create beat-aware photo dumps and bounded 2.5D montages from estimated depth, with controllable parallax, depth blur/haze and foreground emphasis.

Show approximate depth and disocclusion limits; provide manual masking and conservative motion presets.

### 19.5 Reference-to-Recipe

Analyze a permitted user reference for shot-length distribution, palette, framing, transition categories, motion intensity and typography hierarchy.

Let the user choose which structural traits to borrow. Apply supported traits using their own media and brand. Return editable native layers/curves and report unsupported treatments.

A reference does not grant rights to reuse its media, music, logo or paid assets.

### 19.6 Hook Lab

Create alternate openings from actual source evidence: strongest quote, action first, question, result-first demonstration or rhythmic montage.

Keep candidates as branches/alternate sequences, with controllable duration/tone and protected claims. Compare readability, pacing, shot density and source faithfulness.

Do not fabricate viral/retention probabilities or invent stronger quotations.

### 19.7 Long-to-Shorts Studio

Find coherent excerpts using transcript/topic/sentence boundaries, scene changes and relevant audio/motion evidence.

Expose audience, target length, retained context, excluded topics and manual in/out. Rank with concise editorial reasons and exact source ranges.

Create editable reframing, captions, titles, optional B-roll and batch exports. Preserve access to surrounding context and allow review of complete source statements.

### 19.8 Linked Format Studio

Share the editorial sequence across 16:9, 9:16, 1:1 and 4:5 deliverables.

Use responsive typography, subject crops and versioned platform overlays. Clearly mark linked versus overridden properties.

Master dialogue edits update linked versions; intentional per-format layout changes survive.

### 19.9 Prompt-to-Draft

Turn a brief into an editable script/shot plan, narration, uploaded/approved stock/generated visuals, captions, music and graphics.

The user specifies audience, tone, language, duration, asset sources, factual constraints and budget. Use real assets/results and disclose provenance.

Generate a plan before costly dependent jobs; apply within existing authorized scope. Missing access produces a clear setup/blocker state, not fake narration or stock.

The generated timeline stays editable. Pixels inside a generated video are not automatically an editable scene graph.

### 19.10 Smart B-roll and Semantic Media Room

Index actual transcripts, scenes, visual descriptors/embeddings, OCR where implemented, tags and motion.

Search by sentence, object, scene, speaker or action. Return actual thumbnails, source times and evidence.

Suggest B-roll and zoom punches for specific dialogue ranges, preferring relevant existing assets or explicitly permitted stock/generation.

Coarse multimodal sampling is appropriate for broad retrieval; exact dance events require appropriate frame/pose analysis.

### 19.11 Scene-Synchronized Sound

Place fitting impacts, whooshes, pops, ambience and ducking around cuts, transitions, text entrances and motion events.

Expose energy/density, frequency balance and dialogue protection. Every sound remains a separate editable clip.

### 19.12 Style Composer and reusable macros

Offer configurable recipes such as energetic dance, fast-paced tutorial, cinematic montage and clean talking head.

The recipe chooses relevant steps; it does not always remove silence, add captions or apply every effect. Preserve music rests and complete speech.

Expose operations, parameters, protected regions and per-step toggles. A task has a logical activity/undo group even if several analysis jobs finish at different times.

### 19.13 Metadata and Thumbnail Studio

Draft source-faithful titles, descriptions, tags and chapters. Build thumbnails from an actual frame, editable text, cutout, layout and brand tokens.

Keep suggestions editable and separate metadata generation from publishing. No fabricated quotations, achievements or performance predictions.

### 19.14 Creative Preflight

Detect actual missing assets/fonts, unsupported final effects, unrendered masks, unintended black gaps, caption clipping, safe-area collisions, excessive text density, low-resolution enlargements and audio clipping.

Link each issue to an object/time range and offer a supported fix. Distinguish warnings from genuine render blockers.

## 20. Durable jobs, spending and late results

Use durable jobs for uploads/proxies, analysis, heavy processing, generation, export and publishing.

Record jobId, type, actor, project/input revision, source IDs/hashes/ranges, adapter/model, normalized parameters, dependency IDs, status/stage, provider request ID, reserved/estimated/actual usage, outputs, timestamps, error/retryability and cancellation state.

Use states that distinguish queued, running, awaiting-provider, cancel-requested, canceled, failed, succeeded and submission-unknown where appropriate.

Persist submission intent before dispatch. Use provider idempotency when supported. On ambiguous timeout reconcile with provider status; otherwise expose an unknown result and require a deliberate retry decision. Do not claim exactly-once upstream billing without provider support.

Deduplicate local result attachment and webhook delivery. Verify signed webhooks. Persist remote outputs before temporary links expire.

Reserve budget atomically before concurrent paid jobs, reconcile actual usage and release unused reservations. Unknown charges remain conservatively accounted for until resolved.

Show estimates and stages, not fabricated percentage/ETA or unsupported exact prices. Existing spending grants cover routine in-budget actions; request a new decision only when scope/cost exceeds the grant.

Cancellation has distinct local/provider states and may not refund completed upstream work.

Completing a job must revalidate its intended attachment against relevant entity versions. If clips changed, retain the output as a proposed insertion/asset; do not overwrite or resurrect newer edits.

Undo removes the attached edit or restores a prior take; it does not reverse provider charges or external publication.

## 21. Director, proposals and human control

Provide a Hebrew/English Director that can inspect project state, selection, frames, contact sheets, transcript, analysis and capabilities.

Processing loop:

    intent -> gather source evidence -> identify targets and constraints
    -> plan typed operations/jobs -> validate -> preview or apply
    -> inspect the actual resulting timeline/frames/audio -> report

Support commands such as:
- Create a 25-second dance edit and emphasize the drop while keeping hands visible.
- Tighten the explanation without removing a complete sentence.
- Make three openings without replacing the working sequence.
- Correct Hebrew captions and create linked portrait/landscape versions.
- Freeze at the jump peak, add a subject echo, then resume on a strong beat.
- Turn a brief into a draft using my own clips and no paid generation.

Use a provider-neutral AgentRuntime. A supported agent SDK is an adapter option, not a requirement that locks the product to one vendor.

The product agent receives only approved Studio tools and scoped connectors. It does not inherit the developer's shell, filesystem or unrestricted network access.

### Permission modes

| Mode | Authority |
|---|---|
| Observe | Inspect permitted project state and previews |
| Propose | Observe plus edits to proposal branches |
| Edit | Authorized direct edits, local processing and exports |
| Autopilot | Edit plus authorized paid workflows within defined budgets |

Scopes are enforced server-side and can include project, track, range, job type, connector and budget. Advertising a smaller toolset is not authorization.

Show proposed/committed changes, rationale, changed clips, before/after previews and task history. Accept a proposal fully or by independent transaction; revalidate dependencies before merge.

Pause Agent/Take Over revokes or suspends the execution grant server-side. New mutations return a typed paused error. Expose what happens to queued and running jobs. Resuming is deliberate.

Agent selection/playhead appears as a ghost. Follow Agent is optional and never repeatedly steals the human's current view.

For actions needing a fresh decision, use a single approval record bound to the authenticated user, action hash, project revision/preconditions, cost/scope, expiry and single-use state. A stale UI or MCP reply cannot approve a changed action. An agent cannot attest its own voice/identity rights.

Remember earlier valid grants. Do not require a new confirmation for every reversible edit or every already-authorized in-budget job.

Treat transcripts, filenames, imported metadata and external descriptions as untrusted data, not instructions.

Add versioned editing playbooks for hooks, pacing, dance/velocity, captions, Hebrew style, dialogue cleanup, sound, brand and preflight. Expose them as resources/prompts.

## 22. REST, MCP and agent senses

Generate OpenAPI and MCP schemas from the operation/command/catalog definitions.

Expose every persistent editing capability through UI, REST and MCP, plus the queries/session controls needed to inspect and navigate. Preserve useful original tool names through aliases where naming changes.

Offer core, full/discoverable and observe-only toolsets. Avoid a fixed 36/55-tool target; completeness and usable discovery are the acceptance criteria.

Representative endpoints:

    GET  /api/v1/projects
    POST /api/v1/projects
    GET  /api/v1/projects/:id/summary
    GET  /api/v1/projects/:id/timeline
    GET  /api/v1/projects/:id?revision=
    GET  /api/v1/projects/:id/capabilities
    GET  /api/v1/projects/:id/transcript
    GET  /api/v1/projects/:id/frame
    POST /api/v1/projects/:id/operations
    POST /api/v1/projects/:id/operations/validate
    POST /api/v1/projects/:id/transactions
    POST /api/v1/projects/:id/jobs
    GET  /api/v1/jobs/:jobId
    POST /api/v1/jobs/:jobId/cancel
    POST /api/v1/projects/:id/exports
    GET  /api/v1/projects/:id/events
    GET  /api/v1/catalog/:kind
    GET  /api/v1/openapi.json

Convenience caption/export routes dispatch through the same service, not separate mutation logic.

### Agent senses

- get_summary/get_timeline/inspect_selection with bounded ranges and pagination.
- render_frame at an exact time, returning image and revision metadata.
- render_contact_sheet with requested times, labels and output limits.
- render_preview for a short bounded low-resolution range.
- get/search transcript and search actual footage.
- get_audio_analysis: beats, energy, speech, silence and loudness.
- describe_moment: active clips/text/effects/audio/source references at a time.
- list_catalog, get_capabilities and describe_ops.
- get_job, get_progress and inspect result/provenance.

Return compact structured results: revision, changed IDs, summary, warnings and actionable errors. Include exact returned IDs, execution units and time representations.

Queries may provide readable seconds/timecode, but exact editing arguments retain explicit timebases and rounding semantics.

### MCP protocol

Pin the current stable official SDK/protocol and test real clients. The research baseline is the 2026-07-28 stateless revision; implement its actual version/capability rules. Support older client behavior only through deliberate tested compatibility.

Application project state remains persistent even when protocol calls are stateless. Pass explicit project/job/proposal identifiers.

Use the Tasks extension only when the request declares support. Otherwise return an ordinary application jobId with get_job/cancel_job tools. One durable job backs both routes.

Support appropriate resources, prompts and annotations. Annotations guide clients but do not replace authorization.

Keep the Studio revision WebSocket/SSE separate from MCP transport and its protocol-specific streaming/subscription behavior.

Add an optional MCP App with mini-player, timeline strip and proposal review in supporting hosts. Core workflows still work without it, and approval authority remains server-validated.

The API/MCP dialog includes IDs, scopes, sanitized setup examples, token management, capability diagnostics, connection tests and call/activity logs. Verify actual client setup syntax. Prefer OAuth or safe scoped token handling over copying long-lived secrets into shell history.

## 23. History, collaboration and recovery

Use versioned checkpoints, restored branches, alternative sequences and proposal diffs. Keep history readable by actor/task.

Publish committed revision events with actor, transaction, affected IDs and resynchronization information. Recover dropped/duplicate events using revision replay or snapshots.

Hosted collaboration supports roles, presence, timecoded comments, private review links and explicit review status.

Save states distinguish saving, saved, local pending/offline, upload incomplete and conflict. A saved document with unsynced local media must not imply that server export is ready.

Reversible delete preserves source assets until deliberate cleanup. Garbage collection respects references, undo/version retention and running jobs.

Project archives carry schema version, assets, fonts where permitted, effect/plugin requirements, hashes and license manifests. Missing/restricted assets are listed explicitly.

Test restore, import, migrations and relinking instead of treating a ZIP operation as a complete portability solution.

## 24. Recipes, brands and extensions

A recipe is a versioned structural composition with media slots, timing/beat rules, typography roles, layouts, effect dependencies, audio palette, aspect rules and brand tokens.

Templates compile to editable native clips/effects/curves. Generated assets remain ordinary referenced media.

Allow saving a project as a template and a supported operation sequence as a macro. Replacing slots refits the composition without flattening it.

Brand kits include logos, fonts, colors, captions, lower thirds, intros/outros and sound. Expose per-instance overrides.

Ship the recipe families and production counts in Appendix A with real examples and export tests.

Trend packs are curated/versioned or derived from permitted user references. A live trend feed requires an actual supported integration and evidence of freshness.

Extensions declare capabilities, schema versions, resource limits, licenses and upgrade behavior. Start with trusted built-ins; sandbox and permission third-party code before enabling a marketplace.

## 25. Publishing, deliverables and content provenance

Platform profiles are data, not fixed platform assumptions: dimensions, codec choices, safe-area overlays, reading guidance, duration guidance and metadata with checked dates.

Provide download/export independent of social logins.

Optional connectors:
- YouTube: authorized resumable upload, explicit privacy, metadata, thumbnail, captions and supported synthetic-content fields.
- TikTok Upload: approved video.upload scope, user grant and delivery to the user's inbox/draft flow; explain that the user completes posting in TikTok.
- TikTok Direct Post: separately approved scope, current creator/account settings, audit restrictions, quotas and final user authorization.
- Further platforms only after a verified API/account integration.

Draft upload is not a universal bypass of direct-post restrictions. Do not hard-code a historic YouTube private-only rule: recheck the current API and the actual account/app configuration.

Always set intended visibility explicitly. Public publishing, account actions and connector uploads run only within clear user authorization. Provider tokens never appear in project archives.

Store asset provenance: original/derived/generated status, parent assets, model/provider/version, prompt/reference inputs, parameters/seed where returned, processing timestamp and usage.

Offer C2PA/Content Credentials signing where supported by the actual formats/SDK and an authentic signer. Label unsigned output accurately. Provenance records do not prove the depicted event is true and may not survive every platform transformation.

Map supported platform AI-disclosure fields to the actual content transformation. Avoid making every ordinary color correction equivalent to generative replacement.

## 26. Security, privacy and licensing

Enforce tenant/project/asset authorization on every route, tool, job and signed asset URL. Add input validation, limits, CSRF/origin protection where applicable, rate limiting and audit trails.

Remote MCP uses the current authorization scheme, correct audience validation and scopes. Local connections also require appropriate origin and access protections.

Secrets are entered by their owner and sent securely to the trusted backend; do not claim they never transiently exist in the owner's input browser. Never return saved reusable keys to agents, other users or shared state.

Keep keys in the local service's encrypted store/OS keychain or hosted secret manager. Mask them in settings, avoid browser persistence/logging, support rotation and redact errors. Accurately describe where keys and media reside.

For URL imports block unsafe schemes, private/link-local/metadata networks and redirect bypasses; check size/time/content and resolved destinations. Restrict worker egress.

Isolate FFmpeg, image/font parsing, archives, shaders and renderer jobs. Use argument arrays, restricted protocols, resource quotas and scoped scratch paths. Prevent path traversal, archive bombs and unsafe SVG/animation execution.

Configure CSP and cross-origin isolation when needed for WASM threads; self-host or correctly serve fonts/models/WASM with required headers. Verify OAuth and media import compatibility under that policy.

### License and model policy

Check code, model weights, training/reference assets where relevant, fonts, stock media and outputs separately. “Open weights” is not synonymous with unrestricted commercial use.

Prefer commercially usable dependencies with a documented compliance path. Account explicitly for MPL and LGPL obligations rather than an allowlist that accidentally excludes required FFmpeg builds.

Mediabunny's MPL-covered files may coexist with proprietary application files, subject to applicable source/notice duties. Do not state that MPL imposes no obligations.

Record exact FFmpeg build configuration, libraries and codecs. Enabling components such as libx264 can change the build's license. A subprocess boundary alone is not a blanket compliance determination.

Do not bundle unknown/noncommercial weights into a commercial profile. Use an approved alternative, a compatible license arrangement or disable that capability with a clear status.

Ship notices/manifests and required covered source/build information. Do not use third-party logos, named proprietary LUT files or paid templates merely because a similar look is requested.

## 27. Provider-free core and honest capability states

Core import, timeline, text, keyframes, deterministic effects, audio, caption import/manual editing, save/reload and baseline export work without paid AI credentials.

AI actions distinguish:
- Implemented and live-tested.
- Implemented and contract-tested; credentials required.
- Supported with a local model download/worker.
- Experimental for a documented profile.
- Unavailable in this deployment.

Test mocks are limited to tests. Demo projects are clearly labeled and contain real renderable assets.

An output from a generator is editable in placement, duration, time map, effects, mask and alternatives; its internal visual objects are not necessarily native scene layers.

Show processing location and quality/cost tradeoffs without exposing irrelevant engine internals in ordinary creator flows.

## 28. Delivery, tests and completion

Use Appendix C for validation and performance targets and Appendix D for the 14 build phases. Record what was actually measured.

Deliver:
1. Complete source repository, pinned dependencies and working scripts.
2. Original logo/design system, bilingual UI and real demo projects.
3. Schema migrations, operation registry, OpenAPI and MCP server.
4. Media, renderer, audio, queue and optional model-worker services.
5. Browser/server/software capability profiles and setup diagnostics.
6. Full catalog manifests, editable recipes and visual Lab.
7. Provider adapters with accurate test/access status.
8. Automated fixtures, tests, benchmark reports and known limitations.
9. License/provenance manifests and documented data/backup behavior.
10. Local and hosted deployment instructions, environment examples and containers.
11. A complete source archive when supported.
12. User guidance for Hebrew/English, shortcuts, agents and supported export workflows.

Do not declare the full product complete while production catalog targets or required creative workflows remain unimplemented. Report phase completion precisely.

Start by inspecting the environment, recording architecture decisions and building the smallest proof that supports:
import -> edit -> preview -> export -> external-agent edit -> live UI update.

Then complete the phases while retaining the full requirement map.

## 29. Core Hebrew UI glossary

| English | Hebrew | English | Hebrew |
|---|---|---|---|
| Export | ייצוא | Publish | פרסום |
| Media | מדיה | Text | טקסט |
| Captions | כתוביות | Narration | קריינות |
| Sound | סאונד | Effects | אפקטים |
| Transitions | מעברים | Elements | אלמנטים |
| Templates | תבניות | Transcript | תמליל |
| Director | הבמאי | Activity | פעילות |
| Proposal | הצעה | Approve / Reject | אישור / דחייה |
| Variants | גרסאות | Checkpoint | נקודת שחזור |
| Remove silences | הסרת שתיקות | Remove fillers | הסרת מילות מילוי |
| Range start / end | תחילת טווח / סוף טווח | Cut range | חיתוך טווח |
| Close gaps | סגירת רווחים | Duplicate | שכפול |
| Delete | מחיקה | Split | פיצול |
| Snap | הצמדה | Markers | סמנים |
| Speed | מהירות | Color | צבע |
| Mask | מסכה | Green screen | מסך ירוק |
| Adjustment layer | שכבת התאמה | Beat sync | סנכרון לביט |
| Smart reframe | מסגור חכם | Remove background | הסרת רקע |
| Text behind subject | טקסט מאחורי הדמות | Depth motion | תנועה מבוססת עומק |
| Text-based editing | עריכה לפי טקסט | Make shorts | יצירת סרטונים קצרים |
| Enhance voice | שיפור קול | Auto-duck | הנמכת מוזיקה אוטומטית |
| Footage search | חיפוש בחומרים | Phone Drop | העלאה מהטלפון |
| Record | הקלטה | Safe zones | אזורים בטוחים |
| Preflight | בדיקה לפני ייצוא | Budget | תקציב |
| Pause agent | השהה סוכן | Take over | קח שליטה |
| Command palette | לוח פקודות | Saving / Saved / Offline | שומר / נשמר / לא מקוון |

## 30. Operation and tool coverage checklist

Use typed focused tools plus generic discovery/transaction/job tools. Names below are coverage requirements and may have compatibility aliases.

- Project/history: create/rename/settings, marker CRUD, checkpoint/restore, fork/create linked variant, proposal create/review/merge/reject, undo/redo.
- Tracks: add/remove/reorder/update, lock/visibility/mute/solo, bus routing.
- Clips: import/add/move/trim/slip/slide/split/delete/duplicate/cut/close gaps, source replacement, group/link/detach, compound/unpack, insert/overwrite.
- Time: constant speed, ramp, reverse/freeze, fit-to-duration, velocity preset and source mapping inspection.
- Animation: keyframe CRUD, easing/path, anchor, parent, zoom, binding/modulator CRUD and bake-to-keys.
- Appearance: effects CRUD/order/bypass, adjustment clip, grade/look/LUT, masks/keying, matte/blend, transition CRUD and attributes paste.
- Text/captions: text/rich style/preset/animation, cue CRUD/split/merge/shift, ASR/alignment, corrections, translation, emoji suggestions and caption import/export.
- Audio: gain/pan/fades/buses/effects, ducking, loudness, SFX, recording, narration, clone workflow, voice processing, stems and music fitting.
- Analysis/AI: beats, scenes, pose/track/matte/depth/index, semantic search, cleanup proposals, reframe, B-roll, drafts, shorts, hooks, generation, bridge, extension/restyle/inpaint/upscale/interpolation and dubbing where supported.
- Elements/recipes: vector/sticker/layout, divider/PiP geometry, template/slot, brand tokens, save/run recipe.
- Senses/session: summary/timeline/selection, exact frame/contact sheet/preview, transcript/audio analysis, describe moment, seek/select/follow.
- Jobs/delivery: run/get/cancel/reconcile, preflight, export/archive, metadata/thumbnail, authorized connector upload/publish and provenance inspection.
- Permissions: scoped grants, pause/resume, budget inspection/reservation, human approval retrieval and authorized response.

External tasks must never bypass the same permission, revision, cost and provenance rules used by the UI.

## Appendix A — Production catalog

These are professional-release targets, not first-slice blockers. Ship complete, export-tested entries incrementally. Count distinct primitives, catalog presets, and recipes separately. Renamed duplicates, font weights, color swaps, and speed/direction variants do not independently satisfy a primitive target. Presets need a meaningful creative role. Every entry requires a stable ID, bilingual label, parameter schema, capability class, dependency/provenance record, preview, export path, and visual/audio fixture.

| Catalog | Production target |
|---|---:|
| Distinct effect primitives | At least 30 |
| Effect entries and curated presets | At least 80 |
| Transition entries | At least 45, built on at least 12 distinct core kernels; label generated bridges separately |
| Text presets | 40 |
| Text animations | 30 |
| Caption styles | 20 |
| Velocity presets | 8 |
| Color looks | 40 |
| SFX assets | 80 |
| Font families | 60, including 20 with verified Hebrew coverage |
| Original graphic elements | 120 |
| Layout recipes | 12 |
| Creative templates | At least 24 |
| Platform output profiles | 8 |

### Effect families and compositing

Preserve these families; contemporary defaults should include both restrained editorial treatments and energetic creator styles:

- **Color/tone:** exposure, white balance, contrast, curves, HSL, lift/gamma/gain, LUT intensity, selective color, sharpen.
- **Light/lens:** bloom, halation, diffusion, anamorphic streaks, light leaks, chromatic dispersion, vignette, tilt-shift, bokeh, barrel/fisheye distortion.
- **Blur/motion:** directional, zoom and spin blur; bounded camera shake with edge compensation; echo, long exposure, smear, stepped motion, freeze silhouettes.
- **Film/retro:** controllable grain, gate weave, film burn, Super 8, camcorder/CCD, CRT; keep these optional stylistic categories.
- **Digital/stylized:** RGB split, block displacement, scanline tear, pixel sort, hologram, ASCII, halftone, toon/sketch, neon edges, thermal/night-vision looks, kaleidoscope.
- **Distortion/energy:** wave, ripple, bulge, liquid/refraction, beat pulse, bounce, speed lines, shockwave, controlled flash/invert treatments.
- **Subject/depth:** background blur/replacement/dimming, color pop, sticker stroke, aura/scribble outline, silhouette, clone trail, freeze cutout, text behind subject, approximate 2.5D parallax, depth haze/blur, tracked face/hand/body attachments.
- **Targeted blur:** manually or automatically tracked region with shape, feather, strength and correction keyframes. Keep track-loss warnings visible; automatic tracking is not guaranteed redaction.

Masks include rectangle, rounded rectangle, ellipse, polygon/path, star, heart, text and split masks; feather, expansion, inversion, alpha/luma track mattes, chroma key, spill suppression and edge correction. Support documented normal, multiply, screen, overlay, soft/hard light, add/subtract, difference, exclusion, darken/lighten, dodge/burn and hue/saturation/color/luminosity blends.

### Transition library

Include dissolve/dip; directional whip/push/slide; crash zoom with edge handling; spin/roll; bounce/stretch; linear/clock/iris/blinds wipes; luma-pattern; ink/brush/paper tear/page peel; glitch/displacement; leak/burn/flare/glow; perspective cube/flip/fold/doorway; landmark match cut; subject wipe; depth push; beat-cut recipes; optional generated AI Bridge.

Expose duration, direction, easing, intensity, mask and sound-link controls. A source-handle shortage requires an explicit supported policy, never a silent freeze. Depth effects do not reconstruct unseen geometry; generated bridges retain ordinary asset/provenance controls.

### Typography and captions

Text roles include the original Big Title, Display, Marker, Spectrum, Lower-third Name, Kicker, Subtitle, Button and Pixel, plus editorial headline, creator handle, quote card, meme top/bottom, neon/outline/extruded title, typewriter, handwritten/graffiti treatment, sticker label, shine sweep, chat bubble, countdown, price/location tag, hashtag, CTA, ticker, two-field lower third and end card. Build remaining presets as distinct usable compositions.

Animations cover entrance, exit and loop systems: fade, slide, pop, cascade, typewriter, blur reveal, wave, bounded shake, glitch, mask reveal, tracking changes, highlight sweep and counters, with word/grapheme/line staggering. Media fills, multiple strokes, long shadows and supported variable-font axes remain editable.

Twenty caption styles: classic subtitle, karaoke fill, single-word pop, rolling two-line, box highlight, bounce emphasis, keyword punch, gradient stroke, optional emoji, typewriter, minimal, neon, comic, speaker colors, top placement, cinematic, bilingual, lyric phrase, underline emphasis and reduced-motion emphasis. Use generic descriptive names; readability rules and speaker/emoji choices are editable.

Font candidates include Heebo, Assistant, Alef, Varela Round, Rubik, Secular One, Karantina, Suez One, Fredoka, Amatic SC and Noto Hebrew families; Latin display candidates include Anton, Bebas Neue, Montserrat, Syne, Space Grotesk, Press Start 2P and Permanent Marker. Verify each exact font file, license, script coverage and shaping before inclusion. Provide user-text previews, script filters, on-demand downloads and uploaded fonts; count families, not weights.

### Velocity, looks and audio

The eight named velocity presets are **Montage, Hero, Bullet, Flash In, Flash Out, Jump Cut, Smooth Ramp and Stutter**. Montage Bounce, Bullet-Time Drop and Flash Ramp may be named parameterizations; do not double-count them. “Bullet” describes timing/freezing, not synthesized multi-camera orbit. Preserve editable curves, audio policy, beat anchors and source mapping.

Forty looks span clean studio, warm film, teal/orange, moody, pastel, noir, faded vintage, Y2K, night, golden hour, neon city, high-contrast street and green-tinted editorial styles. Original film-inspired grades must not imply licensed branded LUTs.

SFX families cover whoosh/deep whoosh/swish/sweep, riser/downer/suction/tape stop, impact/boom/sub drop/thud/pulse/glitch, ambience, UI and comedic accents. Include bubble pop, bell/ding, cash-register-style accent, shutter, typing, click, scratch, cheer, error buzz, glass-like shatter and metal impact. Provide original or properly licensed assets, preview, tagging and insertion. Audio processing includes gate, EQ, compression, limiter, de-esser, reverb/delay, pitch/voice presets, stereo width, configurable edit crossfades and censor bleep. A short crossfade is not itself a J/L cut.

### Elements, layouts and formats

Original elements: shapes, arrows, callouts, bubbles, badges, frames, lower-third bases, progress bars, timers, CTAs, animated stickers and bars/wave/radial/particle visualizers. Support validated SVG, Lottie/dotLottie, GIF, animated WebP and APNG with deterministic sampling.

Twelve layouts: floating creator PiP, side-by-side duet, stacked reaction, three-up, four-up grid, hero-plus-two, diagonal split, framed inset, blur-fill, before/after comparison, screen-plus-camera and multi-angle strip. Differentiate their constraints and editorial uses. Allow draggable dividers and direct canvas manipulation. PiP supports rectangle/circle/squircle, corner radius, border/cutout and optional speaker-reactive motion.

Eight editable output profiles: TikTok vertical, Reels vertical, YouTube Shorts vertical, YouTube 1080p landscape, YouTube 4K landscape, square feed, 4:5 portrait feed and vertical Story. Profiles describe format/safe areas; they do not imply eight publishing integrations.

### Required template names

The initial production set includes all 24:

1. Velocity Edit
2. Photo Dump on the Beat
3. 3D-Zoom Montage
4. Dance Echo
5. Before/After
6. Countdown List
7. Split-Screen Reaction
8. Talking-Head Short with Captions
9. Podcast Clip
10. Tutorial with Steps
11. Product Showcase
12. Meme
13. Quote Card
14. Lyric Video
15. Gaming Highlight
16. Travel Montage
17. Recipe Steps
18. POV Hook
19. Text-Behind-Subject Intro
20. Freeze-Frame Intro
21. News-Style Lower Thirds
22. End Screen
23. YouTube Intro
24. Slideshow with Narration

Retain additional sports-highlight, event-recap, comparison and clean branded-announcement recipes from PULSEFRAME. Each template has replaceable media/text slots, timing and beat constraints, brand tokens, aspect-ratio behavior, a working example and an export test.

## Appendix B — Source coverage

Source labels identify documents, not independently verified author attribution:

- **O:** prior PULSEFRAME Studio master prompt.
- **A:** long “AGENT-NATIVE AI VIDEO STUDIO” attachment.
- **B:** shorter “PULSE STUDIO” attachment.

| Area | Coverage and merge decision |
|---|---|
| Ops, shared rendering, REST/MCP, live updates | O/A/B overlap; retain O’s rational timing, conflict handling and tested render contract. |
| Jobs and spending | O/A/B overlap; preserve O’s transactional outbox, uncertain submission handling and late-result protection. |
| Beat, velocity, subject effects, captions | O/A/B overlap; A/B add catalog detail, visual treatments and explicit controls. |
| Motion bindings and dance | O supplies detailed signal/pose workflows; B adds named creator presets and reactive PiP. |
| Linked variants, Hook Lab, Reference-to-Recipe | Preserve O’s distinct workflows and manual override semantics. |
| Long-to-Shorts | O/A overlap; keep source evidence, context, editable candidates and batch delivery. |
| Phone Drop, OPFS, offline queue | A adds concrete ingestion and storage workflows; integrate capability/quota/reconciliation checks. |
| Prompt-to-Draft, B-roll, metadata | A adds explicit creation, asset-sourcing and publishing preparation workflows. |
| Visual Catalog Lab, font coverage | A adds systematic contact-sheet review, extreme-parameter fixtures and coverage checks. |
| Keying, mattes, vectors, depth | A expands these catalogs; B adds targeted tracked blur, fisheye and draggable split/PiP controls. |
| One-action creator polish | B adds a composite workflow; keep named editable transactions and neutral outcomes, without “virality” promises. |
| Agent inspection and control | A expands contact sheets, preview clips, moment descriptions, permission modes, pause/takeover and playbooks. |
| MCP Apps and signed provenance | A adds optional progressive enhancements; implement only supported protocols and validated signing. |
| Capture, browser export, audio DSP | A adds capture self-tests, execution choice and shared audio hosts; capability-gate and benchmark. |
| Publishing | A makes connectors and disclosure concrete; distinguish direct publishing, private restrictions and draft/inbox workflows. |
| Implementation continuity and evidence | A adds persistent project-memory files, procedural fixtures and detailed budgets; O preserves vertical-slice delivery and realistic capability states. |

This appendix supplements the main requirements; it does not replace their security, timing, privacy, authorization, accessibility, export or acceptance contracts.

## Appendix C — Validation and performance

### C1. Evidence and benchmark contract

All numerical values below are engineering targets, not measured achievements or universal hardware guarantees. Record the exact CPU/GPU, RAM, OS, browser and driver versions, encoder configuration, renderer backend, deployment profile, media hashes, fixture revision, warm/cold cache state, and measurement script with every result. A phrase such as “2022 laptop” is insufficient identification.

Maintain separate qualification profiles for hardware-accelerated desktop, supported fallback browsers, GPU-enabled headless workers, and software/headless workers. Publish their supported codec/effect/model subsets. A software renderer must execute verified code paths; lack of a GPU does not magically make every WebGPU kernel, codec, or model available.

Record median, p95, sample count, failure count, and peak memory where applicable. Separate local processing from network/provider latency. Measure performance with tracing overhead disclosed. Never silently lower a target or omit a failing fixture: document the cause, remediate, or revise the supported release envelope with evidence.

### C2. Reference workload targets

Use a selected, documented reference laptop with an integrated GPU and a pinned Chromium version for the primary profile. Additional devices receive their own results.

| Workload | Initial target and measurement boundary |
| --- | --- |
| Preview | A 1080p sequence with three active video layers, two text layers, and three named effects: at least 55 fps at half-resolution preview and 30 fps at full resolution after warm-up. Publish exact effects and media; segmentation/generation is precomputed unless explicitly benchmarked live. |
| Seeking | Cached proxy seek p95 below 120 ms; paused frame-step p95 below 50 ms, measured until the correct frame appears. Measure cold/random seeks separately. |
| Large timeline | A two-hour, 2,000-clip project: smooth 60 Hz pan/zoom on the reference profile and common local operation application plus repaint p95 below 16 ms. Separate persistence acknowledgement from local visual feedback. |
| Agent editing | Local REST/MCP request-to-commit p95 below 100 ms; committed edit visible in the connected editor within 150 ms. Report networked scenarios separately. |
| Startup | Editor shell interactive within three seconds under a recorded connection/cache profile; media and AI models load progressively. |
| Export | Target at least 2× real-time throughput for a specified simple 1080p30 composition with the selected hardware encoder. Benchmark complex, 4K, and software exports independently. |
| Resource stability | After warm-up, no sustained leak during a ten-minute export or a longer editing soak. Target less than 10% retained-memory growth under a repeated workload, with an absolute budget and GPU/CPU allocations measured separately. |

Preview degradation, proxy use, bounded queues, and cache eviction must preserve project correctness. Publish export estimates as estimates. Interactive 4K60, unlimited layers, and universal live inference are not implied by these targets.

### C3. Correctness and failure testing

**Operations and history.** Unit-test time math, source mappings, bounds, transitions, locked tracks, linking, captions, and job-result insertion. Run a smaller deterministic property-test suite on every change and at least 10,000 generated operation sequences nightly. In the single-actor test, undo-all and redo-all compare normalized creative-document projections; exclude intentionally changing revision IDs, logs, timestamps, audit records, and caches. Test rejected operations as well as successful ones. Test concurrent compensating undo separately: unrelated later work must survive, and unresolvable inverses must produce explicit conflicts.

**Concurrency and offline recovery.** Exercise three authorized clients with random interleavings and at least 1,000 seeded nightly schedules. Inject stale revisions, duplicate messages, delayed acknowledgements, reconnects, revoked access, and conflicting offline edits. Verify convergence of committed state, explicit resolution of incompatible edits, no lost accepted changes, and no unauthorized rebasing. Optimistic/pending work must remain distinguishable from server-committed work.

**Media conformance.** Generate fixtures whose frames contain robust index barcodes and independent presentation-timestamp truth. Cover supported H.264, HEVC, VP9 and AV1 configurations, B-frames, relevant GOP structures, CFR/VFR, rotation, fractional rates, and audio sample rates. Execute 1,000 seeded random seeks per qualified fixture. Require exact selected source-frame identity according to the documented PTS/rounding policy. Unsupported combinations must report their actual capability status or follow a verified conform route.

**Synchronization.** Export a ten-minute flash/beep fixture and longer mixed-media fixtures. Measure A/V offset against source truth, including encoder priming, resampling, and pipeline latency. Target no cumulative drift and residual offset within one output frame; publish finer sample-level results where available.

**Render parity.** Separate two tests. First compare raw preview and raw headless output using the same backend, shaders, font assets, color transforms, dimensions, and exact time. An initial tolerance target is channel error at most 2/255 for 99.9% of samples, with alpha and outlier inspection; deterministic CPU paths may permit exact equality. Second compare the reference image with the decoded lossy export using documented high-quality encoder settings: initial targets SSIM at least 0.985 and PSNR at least 36 dB. Lossy compression, subsampling, and backend differences are not proof of identical pixels. Supplement global metrics with text-edge, mask-boundary, color, and temporal checks so small serious defects cannot hide in an average.

**Temporal effects.** Random-seek output must agree with sequential evaluation for seeded shake, trails, motion blur, feedback, and time remapping. Declare warm-up/history windows and cached dependencies. Test state reset, reverse, trims, nested sequences, and cache invalidation.

**Audio DSP.** Share deterministic DSP definitions between realtime and offline hosts. Run unity-gain/null tests on decoded reference PCM, compensate documented latency and encoder padding, then compare aligned samples within implementation-specific tolerances. Test channel mapping, fades, buses, ducking, limiter behavior, speed curves, clipping, and discontinuities. Target loudness within ±0.5 LU of the chosen target on suitable fixtures; report short-programme and dynamics constraints rather than falsifying normalization success.

**Captions and beats.** On a versioned Hebrew/English corpus with independently annotated timings, target median word-boundary error at most 80 ms and p95 at most 200 ms for the chosen default route. Report recognition errors, missing words, overlapping speech, and language subsets separately; do not conceal failures by evaluating only easy recognized words. These are qualification goals until measured. For beat detection, target F1 at least 0.95 within ±70 ms on synthetic click tracks and 0.80 on an annotated licensed-music corpus. Record meter, tempo changes, beat/downbeat definitions, and half/double-tempo ambiguity. Instrument/drop classification requires its own evaluation.

**Durability and money.** Crash between commit, outbox dispatch, queue receipt, and event publication. Verify eventual delivery without duplicate visible results. Inject provider timeout with unknown acceptance, duplicate webhooks, expired result URLs, restart, and cancellation. Unknown submissions must reconcile or remain visibly unresolved; never blindly retry a potentially billable generation. Test budget reservations, concurrent spending limits, authorization expiry, and late results after target deletion.

**Security and accessibility.** Test tenant/asset separation, SSRF and redirect/DNS rebinding defenses, archive traversal, parser limits, webhook authentication, secret redaction, and local-service origin checks. Run automated accessibility checks plus manual keyboard and screen-reader workflows. Test RTL/LTR, mixed scripts, niqqud, emoji, reduced UI motion, focus recovery, and untranslated strings. Validate cross-origin isolation, workers, self-hosted assets, fonts, and model downloads on the actual deployment.

### C4. Repeatable acceptance demonstrations

Each demo needs a script, fixtures, expected project assertions, export checks, and a recorded outcome.

1. **Dance edit:** six phone clips plus music become a 20–30-second portrait sequence. Correct a beat marker, pin cuts, regenerate only a range, add speed ramps and text behind the dancer, repair tracking loss, then verify the exported trail/echo and beat timing.
2. **MCP coediting:** an external agent tightens a Hebrew talking-head recording and creates three shorts. The user pauses the agent, accepts a proposal, undoes one transaction, and continues without losing independent edits.
3. **Long-to-Shorts:** inspect candidate evidence and surrounding context, preserve sentence/topic boundaries, create editable reframing/captions, and batch-export linked variants.
4. **Text and multilingual editing:** correct Hebrew words, remove selected filler candidates, ripple linked media, and create an English caption track with separately reviewed timing. Verify shaping and active-word highlighting.
5. **Prompt-to-Draft:** a Hebrew brief produces a sourced script, approved-budget narration, available/generated visuals, captions, and music as editable layers. Missing assets and unsupported capabilities remain explicit. Exercise an AI Bridge only through a connected, supported model.
6. **Local-only creation:** after required assets/models are installed, complete an explicitly supported workflow with external media egress disabled. Verify editing, the selected local analysis route, save/reopen, and export; expose any unavailable cloud capability accurately.
7. **Offline human plus online agent:** disconnect the editor, queue permitted local edits while the agent continues, reconnect, resolve an intentional conflict, and verify convergence without invisible overwrites.
8. **Headless profile:** export through REST on a documented software worker using its supported effect subset. Compare output against that profile’s reference; also test an unsupported capability rejection.
9. **Failure recovery:** restart workers mid-export, inject provider submission uncertainty, and recover missed outbox notifications without duplicate clips or charges claimed as reversible.
10. **Delivery preflight:** seed missing fonts/media, unsafe caption placement, incomplete masks, and audio clipping. Navigate to each issue, repair, and export an immutable revision while later editing continues.

No demo may publish publicly, message others, or exceed an established spending limit without the relevant authorization. Provider contract tests and simulated uploads must be labelled as such; they are not evidence of a live integration.

## Appendix D — Delivery phases (0–13)

Keep the complete product scope, but make each phase independently inspectable. Each gate records tests, evidence, capabilities, limitations, and a runnable demo in progress documentation. Later catalog floors are production-release targets, not blockers to proving an early engine. Work may proceed in parallel when dependencies and ownership are clear; do not build dependent functionality on an unresolved correctness gate.

| Phase | Scope | Exit gate |
| --- | --- | --- |
| 0 — Readiness and spike | Repository, scripts, original brand/tokens, i18n, architecture decisions, capability probes, fixture generator, licensing inventory, and minimal rendering/export experiment. | Development/test commands run; exact runtime capabilities recorded; a source frame, Hebrew text, and audio produce a playable sample through the proposed path. |
| 1 — Authoritative core | Project schema/migrations, rational time, operations, validation, persistence, auth, history, transactional outbox, basic REST/MCP, and revision events. | Unit/property tests pass; two clients and an MCP client converge; stale edits and unauthorized requests fail predictably; crash/replay preserves commits. |
| 2 — Media and playback | Ingest, probe, proxies, metadata, thumbnails, waveforms, decode scheduling, shared evaluator, compositor, audio clock, bounded storage/cache. | Supported conformance fixtures seek correctly; A/V fixture passes; resource lifetimes and capability fallbacks demonstrated. |
| 3 — Editor interaction | Timeline, canvas handles, source viewer, inspector, shortcuts, command palette, autosave, RTL/EN, presence, loop/minimap, and recovery states. | Keyboard-only import/arrange/trim/split/keyframe workflow; visual baselines; real remote edits visible without stealing user control. |
| 4 — Production export | Immutable snapshots, worker/browser export routes, codec selection, cancellation, retry, audio render, download, and parity suite. | Qualified profiles export verified files; supported software profile works; unsupported effects fail clearly; ongoing edits do not alter a snapshot. |
| 5 — Complete agent surface | Operation/schema discovery, senses, preview frames, task/job interfaces, scoped permissions, proposal diffs, budget controls, and verified client setup. | Ten scripted editing goals pass through MCP/REST; UI parity and authorization boundaries verified; task support reflects actual negotiated capabilities. |
| 6 — Typography and captions | Shared shaping, fonts, rich text, animation, ASR adapters, corrections, SRT/VTT/native captions, transcript edits, silence/filler candidates. | Hebrew/mixed-script golden tests pass; timing corpus results reported; transcript removal and retiming preserve synchronization. |
| 7 — Motion and creative catalog | Effect registry, Lab, masks/keying, transitions, color, blends, ramps, graph editor, motion bindings, layouts, and curated initial packs. | Every shipped entry has working preview/export and reviewed visual fixtures. Expand toward production catalog targets without filling counts with duplicates. |
| 8 — Sound and voice | DSP tools, procedural/licensed SFX, recording, narration, provider-supported cloning, ducking, meters, and loudness. | PCM/DSP and loudness tests pass; sounds are actual assets; voice requirements and consent/verification reflect the selected provider. |
| 9 — Analysis intelligence | Beats, reframe, segmentation, pose/tracking, Dance Lab, depth estimates, scene detection, search, and assisted color. | Per-feature corpus and performance results; confidence/manual correction; local-only demo; analysis persists as source-linked editable data. |
| 10 — Generative integrations | Versioned providers, durable paid jobs, generation, bridge/extension/restyle, supported restoration/interpolation, stems, dubbing/lip sync. | Live smoke tests for configured adapters; disconnected states otherwise; spending, unknown submissions, stale outputs, and cancellation tests pass. |
| 11 — Director and recipes | Natural-language planning, Prompt-to-Draft, Long-to-Shorts, hooks, B-roll, sound design, adaptive recipes, and brand kits. | Editable, source-grounded creative demos pass; protected edits survive regeneration; meaningful alternatives and whole-task undo work. |
| 12 — Delivery ecosystems | Linked formats, safe areas, preflight, thumbnails/metadata, optional publishing connectors, provenance, and supported MCP App integration. | Variant overrides survive master changes; preflight catches faults; authorized test-account flows work with platform restrictions disclosed. |
| 13 — Release qualification | Catalog completion, performance tuning, soak/failure tests, security/accessibility review, packaging, documentation, backups, and release evidence. | All required demos and supported-profile gates pass; unresolved limitations are explicit; complete source/deployment artifacts and actual measurements are delivered. |

A provider without credentials, a deployment without required hardware, or an untested platform does not become “complete” through a mock. Record the exact status and preserve a useful functioning editor. Release claims must match the tested capability matrix.

## Appendix E — Verification notes and primary references

This is a documentation-based baseline checked on 14 November 2026, not a claim that the proposed application or every adapter has already been implemented or benchmarked. Recheck versions, account access and deployment behavior during Phase 0.

### Resolved differences between the source proposals

| Source suggestion | Unified requirement |
|---|---|
| WebGPU mandatory with only a few browser exceptions | Prefer WebGPU; probe actual OS/browser/GPU/driver features; provide a documented fallback or remote path. |
| One renderer guarantees a 100% identical MP4 | Share rendering semantics and assets; verify raw output separately from decoded lossy media within documented tolerances. |
| FFmpeg inherently breaks Hebrew | Correctly configured shaping can render Hebrew; use a shared text contract and test the actual path. |
| GPU-less server is automatically just slower | Qualify an explicit isolated software-renderer profile and supported effect/codec subset. |
| Integer microseconds represent every frame exactly | Use rational/frame/sample coordinates; quantize only at required boundaries. |
| Normalized coordinates alone preserve any aspect ratio | Add responsive layout rules, reflow, subject framing and per-variant overrides. |
| No overlap allowed on any track | Validate track-specific policies and explicit transition/audio overlaps. |
| Missing transition handles silently become freezes | Offer an explicit supported edge policy and preserve the user's decision. |
| Every generated result becomes editable internal objects | Editorial decisions remain structured; generated pixels remain derived media with editable placement and processing. |
| All local AI is free/private | Label no provider per-call fee where true; disclose execution/downloads and enforce the selected egress boundary. |
| Approximate word times can stand in for accurate alignment | Label approximation; use verified alignment or manual/segment timing for precision editing. |
| Onsets reliably identify kicks, snares and drops | Evaluate separate event/section classifiers and retain manual correction. |
| J/L cuts are short crossfades | Expose edit offsets separately from fades/crossfades. |
| Every creator macro should remove silence | Select steps by context; preserve musical rests and deliberate timing. |
| Voice cloning always needs only a 10–30-second sample | Use actual provider requirements and verification; expose supported controls only. |
| MCP Tasks always available | Negotiate the extension; use ordinary job handles/polling for other clients. |
| First approval reply always wins | Validate authenticated human, action hash, revision/scope, expiry and single-use consumption. |
| Fixed tool count proves agent completeness | Prove coverage through registry discovery, aliases, task fixtures and actual clients. |
| License allowlist omits LGPL while requiring FFmpeg | Audit exact distributions/builds and applicable MPL/LGPL/other obligations. |
| TikTok draft upload automatically bypasses audit restrictions | Treat inbox upload and Direct Post as separate approved scopes/flows. |
| YouTube always restricts unverified API projects to private videos | The current official reference explicitly says otherwise; use current policy/account settings and set visibility explicitly. |
| Every model name listed with a checkmark is production-ready | Separate documentation existence, license/access review, adapter tests and live measured behavior. |
| Any 2022 laptop and every workload meet the same numeric budgets | Use named exact hardware/media/workloads and publish qualification boundaries. |
| Each full preview must always perform every expensive sample live | Allow disclosed draft/cached modes and full-quality still checks; final render remains faithful. |

The model names Scribe v3, LTX-2.5 and FLUX 3 Max are present in the primary pages below. Their existence is not proof of every named variant, account entitlement, price or promised result. Keep endpoint/model settings versioned and editable.

### Primary reference directory

- [WebCodecs specification and codec-support contract](https://www.w3.org/TR/webcodecs/)
- [Current GPUWeb implementation matrix](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [Mediabunny documentation](https://mediabunny.dev/guide/introduction)
- [Mediabunny license](https://github.com/Vanilagy/mediabunny/blob/main/LICENSE)
- [Mozilla MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [FFmpeg license and build considerations](https://ffmpeg.org/legal.html)
- [FFmpeg filter and text-shaping documentation](https://ffmpeg.org/ffmpeg-filters.html)
- [ffmpeg.wasm limitations](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/faq.md)
- [Chromium software rendering and SwiftShader](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md)
- [MCP July 2026 specification update](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP Tasks extension and capability negotiation](https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md)
- [ivrit.ai Hebrew faster-whisper model card](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ct2)
- [WhisperX language-specific alignment](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py)
- [ElevenLabs transcription capabilities](https://elevenlabs.io/docs/overview/capabilities/speech-to-text)
- [ElevenLabs forced-alignment capabilities](https://elevenlabs.io/docs/overview/capabilities/forced-alignment)
- [ElevenLabs current model catalog](https://elevenlabs.io/docs/overview/models)
- [MediaPipe Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web)
- [Librosa beat-analysis reference](https://librosa.org/doc/main/api/generated/librosa.beat.beat_track.html)
- [SAM segmentation/tracking implementation](https://github.com/facebookresearch/sam3)
- [Runway developer APIs](https://docs.dev.runwayml.com/api/)
- [LTX-2.5 provider catalog](https://fal.ai/ltx-2.5)
- [Black Forest Labs model catalog](https://bfl.ai/models/)
- [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [TikTok Upload prerequisites and completion flow](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content)
- [YouTube video-upload reference](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)
- [YouTube video resource and visibility fields](https://developers.google.com/youtube/data/reference/rest/v3/videos)

## Implementation launch instruction

Read this whole specification and the existing repository instructions. Save the governing specification as docs/SPEC.md, preserve unrelated work, and implement Phase 0. Record architecture choices, measured capability probes and the smallest runnable import/edit/preview/export/agent proof. Update docs/PROGRESS.md with actual results and the next executable phase.

For subsequent sessions, read docs/SPEC.md, docs/PROGRESS.md, docs/CAPABILITIES.md and relevant ADRs, then continue from the first incomplete justified gate. Do not rebuild completed work or declare undocumented features complete.

---

# Accepted amendments

Everything above this line is the governing specification v3.0, saved verbatim. Amendments accepted by the project owner are listed here.
An amendment adds to or refines the sections it names; where it is silent, the base specification governs.

## Amendment A1 — Freefield / ComfyUI integration (accepted 14 November 2026)

Full text: [PULSEFRAME_FREEFIELD_INTEGRATION_ADDENDUM.md](PULSEFRAME_FREEFIELD_INTEGRATION_ADDENDUM.md) (saved verbatim; normative for FF-01 … FF-15, its acceptance gates and its limitations).
Requirement tracking: `docs/REQUIREMENTS.md` (rows FF-01 … FF-15). Provider decisions: `docs/INTEGRATIONS.md`, `docs/adr/0007-comfyui-provider.md`.

Summary of what A1 changes:

| ID | Requirement | Refines base § | Kind |
|---|---|---|---|
| FF-01 | ComfyUI is an optional execution provider behind the existing provider/job/operation layers; never a second project authority; no raw graph submission for untrusted agents | 18, 20, 21, 22 | New (concrete provider) |
| FF-02 | Provider adapter contract: discover, probe, estimate, submit, status without wakeups, cancel, collect; progress labelled measured/estimated/unknown; keep original brief and translated prompt | 18, 20 | Refines |
| FF-03 | Reviewed workflow import: imported graph is a draft; review checklist; import never installs code, executes, or contacts graph-defined endpoints; publication needs real execution and quality review | 18, 24 | New |
| FF-04 | Capability descriptor extensions; statuses kept separate: schema-valid, dependency-ready, license-reviewed, executed, quality-reviewed, Hebrew-qualified, hardware-qualified | 12, 18 | Refines |
| FF-05 | Capability packs: shared dependencies, exact missing bytes, resume + digest verification, readiness report; never the whole catalog by default | 18 | Refines |
| FF-06 | Resource metadata separates download size, phase residency, host RAM/scratch, measured peak device memory, profile, stage durations, estimated vs measured cost | 18, App. C1 | Refines |
| FF-07 | Worker admission: no billable wake from browsing/polling; explicit prewarm under spending rules; lease over the whole execution; distinct cancel semantics; affinity with fairness | 20 | New |
| FF-08 | Durable job and media contract retained; bounded transfers of selected ranges only; outputs probed before attachment; recipe recreation without bit-identity promise | 7, 20 | Refines |
| FF-09 | Lab examples from recorded runs: load example, restore settings, compare, flag weak examples, replace with history, show upgrade changes | 12 | Refines |
| FF-10 | Typed "Use in…" chaining and recipe chains with lineage, explicit slot choice, plan/estimate, cached partial reuse | 19.12, 24 | New |
| FF-11 | Reference Board: reusable reference sets by role, versions recorded in history; LoRA training deferred | 19, 24 | New |
| FF-12 | Generative Reframe as an explicit mode beside Crop/Fit/Blur-fill; protected region; original timing preserved | 14, 19.8 | New |
| FF-13 | Relight (image first), Mixed Media, Cinema controls as creative guidance, not calibrated camera physics | 13, 19 | New |
| FF-14 | Motion Transfer / Recast; enforce real segment limits (selected Recast graph: first 81 frames); reject, never truncate silently | 14, 19.2 | New |
| FF-15 | Typed auxiliary output bundles (matte, depth, normals, guide, audio, preview); numeric geometry defined, RGB visualisations labelled as such | 5, 7, 8 | Refines |

Limitations carried into the requirements unchanged: model file size is not runtime VRAM; the supplied Cameraman v2 LoRA is excluded from the
default commercial profile; imported workflows stay drafts until reviewed and tested; imported graphs never auto-install custom nodes; paid
execution and model downloads follow the existing authorization and spending rules; listed models are candidates, not an install list.

Delivery: sub-milestones G0–G3 are mapped onto phases 0–13 in `docs/PROGRESS.md`. They do not gate the provider-free editor.
