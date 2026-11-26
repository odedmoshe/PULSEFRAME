/**
 * Pure logic of the import cards and the folder import (imports.logic.ts). The folder walk is tested with FAKE directory entries
 * only (no browser here): a real folder drop is checked by the lead's proof in Chromium.
 */
import { describe, expect, it } from 'vitest';
import { dictionaries } from '@pulseframe/i18n';
import type { ImportJobView } from '@pulseframe/core';
import { FOLDER_IMPORT_CAP, cardText, collectDropped, failureText, formatBytes, isHiddenPath, kindOfName, naturalCompare, placementStep, planFolderImport, skippedOf, startPlacement, withQueuePositions, type DroppedItemLike, type FsEntryLike, type PlacementEvent, type PlacementState } from './imports.logic.ts';

const pick = (relativePath: string, size = 10) => ({ name: relativePath.split('/').pop()!, relativePath, size });
const job = (over: Partial<ImportJobView> = {}): ImportJobView => ({
  jobId: 'job_1', projectId: 'p', name: 'IMG_1.MOV', byteSize: 1000, via: 'phone', state: 'waiting', waitingFor: 'turn', percent: null, queuePosition: null, reasons: [], assetId: null, deduplicated: false, error: null,
  batchId: null, dropId: 'd1', retryOf: null, attempt: 1, createdAt: '2026-11-18T10:00:00Z', updatedAt: '2026-11-18T10:00:00Z', ...over,
});

describe('planFolderImport', () => {
  it('keeps media only, skips hidden and system files, counts both', () => {
    const plan = planFolderImport([
      pick('trip/a.mp4'), pick('trip/b.JPG'), pick('trip/notes.txt'), pick('trip/.DS_Store'), pick('trip/Thumbs.db'), pick('trip/desktop.ini'),
      pick('__MACOSX/trip/._a.mp4'), pick('.hidden/c.mov'), pick('trip/.secret.png'), pick('trip/sound.WAV'), pick('trip/doc.pdf'),
    ]);
    expect(plan.files.map((f) => f.relativePath)).toEqual(['trip/a.mp4', 'trip/b.JPG', 'trip/sound.WAV']);
    expect(plan.skipped).toEqual({ notMedia: 2, hidden: 6, tooMany: 0 });
    expect(skippedOf(plan)).toEqual({ count: 2, reason: 'not-media' });
  });
  it('sorts naturally by path: IMG_2 before IMG_10, folders by their own names, case-insensitive, Hebrew names stay', () => {
    const plan = planFolderImport([pick('b/IMG_10.jpg'), pick('a/IMG_2.jpg'), pick('a/IMG_10.jpg'), pick('a/img_1.jpg'), pick('b/IMG_9.jpg'), pick('אלבום/תמונה 2.jpg'), pick('אלבום/תמונה 10.jpg')]);
    expect(plan.files.map((f) => f.relativePath)).toEqual(['a/img_1.jpg', 'a/IMG_2.jpg', 'a/IMG_10.jpg', 'b/IMG_9.jpg', 'b/IMG_10.jpg', 'אלבום/תמונה 2.jpg', 'אלבום/תמונה 10.jpg']);
  });
  it('naturalCompare is a total order: leading zeros and equal-looking names settle the same way every time', () => {
    expect(naturalCompare('a01', 'a1')).not.toBe(0);
    expect(Math.sign(naturalCompare('a01', 'a1'))).toBe(-Math.sign(naturalCompare('a1', 'a01')));
    expect(naturalCompare('x', 'x')).toBe(0);
    expect(naturalCompare('a2', 'a10')).toBeLessThan(0);
    expect(naturalCompare('a', 'a1')).toBeLessThan(0);
  });
  it('caps at 500 (after sorting, so the first 500 in order stay) and counts the rest', () => {
    const files = Array.from({ length: 620 }, (_v, i) => pick(`f/IMG_${i}.jpg`)).reverse();
    const plan = planFolderImport(files);
    expect(FOLDER_IMPORT_CAP).toBe(500);
    expect(plan.files).toHaveLength(500);
    expect(plan.files[0]!.relativePath).toBe('f/IMG_0.jpg');
    expect(plan.files[499]!.relativePath).toBe('f/IMG_499.jpg');
    expect(plan.skipped.tooMany).toBe(120);
    expect(skippedOf(plan)).toEqual({ count: 120, reason: 'too-many' });
  });
  it('an empty folder or only non-media gives nothing to import and a notice only when something was skipped', () => {
    expect(skippedOf(planFolderImport([]))).toBeNull();
    expect(skippedOf(planFolderImport([pick('a/.DS_Store')]))).toBeNull();
  });
  it('isHiddenPath and kindOfName', () => {
    expect(isHiddenPath('a/b/.x.mp4')).toBe(true);
    expect(isHiddenPath('a\\Thumbs.db')).toBe(true);
    expect(isHiddenPath('a/b/c.mp4')).toBe(false);
    expect(kindOfName('x.MOV')).toBe('video');
    expect(kindOfName('x.m4a')).toBe('sound');
    expect(kindOfName('x.heic')).toBe('image');
    expect(kindOfName('x.txt')).toBe('other');
    expect(kindOfName('.mp4')).toBe('other');
  });
});

