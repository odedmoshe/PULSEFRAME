/**
 * The multicam commands of the editor (ADR-0020): their fixed ids and default chords. Lead contract; W3 adds the commands to
 * commands.ts COMMANDS with exactly these ids and keys (labels from i18n multicam.*, `text` where the shared dictionary has
 * no entry).
 *
 * Settled against the redesigned shell (the plan's Shift+digit "cut at the playhead" collides):
 * - Digit1..9 = angle 1..9 and Digit0 = the wide angle. Enabled only while the video target track holds segments of a group.
 *   Paused: switch the segment under the playhead (one commit). Playing with «הקלטת החלפות» on: record a cut at the painted
 *   frame minus the reaction offset. Plain digits are bound by nothing else (commands.test.ts).
 * - Cut at the playhead (multicam.cut1..9, multicam.cutWide): NO default chord, palette and panel button only. Every
 *   modifier+digit is taken: Shift+1…6 the mode bar (Header.tsx), Alt+1…0 the rail (Rail.tsx), Ctrl/⌘+1…9 the browser's tabs,
 *   and Alt+Shift is the Windows keyboard-layout switch most Hebrew users have. The keymap is remappable per person.
 * - multicam.record: no default chord (palette and button). multicam.discard: Escape, enabled ONLY while recording; edit.deselect
 *   is disabled while recording, so Escape has one meaning at a time.
 * - The performance view («במה», .artifacts/stage-plan.md) will turn these digit commands off while it is active.
 */
export const MULTICAM_ANGLE_COMMANDS = ['multicam.angle1', 'multicam.angle2', 'multicam.angle3', 'multicam.angle4', 'multicam.angle5', 'multicam.angle6', 'multicam.angle7', 'multicam.angle8', 'multicam.angle9'] as const;
export const MULTICAM_CUT_COMMANDS = ['multicam.cut1', 'multicam.cut2', 'multicam.cut3', 'multicam.cut4', 'multicam.cut5', 'multicam.cut6', 'multicam.cut7', 'multicam.cut8', 'multicam.cut9'] as const;
export const MULTICAM_KEYS: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(MULTICAM_ANGLE_COMMANDS.map((id, i) => [id, [`Digit${i + 1}`]])),
  'multicam.wide': ['Digit0'],
  ...Object.fromEntries(MULTICAM_CUT_COMMANDS.map((id) => [id, []])),
  'multicam.cutWide': [],
  'multicam.record': [],
  'multicam.discard': ['Escape'],
};
/** Chords other parts of the shell handle outside the command registry (Header.tsx modes, Rail.tsx categories). */
export const SHELL_DIGIT_CHORDS: readonly string[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => `Shift+Digit${d}`),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `Alt+Digit${d}`),
];
/** The one chord a multicam command shares on purpose (with edit.deselect, never enabled at the same time). */
export const MULTICAM_SHARED_CHORDS: Readonly<Record<string, string>> = { Escape: 'edit.deselect' };
