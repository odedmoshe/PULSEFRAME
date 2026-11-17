/**
 * `pnpm proof:music` — built-in music (ADR-0022) through the real server, on a CPU. Evidence: docs/evidence/music-proof.json;
 * a 16-bar render of every style is written to .artifacts/music-audition/ for the owner to listen to.
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence path are fixed; the proof is W3's. Until it is written this
 * exits 2 = blocked, and proves nothing.
 *
 * What the checks must be able to fail for (the verifier's corrections win over the plan):
 * - P6: in the document the music clip starts at the template start and ends no later than the last picture and at most one
 *   frame before it; the plan has no fit_music when the slots end on a bar line; a WAV export (not AAC) of a project holding only
 *   that template with its sound effects muted, cross-correlated with renderMusic(style, N, seed): best lag = clip start in
 *   samples ± 1, normalised peak ≥ 0.99; the last 10 ms below −60 dBFS; control: the clip moved by one frame fails the check;
 * - P7: POST /music: size 44 + 16·N·samplesPerBeat; the second identical request is deduplicated; one undo removes asset,
 *   analysis and clip; analysing the beats of the built-in asset is refused (409 known_by_construction) and leaves beats and
 *   sections unchanged;
 * - P8: ebur128 of each style recorded (target −16 ± 2 LUFS, reported, not gated);
 * - P9: detectBeatsOfFile on the blob directly, nothing committed; F1 against the known grid recorded and labelled
 *   'synthesised music with exact ground truth; not recordings';
 * - every style still carries review 'unheard'.
 */
console.error('proof:music is not built yet (built-in music, ADR-0022): the contracts are in place and the proof is W3\'s. Nothing was checked.');
process.exit(2);
