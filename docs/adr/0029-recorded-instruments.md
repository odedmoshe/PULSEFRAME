# ADR-0029: Recorded instruments for the built-in music «כלים מוקלטים»

Status: **Accepted (lead, 2026-11-26); built and integrated on a synthetic test kit; not offered.** Amends ADR-0022 §4. The lead
read the two untrusted-file readers (`sfzPath`, `readWavInfo` / `readFmt`) line by line. Version 1's only real kit
(`kit.calm.vsco@1`, VSCO-2 CE) has no file list and no checksums yet: the owner's computer finished the audio manifest on
2026-11-26 with that git source failed (git's ownership check on the staging folder; a re-run with the newer fetcher was asked
for). Until its files are read there, the kit is `not_calibrated` in the product, offered nowhere, and a recorded request makes
nothing. Nobody here can listen: nothing below says how anything sounds.

## Context
- ADR-0022 §4 defines the built-in music as a synthesiser: "no recordings, no samples" (`MUSIC_GENERATOR`). The owner keeps
  instrument sample sets in their content library (`tools/library/manifests/audio-01.json`; the library ledger, ADR of the library
  track), and asked for some of the style's instruments to be played from them.
- Design `.artifacts/wave7/instruments-plan.md` (its verifier's corrections C1–C16 win); binding decisions and the lead's notes
  `.artifacts/wave7/instruments-decisions.md`. Built by three builders on the pre-pass's contracts (sampler; WAV/SFZ readers, kit
  check and loader; the editor) and integrated.

## Decision
1. **Opt-in per request, all or nothing.** `MusicRequest.instruments?: 'synth' | 'recorded'` (REST `POST …/music`, the preview's
   `?instruments=`, MCP `add_builtin_music`). Absent or `synth` is ADR-0022 byte for byte: the same queue key, file name, params and
   provenance (`music.golden.json`, `music.exact.test.ts`, `music.determinism.test.ts`, proof:music 24/24). `recorded` plays EVERY
   part of the style's kit from the owner's library or is refused before anything is made, with the kit's state and the next step
   (409 `instruments_*`, 404 `instruments_no_kit`); it is never quietly made with the synthesised sound. Templates, family films and
   music fit stay synthesised; fitting a recorded track is refused (`instruments_not_fittable`).
2. **One kit in version 1:** `kit.calm.vsco@1` for «רגוע ונעים» — pad and double from a sustained strings instrument, arp and lead
   from a piano instrument, both from VSCO-2 CE (CC0, git item pinned to one commit); bass and drums stay synthesised. Cut: the stored
   A/B verdict, round-robin, the cinematic and lofi kits, SF2, the Salamander piano (its licence has no row in the fail-closed table and
   its archive no fetch path: lead question L-1), and any cross-render cache of decoded samples.
3. **The kit table is the authority for the files** (core `musicKits.ts`): per instrument the ledger item and commit, the `.sfz` entry
   and every file with its size and sha256, read on the owner's computer from a tree the download tool has just verified against the
   ledger. A kit with no files is `not_calibrated`. The bank hash is a function of the kit table only (`kitBankInput`).
4. **Order of a recorded render** (`instruments/bank.ts`, `music.ts`): outside the queue turn — the kit, the ledger through
   `LibraryService.ledgerEntries`, every source's duties from core `licenceDuties`, every file opened through the library's
   `openInside` (realpath containment), hashed (cached by path, size and mtime) and compared with the table; inside the turn — every
   file re-stated, the SFZ parsed, the sampler's `planZones` asked which frames each zone needs (a note too far from any recording
   refuses `instruments_range`), only those frames decoded (over 96 MB refuses `instruments_too_large`), then `renderMusic` with the
   bank and the kit it was loaded from. Then validated and stored as today.
5. **Untrusted files.** `wav.ts` and `sfz.ts` are pure readers that throw only `InstrumentError`: every read is bounded by the bytes
   in hand and the RIFF and file sizes, chunk counts are bounded, formats, channels, rates, bit depths, block sizes are checked; SFZ
   paths fold backslashes and refuse absolute paths, drive colons, control characters and empty, `.` and `..` segments; includes and
   defines are bounded. Fuzzed with 5,000 WAV and 5,000 SFZ mutations (I19).
6. **Licences fail closed and the duties follow the file.** Share-alike, no-derivatives and unknown licences refuse the whole kit
   before a sample is opened (mixing samples into a piece makes a derivative). Every library source becomes one `LibraryRecord` in the
   optional schema field `Asset.provenance.instruments` (no schema version bump): credit lines in the video description, the
   non-commercial line and export warning, and the archive rule apply when any record carries them (the union).
