# ADR-0018: Long video to shorts — extra sequences, an explained relative score, one reframe owner (no model)

Status: **Accepted — built and verified (see PROGRESS)** (2026-11-18) for wave 1. Built on shared contracts by
three workers, each reviewed and repaired, merged.
Nothing here is judged on real footage: the proof's fixture is synthetic (a 240 s source with planted
statements, pauses and cuts).

## Context
- The market survey lists "long video to shorts" as missing. The editor held one sequence per project; every
  route read the main one.
- Every picture comes from `evaluate` + `drawGraph` (ADR-0005); every persistent edit is a registered op
  applied through `Store.commit` (ADR-0004); times are exact (ADR-0003);
  actor and scopes come from the credential (ADR-0002).
- Two designs and a judge (read-only workflow, 2026-11-17, `.artifacts/shorts-plan.md`) chose design A
  (measured provenance can only be written by an internal op;
  each shot is its own clip; joins never read removed audio) with grafts from design B (a projection, an
explained score, sentence rules, agent range snapping).
- The plan file has no verifier section; the lead's wave-4 decisions (`.artifacts/wave4-decisions.md`) and the
  contracts report settle what the plan left open.

## Decision
1. **Every short is its own sequence.** `Sequence` gains optional `format` and `origin`; ops `add_sequence`,
   `update_sequence`, `remove_sequence`; `add_marker` takes a `sequenceId`;
   `sequence` joins the entity kinds, so undo through `restore_entities` is exact. At most 64 sequences per
project (`MAX_SEQUENCES`). One frame rate per project.
   Setting a format on the main sequence is refused.
2. **One render path.** Routes reach a short only through core `projectSequence` / `projectOutput`: the
   sequence alone, made the main one, with its own frame, fit, loudness and markers.
   Preview, `/frame`, PNG and MP4 export, browser export, preflight, captions, loudness, batch and MCP all
read that projection; no renderer change.
   The editor's active sequence also works by projection (`state.doc = projectSequence(rawDoc,
activeSequenceId)`).
3. **Schema version 3 with an identity `MIGRATIONS[2]`**, owned by this track and shared by ADR-0019 and
   ADR-0020 (one bump for wave 4). Replay-tested over fuzz op logs stored at v2.
   Older builds refuse a v3 document; the owner updates by `git pull`.
4. **`replace_clip_keyframes`** (bulk keys on one property; ADR-0019 adds its range form) and the internal
   **`apply_sequence_plan`**.
   Measured origin is written only by the internal op, and only onto sequences that op created;
`removeSequenceIds` is limited to sequences whose origin is a short.
   Propose mode is refused (403): a proposal runs without internal ops.
5. **Stricter undo, project-wide.** An undo that would remove a track holding clips added later is refused
   with `undo_conflict` instead of silently deleting them.
6. **Finding candidates is model-free** (measurement kind `shorts-candidates`, analysis job): statements from
   the transcript (or speech blocks between silences when there is none),
   a 100 ms audio feature pass (RMS in dBFS, labelled "not LUFS"; flatness; spectral flux) cached by content
hash, scene cuts, fillers.
   The score is a **relative percentile within this one video**, weighted: complete 25, opening 20, voice 15,
pace 10, moments 10, picture 5, clean 15 (`SCORE_WEIGHTS`);
   missing inputs are dropped and the weights rescaled with a `missing_input` reason. Each reason carries its
measured value and a verbatim quote.
   The UI shows the rank, the explanation and «ציון יחסי בתוך הסרטון הזה (היוריסטיקה)»; never "viral", never a
prediction (SPEC.md:624); a strings test forbids those words.
7. **Making shorts.** Picks snap outward to word edges (phrase edges when timing is approximate); `exact`
   refuses off a word boundary. Optional pause and filler tightening is skipped when it would put
   two picture cuts closer than the flash gap (ADR-0009). Durations are whole frames outward; 10 ms fades only
at removal joins; transcript captions with a caption look; optional verbatim title;
   per-short loudness. Caps: 10 shorts per apply, 40 pieces per short, 2000 ops per apply. One apply is one
undo step.
8. **Reframe has one owner** (`planReframe`): motion lives only as linear x keys on clips inside the short's
   own sequence, simplified to at most 2000 keys. Sources: a picked motion track (ADR-0015),
   the centre, or a blurred backdrop. Faces (ADR-0017 wave 1b) would enter as a sample source;
`VariantOverride.keyframes` is not added.
9. **Privacy regions of the source follow into each short** (found in review; they had been dropped).
10. **Default frame** 1080×1920 for 1080p sources, with the honest "upscaled" preflight warning (skipped for
    any clip with a strong blur, so the backdrop does not trigger it).
    Platform presets: every field is null and shown «לא אומת» until a dated source is recorded for it.

## Consequences / what is not promised
- Browser export of a linked-format view renders the variant it shows ("export what you view"), not the
  master. The browser export refuses sidecar subtitles (422 `unsupported_in_browser_export`); use the server
  export.
- Older builds cannot open a v3 document; the render cache was emptied once by the bump (its fingerprint
  carries the schema version).
- No model chooses by meaning. Choosing "what is good" is a labelled heuristic; the Hebrew words of the panel
  are unreviewed.

## Verified / not verified
- Verified here (one run each, this CPU): `pnpm proof:shorts` 48/48; editor interactions 56/56 (new: keyboard
  focus on the new short's tab and back to the main tab); Phase 0 55, Phase 12 20, browser export 26, life
  line 17,
  test-id inventory 0 lost, accessibility 0 findings, 3876 unit tests (PROGRESS checkpoint 19b).
- Product faults found by review and the wiring, fixed: privacy regions dropped from shorts; the export sheet
  exported the main edit instead of the active short; sequence-tab arrows counted from the wrong tab; tabs
  without `aria-controls`.
- Not verified: real footage; anyone reading the candidates or the Hebrew wording; platform presets (null by
  design); face-driven reframe and the tracking camera follow (wave 2).
