# ADR-0009: Flash safety — a schedule for the strobe, a guard for the screen, and a check of the rendered result

Status: **accepted** (2026-11-17). Steps 1–3 built and tested. Step 4 is built for both export routes: every multi-frame server export runs the check on the frames it encodes, records `photosensitivity` in the job output, and the Deliver tab lists failing stretches with jump-to (Phase 4 proof); the browser export runs the same analyser on every frame it hands its encoder and sends the result with its completion, which the server validates and records with its own method text (browser-export proof: a 5-per-second flashing timeline gives the same stretch on both routes). Not built yet: the on-demand "check flashing" job and a preflight warning. Amended by ADR-0012 (light transitions join the schedule of decision 1).

## Context (measured, with where each fact comes from)
- Flashing faster than three times a second can trigger seizures in people with photosensitive epilepsy. The guidelines
  used here are the general-flash and red-flash thresholds of WCAG 2.3.1, which follow the ITU-R BT.1702 / Harding family:
  more than three flashes in any one second, over more than a quarter of a 10-degree visual field (341 × 256 pixels on a
  1024 × 768 screen: a third of the width and height), where a flash is a pair of opposing changes of at least a tenth of
  the luminance range with the darker state below 0.8, or a pair of changes involving a saturated red.
- The strobe effect (`light.strobe`) carried a rule "never more than three flashes a second" from 18k on. An independent
  review in 18m found it held for one strobe but not for two: two steady strobes at 3 and 2.5 a second on one title
  started six flashes in a second (`packages/engine/src/strobe.test.ts`, "reported: two steady strobes …").
- Skeptics then found three more ways around it (18m): the preview moving through the timeline faster than real time
  (shuttle 2×–8× showed 6–12 starts a second, `flashGuard.test.ts`); pieces of a cut title with a brighter later piece
  (6 starts a second); and the preview canvas showing half-drawn frames between draws (measured in the editor: 16
  brightness swings in a second at 8× shuttle before the canvas was double-buffered, `gpu-proof.ts`).
- A fourth skeptic measured the other built-ins with the guideline's definitions (synthetic pictures, the real
  evaluator, the shader maths reproduced): flash and dip transitions on short back-to-back clips (up to 30 a second),
  the "flicker" motion preset at its defaults on 50/60 fps projects (5.5), the old-film flicker at full amount (6.5),
  fast wave, glitch and shake (up to 10–21 on high-contrast pictures), a music-following pulse on fast beats (10), the
  beat montage on fast music (5). Some of these depend on the user's pictures; some are the product's own defaults.

## Decision
1. **The strobe, the one effect whose purpose is flashing, has a hard limit for the whole timeline.** No strobe decides
   when it flashes. `packages/engine/src/strobeSchedule.ts` lists, once per document version and sequence, every flash
   any strobe would like to start, moves each to the first frame that shows it, and keeps it only if the last kept start
   of any strobe is at least ⌈fps/3⌉ + 1 frames earlier. The evaluator gives each strobe the seconds since its last kept
   start. Cut pieces flash as one run only with identical settings. This is what stills, exports and agent frames show.
2. **The screen is guarded in real time.** The editor's player passes every frame through `FlashGuard` with the real time
   of drawing: a rise of the strobe light that would begin less than a third of a second after the last one is held back
   until enough time has passed, whatever the transport does (shuttle, stepping, loop, jumps, edits during playback,
   rocking across one flash). Normal-speed playback is unchanged. The preview is drawn off-screen and shown whole, so a
   half-drawn frame never reaches the screen.
3. **Built-ins are safe at their defaults, and safe by construction where that keeps their character.** Done: the
   old-film flicker swing stays under a tenth of the luminance range at any amount and seed; the wave continues the
   picture's edge instead of uncovering dark strips. To do (in the worker branches or next): the flicker and fade-pulse
   presets get periods in seconds, not frames, with defaults that stay at or under three a second at every frame rate;
   the beat montage chooses a beat step that keeps clips at least a third of a second long unless asked otherwise.
