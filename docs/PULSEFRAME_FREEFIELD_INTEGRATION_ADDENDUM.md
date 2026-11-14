# PULSEFRAME — Freefield Review and Integration Addendum

Prepared: 14 November 2026  
Baseline: PULSEFRAME_STUDIO_UNIFIED_MEGAPROMPT.md, version 3.0  
Reviewed repository: https://github.com/neuregex/freefield  
Reviewed commit: f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c  
Scope: documentation, all 120 app manifests, selected implementation files, CI definitions and original model/license sources. No dependency installation, GPU execution, deployment or runtime benchmark was performed for this review.

## Executive decision

Adopt an optional ComfyUI workflow provider, selected workflow-building tools and specific creative workflows. Preserve PULSEFRAME's canonical project, operations, exact time model, editor renderer, durable jobs, authorization and REST/MCP architecture.

The strongest additions are a reviewed workflow-import path, capability-based model packs, explicit GPU preparation, reproducible examples, typed result chaining, a Reference Board, generative frame expansion and motion-transfer workflows.

Freefield is evidence that these workflow ideas have concrete implementations to investigate. Its catalog status, demonstrations and reported measurements do not qualify every workflow for PULSEFRAME's hardware, commercial deployment, Hebrew requirements or production quality.

This is an additive implementation brief. It does not declare any integration already built. Existing repository instructions and the governing PULSEFRAME specification continue to apply.

## 1. What was verified

The snapshot contains 120 app manifests: 119 marked ready and one marked draft. Of the 120, 72 identify themselves as generated template apps, and two are model-free smoke apps. These numbers describe catalog entries, not independent model engines. The schema defines ready by workflow presence and resolved bindings; other dimensions need separate qualification. [S1–S3]

Freefield combines a Node application, the Comfy SDK, a token gateway, a Comfy API proxy and a ComfyUI execution environment. It supports a local GPU backend and a Modal deployment. The manifest system generates much of the catalog, forms, workflow bindings and model inventory. [S1–S4]

We verified concrete implementations and metadata rather than assuming that every README phrase is a completed capability. In particular:

- The importer creates a draft and may leave unknown model references to resolve.
- History is persisted, including inputs, outputs, seed and timings, with some restart recovery.
- The hosted demo uses shared passcode access and shared run limits.
- Model file sizes and measured VRAM are different fields.
- Some models have conditional, noncommercial or unclear terms.
- Some app source notes lag behind later lab reports.
- Published examples are repository-reported runs, not benchmarks reproduced in this review.

## 2. Novelty relative to the existing mega-prompt

### 2.1 New or substantially more specific requirements

| Addition | What it contributes | Baseline sections |
|---|---|---|
| ComfyUI workflow provider and importer | A concrete ecosystem for turning reviewed graphs into Studio capabilities | 18, 20, 22, 24 |
| GPU-aware capability packs | Shared weights, download plans, phase residency, explicit prewarm and non-waking status checks | 18, 20 |
| Example replay and quality review | Actual run → catalog example → restore settings → reproduce → review | 12, 19, 28 |
| Typed “Use in…” chaining | A result can populate a compatible input of another tool while preserving lineage | 7, 19, 20, 24 |
| Reference Board | Reusable people, products, places, wardrobe and style references, including multi-image identity sets | 19, 24 |
| Generative Reframe | Synthesize missing frame areas as an explicit alternative to crop, fit and blur-fill | 14, 19 |
| Motion Transfer / Recast | A driving performance animates or replaces a character, beyond pose analysis and overlays | 14, 19 |
| Cinema controls | Structured shot, lens-like aesthetic, lighting and camera-motion vocabulary | 19 |
| Relight and Mixed Media | Dedicated lighting controls and source-guided video restyling | 13, 19 |
| Typed auxiliary output bundles | Preserve matte, depth, normals, guide, audio, preview and final media as related assets | 5, 7, 8, 20 |

### 2.2 Existing categories that gain concrete implementation candidates

