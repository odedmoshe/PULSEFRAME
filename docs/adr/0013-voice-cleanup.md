# ADR-0013: Voice cleanup «ניקוי קול» — model-free hum removal, noise reduction and speech enhancer

Status: **accepted** (2026-11-17); built, reviewed, repaired and merged. Proof so far: voiceclean proof currently FAILING 9/11 (a constant −3-sample
lag; 0.61 dB against
a 0.5 dB bound), a repair is in progress. The lead updates this line when the repair lands. Nobody has listened to the cleaned sound on a real
recording; every statement
below about what the effects do rests on synthetic signals.

## Context
- The sound-effect runtime (ADR-0010) had character voices and space, but nothing that repairs a recording: hum, steady background noise, uneven
  speech level. ADR-0010 D4
  had required real look-ahead for window stages and no kernel used it yet.
- This is the **DSP** cleanup: plain signal processing, no model, nothing downloaded, runs in the browser preview and in the server export. It is not
  the AI voice cleanup
  «ניקוי קול בבינה מלאכותית» of ADR-0017, which is a provider-style job that creates a new asset with an external engine. The two are separate tools
  with separate buttons;
  the block in the inspector mentions the AI one and does not run it.
- Invariants: every edit is a registered op (ADR-0004); preview, export and agents compute the same samples (ADR-0010 D6); a split clip's parts sum to
  the whole (ADR-0010 cut rule).

## Decision
1. **Three effects, stage 2, category `cleanup`**, first in the registry (registry order is processing order): `cleanup.dehum@1` «הסרת זמזום»,
   `cleanup.denoise@1` «הפחתת רעש» (reduction, not removal: the more honest word) and `cleanup.speech@1` «שיפור דיבור». Kernels in
   `packages/engine/src/audiofx/kernels/{dehum,denoise,speech}.ts`.
   - dehum: narrow notches at k·mainsHz·speed (mains 50 or 60 Hz, up to 8 harmonics), causal, zero look-ahead; bound = the l1 norm of the impulse
     response.
   - denoise: STFT spectral gate (N = 1024 at 44.1/48 kHz, hop N/4, sqrt-Hann) driven by a FIXED noise profile, finite memory, no adaptation;
     look-ahead 26.6 ms at 48 kHz, registered as `aheadMs: 50`. Steady noise only: not voices, music, barks or doors.
   - speech: 4th-order low cut, presence EQ, a phrase leveller on 10 ms blocks toward a target (never raising pauses) and a sample-peak limiter last;
     look-ahead up to 250 ms (`aheadMs: 250`); the ceiling applies to the clip before clip gain and volume keys, not to the master.
2. **Look-ahead is real in the voice runtime** (`voice.ts`). `FxReach.ahead` is allowed for window stages only; `chainReach` sums it into
   `aheadWindow` A, the time map runs A samples ahead of the block, and window kernel j is called with n0 offset by its own look-ahead plus every
   later kernel's. Net latency stays 0, so A/V sync is untouched. With A = 0 every old effect computes what it did; a ring-stage kernel that declares
   look-ahead throws.
3. **Frames sit on the timeline sample grid** (`FxContext.at + n`): both parts of a split clip share one grid, so the parts sum to the whole. The
   price, stated in the catalogue limits: moving a clip by a non-multiple of the hop changes the output very slightly.
4. **Clip speed reaches the kernels** (`FxContext.speed`, and a speed argument to `reach`). Pitch follows speed, so hum recorded at 50 Hz is notched
   at 100 Hz at speed 2.
5. **The noise profile is one 48-character string parameter** (`core/voiceClean.ts`): 24 ERB-spaced bands from 50 Hz to 20 kHz, two base64url
   characters per band, 0.05 dB steps. It fits the 64-character string limit, keeps the parameter-corner count of the contract tests small, and is
   never shown as a control. The default is a generic −70 dB floor.
6. **Measuring is read-only** (`voiceMeasure.ts`, server `voiceClean.ts`): `measure_voice` (REST `POST /api/v1/projects/:id/analysis/voice`, durable
   job kind `voice`, MCP tool `measure_voice`) decodes the original file at 48 kHz stereo and reports band noise floors from the pauses, mains hum,
   speech level, peak, SNR and a recommended strength, plus candidate `clean_voice` ops (clip, or every clip cut from the same recording). Nothing is
   stored in the document. A recording over 600 s is measured in 30 windows of 20 s.
7. **One op sets all three: `clean_voice`** (`clipId`, `strength` default 0.6, `profile`, `source`, `mainsHz`, `denoise`, `speech`).
   `cleanVoiceEffects` is a pure monotone table: denoise reductionDb 6 + 14s, sensitivityDb −3 + 6s; speech presence 0.2 + 0.5s, levelDb 3 + 9s, low
   cut 80 Hz, target −20 dBFS, ceiling −1 dBFS; hum removal only when `mainsHz` is given (measure_voice found hum), 4 harmonics, 6 above strength
   0.75. It replaces the clip's cleanup effects and keeps other effects; strength 0 removes them. `update_audio_effect` fine-tunes afterwards.
8. **Inspector block «ניקוי קול»** (`VoiceCleanBlock.tsx`, top of the sound-effects block): «נקה את הקול» measures and commits the candidates as one
   commit; one strength slider re-commits without measuring again; «הסר ניקוי» commits strength 0; ▶ «לפני» and ▶ «אחרי» play from a scratch copy of
   the document. A steady badge says nobody has listened.
9. **Determinism rules** (`determinism.test.ts`, ADR-0010 D6): no `Math.random`, `Date`, `performance` or `crypto` in `audiofx/`; transcendental
   `Math.*` and non-literal powers only in `design.ts` and `tables.ts` (once per instance); sums in a fixed order relative to the frame, never by ring
   slot. `golden.json` holds a SHA-256 per `type@version` on the fixed fixture; it has the keys `cleanup.dehum@1`, `cleanup.denoise@1` and
   `cleanup.speech@1` next to the nine older ones.

## Where the build differs from the plan
- Denoise look-ahead is registered as 50 ms (the kernel's own is 26.6 ms at 48 kHz); the plan said about 27 ms. The hop is N/4; the N/2 fallback was
  not needed or used.
- The block is its own file (`VoiceCleanBlock.tsx`) mounted at the top of `AudioFxBlock`, as planned; its before/after audition uses a scratch
  document, not a stored state.
- Declick, de-esser, compressor, follow-mode noise, loudness across clips and a worker host for the preview DSP are wave 2.

## Consequences / what is not promised
- Everything is "implemented, not qualified" until the owner listens (ADR-0010). The catalogue limits text says "not yet listened to by the owner".
- Cleanup effects count toward the clip's effect limit and are refused, like every sound effect, on a sound that keeps its pitch at another speed or
  changes speed gradually (`incompatible`).
- Noise reduction can make some noise sound different rather than gone; hum removal only handles steady mains hum.
- Cost: the denoise and speech kernels are heavier than the older effects; they are measured by the voicefx proofs, not gated here.
