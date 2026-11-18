/**
 * Fixed data-testids of keyframe curves and motion paths in the editor (ADR-0019), shared by the editor components and the
 * proofs (keyframes-proof.ts, editor-interactions-proof.ts, a11y-audit.ts). Lead contracts commit: W2 (strip, picker, chips)
 * and W3 (motion path) put exactly these on the elements named here and do not rename them. A repeated element repeats its id
 * and carries the data-* attribute named beside it.
 */
export const KF_TESTIDS = {
  // the keyframe strip, a sibling overlay of the selected clip on the timeline (data-drag-clip, as VolumeLine): the strip, one
  // <button aria-pressed> per keyed frame (data-frame = clip-local frame, data-easing = the curve after it), and the edge chip
  // for keys outside the clip (data-side = before | after, data-count)
  strip: 'key-strip', key: 'key-strip-key', outside: 'key-strip-outside',
  // its context menu (role=menu) and the items (data-action = smooth | straight | curve | copy | paste | delete)
  menu: 'key-strip-menu', menuItem: 'key-strip-menu-item',
  // the curve picker (role=dialog aria-modal=true): the dialog, a tile per named curve (`curve-tile-<easing>`, aria-disabled with
  // its reason on light channels), the custom editor, its two handles (data-handle = 1 | 2) and four number inputs
  // (`curve-custom-<0..3>` = x1, y1, x2, y2), Smooth and Straight, the scope radio (data-scope = all | one), the preview
  picker: 'curve-picker', tile: (id: string) => `curve-tile-${id}`, custom: 'curve-custom', customHandle: 'curve-custom-handle',
  customInput: (i: 0 | 1 | 2 | 3) => `curve-custom-${i}`, smooth: 'curve-smooth', straight: 'curve-straight', scope: 'curve-scope', preview: 'curve-preview',
  // the curve chip beside a keyframe diamond in the inspector (`curve-chip-<channel key>`: core channelKey, "x" or "fx_1:radius")
  chip: (channel: string) => `curve-chip-${channel}`,
  // the motion path inside the stage's canvas handles (.ch-root): the path layer, a vertex button (data-frame), a bend grip
  // (data-from, data-to), the role=status note of an approximate insertion, an edge stand-in for a point outside the viewer,
  // and the stated reason when no path is drawn (data-reason = follower | format)
  path: 'motion-path', pathPoint: 'motion-path-point', bend: 'motion-path-bend', pathNote: 'motion-path-note', pathEdge: 'motion-path-edge', pathReason: 'motion-path-reason',
  // a placeholder of this pre-pass: the part is not built yet (removed by W2/W3)
  notBuilt: 'keyframes-not-built',
} as const;
/** Every fixed id of the table, with the templates filled in for the given values (tests and the test-id inventory). */
export function keyframeTestIds(easings: readonly string[], channels: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of Object.values(KF_TESTIDS)) if (typeof v === 'string') out.push(v);
  for (const e of easings) out.push(KF_TESTIDS.tile(e));
  for (const i of [0, 1, 2, 3] as const) out.push(KF_TESTIDS.customInput(i));
  for (const c of channels) out.push(KF_TESTIDS.chip(c));
  return out;
}