The baseline already includes background removal, masks, depth, upscaling, frame interpolation, generative image/video/music/SFX, dubbing, lip sync, scene cleanup, a local model manager, extension manifests, provider routing and a visual Lab.

BiRefNet, MoGe-2, SeedVR2, FILM, Wan Animate, LTX workflows and the audio models therefore do not make all of those product categories newly discovered. They provide specific backends, workflow examples and useful implementation constraints.

Likewise, generation history and a visual Lab already exist in the baseline. The additions here are example-driven replay, structured quality flags, measured resource cards and compatible next-tool suggestions.

## 3. Candidate shortlist

“First integration” means first within the optional ComfyUI addition, after the core editing path is working. It does not make model downloads or a GPU mandatory for basic editing.

| Capability / candidate | Recommended use | Qualification and scope |
|---|---|---|
| ComfyUI + Comfy SDK or direct supported API | Optional local/remote worker provider | Verify exact protocol/SDK versions; preserve our authoritative job layer |
| BiRefNet: remove-bg / video-remove-bg | Cutouts and reusable subject mattes | Image-model application to video needs flicker, hair, blur and occlusion tests |
| MoGe-2: depth-map | Estimated depth and normals for parallax, fog and selective processing | Export usable geometry data, not only a colored visualization |
| SeedVR2: upscale / upscale-video | Optional restoration and enlargement | Compare source/detail fidelity; qualify image and video paths separately |
| FILM: smooth | Candidate for interpolation and slow motion | Official repository is archived; benchmark against maintained alternatives at implementation time |
| LTX + In-Outpainting: reframe | Generative aspect-ratio expansion | Separate from crop/reflow; review generated borders and preserved center |
| Qwen Image Edit + Relight LoRA: relight | Lighting direction, softness, intensity and color | Image workflow first; any temporally stable video version is additional work |
| FLUX + LTX Union Control: mixed-media | Restyle a clip using source structure and a chosen visual look | Assess full-clip style drift, identity, motion and texture stability |
| Wan Animate 2: motion-transfer | Animate a character from a driving clip | Evaluate timing, limbs, face/identity and motion fidelity |
| SCAIL-2 + tracking: recast | Replace a performer with a chosen character | Freefield's selected graph is explicitly limited to the first 81 frames |
| Cinema Studio / Cinema Video / camera-moves | Guided cinematic stills and shots | Creative guidance; numerical-looking labels must not imply calibrated physical cameras |
| MiniMax Music 3: music | Optional music/song generation backend | Original Community License governs; exact musical constraints need validation |
| Stable Audio 3: sfx | Optional effects/ambience generation backend | Community terms; inpainting/continuation are upstream capabilities needing additional workflows |
| LTX DubIt port: dub | Research candidate for generated dialogue/lip motion | Ported workflow; verify actual language, intelligibility and Hebrew behavior |
| Camera Copy | Preserve as a product idea | The supplied Cameraman v2 LoRA is research/noncommercial; exclude from default commercial pack |
| Reshoot / novel view | Experimental generative reframing from another apparent viewpoint | Compute-heavy; unseen surfaces are synthesized; unresolved optional Turbo-model terms require resolution/removal |
| Learned SDR-to-HDR | Experimental separately qualified workflow | Needs genuine high-bit-depth/color pipeline and a tone-mapped preview; not just metadata tagging |
| Character LoRA training | Deferred research | Freefield describes future/unverified training work; do not advertise it as implemented |

Sources: pinned manifests in apps/; upstream sources [S14–S26]. A license label in this table is not clearance for every transitive dependency.

## 4. Mandatory integration architecture

### FF-01 — Optional provider boundary

Implement ComfyUI behind PULSEFRAME's existing provider contract. A user or agent selects a reviewed capability; the normal operation/job layer validates access, source media, input range, parameters, execution policy and budget.

The provider may execute locally or on an approved remote GPU. The browser editor remains usable without this provider, and deterministic editing/export remains independent of generative model availability.

