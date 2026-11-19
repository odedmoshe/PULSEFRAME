# ADR-0010: Sound effects — one DSP implementation shared by preview, browser export and server export

Status: **accepted** (2026-11-17) for wave 1 (nine effects, eleven presets). Implementation in progress; nobody has listened to any of it yet.

## Context
- No sound effects existed: no voice changer, echo, reverb or tone shaping, which every surveyed editor offers (docs/MARKET_RESEARCH.md §5). SPEC §10 asks for audio processing with preview = export.
- Sound reaches the listener by three routes: the server export (ffmpeg decode, `apps/server/src/audiomix.ts`, chunks of 48,000 frames), the browser export (one OfflineAudioContext, `apps/web/src/browserExport.ts`) and the editor's preview (one pump per clip on the main thread, `apps/web/src/player.ts`). All three follow one plan (`packages/engine/src/audio.ts` `audioPlan`). ADR-0005 keeps one evaluator and one compositor for pictures; ADR-0008 decision 2 keeps one implementation per GPU effect.
- Two independent designs and a judge (read-only workflow, 2026-11-17) chose a fixed-stage voice with declared reach (design B) and grafted from design A: the output rate in `audioPlan` (which also fixes a latent browser-export bug for projects not at 48 kHz), one-op presets, an honest preview state, a manifest list of effect versions with an unknown-effect blocker, cut-tail warnings, a static determinism scan and golden hashes.

## Decision
**D1. One implementation.**
- Every audio effect is one pure TypeScript kernel in `packages/engine/src/audiofx/`. Server export, measure_loudness, browser export, preview and listen previews all run it.
- No WebAudio DSP node and no ffmpeg filter implements an effect. This is the audio form of ADR-0008 decision 2.
- No WASM: the CSP forbids it (http.ts:64).
- Only decoding stays route-specific: ffmpeg on the server, WebCodecs through Mediabunny in the browser.

**D2. Fixed stage order.** Users choose effects, never their order. For one clip:

1. Time map: exact rational speed, decoder rate to plan rate, reverse, mono to L=R.
2. Window stages:
   - 1 time (wave 2);
   - 2 tone;
   - 3 texture.
3. × volume keys × fades. These are zero outside [0, length).
4. Ring stages:
   - 4 space;
   - 5 rhythm (wave 2);
   - 6 motion.
5. × gain (clip gain × track gain) × duck, then balance (`panGains`, audio.ts:48).

Why this order:
- A fade-out happens before the echo or reverb, so the tail rings on naturally.
- Drive and crush keep their character when gain or volume change.
- Stages 4–6 are linear and time-invariant in wave 1, so cuts are exact there.
- Inside a stage, the processing order is the registry order.

**D3. Seek and warm-up rule.** This is the fix to design B.

Each kernel declares `reach = { warm, tail }`, in samples at the plan rate:
- Finite memory: `warm` is exact.
- Linear and decaying: `warm` is the smallest W with Σ_{k≥W} |h[k]| ≤ 2^-24, times the Lipschitz constant of any memoryless nonlinearity after it.

The chain sums these:
- `warmWindow` is the sum of `warm` over stages 1–3.
- `warmRing` is the sum of `warm` over stages 4–6.
- `tail` is the sum of `tail` over stages 4–6.

A voice opened at clip-local sample `from` does this:
- `ringStart = max(0, from − warmRing)` and `windowStart = ringStart − warmWindow`.
- Window stages always start at `windowStart` and read real source before the clip start (silence outside the file). Their output at any sample therefore equals the infinite-history output to within 2^-24 of peak.

Consequences:
- Output does not depend on push or chunk sizes. This is bit-exact.
- If `from ≤ warmRing`, a range render runs exactly the same computation as the full render, so it is bit-exact.
- Otherwise |range − full| ≤ 2^-17 × the clip's output peak, below the existing 2/32768 bound.
- A cut is inaudible:
  - window stages within 2^-24;
  - volume keys shift with the right half (packages/core/src/animation.ts:43-48);
  - fades stay on the outer edges (ops.ts:1134);
  - the ring stages are linear, so the parts sum to the whole.

