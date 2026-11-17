/**
 * Export checks of the life line (ADR-0021): titles with live fields and capture-sourced date stamps, in the export plan and in
 * the preflight report. The first group holds with or without the core bodies of the life line (its fixtures have no date
 * anywhere, so "no data" is the answer either way); the group marked "core" runs once they are built (LIFE_OPS_BUILT): it
 * needs real dates resolved by core fieldSpans / stampText, which until then throw or answer nothing.
 * Expected words are typed here, never taken from the code under test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { LIFE_OPS_BUILT, applyTransaction, createProject, type Asset, type Capture, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { Exporter } from './export.ts';
import { preflight } from './preflight.ts';
import { MAX_FIELD_ISSUES, fieldIssues, fieldTextExtent, isFieldIssueCode } from './preflight.fields.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pf${seed++}_`, actor: 'user:local', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const file = (n: number, capture?: Capture): Omit<Asset, 'id'> => ({ kind: 'video', name: `clip-${n}.mp4`, contentHash: `sha256:${n.toString(16).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(600, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 18000 }, provenance: prov, ...(capture ? { capture } : {}) });
/** A project with these library files; the ids come back in the same order. */
function library(...assets: Omit<Asset, 'id'>[]) {
  const r = tx(createProject({ id: 'prj_pf', name: 'PF', width: 640, height: 360, frameRate: R }), assets.map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  return { doc: r.doc, assetIds: r.results.map((x) => x.output!.assetId as string) };
}
const out = (r: ReturnType<typeof tx>, i: number, key: string) => r.results[i]!.output![key] as string;
const life = (doc: ProjectDocument, range?: { startFrame: number; endFrame: number }) => fieldIssues(doc, range).map((i) => ({ code: i.code, severity: i.severity, ids: i.ids, range: i.range }));
const titleText = (doc: ProjectDocument, titleId: string, frame: number) => { const l = evaluate(doc, f(frame)).layers.find((x) => x.kind === 'text' && x.clipId === titleId); return l && l.kind === 'text' ? l.text : undefined; };
/** Marks a title as holding fields without the operation (which belongs to the core bodies): for the fixtures that must hold before and after them. */
const withFields = (doc: ProjectDocument, titleId: string) => { const d = structuredClone(doc); for (const t of d.sequences[d.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === titleId && c.type === 'text') c.fields = true; return d; };

let dir: string, store: Store, exporter: Exporter;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-fields-')); store = new Store(dir); exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist')); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const lifeOfPlan = (doc: ProjectDocument, options: Parameters<Exporter['plan']>[2] = {}) => { const p = exporter.plan(doc, 1, options); return { blockers: p.blockers.filter((b) => isFieldIssueCode(b.code)).map((b) => b.code), warnings: p.warnings.filter((b) => isFieldIssueCode(b.code)).map((b) => b.code) }; };