Freefield's web shell must not become a second project authority. Its backend cannot mutate a PULSEFRAME document directly. Do not copy another product's visual identity; use PULSEFRAME's original design and Hebrew conventions.

A successful flow is:

1. Resolve capability version and source asset/range.
2. Validate authorization, licenses, resource profile and cost policy.
3. Commit the durable job and source-revision preconditions.
4. Stage the selected media and acquire worker ownership.
5. Execute the pinned graph and report structured progress.
6. Collect, probe and persist typed outputs as derived assets.
7. Propose or apply attachment through the canonical operations layer.
8. Release the worker and settle recorded resource/cost usage.

UI, REST and MCP call the same authoritative actions. Do not expose a privileged raw graph-submission route to untrusted agents.

### FF-02 — Provider adapter contract

Map the existing provider abstraction to capabilities such as:

- Discover supported reviewed workflows.
- Probe environment and dependency availability.
- Estimate download, memory, duration and cost ranges.
- Submit a durable job.
- Fetch status and progress without unnecessary worker wakeups.
- Cancel a queued or owned running job.
- Collect and validate named outputs.

These are PULSEFRAME integration requirements, not claims that Freefield already exposes this exact interface or an MCP server.

Represent preparation, queueing, inference, post-processing and transfer separately. State which progress values are measured, estimated or unknown.

Preserve the original brief and any translated model prompt. Hebrew UI and text remain first-class even where a specific model works best with an English prompt.

### FF-03 — Reviewed workflow import

Accept exported ComfyUI API JSON and, where supported, UI-format graphs. The first result is a draft capability.

Import should infer candidate inputs, outputs and bindings, then require review of:

- Graph and node identities.
- Media input roles and output roles.
- Exposed controls, bounds, units and defaults.
- Seed relationships and prompt-building logic.
- Required model artifacts and optional model branches.
- Custom-node package versions and runtime requirements.
- Download, compute and egress behavior.
- Licensing evidence and unresolved dependencies.

Freefield's importer can produce unknown-model placeholders; unresolved placeholders are never production-ready dependencies. [S3]

Importing JSON must not install arbitrary Python code, execute a workflow, contact arbitrary graph-defined endpoints, or grant access to filesystem paths/secrets. Approved custom nodes run in reviewed, isolated worker images.

Publication requires structural validation, a real execution on a named profile, output checks and task-appropriate quality review. Show the reasons a draft remains unpublished.

### FF-04 — Capability descriptor extensions

Extend the current registry rather than creating a parallel catalog. Preserve:

- Stable capability ID and semantic version.
- Source repository commit and original notices.
- Graph digest and exposed bindings.
- Runtime image digest; ComfyUI, node-pack and adapter versions.
- Models: original publisher, immutable revision, file path, cryptographic digest, size, gate/access prerequisites and license evidence.
- Typed inputs and outputs, including alpha/depth/normal metadata.
- Qualified resolutions, durations, frame counts, batch sizes and frame rates.
- Resource estimates and separate measured profiles.
- Feature-specific limitations and supported languages.
- License eligibility for the selected distribution/commercial profile.
- Examples tied to actual run records.
- Independent validation dimensions.

Keep these statuses separate: schema-valid, dependency-ready, license-reviewed, executed, quality-reviewed, Hebrew-qualified and hardware-qualified. “Ready” must not collapse them.

### FF-05 — Capability packs and local readiness

Install models by selected capability or pack. Calculate shared dependencies and exact missing disk bytes, support resume/checksums, and explain the effect of uninstalling shared artifacts.

Do not download the entire Freefield catalog by default.

Add a readiness report covering runtime versions, GPU/driver availability, disk space, host RAM, selected model access, worker connectivity and codec/output prerequisites.

Pin model revisions and verify bytes. File existence with a nonzero size does not prove that a download is complete or matches the tested artifact.

## 5. GPU lifecycle, performance and jobs

### FF-06 — Resource metadata that describes the right quantity

Store separately:

