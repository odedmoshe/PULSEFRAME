# ADR-0011: Time effects, overlays and beat modulation through the one rendering path

Status: **accepted** (2026-11-17) for wave 1. Wave 1 is merged (PROGRESS checkpoint 18o): the shared contracts and all three workers landed together, and the time, overlay and GPU proofs pass on the merged head.

## Context
- The market survey (docs/MARKET_RESEARCH.md §1–2) lists effects this editor lacked: echo trails and motion blur (they need the clip at other times than the frame drawn), particle overlays, a dated digicam look, CRT, velocity-style whip transitions, effects that pulse with the music.
- Every effect is a pure function of (document, time) through `evaluate` + `drawGraph` (ADR-0005); per-pixel maths is one WGSL pass with no CPU twin (ADR-0008); nothing may flash (ADR-0009).
- Two independent designs and a judge (read-only workflow, 2026-11-17) chose design A (engine-true and stateless: time effects draw the same clip at several exact earlier source times; overlays are seeded and computed in closed form per frame; modulation is default-deny) with grafts from design B.

## Decision (rules this wave keeps)
**One path (ADR-0005).** Every new picture comes from `evaluate` plus `drawGraph`, the same pair used by:
- the player (`player.ts:118-119`);
- the render worker (`render.ts:28-29`);
- browser export (`browserExport.ts:297`);
- the gallery (`EffectGallery.tsx:197`);
- the Lab (`lab.ts:196`).

There is no second renderer.

**Ops (ADR-0004).**
- Every new persistent state is a field on an effect instance inside a clip. That covers new effect ids and params, the effect's position in the list, and `modulate`.
- Every change goes through registered ops: `add_effect` and `update_effect` (`ops.ts:1876-1915`) and the new `set_effect_modulator`.
- These ops touch only clip entities, so undo through `restore_entities` (`ops.ts:1250-1262`) is an exact inverse by construction.
- REST and MCP pick the new op up from the registry automatically.

**Exact time (ADR-0003).**
- Stored windows are whole frames (`delay`, `lag`, `hold`) or whole degrees (`angle`).
- Tap times are rationals built from `T.frameTime`/`T.rt` (`packages/time/src/index.ts:36`, `:97`).
- Floats are render quantities only, as in `beatgrid.ts:14`.

**Determinism and seeking.**
- No pixel or state carries from one frame to the next.
- Caches hold pure functions of their keys only: the beat-step list is a WeakMap per document, like `strobeSchedule.ts:39`; sprite caches are keyed by radius bucket.
- So a random seek equals sequential playback (`SPEC.md:315-316`, `:1163`).

**ADR-0008.**
- Drawing, layering and the time merges stay in Canvas2D/JS (decision 1, `0008:23`).
- The two per-pixel looks (digicam, CRT) and two transition kernels are WGSL only, with no CPU twin (decisions 2 and 5, `:24`, `:27`).
- Without an adapter they are unavailable with a reason: `look.ts:213-216`, `compositor2d.ts:335-336`, `render.ts:30-36`.

**ADR-0009 (flash safety).**
- Anything whose purpose is flashing joins the timeline-wide schedule (decision 5, `0009:49`). Wave 1 adds no such item.
- Every wave-1 item must pass `FlashAnalyser` (`flashAnalysis.ts:106`) on an export of it at its defaults, and also at its extremes where the item has a rate.
- Existing flash and dip transitions stay as they are (decision 4, `:40`) until the owner decides otherwise.
- The gallery's animated tiles go through `FlashGuard`.

**Time effects.**
- A clip carries at most one time effect, and it is first in its effect list.
- The effects after it apply to the merged picture.
- Remap (stutter) changes which picture is shown and never reaches the compositor.

**Beat modulation is default-deny.**
- Only the parameters listed in `MODULATABLE` (geometry and texture) can follow the beat.
- Brightness and colour parameters cannot follow the beat until the light plan exists (wave 2).

