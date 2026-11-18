/**
 * The assistant's summary is an allowlist (ADR-0027, plan §7.3; decision 7): planted private values never appear in it,
 * owner-typed text appears only behind its switch, people only as {id, name} behind theirs, and it folds at 32 KB.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { ASSISTANT_SUMMARY_FIELDS, SUMMARY_MAX_BYTES, type ProjectDocument } from '@pulseframe/core';
import { ASSISTANT_DATA_SENT, ASSISTANT_CAPABILITY } from '@pulseframe/providers';
import { ApiError, Store } from '../store.ts';
import { f, PLANTED, PLANTED_PRIVATE, plantedProject } from './assistantFixture.ts';
import { assistantSummary, FIELD_PLACEHOLDER, SUMMARY_FIELDS } from './summary.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const newStore = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-asum-')); dirs.push(d); return new Store(d); };
const OFF = { titlesAndMarkers: false, peopleNames: false };

describe('the summary allowlist', () => {
  it('holds none of the planted private values with both switches off, nor the owner-typed text', () => {
    const store = newStore();
    const { pid, clipIds } = plantedProject(store);
    const doc = store.getProject(pid).doc;
    const s = assistantSummary(doc, { playheadFrame: 0, selection: [clipIds[0]!, 'not-a-clip'] }, OFF);
    const json = JSON.stringify(s);
    for (const v of [...PLANTED_PRIVATE, PLANTED.personName, PLANTED.title, PLANTED.markerLabel, PLANTED.trackName, 'שיר_של_נועה']) expect(json, v).not.toContain(v);
    expect(json).not.toMatch(/"(birthDate|form|capture|contentHash|provenance|transcripts?|events|people|assetId|label|text)":/);
    expect(s.people).toBeUndefined();
    expect(s.sent).toEqual(OFF);
    expect(s.selection).toEqual([clipIds[0]]); // only clips of the sequence are echoed back
    expect(Object.keys(s).sort()).toEqual(ASSISTANT_SUMMARY_FIELDS.filter((k) => k !== 'people').sort());
    // assets only as aliases, by first use; the music's beat count and bpm, nothing else of the analysis
    const media = s.clips.filter((c) => c.type === 'media');
    expect([...new Set(media.map((c) => c.asset))].sort()).toEqual(['A1', 'A2']); // the video's linked sound shares its alias
    expect(s.music).toEqual([{ asset: media.find((c) => c.assetKind === 'audio')!.asset, beats: 3, bpm: 120 }]);
    // titles without their wording; markers without labels; tracks by kind and position
    expect(s.clips.find((c) => c.type === 'text')).toMatchObject({ chars: [...PLANTED.title].length, hasFields: false });
    expect(s.clips.find((c) => c.type === 'text')!.text).toBeUndefined();
    expect(s.markers).toEqual([{ time: T.normalize(f(15)) }]);
    for (const t of s.tracks) expect(t.name).toMatch(/^רצועת \S+ \d+$/);
    expect(s.tracks.filter((t) => t.kind === 'video').map((t) => t.name)).toEqual(['רצועת וידאו 1', 'רצועת וידאו 2']);
  });
  it('with the people switch only the person\'s id and name are added, never the birth date or the word choice', () => {
    const store = newStore();
    const { pid, personId } = plantedProject(store);
    const s = assistantSummary(store.getProject(pid).doc, { playheadFrame: 0, selection: [] }, { titlesAndMarkers: false, peopleNames: true });
    expect(s.people).toEqual([{ id: personId, name: PLANTED.personName }]);
    const json = JSON.stringify(s);
    for (const v of PLANTED_PRIVATE) expect(json, v).not.toContain(v);
    // the name is in the people list and nowhere else (not via the track name, the event or the file name)
    expect(json.split(PLANTED.personName).length - 1).toBe(1);
  });
  it('with the titles switch: title wording (fields as {שדה}), marker labels and track names (cut to 40 characters)', () => {
    const store = newStore();
    const { pid, personId } = plantedProject(store);
    const doc = structuredClone(store.getProject(pid).doc) as ProjectDocument;
    const text = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text')!;
    if (text.type !== 'text') throw new Error('fixture');
    text.text = `${PLANTED.title} {age:${personId}:words} {{x}} {date}`;
    text.fields = true;
    doc.sequences[doc.mainSequenceId]!.tracks[0]!.name = 'א'.repeat(100);
    const s = assistantSummary(doc, { playheadFrame: 0, selection: [] }, { titlesAndMarkers: true, peopleNames: false });
    expect(s.clips.find((c) => c.type === 'text')!.text).toBe(`${PLANTED.title} ${FIELD_PLACEHOLDER} {{x}} ${FIELD_PLACEHOLDER}`);
    expect(s.markers).toEqual([{ time: T.normalize(f(15)), label: PLANTED.markerLabel }]);
    expect(s.tracks.map((t) => t.name)).toContain(PLANTED.trackName);
    expect(s.tracks[0]!.name).toBe('א'.repeat(40));
    const json = JSON.stringify(s);
    expect(json).not.toContain(personId);
    for (const v of PLANTED_PRIVATE) expect(json, v).not.toContain(v);
    // with the switch off, a title with fields says only that it has some
    const off = assistantSummary(doc, { playheadFrame: 0, selection: [] }, OFF);
    expect(off.clips.find((c) => c.type === 'text')).toMatchObject({ hasFields: true });
    expect(JSON.stringify(off)).not.toContain(personId);
  });
  it('reads only the sequence it is asked for; an unknown one is a 404', () => {
    const store = newStore();
    const { pid } = plantedProject(store);
    const doc = store.getProject(pid).doc;
    expect(assistantSummary(doc, { playheadFrame: 0, selection: [] }, OFF).sequenceId).toBe(doc.mainSequenceId);
    try { assistantSummary(doc, { playheadFrame: 0, selection: [], sequenceId: 'seq_nope' }, OFF); throw new Error('no refusal'); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).status).toBe(404); }
  });
  it('the descriptor\'s dataSent is the summary\'s own field list', () => {
    expect([...SUMMARY_FIELDS]).toEqual([...ASSISTANT_SUMMARY_FIELDS]);
    expect([...ASSISTANT_DATA_SENT]).toEqual([...ASSISTANT_SUMMARY_FIELDS]);
    expect(ASSISTANT_CAPABILITY.dataSent).toEqual([...ASSISTANT_SUMMARY_FIELDS]);
  });
});

describe('the 32 KB fold', () => {
  function bigDoc(store: Store) {
    const { pid } = plantedProject(store);
    const doc = structuredClone(store.getProject(pid).doc) as ProjectDocument;
    const track = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'text')!;
    const tpl = track.clips.find((c) => c.type === 'text')!;
    track.clips = Array.from({ length: 600 }, (_x, i) => ({ ...structuredClone(tpl), id: `clp_fold${String(i).padStart(4, '0')}`, start: f(i * 60), duration: f(30) }));
    return doc;
  }
  it('folds clips far from the playhead and outside the selection into per-track counts, and says so', () => {
    const store = newStore();
    const doc = bigDoc(store);
    const sel = 'clp_fold0599'; // the last clip, far from the playhead: kept because it is selected
    const s = assistantSummary(doc, { playheadFrame: 300 * 60, selection: [sel] }, OFF);
    const bytes = Buffer.byteLength(JSON.stringify(s), 'utf8');
    expect(bytes).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(s.folded).not.toBeNull();
    const textTrack = s.tracks.find((t) => t.kind === 'text')!.id;
    const kept = s.clips.filter((c) => c.trackId === textTrack);
    expect(kept.length + s.folded!.find((x) => x.trackId === textTrack)!.clips).toBe(600);
    expect(kept.map((c) => c.id)).toContain(sel);
    expect(kept.map((c) => c.id)).toContain('clp_fold0300'); // under the playhead
    // what was kept is what is nearest the playhead: every kept unselected clip is nearer than every folded one
    const t = T.frameTime(300 * 60, { num: 30, den: 1 });
    const dist = (c: { start: T.RationalTime; duration: T.RationalTime }) => { const e = T.add(c.start, c.duration); return T.lt(t, c.start) ? T.toSeconds(T.sub(c.start, t)) : T.lt(e, t) ? T.toSeconds(T.sub(t, e)) : 0; };
    const keptMax = Math.max(...kept.filter((c) => c.id !== sel).map(dist));
    expect(keptMax).toBeLessThanOrEqual(60);
  });
  it('a summary under the bound is not folded', () => {
    const store = newStore();
    const { pid } = plantedProject(store);
    expect(assistantSummary(store.getProject(pid).doc, { playheadFrame: 0, selection: [] }, OFF).folded).toBeNull();
  });
  it('a selection too large to describe is refused (413), never cut silently', () => {
    const store = newStore();
    const doc = bigDoc(store);
    const ids = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips.map((c) => c.id));
    try { assistantSummary(doc, { playheadFrame: 0, selection: ids }, OFF); throw new Error('no refusal'); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).code).toBe('summary_too_large'); }
  });
});
