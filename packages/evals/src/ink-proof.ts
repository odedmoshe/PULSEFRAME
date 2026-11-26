/**
 * pnpm proof:ink — «ציור חי», the live drawing (wave 8 ink track; .artifacts/wave8/ink-plan.md §5 as corrected by ink-verify.md:
 * I2 cross-host, I8 wiggle, I10 re-open, I14 pressure and I16 byte equality are cut with chalk, pressure, wiggle and the eraser;
 * I17 (after pen-up) is added from C2). LEAD: the entry point and the list of checks, numbered as in the plan. Built in parts:
 * ink-proof.core.ts (W1: I1, I3, I12, I13), ink-proof.render.ts (W2: I4–I7, I11) and ink-proof.ui.ts (W3: I9, I15, I17); the integration
 * step imports them here and sets INK_PROOF_BUILT. Until then it runs nothing and exits 2 (blocked), never a pass.
 * Fixtures are SYNTHETIC only, made at proof time: 320×180 30 fps clips from ffmpeg lavfi (black, testsrc2, a white disc moving on a
 * linear x), a manual motion track of the disc's known centre (no tracker run), seeded strokes (a crown polyline, a closed circle, a
 * zigzag, a right-to-left handwriting stand-in); under 1 MB, deleted at the end. Nobody here can look: every check is a measurement.
 */
export const INK_PROOF_BUILT = false;
export const INK_CHECKS: Readonly<Record<string, string>> = {
  I1: 'without a drawing nothing changes: SCHEMA_VERSION unchanged, a document without a drawn clip parses deep-equal, baseline:keys --check and the trend baseline show 0 differences; a document with a drawing is refused whole by a build without the kind (unregistered) with "cannot be read by this version" on archive import',
  I3: 'every add_ink / edit_ink refusal fires with its Hebrew and English text at cap + 1 (2 001 points a stroke, 201 strokes, 8 001 points, the document at 24 000), and the cap inputs are accepted',
  I4: 'draw-on: a straight marker line on black at play drawn (1×) and all; on 30 frames each the farthest lit pixel along the line is within 1 px of inkStrokeProgress\'s position',
  I5: 'for each brush (3) and 3 frames, the paused editor preview equals the server still byte for byte; an exported H.264 frame is at or above 36 dB against the compositor frame (the parity precedent)',
  I6: '60 frames rendered in shuffled order equal the same frames rendered in sequence',
  I7: 'follow: the drawing set to follow the disc\'s manual track; at 10 frames the centre of its rendered ink box is within 1 px of the track plus the offset; at the frame where it was attached it has not moved',
  I9: 'editor: 5 strokes by synthetic pointer events, 2 removed with Ctrl+Z inside the mode (the project undo untouched), «סיום» → exactly one new revision with op add_ink and 3 strokes; Ctrl+Z then restores the previous document hash; Escape after drawing asks first and confirming adds no revision; [ ] D and Space inside the mode change nothing on the timeline',
  I11: 'split a drawing at frame 20: both halves render byte-equal to the unsplit clip at the same timeline frames; trim-start by 7 frames the same',
  I12: 'agent: add_ink over MCP with arrays is stored; get_timeline shows the summary (counts and box) and no packed string; a propose credential gets a proposal; an observe credential is refused; no REST ink route exists',
  I13: 'at the caps the document\'s packed points are exactly 192 000 characters (8 a point); bench:commit records a row "1000 clips + 24 000 ink points" (one sample, not gated)',
  I15: 'the panel shows «לא נבדק בעין»; in Hebrew the toolbar runs right to left and the strokes are not mirrored; audit:a11y states ink-mode, ink-discard-confirm in he and en',
  I17: 'after pen-up the wet canvas is empty and the stage shows every session stroke (the ghost with play all, C2) equal to the still of the ghost document',
};

if (!INK_PROOF_BUILT) {
  console.error(`ink-proof: not built yet; ${Object.keys(INK_CHECKS).length} checks pending (${Object.keys(INK_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