- Download size on disk.
- Estimated model residency by phase.
- Host RAM and scratch-disk requirements.
- Measured peak device memory.
- Qualified device/runtime/workload profile.
- Cold-start, load, inference, post-processing and transfer durations.
- Estimated versus measured cost.

Freefield's weight-based fit heuristic excludes activation memory. Its measured peaks are workload-specific and can include retained models. Neither field alone proves a minimum hardware requirement. [S5]

Selected values from the reviewed VRAM JSON, reported by the repository:

| Workflow | Required model files, GB | Reported peak VRAM, GB | Measurement environment |
|---|---:|---:|---|
| BiRefNet image removal | 0.44 | 4.96 | L40S |
| BiRefNet video removal | 0.44 | 6.73 | H100 |
| MoGe depth map | 0.66 | 6.64 | H100 |
| SeedVR2 image upscale | 3.96 | 6.51 | H100 |
| SeedVR2 video upscale | 3.96 | 26.11 | L40S |
| FILM interpolation | 0.07 | 27.71 | L40S |
| Motion Transfer | 24.90 | 37.34 | L40S |
| Generative Reframe | 40.01 | 44.15 | H100 |

These are not independently reproduced benchmarks or purchase recommendations. Input size, frame count, offloading, precision, tiling and runtime versions must accompany PULSEFRAME's own measurements. [S5]

### FF-07 — Worker admission, prewarm and cancellation

Catalog browsing and status polling must not start a billable GPU. Prewarm is an intentional action governed by existing spending authorization and visible estimated cost.

Use a worker lease across preparation, model switching, submission and job ownership. A lock only around unloading models does not establish ownership of the whole execution.

Do not unload a model or issue a global interrupt while another user's job owns the worker. Distinguish removing a queued job, cancelling an owned running job and a cancellation request that the backend cannot honor.

Use model affinity to reduce reloads, with fairness and deadlines so one heavy pack cannot starve other users. Introduce multi-worker routing only after ownership and admission are correct.

### FF-08 — Durable job and media contract

Retain the baseline's transactional outbox, idempotency, submission-unknown reconciliation, cost reservations, retries, stale-result protection and immutable export revision.

Freefield has useful persistent history and recovery logic, but its one-hour default recovery cutoff and handling of submissions without a backend job ID are not a replacement for that contract. [S6]

Buffering entire feature-length uploads is unacceptable. Reuse PULSEFRAME's ingestion/probing and bounded transfer pipeline; submit only the selected source ranges and appropriate working resolution.

Probe output dimensions, duration, timestamps, codec, audio, alpha and color metadata before marking an attachment usable. A GPU job finishing does not mean its output has been downloaded and committed successfully.

Preserve original assets. Store graph/model/node versions, source hashes, resolved parameters/seed and execution profile. “Recreate” restores the recipe; cross-runtime bit identity is not promised.

## 6. Creator experience

### FF-09 — Lab examples become usable starting points

Extend the existing /lab system so an approved recorded run can produce a catalog card, sample media and a “Load this example” action.

A card should expose the artistic result first, with resource and model details available on demand. Keep required product choices understandable; implementation details belong in advanced views.

Provide:

- Restore inputs/settings from an authorized previous run.
- Compare original and result with an image wipe or synchronized video.
- Mark a weak example with a reason and send it to a review queue.
- Replace examples after a new qualified run while retaining history.
- Show changes caused by a model/workflow upgrade.

Publish synthetic or licensed samples rather than private user media. A successful process exit and a visually good result are separate review dimensions.

### FF-10 — Typed “Use in…” and recipe chains

Each output declares its role and compatible media type. Offer relevant next actions: a still can become a first-frame input, a clip can drive motion transfer, a matte can feed compositing, and generated audio can enter the audio timeline.

If a tool has multiple compatible slots, ask for the slot or use an explicit user choice; do not silently replace the wrong reference.

The chain retains asset lineage and becomes a reusable recipe. Show the total planned steps, source ranges and estimated resource use. Each step uses the existing job dependency graph and budget policy.

