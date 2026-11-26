/**
 * pnpm proof:living — «תמונה חיה» (wave 8 living track; .artifacts/wave8/living-plan.md §5 as corrected by living-verify.md and the
 * lead's decisions: the model end is cut, so checks 8, 10 and the model parts of 11 are gone; check 4 refuses rotation (rotated
 * picture-in-picture is cut); check 12 compares the calm version with the master (stir 'none', C12); new checks C2, C3, C7, C13).
 * LEAD: the entry point and the check list, numbered as in the plan with the verifier's additions as 17–20. Built in parts:
 * living-proof.engine.ts (W2: 1–7, 9, 12, 17, 19) and living-proof.ui.ts (W3: 14–16, 18 in the editor), and the core/server rows
 * (W1: 11, 13, 20); the integration step imports them here and sets LIVING_PROOF_BUILT.
 * Runs on the SOFTWARE WebGPU adapter of headless Chromium (--enable-unsafe-webgpu), at 640×360, needs `pnpm build`; exits 2 (blocked)
 * when the browser gives no adapter, exactly as gpu-proof.ts does, and until it is built — never a pass.
 * Fixtures are SYNTHETIC only, made at proof time with ffmpeg from raw bytes and deleted at the end (under 1 MB): the coordinate photo
 * 640×360 PNG (R = x mod 256, G = y mod 256, B = 64·⌊x/256⌋; pixels within 2 px of a wrap column are skipped), a hand disc depth
 * (base flat, one near dab of size 300) and a ramp depth (horizon 400); a 640×360, 30 fps project with the photo on 3 s (90 frames).
 * Nobody here can look: every check is a measurement against core and the JS model (livingModel), none says how anything looks.
 */
export const LIVING_PROOF_BUILT = false;
export const LIVING_CHECKS: Readonly<Record<string, string>> = {
  1: 'slide, amount 1, the still at the last frame: pixels well outside the disc decode to source x shifted by the amount for m = −f, well inside by m = 1 − f, each within 1 px of livingModel',
  2: '300 random pixels of a still at travel 0.5 decode to livingModel\'s source within 1 px, skipping pixels within ⌈A⌉+2 px of a depth edge (C14 e); for the ramp, each row\'s shift is proportional to (y − h)/(1 − h) within 1 px',
  3: 'the band beside the disc\'s trailing edge is at most ⌈A⌉ + 2 px wide, every band pixel decodes to a source outside the disc (the far side), and no pixel inside the picture is transparent',
  4: 'a rotated photo (rotation 10°): set_living_picture refuses living_rotated; a living picture rotated afterwards is reported unavailable (preview notice, still refused naming the clip), never drawn flat',
  5: 'the effect disabled: the still equals the still without the effect byte for byte',
  6: 'the paused editor preview equals render_frame byte for byte at frames 0, 45 and 89 (gpu-proof.ts method)',
  7: 'export (MP4): the disc\'s decoded centre at frames 0, 22, 45, 67, 89 follows the ease-in-out keys within 1.5 px; every exported frame within 36 dB PSNR of its still',
  9: 'the page\'s depthGrid digest equals Node\'s for the hand disc and the ramp',
  11: 'an agent token: set_clip_depth and set_living_picture work as ordinary edits (hand depth is document data, LD4); render_frame shows the moved disc; add_effect depth.living is refused living_use_op',
  12: 'the calm audience version: the still at frame 89 equals the master\'s (stir none, C12)',
  13: 'set_living_picture on a 2-second clip at amount 1 → living_too_fast with max = livingMaxAmount; update_effect raising the amount past it is refused; keys made faster by replace_effect_keyframes → preflight living_too_fast with the clip id',
  14: 'PF_RENDER_GPU=off: the still is refused with the GPU reason; the block shows «דורש כרטיס מסך» (living-gpu-note)',
  15: 'editor, keyboard only: select the photo, the Motion tab, «הפכו לתמונה חיה» (Enter) opens the depth dialog with the ramp, «שמירה» commits ONE set_living_picture carrying the depth (C13), arrow to «גלישה הצידה»; the preview differs between frames 0 and 89; one Ctrl+Z restores the clip exactly (entity diff empty)',
  16: 'the dialog: open, move the horizon with the arrow keys, one pointer stroke «קרוב», «שמירה» = exactly one set_clip_depth in history; Escape on a second open saves nothing and returns focus to living-depth-open',
  17: 'C2: a photo at Ken Burns scale 1.18 (larger than the frame): the outer 2% of rows and columns decode to sources inside the frame (no edge smear)',
  18: 'C3: on a clip with Ken Burns in, set_living_picture removes the motion.move keys in the same transaction; the block shows «התנועה הקודמת הוחלפה בתמונה חיה»; one undo brings both back',
  19: 'C7: the pass\'s step count K is the same for the paused preview at 640×360, a still at 1280×720 and export at 640×360 (read back from the uniforms the page sends)',
  20: 'C6: set_clip_depth null with a living picture on the clip is refused («קודם הסירו את התמונה החיה»); a document with an enabled living picture and no depth: still refused naming the clip, preview notice, export plan blocked',
};

if (!LIVING_PROOF_BUILT) {
  console.error(`living-proof: not built yet; ${Object.keys(LIVING_CHECKS).length} checks pending (${Object.keys(LIVING_CHECKS).join(', ')}); nothing was measured`);
  process.exit(2);
}