**D4. Zero latency.** All wave-1 kernels are causal and declare no latency. A kernel with lookahead (wave 2) must also delay its dry path and declare an `ahead` reach, so output never moves. A/V sync is unchanged.

**D5. Tails are explicit and never lengthen the video.**
- Ring stages run to `length + tail`.
- A tail that would pass the programme end (audio.ts:103) is cut there with a linear fade of 10 ms or less (plan field `cutFrom`).
- `plan.cutTails` reports each cut. Export and preflight warn about it.
- Ducking is sliced over [0, length + tail), so a ducked track ducks its tail.
- Tails never trigger ducking: speech ranges are unchanged (audio.ts:59-76).

**D6. Determinism.**
- Per-sample code uses only + − × ÷, comparisons, `Math.floor`, `round`, `fround`, `imul`, `abs`, `min`, `max` and lookup tables. JavaScript never fuses into FMA.
- Transcendental `Math.*` calls are allowed only in `design.ts` and `tables.ts`, which compute coefficients once per instance.
- Noise is `hash32(seed, at + n, channel)` built with `Math.imul`. Oscillator phase comes from the integer timeline sample `at + n`. Both are random-access and continuous across cuts.
- Millisecond and Hz parameters are integers, converted to samples once by `Math.round(v·sr/1000)`, as ducking does (audio.ts:108).
- Source positions use exact integer phase accumulators, never accumulated floats (ADR-0003).
- Equality across runtimes (Node and Chromium) is measured and must be within 1e-6. It is reported, not promised (the ADR-0008 decision 4 analogue).

**D7. Honest states.**
- An effect that cannot run in the preview leaves its clip playing dry, with a reason in `player.unavailableAudioFx`, shown where picture reasons are shown (App.tsx:57).
- Export blocks on an unknown type or version (blocker `unknown_audio_effect`), as for picture effects (export.ts:176-177).
- In wave 1, clips that keep their pitch at a speed other than 1, or that ramp, cannot carry effects. Validation refuses this with issue `audio_fx_time_map`, and the ops refuse it with a hint. It is never silently dropped.

**D8. Not voice conversion.**
- These are DSP voice effects. Speech-to-speech conversion stays a separately labelled provider job (SPEC §10, docs/SPEC.md:380; ADR-0007).
- API name: `audioFx` / `audioEffects`. Hebrew UI name: «אפקטי קול». Neither is "soundEffects", which already means SFX assets (http.ts:690).

**D9. Stills and agent frames are untouched (ADR-0005).**
- Sound has no stills. The sound equivalent of render_frame is a WAV range export through the same mixer.
- `describe_moment` reports which effects are active and which clips are heard only through their tail.

## Lead decisions on the judge's open questions (2026-11-17)
- Reverb and echo tails are cut at the programme end with a fade of at most 10 ms and reported; the video is never lengthened automatically.
- Space effects add their wet signal on top of the dry one (y = x + amount·wet).
- Wave 1 refuses sound effects on clips that keep their pitch at another speed or change speed gradually (validation `audio_fx_time_map`, op refusals with a hint).
- Node and Chromium are measured to agree within 1e-6; bit equality is reported, not promised (the analogue of ADR-0008 decision 4).
- No WASM in wave 1 (the CSP forbids it); a Worker host for the preview DSP is a wave-2 item.
- Hebrew name «אפקטי קול», distinct from the sound library «צלילים».
- Tails on a ducked track are ducked; tails never trigger ducking.
- The owner listening on the laptop gates wave 2, as the owner's run gated ADR-0008 step 4.

## Consequences
- Contracts in the tree: `packages/core/src/audioEffects.ts` (registry, presets, parameter schemas), the `audioFx` field on media clips and its validation, `packages/engine/src/audiofx/` (kernel, registry, voice interfaces), the plan types, `packages/evals/src/voicefx-fixtures.ts`.
- Acceptance: the unit tests and the `pnpm proof:voicefx` checks of the plan's section 9 (range equals full render, push-size independence, band edges, RT60, impulse tails, golden hashes, preview = export within stated tolerances).