4. **Everything else is checked on the rendered result, not forbidden.** Transitions, glitches, fast motion, cuts between
   bright and dark pictures and the user's own footage are creative choices whose risk depends on the pictures. They
   are not limited. Instead, `packages/engine/src/flashAnalysis.ts` analyses rendered frames one at a time (24 × 24 cells
   of mean linear colour; per cell, transitions with hysteresis; a frame fails when more than a quarter of the cells of
   some 10-degree window are flashing more than three times in the second ending there; red flashes likewise) and
   reports failing stretches with their time, rate and share of the frame. Planned wiring: every export runs it on the
   frames it encodes and records the result in the manifest; a "check flashing" job renders the timeline at draft size
   for the same report on demand; the Deliver tab shows the stretches with jump-to, and preflight warns (it does not
   block: the owner decides).
5. **What is not promised.** The check is a guide based on block averages of sRGB pixels, not a certification (a
   broadcaster would still run a certified analyser). Flashes smaller than a cell's share of a window, the "extended
   flashing" rule and viewing conditions are not modelled. Effects added later must either join the strobe schedule (if
   their purpose is flashing) or be safe at their defaults and left to the check.

## Consequences
- With several strobes or fast music some flashes are left out, and a strobe at the top rate can leave another with few
  flashes (measured: 164 against 14 over a minute). The strobe's texts say so.
- The preview at speeds other than 1× shows fewer strobe flashes than the timeline holds.
- Test coverage: `strobe.test.ts` (property tests over random documents with several strobes), `flashGuard.test.ts`
  (simulated transports, property test over random transports), `flashAnalysis.test.ts` (thresholds at 24/30/60 fps,
  area, red, ranges, a property over square waves), GPU proof (an exported file with three strobes; 8× shuttle in the
  editor sampled on every animation frame).

## Amendment (2026-11-18): the screen guard counts what is painted, when it is painted
A stricter shuttle check (8× in the editor, measured on the painted screen) found that the guard of decision 3 could let
four light rises reach the screen within 0.9 s in about one run in eight. Four causes, all fixed in `FlashGuard.paint`
(`packages/engine/src/strobeSchedule.ts`), used by the player and the effect gallery:
1. The guard took the light of the graph it was handed as what was on screen; the compositor can paint less (a GPU pass
   not ready yet, a missing picture). Now the compositor reports what it drew, and the guard records that after the copy.
2. The guard stamped its time before an asynchronous draw. Now: decide before the draw, wait before the copy so that no
   rise is copied less than the gap after the last one reached the screen, record after the copy, and move the stamp to
   the next animation frame (only ever later).
3. It followed only the single strongest light; a strong title strobe could hide the picture's own strobes rising. Now
   every layer's light, combined as the passes combine it, counts as a rise of its own.
4. A weak first step of a rise (below 0.1 of full light) could set the rise's time too early; further steps up within it
   move the time to them.
Checks: `apps/web/src/player.flash.test.ts` (the real Player on a fake clock with slow draws; the recorded failing run
reproduced on the old code), `flashGuard.test.ts` (screen measured as the proof measures it; property tests with draws
that take time); the GPU proof's shuttle check (margin of need, a floor of flashes that grows with the window, replays
through guards with wrong gaps that must be judged unsafe or too close, and a `too-close` verdict: rises closer than the
gap less half a 60 Hz refresh). Verified here: `pnpm proof:gpu` 92/92 twice (shuttle `ok`, closest rises 0.346 s),
`proof:trend-light` 15/15, `proof:creative` 41/41. **Not promised:** the page knows when a frame is copied and when the
next animation frame runs, not when the display shows it; normal-speed playback with varying draw times can show a
scheduled flash up to about 75 ms late; at 120/144 fps on a 60 Hz display a scheduled flash is sometimes held; two
full-frame layers whose lights move in opposite directions can still raise mean brightness without any layer rising.
