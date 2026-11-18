# ADR-0022: Content packs, Hebrew title fonts and built-in original music

Status: **Accepted — built and verified (see PROGRESS)** (2026-11-18) for wave 1. Built by three workers on
shared contracts, each reviewed and repaired, merged.
Nobody has listened to the music or looked at the pack elements on a screen the owner chose; every music style
is labelled unheard.

## Context
- The product shipped no music, yet every music feature assumes a song the user may publish; holiday and
  birthday content was missing; five Hebrew families were all there was for titles.
- Templates are versioned data compiled by a pure planner and applied as one internal op (ADR-0016). Every
  picture comes from `evaluate` (ADR-0005); edits are registered ops (ADR-0004).
- The plan (`.artifacts/content-pack-plan.md`) came back "needs changes"; its Verifier and Corrected notes win
  over its body. Lead decisions: `.artifacts/wave5-decisions.md`.

## Decision
1. **A pack is data** (`packages/core/src/packs/`): templates, elements, looks, caption looks, text styles,
   titles, sound picks, music picks and an occasion. Everything it produces is an ordinary clip made by
   existing ops;
   `packages/engine` is not touched. Wave 1 holds a Hanukkah pack first and a birthday pack; `tpl.birthday`
stays byte-identical and joins by id. A pack is suggested from the event's Hebrew date (ADR-0021);
   the occasion names a holiday family of the life line, so leap years stay the calendar's business.
2. **One title is one `add_text`** (it gained optional `presetId` and `animation`), a look is one
   `add_adjustment`, a caption look one `apply_caption_look`. An element or sound added from a pack is "clip
   undone, asset stays in the library".
   Pack fields are `name`, `name2`, `age`, `night`, `place`, `when`; `{n}` stays the planner's per-slot
counter and is never a pack field. Pack field values are literal; the life line's fields stay live.
3. **Elements are drawn by formula** (SVG, no licence exposure). Hanukkiah, dreidel and candles are in; the
   hexagram is available but never a default. No songs, lyrics or incipits anywhere (a test holds a forbidden
   list).
4. **Built-in music is a deterministic TypeScript synthesiser** (`apps/server/src/music/`, six styles) that
   writes PCM WAV itself, whole bars at allowed tempos that divide 2,880,000 at 48 kHz, so a request of N bars
   has an exact length.
   Its beats, bars and sections are known by construction and attached as analysis with the method recorded;
measuring them answers 409 `known_by_construction`. Internal op `add_builtin_music`.
   A template with built-in music gets a track whose clip never ends after the pictures and at most one frame
before them. Every style carries review "unheard" and the label «מוזיקה מובנית — עוד לא הושמעה לאף אחד».
5. **Title fonts.** Five OFL-1.1 families are pinned (Suez One, David Libre, Amatic SC, Fredoka, Gveret Levin;
   `@fontsource` 5.3.0), their licence text read in each installed package, accepted by the lead under the
   owner's standing direction
   and to be reported to the owner. A row moves into `FONT_CATALOG` only after its glyph test proves it.
**Alef and Varela Round are held:** they declare Reserved Font Names and subsetting counts as a modification,
so a subset served
   under the original name is the owner's licence question. Karantina was already pinned by the interface.
6. **Schema:** optional fields only (procedural params, beat sections, template and element extras); no
   version bump.

## Consequences / what is not promised
- Musical quality is unknown until the owner listens. Cross-machine byte equality of the music is argued from
  IEEE arithmetic and shown only on the build machine.
- The 'holiday' genre and the mounts (pack shelf, font picker, music browser) waited for the UI redesign. An
  agent that calls `add_adjustment` directly still covers a pack's elements (only the pack page uses the
  ordering op).
- Hebrew wording of packs and music is unreviewed (`docs/OWNER_REVIEW.he.md`).

## Verified / not verified
- One run each, this CPU: `pnpm proof:packs` 28/28, `pnpm proof:fonts` 11/11, `pnpm proof:music` 24/24, `pnpm
  check:notices` (11 font families), after the pack, font and music workers' reviews (PROGRESS 19b, 19c).
- Looking at rendered stills found four faults, each fixed with a check: overlapping titles of the birthday
  invite, pack looks blurring a template's own graphics, a wrong candle number drawing, pale candles vanishing
  on light backgrounds.
- Not verified: anyone hearing the music or judging the elements; Chromium text goldens beyond the pinned
  Chromium; the owner's Windows laptop.