## Wave 1 catalogue
| Id | He / En | Family, implementation | Owner | Key proof |
|---|---|---|---|---|
| `time.echo` | הד ושובל / Echo trails | time taps, exact integer merge (`blend`/`trail`/`lighten`) | W1 | on a flat-grey fixture, the still equals `(ΣW_k·g(F−k·d)+2048)>>12` exactly |
| `time.split` | פיצול זמן צבעוני / Time-split RGB | time taps, channel choice | W1 | per-channel barcode reads `(F, F−lag, F−2·lag)` on stills and export, 0 errors |
| `time.shutter` | טשטוש תנועה (צמצם) / Shutter motion blur | sub-frame transform taps, no extra decode (`SPEC.md:317`) | W1 | angle 0 byte-identical to no effect; bar profile matches the model |
| `time.stutter` | קפיצות פריים / Stutter, stop-motion | remap (`steps`/`freeze`; steady or planned beats ≥ 1/3 s apart) | W1 | export barcodes equal `F − F mod hold`, the same with a split |
| `overlay.snow`, `overlay.confetti` (fall, or one burst at the clip start), `overlay.hearts` (beat swell), `overlay.bokeh` | שלג / קונפטי / לבבות / בוקה | Canvas2D, closed-form lattice model | W2 | ≥ 99% of model centres lit; untouched pixels unchanged; continuity across a cut |
| `overlay.speed-lines` | קווי מהירות / Speed lines | Canvas2D, smooth only (`rate` ≤ 2/s) | W2 | wedge angles ±0.5°; FlashAnalyser passes at extremes |
| `stylize.date-stamp` | חותמת תאריך / Date stamp | Canvas2D seven-segment polygons, no font | W2 | segment mask IoU ≥ 0.95 at 16:9 and 9:16 |
| `stylize.digicam` | מצלמה דיגיטלית ישנה / Old digicam (CCD) | WGSL, ≤ 8 numbers, noise tick 15/s | W3 | flat patch within 2/255 of `digicamTone`; noise changes exactly at tick boundaries |
| `stylize.crt` | מסך שפופרת / CRT screen | WGSL, no time input, so no flicker | W3 | mask period = `pitch·H` ±0.1 px; barrel mapping within 1.5 px of `crtMap` |
| `whip-left/right/up/down` | הצלפה / Whip pan | `T2` kernel `whip` | W3 | monotone, repeatable, distinct; mid-frame variance along the move ≥ 4× across it |
| `spin-cw/ccw` | סיבוב מהיר / Spin | `T2` kernel `spin`, mirror-fold edges | W3 | monotone, repeatable, distinct; centre comes from outgoing before p 0.45 and incoming after 0.55 |
| Beat modulation | פעימה על פרמטר / Beat on a parameter | `modulate` on an effect instance, set by the `set_effect_modulator` op | lead (core) + W3 (engine, UI) | value equals `clamp(base + depth·e^(−since·decay))` at hit frames ±1e−9 |

**Fixes riding along:**
- `describeCatalog` implementation;
- `add_effect` wording;
- fuzz ids;
- `FlashGuard` in the gallery hover loop (`EffectGallery.tsx:232`);
- the strobe tile drawn at its first flash (today, frame 12 is 0.4 s after a flash: `EffectGallery.tsx:29`, `gpu.ts:145`).

## Lead decisions on the judge's open questions (2026-11-17)
- Existing flash, dip-black and dip-white transitions are not brought under the strobe schedule (ADR-0009 decision 4 stands); a reduced-flashing export option is a later question for the owner.
- Decoder budgets rise to 10 in the editor and 12 in the render worker and browser export (ADR-0005 amended), because a time effect on a video reads it through extra decode lanes.
- Overlays are attached per clip (no adjustment-clip kind in wave 1).
- Beat modulators default to every second beat; brightness and colour parameters cannot follow the beat in wave 1.
- A clip carries at most one time effect, first in its list; effects after it apply to the merged picture.
- The new GPU passes (digicam, CRT, whip, spin) count as verified only after the owner has run them on the laptop's hardware adapter.
