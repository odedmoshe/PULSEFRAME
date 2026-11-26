/**
 * The owner's answers (wave 8 booth; plan §3.2 as corrected): <dataDir>/owner-review.json (OWNER_REVIEW_FILE), written like
 * instruments/heard.ts — a temporary file with mode 0600, then rename (a kill between the two leaves the old file whole). One row per
 * item id (the latest). A missing, unreadable or invalid file is "no answers". Machine state, never in a project, archive or backup.
 *
 * Item state (core BoothItemState): 'changed' when the stored row's recipe differs (every kind); for audio when the bytes this machine
 * serves now (or music's pinned bytes) differ from the row's `played`; for a picture when the adapter the caller names now differs from
 * the row's (never «השתנה מאז» for an adapter: changedWhy 'adapter' selects «נבדק על כרטיס מסך אחר — בדקו כאן»). Changed counts as
 * unanswered.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OwnerReviewFileSchema, type BoothAnswer, type BoothItem, type BoothItemView, type OwnerReviewFile } from '@pulseframe/core';
import { OWNER_REVIEW_FILE, OWNER_REVIEW_FILE_MODE } from './contract.ts';

export const ownerReviewPath = (dataDir: string) => path.join(dataDir, OWNER_REVIEW_FILE);
const EMPTY = (): OwnerReviewFile => ({ version: 1, answers: [] });

export function readOwnerReview(dataDir: string): OwnerReviewFile {
  try {
    const r = OwnerReviewFileSchema.safeParse(JSON.parse(fs.readFileSync(ownerReviewPath(dataDir), 'utf8')));
    return r.success ? r.data : EMPTY();
  } catch { return EMPTY(); }
}
/** Writes the whole file: tmp (0600) then rename. `beforeRename` is a TEST seam (a kill between write and rename). */
export function writeOwnerReview(dataDir: string, file: OwnerReviewFile, beforeRename?: () => void): void {
  const parsed = OwnerReviewFileSchema.parse(file);
  const dest = ownerReviewPath(dataDir), tmp = `${dest}.tmp`;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(parsed)}\n`, { mode: OWNER_REVIEW_FILE_MODE });
  try { fs.chmodSync(tmp, OWNER_REVIEW_FILE_MODE); } catch { /* Windows */ }
  beforeRename?.();
  fs.renameSync(tmp, dest);
  try { fs.chmodSync(dest, OWNER_REVIEW_FILE_MODE); } catch { /* Windows */ }
}
/** Stores the row for answer.id (replacing an earlier one) and answers the stored row. */
export function putAnswer(dataDir: string, answer: BoothAnswer): BoothAnswer {
  const f = readOwnerReview(dataDir);
  const answers = [...f.answers.filter((a) => a.id !== answer.id), answer];
  writeOwnerReview(dataDir, { version: 1, answers });
  return answer;
}
/** Removes the row of id; true when there was one. */
export function deleteAnswer(dataDir: string, id: string): boolean {
  const f = readOwnerReview(dataDir);
  const answers = f.answers.filter((a) => a.id !== id);
  if (answers.length === f.answers.length) return false;
  writeOwnerReview(dataDir, { version: 1, answers });
  return true;
}

/** What is true on this machine now, against which a stored row is compared. */
export interface BoothNow {
  /** audio: sha256 of the bytes this process served for the item (null when none yet; music falls back to its pinned bytes) */
  played?: (item: BoothItem) => string | null;
  /** picture: the editor tab's adapter as the caller names it now (row browser-gpu) */
  browserAdapter?: string | null;
  /** picture: the export worker's adapter as last found (row export-gpu) */
  exportAdapter?: string | null;
}
export function viewOf(item: BoothItem, answer: BoothAnswer | null, now: BoothNow = {}): BoothItemView {
  if (!answer) return { item, answer: null, state: 'unanswered' };
  if (answer.recipe !== item.recipe) return { item, answer, state: 'changed', changedWhy: 'recipe' };
  if (item.kind === 'audio' && answer.played) {
    const cur = now.played?.(item) ?? item.expected ?? null;
    if (cur && cur !== answer.played) return { item, answer, state: 'changed', changedWhy: 'played' };
  }
  if (item.kind === 'picture') {
    const differs = (was: string | undefined, is: string | null | undefined) => was !== undefined && !!is && was !== is;
    if (differs(answer.browserAdapter, now.browserAdapter) || differs(answer.exportAdapter, now.exportAdapter)) return { item, answer, state: 'changed', changedWhy: 'adapter' };
  }
  return { item, answer, state: 'answered' };
}
export function itemViews(items: readonly BoothItem[], file: OwnerReviewFile, now: BoothNow = {}): BoothItemView[] {
  const byId = new Map(file.answers.map((a) => [a.id, a]));
  return items.map((i) => viewOf(i, byId.get(i.id) ?? null, now));
}
