# ADR-0017: The AI-model wave — upscale, smooth slow motion, video enhance, AI voice cleanup, caption translation, classic vocal removal, portrait blur

Status: **accepted** (2026-11-17) for wave 1 (CPU, this container). Built by three workers on shared contracts, each reviewed and repaired, merged.
Proofs: see docs/PROGRESS.md (the checkpoint that merged this wave) for what ran and what it showed. Nothing here is quality-reviewed: nobody has
looked at the upscaled or interpolated pictures on real footage, listened to the cleaned voice, or read the Hebrew translations yet.

## Context
- The owner authorised model downloads up to 30 GB (2026-11-17, docs/BLOCKERS.md B-4), with every licence checked at the original publisher first,
  and named Real-ESRGAN explicitly; later the same day the owner accepted Real-ESRGAN's training-data residual risk and approved installing the
  DeepFilterNet engine on this machine.
- A read-only workflow mapped the provider infrastructure, six researchers checked 61 candidate model families at their publishers
  (`.artifacts/ai-licences.json` in the session; the accepted ones are pinned in `packages/providers/src/aiPins.ts` and
  `docs/evidence/ai-wave-pins.json`), two designs were judged, and design B won with grafts from A.
- This machine is CPU-only (4 cores). Measured on stand-ins of the same architecture: Real-ESRGAN x4plus takes about 10 s per 720p output frame
  (stills only on CPU); the compact realesr-general-x4v3 about 0.6–0.8 s (short clips feasible); RIFE v4.25 about 0.17 s per new 360p frame.

## Decision
1. **One capability registry, two providers** (ADR-0007 amendment): reviewed ComfyUI-core graphs for pictures and video, and PULSEFRAME-owned
   local tools (Python worker with transformers; an operator-installed engine; FFmpeg) for text and sound. Every run is a durable job; every
   result is digested, probed and validated against its declared contract (size, frame count, exact rate, sample count, delay ≤ 1 ms, not
   silent) before success, and enters the project only through ops; a result whose source changed while it ran stays a proposal.
2. **Frame jobs** for video: exact half-open frame ranges on the asset's clock, chunked to fit memory, one compute-lane hold per chunk, pairwise
   chunks with a one-frame overlap for interpolation, scene cuts held rather than morphed, assembly at the exact output rate (r·m), sound
   re-muxed sample-exactly, validation like the proxy rule, cancel at chunk boundaries, recovery that re-verifies chunk digests.
3. **Wave-1 features:** photo upscale ×2/×3/×4 (Real-ESRGAN x4plus + exact `ImageScaleBy`; inputs ≤ 1 MP on CPU); smooth slow motion ×2/×4
   (RIFE v4.25; ≤ 1280×720, ≤ 150 frames on CPU; placed with `replace_clip_asset` + `set_clip_speed(1/m)` in one transaction, so sound and
   captions behave exactly as a speed change); video enhance (realesr-general-x4v3, same size and rate; ≤ 640×360, ≤ 300 frames on CPU);
   AI voice cleanup «ניקוי קול בבינה מלאכותית» (DeepFilterNet3 through `deep-filter` 0.5.6, input padded and trimmed back to the exact sample
   count because the engine returns 30 ms less); caption translation Hebrew ↔ English (OPUS-MT, phrase-timed only, stored as a linked language
   format with review 'needed' until the owner marks it reviewed; agents cannot); classic vocal removal (FFmpeg centre cancel, labelled
   «קלאסי, לא בינה מלאכותית», refused on effectively mono sound); portrait blur for stills (an op that puts a blurred copy under the BiRefNet
   cut-out).
4. **Licences:** only `commercialUse: 'allowed'` runs in the default profile. Residual risks are recorded, not hidden: Real-ESRGAN's DIV2K
   training data (academic-only; accepted by the owner), OPUS-MT's Tatoeba training data (CC-BY-NC-SA; CC-BY attribution is shown in the model
   card and notices), RIFE as a key-renamed repack (MIT at the publisher; Vimeo-90K terms not reviewed). Excluded from the commercial profile:
   CodeFormer, GPEN, GFPGAN family, RMBG 1.4/2.0, DA V2 Base/Large, NLLB-200, SCRFD/InsightFace, htdemucs_6s and others listed in the plan;
   Spleeter waits for the owner's ruling; SAM 3.1 is skipped.
5. **Downloads** are owner-only, bound to exact bytes and SHA-256, from hosts in `PF_MODEL_HOSTS` (now also the exact GitHub publisher hosts),
   with a free-disk check; agents can only request one (an approval), never perform it.
6. **Honest setup states** per capability: ready, provider not configured or unreachable, engine not configured / not working / unverified,
   model missing (with exact bytes), licence blocked, host not allowed, disk insufficient. Long runs need a confirmation; the first run on a
   machine is capped until it has a measurement; estimates come from measurements on this device or are absent.

## Consequences
- On this CPU, video work is for short clips only; the GPU features (video cut-out and text behind the subject, RIFE at 1080p, x4plus on video,
  depth on video, a larger translation model) are wave 2 on the owner's RTX 3050 laptop, after its measurements.
- Transcript-driven edits (delete a range of the transcript, filler and silence cuts, pacing, scene splits) still match clips by asset id, so a
  clip that now shows a derived copy is not cut by them; captions, cues and ducking already follow the lineage. A follow-up makes them
  lineage-aware.
- An imported archive could carry a translation marked reviewed; a follow-up makes import reset the mark.