describe('field issues where nothing has a date (holds before and after the core bodies)', () => {
  it('the cap never hides a blocker: 45 date stamps without a date and one title with a field still stop the export', () => {
    const { doc: d0, assetIds } = library(file(1));
    const clips = tx(d0, Array.from({ length: 45 }, (_, i) => ({ op: 'add_clip', args: { assetId: assetIds[0]!, start: f(i * 30), duration: f(30), withLinkedAudio: false } })));
    const stamped = tx(clips.doc, clips.results.map((r) => ({ op: 'add_effect', args: { clipId: r.output!.clipId as string, type: 'stylize.date-stamp', params: { source: 'capture' } } })));
    const t = tx(stamped.doc, [{ op: 'add_text', args: { text: '{date}', start: f(45 * 30 - 30), duration: f(30) } }]);
    const titleId = out(t, 0, 'clipId');
    const doc = withFields(t.doc, titleId);
    const issues = fieldIssues(doc);
    // the title is over the LAST clip: in timeline order it would be the 46th issue, and a cap in that order would cut it
    expect(issues[0]).toMatchObject({ code: 'field_no_data', severity: 'blocker', ids: expect.arrayContaining([titleId]), range: { startFrame: 1320, endFrame: 1350 } });
    expect(issues.filter((i) => i.code === 'field_no_data')).toHaveLength(1);
    const listed = issues.filter((i) => i.code === 'stamp_no_date' && i.range);
    expect(listed).toHaveLength(MAX_FIELD_ISSUES - 1);
    expect(listed.map((i) => i.range!.startFrame)).toEqual(Array.from({ length: MAX_FIELD_ISSUES - 1 }, (_, i) => i * 30)); // timeline order
    // what the cap cut is counted, once, under its own code and severity
    expect(issues.filter((i) => !i.range)).toEqual([expect.objectContaining({ code: 'stamp_no_date', severity: 'warning', ids: [], message: expect.stringMatching(/^6 more/) })]);
    expect(issues).toHaveLength(MAX_FIELD_ISSUES + 1);
    expect(lifeOfPlan(doc, { format: 'mp4-h264-aac' }).blockers).toEqual(['field_no_data']);
    // a range that holds only stamps: the same cap, no blocker
    expect(fieldIssues(doc, { startFrame: 0, endFrame: 1320 }).some((i) => i.severity === 'blocker')).toBe(false);
    expect(fieldIssues(doc, { startFrame: 0, endFrame: 60 })).toHaveLength(2);
  });
  it('what is not drawn is not reported: a stamp with typed text, a switched-off stamp, a hidden track, a title without fields', () => {
    const { doc: d0, assetIds } = library(file(1));
    const c = tx(d0, [{ op: 'add_clip', args: { assetId: assetIds[0]!, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: 'a {date} b', start: f(0), duration: f(60) } }]);
    const clipId = out(c, 0, 'clipId');
    expect(fieldIssues(c.doc)).toEqual([]);
    const typed = tx(c.doc, [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'text', text: "'24 12 25" } } }]);
    expect(fieldIssues(typed.doc)).toEqual([]);
    const captured = tx(typed.doc, [{ op: 'update_effect', args: { clipId, effectId: out(typed, 0, 'effectId'), params: { source: 'capture' } } }]);
    expect(life(captured.doc)).toEqual([{ code: 'stamp_no_date', severity: 'warning', ids: [clipId], range: { startFrame: 0, endFrame: 60 } }]);
    const off = tx(captured.doc, [{ op: 'update_effect', args: { clipId, effectId: out(typed, 0, 'effectId'), enabled: false } }]);
    expect(fieldIssues(off.doc)).toEqual([]);
    const hidden = tx(captured.doc, [{ op: 'update_track', args: { trackId: 'trk_video', hidden: true } }]);
    expect(fieldIssues(hidden.doc)).toEqual([]);
    // the linked sound clip of the same file never carries a stamp that is drawn
    expect(life(captured.doc).map((i) => i.ids)).toEqual([[clipId]]);
    // a title on a hidden title track is not drawn, so its fields are not missed
    const titleId = out(c, 1, 'clipId');
    const hiddenTitle = tx(withFields(c.doc, titleId), [{ op: 'update_track', args: { trackId: 'trk_text', hidden: true } }]);
    expect(fieldIssues(hiddenTitle.doc)).toEqual([]);
    expect(life(withFields(c.doc, titleId))).toEqual([expect.objectContaining({ code: 'field_no_data', severity: 'blocker' })]);
  });
  it('the title extent of a title without fields is its own text, braces and all', () => {
    const { doc } = library();
    const t = tx(doc, [{ op: 'add_text', args: { text: 'one {date}\ntwo', start: f(0), duration: f(30) } }]);
    const clip = t.doc.sequences[t.doc.mainSequenceId]!.tracks.flatMap((x) => x.clips).find((c) => c.type === 'text')!;
    expect(clip.type === 'text' && fieldTextExtent(t.doc, t.doc.mainSequenceId, clip)).toBe('one {date}\ntwo');
  });
});