// ---- a fake directory, as the File and Directory Entries API would give it (at most 100 entries per readEntries) ----------
const fakeFile = (name: string): File => ({ name, size: 3, lastModified: 1 }) as unknown as File;
function fileEntry(path: string): FsEntryLike {
  const name = path.split('/').pop()!;
  return { isFile: true, isDirectory: false, name, fullPath: `/${path}`, file: (ok) => ok(fakeFile(name)) };
}
function dirEntry(path: string, children: FsEntryLike[], batch = 100): FsEntryLike & { reads: number } {
  const e = {
    isFile: false, isDirectory: true, name: path.split('/').pop()!, fullPath: `/${path}`, reads: 0,
    createReader: () => {
      let at = 0;
      return { readEntries: (ok: (b: FsEntryLike[]) => void) => { e.reads++; const out = children.slice(at, at + batch); at += batch; queueMicrotask(() => ok(out)); } };
    },
  };
  return e;
}
const itemOf = (entry: FsEntryLike | null, file: File | null = null): DroppedItemLike => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => file });

describe('collectDropped (fake directories)', () => {
  it('reads a directory of 250 entries completely: readEntries is called until it returns nothing', async () => {
    const kids = Array.from({ length: 250 }, (_v, i) => fileEntry(`trip/IMG_${i}.jpg`));
    const dir = dirEntry('trip', kids);
    const got = await collectDropped([itemOf(dir)]);
    expect(got).toHaveLength(250);
    expect(dir.reads).toBe(4); // 100 + 100 + 50 + the empty batch
    expect(got[0]!.relativePath).toBe('trip/IMG_0.jpg');
    expect(new Set(got.map((g) => g.relativePath)).size).toBe(250);
  });
  it('walks nested folders and keeps their paths; a loose file keeps its name; an item with no entry falls back to getAsFile', async () => {
    const inner = dirEntry('trip/day1', [fileEntry('trip/day1/a.mp4')]);
    const outer = dirEntry('trip', [inner, fileEntry('trip/b.jpg')]);
    const got = await collectDropped([itemOf(outer), itemOf(fileEntry('loose.mov')), itemOf(null, fakeFile('legacy.png')), { kind: 'string', webkitGetAsEntry: () => null, getAsFile: () => null }]);
    expect(got.map((g) => g.relativePath)).toEqual(['trip/day1/a.mp4', 'trip/b.jpg', 'loose.mov', 'legacy.png']);
  });
  it('takes every entry before the first await (a DataTransferItem is dead after it)', async () => {
    let alive = true;
    const mk = (entry: FsEntryLike): DroppedItemLike => ({ kind: 'file', webkitGetAsEntry: () => { if (!alive) throw new Error('dead item'); return entry; }, getAsFile: () => null });
    const p = collectDropped([mk(dirEntry('a', [fileEntry('a/1.jpg')])), mk(dirEntry('b', [fileEntry('b/2.jpg')]))]);
    alive = false;
    expect((await p).map((g) => g.relativePath)).toEqual(['a/1.jpg', 'b/2.jpg']);
  });
  it('a read error rejects instead of returning a partial list', async () => {
    const bad: FsEntryLike = { isFile: false, isDirectory: true, name: 'x', fullPath: '/x', createReader: () => ({ readEntries: (_ok, fail) => fail(new Error('denied')) }) };
    await expect(collectDropped([itemOf(bad)])).rejects.toThrow('denied');
  });
});

