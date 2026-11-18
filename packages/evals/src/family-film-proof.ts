/**
 * `pnpm proof:family-film` — the end-to-end proof of the family film maker and measured moments (ADR-0026; the plan's section 10
 * with the verifier's corrected checks, which win), on a CPU, with no model. Evidence: docs/evidence/family-film-proof.json
 * (every measurement, and for each check: passed, failed with its numbers, or 'not run' with the reason).
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence path are fixed; the lead writes the checks after W1 (planner),
 * W2 (moments job and packages/fixtures/src/film.ts) and W3 (UI) have merged, against a server started with startServer on its
 * own port and data directory. Until then this exits 2 = blocked, and proves nothing.
 *
 * Fixtures (film.ts): 640x360 30 fps clips of 12-16 s with a CHROMA-ONLY barcode (equal luma within 2 levels; read with
 * readBarcodeChannel), each with one 6 s truth window (a disc over a static noise texture plus 1 kHz bursts over -40 dBFS noise);
 * a whip-pan decoy at 1200 permille/s or more, a dark stretch, a clip without sound, a static silent clip, a clip active for 80 %
 * of its length, a clip whose picture starts late, one still, container capture times out of name order; a 120 BPM accented loop.
 * Checks the proof must be able to fail for:
 * - F1  each top candidate's peak inside its truth window; the clean stretch covers the window minus 0.4 s at each end;
 * - F2  the decoy and the dark stretch are in no candidate and are gated (the data file's gated series shows it);
 * - F3  sample k decodes to barcode k*S, on the proxy and on the original, also on the clip whose picture starts late;
 * - F4  cancel mid-run: canceled, revision unchanged; a restart completes;
 * - F5  a second run decodes nothing and gives the same data digest;
 * - F6  a full record within MOMENTS_RECORD_BUDGET_BYTES (unit test) and the run record at most FILM.runRecordBytes; median commit
 *       latency before and after attaching 40 assets, reported;
 * - F7  a reason on every pick; the static clip says default middle; the 80 %-active clip says active throughout; capture order
 *       only with life-line's capture times (merged: run it);
 * - F8  apply is one revision;
 * - F9  every exported frame's barcode equals the prediction; each slot's source range contains the detected peak, lies in the
 *       clean stretch and overlaps the truth window by at least 90 % of the slot;
 * - F10 every picture cut is the nearest frame of a bar start or half-bar (this fixture gives bar starts only: said separately);
 *       followedBeats agrees within 1e-6 s;
 * - F11 the title's live fields resolve to the expected Hebrew date from life-line's verified table, and a still of it is
 *       pixel-equal to a plain title with that string;
 * - F12 undo restores the document byte for byte (sha256); redo restores the film;
 * - F13 move one clip and trim another, regenerate at another length: both byte-identical and present; no asset twice; no slot
 *       key twice; every frame of [first slot start, last slot end) has a picture; off-grid cuts only next to kept clips; a kept
 *       clip beyond a shorter target stays; a track gain set by hand survives regeneration;
 * - F14 the export's photosensitivity verdict is pass, with a control that the same analyser fails a hand-built alternation
 *       closer than flashGapFrames;
 * - F15 with music, the 1 kHz band = source -12.0 +- 0.5 dB; without music = source +- 0.5 dB; mute = silence; no loudness target;
 * - F15b 'lead': the music band over a sounding clip = music alone -9 +- 0.5 dB; the level over a still is reported;
 * - F16 an edit-mode agent plans, applies and regenerates over MCP; a propose-mode agent gets 403; an agent without the people
 *       scope is refused a title with {age:…} (403 people_scope_required) and its plan holds no birth date or age;
 * - F17 preview equals export at three sampled frames;
 * - F18 the dialog is driven by keyboard only and the accessibility audit has no findings (Hebrew and English);
 * - F19 after a reload, regenerate from the document's run works.
 * Recorded, not asserted: measurement speed (x real time) on the fixtures and on .artifacts/owner-media/clip1..5.mp4. Real
 * footage stays "unverified" until the owner watches a film made from their own clips. Expected numbers are typed in this
 * file, never computed by the code under test.
 */
console.error('proof:family-film is not built yet (family film maker, ADR-0026): the contracts are in place; the checks are written after the planner, the moments job and the UI have merged. Nothing was checked.');
process.exit(2);