Permit partial reuse of cached results when input hashes, parameters and relevant model/runtime versions match. Re-running a downstream step should not automatically regenerate already accepted upstream assets.

### FF-11 — Reference Board

Add reusable reference sets for people, characters, products, clothing, places, lighting and visual styles.

Support individual images and generated reference sheets; record which reference serves which role. Preserve original reference files and their permissions. A reference-conditioned generation is distinct from training a personalized model.

Allow the user to select an identity set, product set and look set independently. Record their versions in generation history.

Test consistency across multiple outputs: face/character identity, clothing, product shape, logos, text and palette. Preserve exact Hebrew titles, product labels and brand marks as native overlays or source compositing when pixel accuracy matters.

Character LoRA training is a separate deferred capability requiring an independently verified training workflow, storage policy and compute qualification.

### FF-12 — Generative Reframe

Add an explicit mode alongside existing Crop, Fit and Blur-fill:

“Generate missing frame area.”

Display a protected source region and the region to synthesize. Preserve the original clip, track derived areas, and compare the full output for border flicker, duplicated objects, geometry changes and subject distortion.

Where supported, composite the protected original center back into the result; qualify seam and motion behavior. Do not imply that a prompt alone guarantees unchanged center pixels.

Retain the original rational timeline mapping. Different generated duration/frame rate must not silently stretch the source or desynchronize captions/audio.

### FF-13 — Relight, Mixed Media and Cinema controls

Start with image relighting, then qualify any video propagation separately. Expose direction, softness, brightness and color only when the selected workflow actually supports them.

Mixed Media uses a chosen appearance plus source structure; test multiple points throughout the clip, including motion and occlusions. “Style stays identical” is a quality goal to measure, not an inherent guarantee.

Cinema controls may describe shot size, genre/era, lens-like aesthetic, aperture-like treatment, lighting, palette and suggested camera moves. Distinguish creative guidance from deterministic geometric transforms.

Keep native position/scale/keyframe controls available for exact motion. A generated camera move produces a new clip. Do not promise that an ordered list of three movements will be executed precisely by every model.

### FF-14 — Motion Transfer and Recast

Create optional asynchronous workflows for character animation and replacement from a driving performance.

Evaluate beat alignment, limb continuity, foot contact, hand/face consistency, motion blur and occlusions. Retain the driving clip, reference character and output side by side.

Enforce each workflow's actual segment length. Freefield's SCAIL graph explicitly processes the first 81 frames; arbitrary-length recasting requires additional implementation and boundary/continuity evaluation. [S15]

Chunking is not automatically sufficient: compare seams, pose continuity, identity and audio alignment across chunks. Reject unsupported durations rather than silently truncating them.

### FF-15 — Auxiliary assets and geometry-aware editing

Store primary output and related matte/depth/normals/warp guide/audio/preview as a typed output bundle, each with source identity and timing.

A colored depth preview is not sufficient as a numeric depth input. If a workflow only returns an RGB visualization, mark it as such; add a qualified raw geometry output before enabling depth-dependent post-processing.

Define depth scale/normalization, coordinate system, normal encoding, bit depth and invalid-pixel mask. Treat monocular geometry as estimated.

These assets may power the baseline's parallax, depth blur, fog, relighting and occlusion effects without regenerating the entire clip for every artistic change.

## 7. Conditional and experimental directions

### Camera Copy

Preserve camera-motion transfer as an idea. Exclude the exact Cameraman v2 dependency from the default commercial pack because its publisher labels it research-only and not intended for commercial use. A new licensed implementation or explicit authorization is required. Complex multi-axis fidelity also needs testing. [S16]

### Novel-view Reshoot

Treat reconstructed views as generated interpretations. Show the reprojection/warp guide and synthesized holes. Evaluate identity, object geometry and visibility. Any model with unstated terms remains unqualified until resolved or removed from the tested graph.

