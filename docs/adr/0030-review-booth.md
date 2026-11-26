# ADR-0030: «תא הבדיקה» — the owner's review booth and the laptop self-check (wave 8, track booth, version 1)

Status: **Accepted (lead, 2026-11-26)** — three builders on the pre-pass's contracts, integrated and merged. `pnpm proof:booth`: 13 pass,
1 blocked (B13: headless Chromium here has no WebGPU, so the picture cards show «דורש כרטיס מסך» and the export strip never ran against a
graphics card), one run (`docs/evidence/booth-proof.json`). Not run anywhere: a hardware GPU, a microphone, Windows, a real pasted
report through `pnpm booth:ingest`. A status the booth records is the owner's statement on their machine
(`owner-reviewed (their machine, <date>, adapter <x>, build <y>)`), never "verified".

## Context
Much of what the product makes has never been heard or seen by a person: the six built-in music styles (labelled «עוד לא הושמעה לאף
אחד»), the 80 SFX, the GPU transitions and effects (WebGPU on the owner's laptop is confirmed only on Intel integrated graphics; the
export worker's GPU adapter was never checked by eye), and the microphone path of «ספרו מה היה». The owner said the project feels stuck.
QUICKSTART asked them to copy-paste four separate steps (gpu.html, probe:gpu, ffmpeg, the speech engines) to tell us what their machine
has. The booth puts those steps and the listening/looking into one dialog of the editor, and gives back one report they paste to us.
Plan: `.artifacts/wave8/booth-plan.md`; corrections that win: `booth-verify.md`; decisions: `decisions.md` "booth".

## Decisions
1. **Machine state, not project state.** Answers live in `<dataDir>/owner-review.json` (mode 0600, written tmp-then-rename, one row
   per item, the latest answer). Never in a project, an archive or a backup (`NEVER_BACKED_UP`). The "every edit is an op" invariant
   does not apply: nothing in a project changes.
2. **Owner's own session only, every route, GET included** (L5). `boothOwner(need(c,'observe'))` is the first line of every
   handler: agents, observer and propose grants get 403 `owner_required` before the item id or the body is read. No MCP tool. The phone
   drop's own listener has no booth path.
3. **The booth changes no product label** (C1, L3, L4). An answer is the owner's statement about this machine. The lead reads the
   report and, per style, sets `review: 'heard'` (a core type value) or `'approved'` in code, for every surface at once.
   `music-kits-heard.json` and its route stay as they are (C2); only the gendered Hebrew of its label was reworded.
4. **Version 1 is the first sitting of 14 cards**: the 7 GPU transitions new in wave 6 (each drawn by this browser, plus one export
   strip «כך זה ייצא» of 7 mid-transition stills from the export's own worker), the 6 music styles at 8 bars seed 1 (the bytes
   `music.golden.json` pins), and a 5-second microphone take. The first screen says «חלק ראשון: 0 מתוך 14», never a larger total.
   Order (L1): transitions first only when the browser row is `ok` on a discrete adapter; else music → mic → the Windows graphics
   step (not tried by anyone) → transitions.
5. **The self-check has 13 rows**, each an allow-listed scalar row (`BoothCheckRowSchema`: booleans, enums, integers, version-like
   ASCII) with a reason code that selects words from the dictionary; no server text, path, user, host or address reaches a row. Three
   rows are heavy (export-gpu: up to three browser launches; speech and search: a Python probe and model hashing) and run only from
   their own button with «עשוי לקחת עד שתי דקות; ייתכן שחלון יופיע לרגע», and are `skipped` (409 `booth_busy` for the strip) while an
   export, still, transcription, narration, scan, capability, proposal, tracking or stabilise job is queued or running.
6. **Recipes.** Each item has `recipe` = sha256 of the canonical definition that makes it; a changed recipe, a changed served sound
   (`played`, audio) or — for pictures only — another adapter (browser or export) marks the answer `changed` and asks again
   («נבדק על כרטיס מסך אחר — בדקו כאן» for an adapter, never «השתנה מאז»). The browser passes its adapters on GET /booth.
7. **Flash.** A light-changing picture starts as a still and plays once through the dialog's ONE FlashGuard; under reduced motion it
   shows three stills and draws no animation frame.
8. **The report** (one language for the human part, then the machine block): counts of the first sitting; the «לא טוב» list (a bad
   answer whose item changed since is listed too, marked with why); the microphone numbers; the self-check rows in words. The machine
   block is ASCII-only JSON (ids, codes, hashes, versions, adapters, dates not times, the mic numbers; no Hebrew, no notes, no names),
   cut into lines of ≤ 64 with no spaces, followed by a `sha256:` line of its own text: `parseBoothBlock` refuses a bidi mark
   (`not_ascii`) or one changed character (`checksum`) and accepts a pure re-wrap. `pnpm booth:ingest` writes
   `docs/evidence/owner-review/<date>.json` with no notes.
9. **Privacy of notes.** The note is scrubbed on the SERVER at PUT, before it is stored: this machine's user name, home folder, host
   name, data folder and library folder literally (case-insensitive, both slash directions), then Windows paths to the end of the line
   segment (spaces included, so `C:\Users\x\OneDrive - <family>\…` goes whole), UNC, POSIX, `~`, e-mail, URL, IPv4/IPv6, file names
   with media/document endings, and runs of 7+ digits. People-sheet names are counted, not replaced (L2): the dialog warns. The dialog
   says, next to the note field and above «העתקת הדוח», that notes are the owner's own words, copied as written, and asks them not to
   write names, dates or addresses there. The microphone take never leaves the card's memory; only the peak (dBFS) and the clipped-
   sample count go with the answer.
10. **Build identity**: `.git/HEAD` and its ref file read without exec (else `unknown`), plus the web bundle's digest.
11. **Starting**: `start-pulseframe.cmd` sets `PF_OPEN_BROWSER=1`, which opens the owner link in the default browser after the server
    listens (an argument array, no shell string; failure printed, never fatal).

## What the scrub does not catch (pinned in `packages/core/src/booth/scrub.test.ts`)
Names written as plain words (counted for the warning, not removed); folder words with no slash and no file ending; street addresses;
dotted birth dates such as 3.4.2019; the words after the first space of a POSIX path; user names shorter than 2 characters. It
over-scrubs a Windows path to the end of its line. Hence the dialog's sentence (decision 9) and: notes never enter the machine block.

## What is not built (version 1)
Everything behind «עוד» is listed with counts but has no sitting of its own beyond reusing the cards: the 11 SFX that packs and templates
place by themselves, the other 69 SFX, the other 39 GPU transitions, the GPU effects that show something on a still. Not built at
all: the kit card (the kit is one self-check row), the phone-drop task card, phrase and age-word cards, per-card export stills and any
difference number, the music-bytes row, machine-local labels on any surface, the verdict `heard`.

## What is not known
Nothing of this has run on the owner's Windows machine, on a hardware GPU or with a microphone. In the build container (no GPU, no
microphone, headless Chromium) the picture cards and the export strip can only show their honest unavailable states and the mic row its
permission state; the real export-still PNG was never produced on hardware; `navigator.permissions.query({name:'microphone'})` in the
owner's Chrome, the strings Python prints on Windows, `PF_OPEN_BROWSER` on Windows and every timing on the laptop are unknown. The
`discrete` flag of the browser row is a vendor-name heuristic (an AMD integrated chip reads as discrete); no wording relies on it
beyond the order of the sitting.

## Recipe-hash limits (L6, accepted)
A GPU transition's recipe covers the kernel name and its variant numbers, not the WGSL body (the engine does not export it), nor the JS
`params` functions and shared helpers (`gpu.ts` `transitionUniforms`): an edit inside a kernel body or its uniforms is not detected, and
the owner is not asked again. SFX recipes hold the ffmpeg version line: the laptop's bytes differ from this container's (lavfi DSP and
noise depend on the build) and that is not a regression. Music recipes rest on `music.golden.json`.

## The status word for the docs
`owner-reviewed (their machine, <date>, adapter <x>, build <y>)` — defined once in docs/CAPABILITIES.md. It is the owner's statement
about what they heard or saw on their machine on that date, with that adapter and that build; it is never "verified", never "good",
and it says nothing about another machine. A changed recipe makes the word stale.
