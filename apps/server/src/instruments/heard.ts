/**
 * The owner's «שמעתי» marks of recorded kits (wave 7 instruments track; decisions §3). LEAD-BUILT, complete.
 *
 * - Not project state: a kit is the editor's, not a project's (like library.json). <dataDir>/music-kits-heard.json, mode 0600, written
 *   to a temporary name and renamed into place; at most INSTRUMENTS_LIMITS.heardRows rows, the oldest dropped.
 * - Only the owner's own session marks (isOwnerSession): every agent credential, an observer grant and the phone drop get 403
 *   owner_required BEFORE the kit id is even looked at, so nobody else learns anything from the answer.
 * - A mark names the kit AND its version (kitKey): a recalibrated kit (another version) is unheard again.
 * - The mark says a person listened. It records no verdict and nothing about how it sounds (the A/B choice is not stored: cut (a)).
 */
import fs from 'node:fs';
import path from 'node:path';
import { INSTRUMENTS_LIMITS, kitKey, MUSIC_KITS, type MusicKit } from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import type { Principal } from '../auth.ts';
import { ApiError } from '../store.ts';
import { instrumentsError, KITS_HEARD_FILE } from './contract.ts';

export interface HeardRow { kit: string; at: string }
const fileOf = (dataDir: string) => path.join(dataDir, KITS_HEARD_FILE);

/** The marks on disk, by kitKey (a missing or unreadable file is no marks: unheard is the safe state). */
export function readKitsHeard(dataDir: string): Map<string, { at: string }> {
  const out = new Map<string, { at: string }>();
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(dataDir), 'utf8')) as { rows?: unknown };
    for (const r of Array.isArray(j.rows) ? j.rows : []) {
      const row = r as Partial<HeardRow>;
      if (typeof row.kit === 'string' && typeof row.at === 'string' && row.kit.length <= 80 && row.at.length <= 40) out.set(row.kit, { at: row.at });
    }
  } catch { /* none yet */ }
  return out;
}

/**
 * POST /api/v1/music/kits/:kitId/heard {heard}. `now` is the server's clock (ISO). Returns the kit's mark after the change.
 * 403 owner_required for anyone but the owner's own session (checked first); 404 not_found for a kit this build does not have.
 */
export function markKitHeard(dataDir: string, principal: Principal, kitId: string, heard: boolean, now: string, kits: readonly MusicKit[] = MUSIC_KITS): { kitId: string; version: number; heard: { at: string } | null } {
  if (!isOwnerSession(principal)) throw instrumentsError('ownerOnly', {});
  const kit = kits.find((k) => k.id === kitId);
  if (!kit) throw new ApiError(404, 'not_found', `there is no recorded kit "${kitId.slice(0, 80)}"`, {}, 'GET /api/v1/music/kits lists the kits.');
  const key = kitKey(kit);
  const marks = readKitsHeard(dataDir);
  marks.delete(key);
  if (heard) marks.set(key, { at: now });
  const rows: HeardRow[] = [...marks].map(([k, v]) => ({ kit: k, at: v.at })).slice(-INSTRUMENTS_LIMITS.heardRows);
  const file = fileOf(dataDir), tmp = `${file}.tmp`;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, rows }) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  return { kitId: kit.id, version: kit.version, heard: heard ? { at: now } : null };
}