This workflow is different from ordinary pan/zoom and bounded 2.5D parallax. It does not recover unseen ground truth.

### Learned SDR-to-HDR

Require verified bit depth, transfer function, primaries, range and color conversion at every boundary. Supply a correctly tone-mapped preview and qualify a real HDR export path.

Keep generative luminance reconstruction separate from faithful color management. Do not describe changing metadata as recovering genuine source HDR.

### Audio repair and continuation

Stable Audio's upstream model describes inpainting and continuation; Freefield's selected sound app exposes generation. A future “Sound Repair & Extend” tool would therefore be a new PULSEFRAME workflow. [S24]

Require selected audio range, fixed boundaries, fades and length checks. Evaluate rhythm, key, timbre and transitions. Generated repairs do not recover an unknown original recording.

### Hebrew dubbing

A form saying “any language” is not a Hebrew qualification. Keep existing Hebrew ASR/TTS/alignment providers. Test intelligibility, pronunciation, speaker similarity, timing and lip behavior independently for any generative dubbing candidate.

## 8. Licensing and deployment decisions

Freefield root code is MIT. ComfyUI core is GPL v3. Model weights, LoRAs, custom nodes and other dependencies keep their own terms. A separate worker is a useful architecture boundary; it is not an automatic exemption from distribution obligations. [S1, S17]

Compute commercial eligibility across the selected workflow and runtime distribution. Unknown or conflicting terms prevent qualification for that profile.

Original publisher licenses take precedence over informal repack tags when assessing an artifact. MiniMax Music 3 is a concrete example: its original license is a Community License with commercial conditions, even though a repack card had an Apache tag. [S23]

Do not equate “open weights” with unrestricted commercial use or zero operating cost. Keep models downloadable or remotely hosted according to their terms and selected privacy policy.

Preserve notices for reused Freefield code and inspect the origin of copied workflows. Do not reuse proprietary branding or assume every demonstration asset is covered by the code license.

Freefield's shared-passcode demo is useful for trusted personal evaluation. A hosted PULSEFRAME deployment must provide per-user/project authorization, tenant-scoped history/assets, scoped downloads and quotas. Retain real existing authentication when evaluating it; the gap is individual ownership and isolation. [S7]

## 9. Acceptance gates

| Gate | Required proof |
|---|---|
| Provider boundary | Same reviewed task invoked by UI, REST and MCP creates the same authoritative job shape |
| Structural import | Unbound controls and unknown models block publication with actionable errors |
| No implicit execution | Importing a workflow alone performs no model install, arbitrary node execution or paid GPU wake |
| Model integrity | A partial/corrupt file fails digest validation and is never treated as ready |
| Resource qualification | Download bytes, estimated weight residency and measured VRAM are shown separately |
| Worker isolation | Concurrent jobs cannot unload or interrupt another job's worker ownership |
| Recovery | Disconnect and server restart preserve known jobs; ambiguous submissions are reconciled without blind paid retries |
| Output integrity | Missing or malformed outputs cannot be attached as successful assets |
| Stale result | A finished job does not overwrite a newer clip edit; user can attach or review the derived asset |
| Temporal correctness | Reframe/slow-motion/recast preserve declared duration and audio/caption timing rules |
| Visual quality | Hair/masks, fast dance motion, scene cuts, text/logos, occlusions and style drift have reviewed fixtures |
| Licensing | A workflow containing the research-only Cameraman dependency is unavailable in the default commercial profile |
| Example replay | Restored inputs and resolved settings match the saved recipe; changed versions are disclosed |
| Privacy | Local-only policy blocks cloud routing; history and assets are scoped to the requesting user/project |

A schema-valid workflow, a CPU validator result, a successful GPU run and a production-quality example are different kinds of evidence.

## 10. Delivery sequence

### G0 — One complete optional integration

Build the provider adapter with a model-free smoke graph, then one reviewed media graph. Demonstrate job creation, progress, source-range handling, output probing, canonical attachment, cancellation and stale-result behavior.