7. **A recorded track says so.** `MUSIC_RECORDED_GENERATOR`, `provenance.instruments { kitId, kitVersion, sampler, bank, records }`,
   the name `"<style> · <bars> bars · recorded instruments.wav"`; validation (`instruments_provenance`) refuses any other mix.
8. **Unheard until the owner says otherwise.** Every label says nobody has listened; the owner's «שמעתי» mark is the owner's own
   session only (403 `owner_required` for agents, observers and the phone drop; no MCP tool), stored in `<dataDir>/music-kits-heard.json`
   (0600, atomic), never in a project. No string praises a sound (core `INSTRUMENTS_FORBIDDEN_WORDS`, tested over every instruments
   string). The blind pair plays both versions at a matched level: the server sends `x-pf-level-scale` (RMS, ≤ 1) and the page sets the
   player's volume; no sample is scaled and nothing about the choice is stored.
9. **Memory, one render at a time** (the existing queue): decoded zones ≤ 96 MB, kernel tables 1 MB, scratch 3 MB; nothing decoded is
   kept between renders (I13 measures what remains after a full garbage collection).
10. No new op, no engine change, no dependency; both assistant prompt digests unchanged.
11. **Edge notes (lead, 2026-11-26).** A kit part may set `edge` (whole semitones 0..12, absent = 0). A note that no region of the
    instrument matches by key is played by the regions of the nearest key that does match, at most `edge` semitones away (lower key
    first on a tie, never a keyswitch key), pitch-shifted to the note; the ratio limit and every other rule still apply, and beyond
    `edge` the request is refused (`instruments_range`). `planZones` and `renderSampled` select through the same `noteRegions`.
    `kitBankInput` carries the value only when > 0, so kits without it keep their bank. Why: the overview read on the owner's computer
    (`tools/library/kit-inventory.mjs`) showed that no sustained-strings instrument of VSCO-2 CE covers what the calm style plays
    (pad 47..78 and double 69..88 over 200 seed and length combinations here; viola ensemble keys 48..86, cello 36..77, violin 55..86),
    so `kit.calm.vsco` sets `edge: 2` on pad and double. A region with keytrack 0 gives the substitute key's bytes, not the note's pitch.

## Consequences
- Integration found and fixed two defects, each pinned by a test that failed first: the renderer compared a bank only with the style's
  kit in `MUSIC_KITS`, so a kit the request path had checked (any kit outside that table, here the synthetic test kit) could not be
  rendered (`RenderOptions.kit`, `apps/server/src/instruments/integration.test.ts`); and `makeMusic` checked, hashed and wrote a long
  finished track in one synchronous stretch (about 80–130 ms for 128 s under load), now with a turn of the event loop between them
  and an asynchronous write (bytes unchanged; same test file).
- The partial decode (only the planned frames) gives the same bytes as the same samples decoded whole (I15, integration test).
- Measured here on the synthetic kit only (one sample each, on a shared 4-CPU machine): a 128 s recorded render of a 73 MiB synthetic
  kit about 30× real time, event-loop max under 100 ms after the fix, a peak of tens of MB. Nothing is known about the real set's sizes
  or speed until the laptop steps.

- Final regression of wave 7 (2026-11-26, merged tree, quiet machine, one sample each): `proof:instruments` 22/22 on the synthetic
  kit, `proof:music` 24/24, `proof:musicfit` 23/23; M10 alone 4,215 ms and 3,476 ms with event-loop delays 28.5 and 25.3 ms.
- Open: the start of a recorded request still holds the event loop 60–80 ms at idle (I13 passed at 88.7 ms against its 100 ms
  bound once); the 96 MB refusal was exercised only with a lowered bound.

## Not built / not known
- 2026-11-26: the upright piano's 70 files (`UprightPiano.sfz`, 253,644,252 bytes, table digest f002db28…d4a0, recomputed here from the
  lines the owner's computer printed) are in the kit table (`packages/core/src/musicKits.vsco.ts`). The overview of the 50 piano, harp
  and strings instruments read there showed no missing file, no path leaving the item and no `..` segment, so `sfzPath` needs no
  change for them. The strings instrument (the lead chose `ViolaEnsSusVib.sfz`) is not read yet: the kit stays `not_calibrated`.
- The real kit's files, checksums, gains (−18 dB placeholder) and whether its `.sfz` files use `..\Samples\…` paths, which `sfzPath`
  refuses today (a decision for then: containment after normalising, still inside the item).
- How any of it sounds; whether the sustains are long enough for the pads; L2–L5 on the owner's laptop.
- Whether the recorded sound should become the default after the owner listens (the owner decides; synth stays the default).
