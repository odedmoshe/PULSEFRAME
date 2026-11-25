/**
 * The routes of recorded instruments (wave 7 instruments track; decisions §4.7). The lead lands the permission checks and the honest
 * states COMPLETE; BUILDER W2 replaces the 'not_built' branch with the real check (bank.ts checkKit) and owns this file after.
 *
 * - GET /api/v1/music/kits (observe; no project, no people): every kit with its state, the reason a recorded request would get now,
 *   the parts it plays, its sources' duties once checked, its label, and the owner's mark. No absolute path.
 * - POST /api/v1/music/kits/:kitId/heard {heard} (the owner's own session only; heard.ts). No MCP tool.
 */
import { kitCalibrated, kitKey, MUSIC_KITS, MUSIC_RECORDED_HEARD_LABEL, MUSIC_RECORDED_UNHEARD_LABEL, type KitState, type MusicKit, type MusicKitStatus } from '@pulseframe/core';
import type { Config } from '../config.ts';
import { libraryServiceFor } from '../library/index.ts';
import { INSTRUMENTS_BUILT, INSTRUMENTS_SERVER_REFUSALS } from './contract.ts';
import { readKitsHeard } from './heard.ts';

/** The refusal code a recorded request gets in each state (null = it is made). */
export const KIT_STATE_REASON: Readonly<Record<KitState, string | null>> = {
  not_built: INSTRUMENTS_SERVER_REFUSALS.notBuilt.code, library_not_set: INSTRUMENTS_SERVER_REFUSALS.libraryNotSet.code, not_calibrated: INSTRUMENTS_SERVER_REFUSALS.kitNotReady.code,
  item_missing: INSTRUMENTS_SERVER_REFUSALS.itemMissing.code, item_version: INSTRUMENTS_SERVER_REFUSALS.itemVersion.code, licence: INSTRUMENTS_SERVER_REFUSALS.licence.code,
  file_missing: INSTRUMENTS_SERVER_REFUSALS.fileMissing.code, file_changed: INSTRUMENTS_SERVER_REFUSALS.fileChanged.code, unreadable: INSTRUMENTS_SERVER_REFUSALS.unreadable.code,
  checking: null, ready: null,
};
/** Label of a kit: unheard until the owner's own mark; then the day they marked it (nothing about how it sounds). */
export function kitLabel(heard: { at: string } | null): { he: string; en: string } {
  if (!heard) return MUSIC_RECORDED_UNHEARD_LABEL;
  const date = heard.at.slice(0, 10);
  return { he: MUSIC_RECORDED_HEARD_LABEL.he.replace('{date}', date), en: MUSIC_RECORDED_HEARD_LABEL.en.replace('{date}', date) };
}
/** The state a kit is in before any file is read: library set? kit calibrated? recorded path built? (W2 continues with checkKit.) */
export function kitStateBeforeCheck(cfg: Config, kit: MusicKit): Exclude<KitState, 'ready' | 'checking'> | 'check' {
  if (!libraryServiceFor(cfg).configuredRoot()) return 'library_not_set';
  if (!kitCalibrated(kit)) return 'not_calibrated';
  if (!INSTRUMENTS_BUILT) return 'not_built';
  return 'check';
}
/** GET /api/v1/music/kits. */
export async function listMusicKits(cfg: Config, kits: readonly MusicKit[] = MUSIC_KITS): Promise<{ kits: MusicKitStatus[] }> {
  const marks = readKitsHeard(cfg.dataDir);
  return {
    kits: kits.map((kit): MusicKitStatus => {
      const before = kitStateBeforeCheck(cfg, kit);
      const state: KitState = before === 'check' ? 'not_built' : before; // W2: run checkKit here
      const heard = marks.get(kitKey(kit)) ?? null;
      return {
        kitId: kit.id, version: kit.version, styleId: kit.styleId, state, reason: KIT_STATE_REASON[state],
        parts: Object.entries(kit.parts).map(([part, p]) => {
          const ins = kit.instruments.find((i) => i.id === p!.instrument)!;
          return { part: part as MusicKitStatus['parts'][number]['part'], instrument: ins.id, title: ins.title };
        }),
        sources: [], label: kitLabel(heard), heard,
      };
    }),
  };
}