describe.runIf(LIFE_OPS_BUILT)('field issues with real dates (core)', () => {
  const MAY = { at: '2024-05-05T10:00:00', utcOffsetMinutes: 180, source: 'container' } as const satisfies Capture;
  const DECEMBER = { at: '2024-12-25T11:00:00', utcOffsetMinutes: 120, source: 'container' } as const satisfies Capture;
  /** A title with fields: the text and the switch in one transaction, as the editor commits them. */
  const fieldTitle = (doc: ProjectDocument, text: string, start: number, frames: number) => {
    const a = tx(doc, [{ op: 'add_text', args: { text, start: f(start), duration: f(frames) } }]);
    const titleId = out(a, 0, 'clipId');
    return { doc: tx(a.doc, [{ op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]).doc, titleId };
  };
  /** An undated clip at 0–60 and a dated one at 60–120 on the same track. */
  function undatedThenDated() {
    const { doc, assetIds } = library(file(1), file(2, MAY));
    const r = tx(doc, [
      { op: 'add_clip', args: { assetId: assetIds[0]!, start: f(0), duration: f(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: assetIds[1]!, start: f(60), duration: f(60), withLinkedAudio: false } },
    ]);
    return { doc: r.doc, undatedClip: out(r, 0, 'clipId'), datedClip: out(r, 1, 'clipId'), assetIds };
  }

  it('an undated clip under a title with a field, with a dated clip later on the same track: empty text and field_no_data with the frame range', () => {
    const base = undatedThenDated();
    const { doc, titleId } = fieldTitle(base.doc, 'צולם ב־{date}', 0, 60);
    // the field is empty: the date of the OTHER clip is never borrowed
    for (const frame of [0, 30, 59]) expect(titleText(doc, titleId, frame), `frame ${frame}`).toBe('צולם ב־');
    expect(life(doc)).toEqual([{ code: 'field_no_data', severity: 'blocker', ids: [titleId, base.undatedClip], range: { startFrame: 0, endFrame: 60 } }]);
    expect(fieldIssues(doc)[0]!.message).toMatch(/\{date\}/);
    expect(lifeOfPlan(doc, { format: 'mp4-h264-aac' })).toEqual({ blockers: ['field_no_data'], warnings: [] });
    expect(lifeOfPlan(doc, { format: 'png', frame: 10 })).toEqual({ blockers: [], warnings: [] });
    const report = preflight(exporter, doc, 1);
    expect(report.ok).toBe(false);
    expect(report.issues.filter((i) => isFieldIssueCode(i.code))).toEqual([expect.objectContaining({ code: 'field_no_data', ids: [titleId, base.undatedClip], range: { startFrame: 0, endFrame: 60 } })]);
    // the same title over the dated clip has its words and no issue
    const over = fieldTitle(base.doc, 'צולם ב־{date}', 60, 60);
    expect(titleText(over.doc, over.titleId, 90)).toBe('צולם ב־5 במאי 2024');
    expect(fieldIssues(over.doc)).toEqual([]);
    expect(lifeOfPlan(over.doc, { format: 'mp4-h264-aac' })).toEqual({ blockers: [], warnings: [] });
  });
  it('a title across the cut is reported for the frames over the undated clip only, and a range outside them is not stopped', () => {
    const base = undatedThenDated();
    const { doc, titleId } = fieldTitle(base.doc, '{date:numeric}', 30, 60);
    expect(titleText(doc, titleId, 59)).toBe('');
    expect(titleText(doc, titleId, 60)).toBe('5.5.2024');
    expect(life(doc)).toEqual([{ code: 'field_no_data', severity: 'blocker', ids: [titleId, base.undatedClip], range: { startFrame: 30, endFrame: 60 } }]);
    expect(life(doc, { startFrame: 60, endFrame: 120 })).toEqual([]);
    expect(lifeOfPlan(doc, { range: { startFrame: 60, endFrame: 120 } }).blockers).toEqual([]);
    expect(lifeOfPlan(doc, { range: { startFrame: 59, endFrame: 120 } }).blockers).toEqual(['field_no_data']);
    // the extent estimate uses the longest words the title shows, not its stored text
    const clip = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((x) => x.clips).find((c) => c.id === titleId)!;
    expect(clip.type === 'text' && fieldTextExtent(doc, doc.mainSequenceId, clip)).toBe('5.5.2024');
  });
  it('an evening clip with {hebrewDate}: field_sunset_undecided, cleared by update_event afterSunset', () => {
    // 25 December 2024, 18:00 on an Israeli winter clock: before sunset it is 24 Kislev, after it 25 Kislev (the first candle)
    const { doc: d0, assetIds } = library(file(1, { at: '2024-12-25T18:00:00', utcOffsetMinutes: 120, source: 'container' }));
    const c = tx(d0, [{ op: 'add_clip', args: { assetId: assetIds[0]!, start: f(0), duration: f(60), withLinkedAudio: false } }]);
    const { doc, titleId } = fieldTitle(c.doc, '{hebrewDate}', 0, 60);
    expect(titleText(doc, titleId, 10)).toBe('');
    expect(life(doc)).toEqual([{ code: 'field_sunset_undecided', severity: 'blocker', ids: [titleId], range: { startFrame: 0, endFrame: 60 } }]);
    // in an event, still not answered: the event is named as the place to answer
    const e = tx(doc, [{ op: 'add_event', args: { assetIds: [assetIds[0]!] } }]);
    const eventId = out(e, 0, 'eventId');
    expect(life(e.doc)).toEqual([{ code: 'field_sunset_undecided', severity: 'blocker', ids: [titleId, eventId], range: { startFrame: 0, endFrame: 60 } }]);
    expect(lifeOfPlan(e.doc, { format: 'webm-vp9-opus' }).blockers).toEqual(['field_sunset_undecided']);
    const after = tx(e.doc, [{ op: 'update_event', args: { eventId, afterSunset: true } }]);
    expect(titleText(after.doc, titleId, 10)).toBe('כ״ה בכסלו תשפ״ה');
    expect(fieldIssues(after.doc)).toEqual([]);
    expect(lifeOfPlan(after.doc, { format: 'webm-vp9-opus' }).blockers).toEqual([]);
    const before = tx(e.doc, [{ op: 'update_event', args: { eventId, afterSunset: false } }]);
    expect(titleText(before.doc, titleId, 10)).toBe('כ״ד בכסלו תשפ״ה');
    expect(fieldIssues(before.doc)).toEqual([]);
    // the Hebrew year is the same on both sides of that sunset, so it needs no answer
    const year = fieldTitle(c.doc, '{hebrewYear}', 0, 60);
    expect(titleText(year.doc, year.titleId, 10)).toBe('תשפ״ה');
    expect(fieldIssues(year.doc)).toEqual([]);
    // a daytime clip never asks
    const day = library(file(2, DECEMBER));
    const dc = tx(day.doc, [{ op: 'add_clip', args: { assetId: day.assetIds[0]!, start: f(0), duration: f(60), withLinkedAudio: false } }]);
    const dayTitle = fieldTitle(dc.doc, '{hebrewDate}', 0, 60);
    expect(titleText(dayTitle.doc, dayTitle.titleId, 10)).toBe('כ״ד בכסלו תשפ״ה');
    expect(fieldIssues(dayTitle.doc)).toEqual([]);
  });
  it('a field that takes its date from a file-name estimate: note capture_estimated', () => {
    const { doc: d0, assetIds } = library(file(1, { at: '2024-03-15', utcOffsetMinutes: null, source: 'filename', circa: true }));
    const c = tx(d0, [{ op: 'add_clip', args: { assetId: assetIds[0]!, start: f(0), duration: f(60), withLinkedAudio: false } }]);
    const { doc, titleId } = fieldTitle(c.doc, '{date}', 15, 30);
    expect(titleText(doc, titleId, 20)).toBe('15 במרץ 2024');
    expect(life(doc)).toEqual([{ code: 'capture_estimated', severity: 'note', ids: [titleId, assetIds[0]], range: { startFrame: 15, endFrame: 45 } }]);
    // a note stops nothing
    expect(lifeOfPlan(doc, { format: 'mp4-h264-aac' })).toEqual({ blockers: [], warnings: [] });
    const report = preflight(exporter, doc, 1);
    expect(report.issues.filter((i) => isFieldIssueCode(i.code)).map((i) => [i.code, i.severity])).toEqual([['capture_estimated', 'note']]);
    expect(report.notes).toBeGreaterThanOrEqual(1);
    // a title with the switch on and no field in it depends on no date: nothing to note
    const plain = fieldTitle(c.doc, 'braces {{stay}}', 15, 30);
    expect(titleText(plain.doc, plain.titleId, 20)).toBe('braces {stay}');
    expect(fieldIssues(plain.doc)).toEqual([]);
  });
  it('a capture-sourced stamp: silent over a dated file, a warning over an undated one, and on an adjustment clip only where no dated picture lies under it', () => {
    const base = undatedThenDated();
    const stamp = (clipId: string) => ({ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture' } } });
    expect(fieldIssues(tx(base.doc, [stamp(base.datedClip)]).doc)).toEqual([]);
    expect(life(tx(base.doc, [stamp(base.undatedClip)]).doc)).toEqual([{ code: 'stamp_no_date', severity: 'warning', ids: [base.undatedClip], range: { startFrame: 0, endFrame: 60 } }]);
    const adj = tx(base.doc, [{ op: 'add_adjustment', args: { span: { start: f(30), duration: f(120) }, effects: [{ type: 'stylize.date-stamp', params: { source: 'capture' } }] } }]);
    const adjId = out(adj, 0, 'clipId');
    // 30–60 over the undated clip, 60–120 over the dated one, 120–150 over nothing
    expect(life(adj.doc)).toEqual([
      { code: 'stamp_no_date', severity: 'warning', ids: [adjId], range: { startFrame: 30, endFrame: 60 } },
      { code: 'stamp_no_date', severity: 'warning', ids: [adjId], range: { startFrame: 120, endFrame: 150 } },
    ]);
    expect(lifeOfPlan(adj.doc, { range: { startFrame: 60, endFrame: 120 } })).toEqual({ blockers: [], warnings: [] });
    expect(lifeOfPlan(adj.doc, { format: 'gif' })).toEqual({ blockers: [], warnings: ['stamp_no_date', 'stamp_no_date'] });
  });
  it('a format\'s own wording is what is checked for that format', () => {
    const base = undatedThenDated();
    const { doc: d1, titleId } = fieldTitle(base.doc, 'plain words', 0, 60);
    const v = tx(d1, [{ op: 'add_variant', args: { name: 'Tall', width: 360, height: 640 } }]);
    const variantId = out(v, 0, 'variantId');
    const worded = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, text: 'filmed {date:long-en}' } }]);
    // the master shows plain words; the format's wording holds a field over the undated clip
    expect(fieldIssues(worded.doc)).toEqual([]);
    expect(preflight(exporter, worded.doc, 1).issues.filter((i) => isFieldIssueCode(i.code))).toEqual([]);
    expect(preflight(exporter, worded.doc, 1, { variantId }).issues.filter((i) => isFieldIssueCode(i.code))).toEqual([expect.objectContaining({ code: 'field_no_data', ids: [titleId, base.undatedClip] })]);
    expect(lifeOfPlan(worded.doc, { format: 'mp4-h264-aac', variantId }).blockers).toEqual(['field_no_data']);
    expect(lifeOfPlan(worded.doc, { format: 'mp4-h264-aac' }).blockers).toEqual([]);
  });
});