describe('cardText: the four Hebrew states', () => {
  const he = (v: ImportJobView) => cardText({ kind: 'job', view: v }, 'he');
  it('waiting: chip ממתין with the reason it waits', () => {
    expect(he(job({ waitingFor: 'turn', queuePosition: 3 }))).toEqual({ chip: 'ממתין', detail: 'בתור: 3 לפניו' });
    expect(he(job({ waitingFor: 'turn', queuePosition: 0 }))).toEqual({ chip: 'ממתין', detail: null });
    expect(he(job({ waitingFor: 'export' }))).toEqual({ chip: 'ממתין', detail: 'ממתין לסיום הייצוא' });
    expect(he(job({ waitingFor: 'check' }))).toEqual({ chip: 'ממתין', detail: 'נבדק' });
    expect(he(job({ waitingFor: 'compute' })).detail).toBe('ממתין לסיום עבודה אחרת');
  });
  it('converting: ממיר 42% with the reasons in the words of notice.reason.*', () => {
    const t = he(job({ state: 'converting', waitingFor: null, percent: 42, reasons: ['rotation', 'hdr'] }));
    expect(t.chip).toBe('ממיר 42%');
    expect(t.detail).toBe(`${dictionaries.he['notice.reason.rotation']}, ${dictionaries.he['notice.reason.hdr']}`);
    expect(he(job({ state: 'converting', waitingFor: null, percent: null })).chip).toBe('ממיר');
    expect(cardText({ kind: 'job', view: job({ state: 'converting', waitingFor: null, percent: 7, reasons: ['codec'] }) }, 'en').detail).toBe(dictionaries.en['notice.reason.codec']);
  });
  it('ready: מוכן', () => expect(he(job({ state: 'ready', waitingFor: null, assetId: 'a1' }))).toEqual({ chip: 'מוכן', detail: null }));
  it('failed: נכשל with the reason of the failure code, and a plain sentence for a code nobody knows', () => {
    expect(he(job({ state: 'failed', waitingFor: null, error: { code: 'unsupported_media', message: 'x', retryable: false } }))).toEqual({ chip: 'נכשל', detail: dictionaries.he['error.code.unsupported_media'] });
    expect(he(job({ state: 'failed', waitingFor: null, error: { code: 'disk_full', message: 'x', retryable: true } })).detail).toBe('אין מספיק מקום פנוי בדיסק');
    expect(failureText('no_such_code', 'he', 'הודעה')).toBe('הודעה');
    expect(he(job({ state: 'failed', waitingFor: null, error: null })).detail).toBe('הייבוא לא הושלם');
  });
  it('canceled and the local states before a job exists', () => {
    expect(he(job({ state: 'canceled', waitingFor: null })).chip).toBe('בוטל');
    const local = (state: 'uploading' | 'pending-upload' | 'not-uploaded', percent = 0, reason: string | null = null) => ({ kind: 'local' as const, local: { localId: 'l', name: 'a.mp4', byteSize: 1, via: 'browser' as const, state, percent, jobId: null, reason } });
    expect(cardText(local('uploading', 42), 'he').chip).toBe('בהעלאה 42%');
    expect(cardText(local('pending-upload'), 'he').chip).toBe('ממתין להעלאה');
    expect(cardText(local('not-uploaded', 0, 'network_error'), 'he')).toEqual({ chip: 'לא הועלה', detail: 'ההעלאה נקטעה' });
    expect(cardText(local('not-uploaded', 0, 'upload_too_large'), 'he').detail).toBe('הקובץ גדול מדי');
  });
  it('every state has text in English too, and sizes read as MB/GB', () => {
    expect(cardText({ kind: 'job', view: job({ state: 'ready', waitingFor: null }) }, 'en').chip).toBe('Ready');
    expect(formatBytes(412 * 1024 ** 2)).toBe('412 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });
});

describe('withQueuePositions', () => {
  it('counts the unfinished files ahead in list order, keeps a position the server gave', () => {
    const jobs = [job({ jobId: 'a', state: 'converting', waitingFor: null, percent: 10 }), job({ jobId: 'b', state: 'ready', waitingFor: null }), job({ jobId: 'c' }), job({ jobId: 'd', queuePosition: 9 }), job({ jobId: 'e' })];
    expect(withQueuePositions(jobs).map((j) => j.queuePosition)).toEqual([null, null, 1, 9, 3]);
  });
});

describe('placement chain', () => {
  const run = (s: PlacementState, evs: PlacementEvent[]) => {
    const placed: { localId: string; frame: number; trackId: string | null }[] = [];
    let state = s;
    for (const ev of evs) {
      const r = placementStep(state, ev);
      state = r.state;
      if (r.place) placed.push({ localId: r.place.localId, frame: r.place.frame, trackId: r.place.trackId });
    }
    return { placed, state };
  };
  it('places in the order dropped whatever order the jobs finish in, each after the previous clip', () => {
    const { placed } = run(startPlacement(['a', 'b', 'c'], { frame: 100, trackId: 't1' }), [
      { kind: 'finished', localId: 'c', assetId: 'AC' }, { kind: 'finished', localId: 'b', assetId: 'AB' },
      { kind: 'finished', localId: 'a', assetId: 'AA' }, { kind: 'placed', nextFrame: 160 }, { kind: 'placed', nextFrame: 220 },
    ]);
    expect(placed).toEqual([{ localId: 'a', frame: 100, trackId: 't1' }, { localId: 'b', frame: 160, trackId: 't1' }, { localId: 'c', frame: 220, trackId: 't1' }]);
  });
  it('a failed file in the middle is skipped and the next one goes where it would have', () => {
    const { placed, state } = run(startPlacement(['a', 'b', 'c'], { frame: 0, trackId: null }), [
      { kind: 'finished', localId: 'a', assetId: 'AA' }, { kind: 'finished', localId: 'b', assetId: null }, { kind: 'finished', localId: 'c', assetId: 'AC' },
      { kind: 'placed', nextFrame: 90 },
    ]);
    expect(placed).toEqual([{ localId: 'a', frame: 0, trackId: null }, { localId: 'c', frame: 90, trackId: null }]);
    expect(state.placing).toBe(true);
  });
  it('only one placement is in flight; a placement that put nothing (null) leaves the position where it was', () => {
    const s0 = startPlacement(['a', 'b'], { frame: 50, trackId: null });
    const r1 = placementStep(s0, { kind: 'finished', localId: 'a', assetId: 'AA' });
    expect(r1.place?.localId).toBe('a');
    const r2 = placementStep(r1.state, { kind: 'finished', localId: 'b', assetId: 'AB' });
    expect(r2.place).toBeNull(); // a is still being placed
    const r3 = placementStep(r2.state, { kind: 'placed', nextFrame: null });
    expect(r3.place).toEqual({ localId: 'b', assetId: 'AB', frame: 50, trackId: null });
  });
  it('is a pure step: the input state is not changed, and an id like __proto__ is just an id', () => {
    const s0 = startPlacement(['__proto__', 'constructor'], { frame: 0, trackId: null });
    const before = JSON.stringify([s0.order, [...s0.finished], s0.nextIndex, s0.placing]);
    const r = placementStep(s0, { kind: 'finished', localId: '__proto__', assetId: 'A1' });
    expect(JSON.stringify([s0.order, [...s0.finished], s0.nextIndex, s0.placing])).toBe(before);
    expect(r.place?.localId).toBe('__proto__');
    expect(placementStep(r.state, { kind: 'finished', localId: 'nobody', assetId: 'X' }).place).toBeNull(); // unknown ids are ignored
  });
  it('an all-failed drop places nothing and ends', () => {
    const { placed, state } = run(startPlacement(['a', 'b'], { frame: 0, trackId: null }), [{ kind: 'finished', localId: 'b', assetId: null }, { kind: 'finished', localId: 'a', assetId: null }]);
    expect(placed).toEqual([]);
    expect(state.nextIndex).toBe(2);
  });
});
