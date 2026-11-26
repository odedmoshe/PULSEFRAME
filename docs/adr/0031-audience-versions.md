# ADR-0031: «גרסה לכל קהל» — a calm version and a grandparents version projected from the master (wave 8, track audiences, version 1)

Status: **Accepted (lead, 2026-11-26)** — three builders on the pre-pass's contracts, integrated and merged. `pnpm proof:audiences` 13
pass, 0 fail, 0 blocked in one run (`docs/evidence/audiences-proof.json`); phase12 20/20, editor interactions 146/146, accessibility
0 findings with the audience panel in both themes and languages (one sample each, on the integration branch). Nobody has watched or
listened to a version. Not a medical claim. The "sharing" version of the plan is not built (reopened as a later track by the owner's
decisions of 2026-11-26). Known and left: about 15 rows of the stir table are marked "unsure" in the core test and await review by eye.

## Context
Families send the same film to different people. Some viewers are bothered by flashing, shaking and loud music; older viewers want
larger words and quieter music under speech. The project already has linked formats (variants): one master edit projected into other
frames by `projectVariant`, used by the preview, the still route, every export path and preflight (ADR-0005: one projection for every
output). The verifier (audiences-verify.md) found that a profile marker in the data (`applied`) breaks validation, that the size control
in a version multiplied itself, that a hand list of "calm" effects missed items, and that "has ducking means music" misclassifies
family sound tracks. The sharing profile (private marks, covers, a review digest, an export gate) was judged unsafe as planned and cut.

## Decisions
1. A version for an audience is a variant with `audience: { profile: 'calm' | 'grandparents', rules: 1, musicDb?, sound? }`. It uses
   the master frame only (no base format). Three ops: `add_audience_version`, `update_audience_version`, `set_audience_keep`
   (`VariantOverride.keep`, per clip and rule). An audience version and a translation are exclusive.
2. The rules run as the LAST step of `projectVariant` (`applyAudience`, packages/core/src/audience.ts). Every caller projects the stored
   master once; the export retry plans its snapshot as resolved (`Exporter.plan(..., { resolved: true })`). No marker in the data says
   "applied". `applyAudience` never throws; unknown ids are skipped.
3. Picture rules come from flags on the effect and transition registries (`stir` class), deny by default, with a test that fails when a
   registry row has no class. Calm and grandparents both: stirring effects off; every modulator removed (they are beat-only) except on
   an effect that ends up off (nothing moves, no row); stirring transitions become a dissolve with the same frames (`sync` kept); the
   `jitter` text loop removed. No runtime filter of the player (`withoutFlash`) is used.
4. Sizes (grandparents): a size the version sets itself is absolute; only an inherited size is scaled: `max(x, min(cap, x * 4 / 3))`
   (titles cap 0.5, captions cap 0.2; text never shrinks). Captions: at most 26 characters a line, a box when the style has none, the
   classic look — each only where the version's own caption style does not set it. The inspector commits nothing on a mere visit.
5. Sound: a track is music only when every clip on it is library music or a loop, built-in music or fitted music; speech only for a duck
   source or narration; everything else is "other" and unchanged; the owner can correct the role per track. Only music tracks change:
   gain × DB_GAIN[musicDb] (calm −6 dB, grandparents −8 dB by default, clamped to the gain range); grandparents also duck an already
   ducked music track 6 dB deeper (cap 40). Levels are worded relative to the rest of the mix («ביחס לשאר הקול»): with a loudness
   target the export renormalises the whole mix.
6. The change list (`audienceChanges`, REST `GET …/variants/:variantId/audience`, MCP `get_audience_changes`) is built in the same pass
   that projects the version. One row per changed field of one target (per effect instance; per clip for transition, text loop and title
   size; per caption track and style field; per sound track for level and ducking). Each row names its sequence; frames are on that
   sequence's own clock. The wire carries ids, frames, registry ids, sizes and dB only (no words). Fast cuts are listed from the pacing
   report (a heuristic window of 5 s) and never changed.
7. Editor: the «+» menu of the format prism always renders (so the group stays reachable with all four formats); one click = one
   transaction and the viewer switches to the version; a chip glyph per profile; the panel «מה שונה בגרסה הזו» with jump-to (rows of the
   main sequence only; rows of a short are listed with the short's name and no jump), «להשאיר כמו במקור» as one op, sound rows with the
   role and level, the fixed list of what the version does not do; «לשליחה» opens the export sheet with that version's target alone
   chosen (`openExportSheet({ variantId })`). Override counts and the «adjusted» dot ignore keep-only overrides.
8. The product says what the calm version does not do: it does not slow the cutting, it is not a medical or safety claim, keyframed
   brightness and motion are not recognised, and nothing was looked at or listened to.

## Not built
The sharing profile «לשיתוף מחוץ למשפחה» and everything of it (private marks, version covers, loss style, review op and digest, export
gate, name matching, agent redaction). A base format for a version (a 9:16 grandparents version). A speech level control. Command-bar
intents. Jump-to into a short from the panel (the editor views a version only on the main sequence). A slower cut for the calm version.

## Not known
- How any version looks or sounds: nobody has watched or listened; every proof is a measurement of documents, frames or samples.
- Whether the stir classes marked "unsure" in audienceContracts.test.ts (about fifteen effects and transitions, e.g. stylize.grain,
  distort.wave, motion.sway, time.echo, the confetti and hearts overlays, bars and slices) are the right class for real viewers.
- Whether the 5-second pacing window suits the fast-cut list on real footage.
- Whether the flash analysis is right in every case: on the audiences proof's master fixture (one strobe plus a flash transition) it
  reports 14 flashes a second over 0.133–5.8 s, which the lead is investigating separately; the calm version's report on the same
  fixture has no flash stretch (one sample).
- Whether the sound-role heuristic matches real family projects (one synthetic fixture was measured).
