/**
 * The routes of recorded instruments (wave 7 instruments track; decisions §4.7). The lead lands the permission checks and the honest
 * states COMPLETE; BUILDER W2 replaces the 'not_built' branch with the real check (bank.ts checkKit) and owns this file after.
 *
 * - GET /api/v1/music/kits (observe; no project, no people): every kit with its state, the reason a recorded request would get now,
 *   the parts it plays, its sources' duties once checked, its label, and the owner's mark. No absolute path. The state is the kit
 *   check's own (bank.ts checkKit: library, calibration, ledger, licences, every file against the kit table); a kit whose check passes
 *   is 'ready' (it would be 'not_built' only in a build with INSTRUMENTS_BUILT off).
 * - POST /api/v1/music/kits/:kitId/heard {heard} (the owner's own session only; heard.ts). No MCP tool.
 */
import { kitForStyle, kitKey, MUSIC_KITS, MUSIC_RECORDED_HEARD_LABEL, MUSIC_RECORDED_UNHEARD_LABEL, type KitState, type MusicKit, type MusicKitStatus } from '@pulseframe/core';
import type { Config } from '../config.ts';
import { checkKit, type ReadyKit } from './bank.ts';
import { INSTRUMENTS_BUILT, INSTRUMENTS_SERVER_REFUSALS, instrumentsError } from './contract.ts';
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
/** GET /api/v1/music/kits. `built` is the build flag (a test of the check itself may pass true). */
export async function listMusicKits(cfg: Config, kits: readonly MusicKit[] = MUSIC_KITS, built: boolean = INSTRUMENTS_BUILT): Promise<{ kits: MusicKitStatus[] }> {
  const marks = readKitsHeard(cfg.dataDir);
  const out: MusicKitStatus[] = [];
  for (const kit of kits) {
    const check = await checkKit(cfg, kit);
    const state: KitState = check.state === 'ready' && !built ? 'not_built' : check.state;
    // the reason is the refusal a recorded request would get now (the check's own error: path_escape and format too)
    const reason = check.state === 'ready' ? (built ? null : KIT_STATE_REASON.not_built) : check.error.code;
    const heard = marks.get(kitKey(kit)) ?? null;
    out.push({
      kitId: kit.id, version: kit.version, styleId: kit.styleId, state, reason,
      parts: Object.entries(kit.parts).map(([part, p]) => {
        const ins = kit.instruments.find((i) => i.id === p!.instrument)!;
        return { part: part as MusicKitStatus['parts'][number]['part'], instrument: ins.id, title: ins.title };
      }),
      sources: check.sources, label: kitLabel(heard), heard,
    });
  }
  return { kits: out };
}

/**
 * The recorded kit of a request, checked (outside the queue turn), or the refusal: 404 instruments_no_kit for a style without one, then
 * the check's own refusal (library, calibration, ledger, licence, files). All-or-nothing: nothing is made unless this returns.
 */
export async function recordedKitFor(cfg: Config, styleId: string, kits: readonly MusicKit[] = MUSIC_KITS, signal?: AbortSignal): Promise<{ kit: MusicKit; check: ReadyKit }> {
  const kit = kitForStyle(styleId, kits);
  if (!kit) throw instrumentsError('noKit', { styleId }, styleId);
  const check = await checkKit(cfg, kit, signal);
  if (check.state !== 'ready') throw check.error;
  return { kit, check };
}