Do not change the core timeline/rendering architecture.

### G1 — Practical image and geometry utilities

Qualify BiRefNet image removal, MoGe depth/normal outputs and SeedVR2 image enlargement on named hardware. Add model packs, readiness diagnostics and transparent preparation states.

Treat video versions as separate workloads with separate memory/quality qualification.

### G2 — Reusable creative workflow experience

Add example replay, synchronized comparison, typed “Use in…”, recipes and Reference Board. Then qualify Generative Reframe and one Mixed Media/Relight workflow.

### G3 — Advanced performance and generation

Evaluate video upscaling/interpolation, Motion Transfer, Recast and selected audio workflows. Camera Copy, Reshoot, learned HDR and personalized training stay conditional until their specific evidence and eligibility requirements are met.

Do not defer the usable editor until the entire imported catalog exists.

## 11. Sources and evidence directory

Pinned repository links identify the reviewed source snapshot. Upstream model pages can change; recheck their exact versions during implementation.

- S1 — [Freefield README and license discussion](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/README.md)
- S2 — [Manifest schema](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/schema/app.schema.json)
- S3 — [Workflow importer guide](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/docs/import-workflow.md)
- S4 — [Registry validation](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/server/registry.ts)
- S5 — [VRAM data](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/docs/vram-map.json) and [calculation logic](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/tools/catalog.py)
- S6 — [Persistent run history and recovery](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/server/history.ts)
- S7 — [Hosted guard](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/server/guard.ts)
- S8 — [Gateway preparation](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/infra/gateway.py)
- S9 — [Runtime and model downloads](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/infra/common.py)
- S10 — [Server, GPU status and wake](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/server/server.ts)
- S11 — [Lab-run evidence](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/docs/lab-runs.md)
- S12 — [CI definition](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/.github/workflows/validate.yml)
- S13 — [Capability manifests](https://github.com/neuregex/freefield/tree/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/apps)
- S14 — [Generative Reframe manifest](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/apps/reframe/app.json)
- S15 — [Recast segment limit](https://github.com/neuregex/freefield/blob/f3d32ce2e3128c58bb2fe38c8942edf87cdb2e4c/apps/recast/app.json)
- S16 — [Cameraman v2 original model card](https://huggingface.co/Cseti/LTX2.3-22B_IC-LoRA-Cameraman_v2)
- S17 — [ComfyUI core license](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE)
- S18 — [BiRefNet original model](https://huggingface.co/ZhengPeng7/BiRefNet) and [Comfy package](https://huggingface.co/Comfy-Org/BiRefNet)
- S19 — [MoGe upstream](https://github.com/microsoft/MoGe)
- S20 — [SeedVR2 package and original links](https://huggingface.co/Comfy-Org/SeedVR2)
- S21 — [FILM upstream](https://github.com/google-research/frame-interpolation)
- S22 — [LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5) and [original family license](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x)
- S23 — [MiniMax Music 3 original license](https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE)
- S24 — [Stable Audio 3 model card](https://huggingface.co/stabilityai/stable-audio-3-medium)
- S25 — [Wan Animate 2 package](https://huggingface.co/Comfy-Org/Wan-Animate-2) and [original model](https://huggingface.co/Wan-AI/Wan2.2-Animate-2-14B)
- S26 — [SCAIL-2 original model](https://huggingface.co/zai-org/SCAIL-2)

## Implementation handoff

Read the governing PULSEFRAME specification and this addendum. Record the accepted requirements in docs/REQUIREMENTS.md and the candidate workflow/provider decisions in docs/INTEGRATIONS.md and relevant ADRs.

Plan G0 alongside the existing provider/job milestones. Implement the smallest qualified optional integration first. Preserve the editing engine, shared operation layer, current authorization, exact time model and functioning provider-free core.

Report source review, structural validation, actual execution and visual quality separately. Record measured results and remaining blockers in docs/PROGRESS.md. Do not label imported workflows production-ready solely because their JSON validates.

