# ADR-0029 — Recorded instruments for the built-in music (stub)

Status: proposed (wave 7 instruments pre-pass, 2026-11-25). Amends ADR-0022 §4. The number is to be re-checked when the branch merges.

## Context
ADR-0022 §4 defines built-in music as a synthesiser: "no recordings, no samples" (`MUSIC_GENERATOR`). The owner downloaded instrument
sample sets into their library (`tools/library/manifests/audio-01.json`). Design: `.artifacts/wave7/instruments-plan.md`,
binding decisions `.artifacts/wave7/instruments-decisions.md`.

## Decision
- Recorded instruments are OPT-IN per request (`instruments: 'recorded'`); a request without it is ADR-0022 byte for byte.
- All or nothing: every part of the style's kit is played from the owner's library or the request is refused before anything is made,
  with the state and the next step. Never silently synthesised.
- A kit is offered only when every file it uses matches the kit table's sha256 (read on the owner's computer from a tree the download
  tool verified against the ledger) and every library source passes the core licence table. Share-alike, no-derivatives and unknown
  licences refuse the kit; non-commercial sources are carried. A made track carries one library record per source
  (`provenance.instruments.records`): the union of duties (credits, the non-commercial line and export warning, the archive rule).
- A recorded track says so: `MUSIC_RECORDED_GENERATOR`; `MUSIC_GENERATOR` never sits on it.
- Samples stay on the owner's disk: nothing is committed, bundled or put in a shared archive.
- Every kit is unheard until the owner marks it from their own session; no wording claims a recorded kit sounds better.
- Determinism holds as in ADR-0022: integer sample positions, the arithmetic of the render path (test M9 covers `music/sampler.ts`); the
  bank hash depends on the kit table only.

## Consequences
To be completed at integration (measured memory and speed on the laptop, L1–L6).
