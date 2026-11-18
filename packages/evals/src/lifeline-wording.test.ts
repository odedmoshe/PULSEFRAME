/**
 * Keeps the Hebrew wording of the life-line refusals (packages/i18n/src/lifeline.ts HE_LIFE) in step with the fixed English
 * sentences of the operations (packages/core/src/lifeOps.ts LIFE_REFUSALS), and the interface strings of the track complete.
 * The table is the contract both sides are written against; provoking each refusal through its operation is W1's test.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, LIFE_REFUSALS, MAX_CAPTURE_SHIFT_MINUTES, MAX_EVENT_FILES, MAX_LIFE_EVENTS, MISSING_REASONS, CaptureSchema, OpError, type Capture, type LifeEvent, type LifeRefusalKey, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries, LIFE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

/** One real message of every refusal, built from the table itself with sample values. */
const SAMPLES: Record<LifeRefusalKey, string> = {
  assetNotFound: LIFE_REFUSALS.assetNotFound.message('ast_w1'), eventNotFound: LIFE_REFUSALS.eventNotFound.message('evt_w1'),
  lutHasNoDate: LIFE_REFUSALS.lutHasNoDate.message(), noSuchDay: LIFE_REFUSALS.noSuchDay.message(), dateOutOfRange: LIFE_REFUSALS.dateOutOfRange.message(),
  captureUnchanged: LIFE_REFUSALS.captureUnchanged.message(), noCaptureToRemove: LIFE_REFUSALS.noCaptureToRemove.message(), listedTwice: LIFE_REFUSALS.listedTwice.message(),
  shiftNoDate: LIFE_REFUSALS.shiftNoDate.message(3), shiftDayOnly: LIFE_REFUSALS.shiftDayOnly.message(41), shiftInherited: LIFE_REFUSALS.shiftInherited.message(7),
  shiftTooFar: LIFE_REFUSALS.shiftTooFar.message(2),
  notATitle: LIFE_REFUSALS.notATitle.message(), fieldsAlready: LIFE_REFUSALS.fieldsAlready.message(true),
  notFields: LIFE_REFUSALS.notFields.message('{weather}, {date:fancy}, {'),
  fieldsStillThere: LIFE_REFUSALS.fieldsStillThere.message(),
  noDatedFiles: LIFE_REFUSALS.noDatedFiles.message(), tooManyEvents: LIFE_REFUSALS.tooManyEvents.message(), eventFileKind: LIFE_REFUSALS.eventFileKind.message(), eventLastFile: LIFE_REFUSALS.eventLastFile.message(),
  eventTooManyFiles: LIFE_REFUSALS.eventTooManyFiles.message(),
  eventNothingToChange: LIFE_REFUSALS.eventNothingToChange.message(), eventFileNotIn: LIFE_REFUSALS.eventFileNotIn.message(), eventAddAndRemove: LIFE_REFUSALS.eventAddAndRemove.message(),
};

describe('Hebrew wording of the life-line refusals (ADR-0021)', () => {
  it('every refusal of the table is recognised and worded in Hebrew, with its numbers and brace groups kept; no pattern is left without a refusal', () => {
    const matched = new Set<number>();
    for (const [key, message] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', message);
      expect(he, `${key}: ${message}`).toBeDefined();
      expect(he, key).toMatch(/[֐-׿]/);
      const hits = LIFE_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, `${key} is recognised by exactly one life-line pattern`).toBe(1);
      matched.add(hits[0]!);
      expect(translateRefusal('en', message), key).toBeUndefined(); // English shows the server's own sentence
    }
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(LIFE_REFUSALS).sort());
    expect(LIFE_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', SAMPLES.shiftDayOnly)).toContain('41');
    expect(translateRefusal('he', SAMPLES.dateOutOfRange)).toMatch(/1900.*2100/);
    expect(translateRefusal('he', SAMPLES.tooManyEvents)).toContain('2000');
    expect(translateRefusal('he', SAMPLES.shiftTooFar)).toMatch(/2.*105716160/);
    expect(translateRefusal('he', SAMPLES.eventTooManyFiles)).toContain('5000');
    expect(translateRefusal('he', SAMPLES.notFields)).toContain('{weather}, {date:fancy}, {');
    expect(translateRefusal('he', LIFE_REFUSALS.fieldsAlready.message(false))).not.toBe(translateRefusal('he', SAMPLES.fieldsAlready));
  });
  it('the shared strings of the track exist in both languages: a headline for each preflight code, a line for each reason a field has no words, a label for each capture source, and the three palette commands', () => {
    const missing: string[] = [];
    const keys = [
      ...['field_no_data', 'field_sunset_undecided', 'capture_estimated', 'stamp_no_date'].map((c) => `preflight.${c}`),
      ...MISSING_REASONS.map((r) => `life.missing.${r}`),
      ...CaptureSchema.shape.source.options.map((s) => `life.capture.source.${s}`),
      'cmd.arrangeEvents', 'cmd.readCaptureDates', 'cmd.freezeFields',
    ];
    for (const lang of ['he', 'en'] as const) for (const k of keys) if (!(dictionaries[lang] as Record<string, string>)[k]?.trim()) missing.push(`${lang} ${k}`);
    expect(missing).toEqual([]);
    for (const k of keys) expect((dictionaries.he as Record<string, string>)[k], k).not.toBe((dictionaries.en as Record<string, string>)[k]);
  });
  // The samples above are built from the table. This holds them against the operations: each refusal, provoked for real with
  // the same values, is thrown as exactly the sample sentence (packages/evals/src/refusal-wording.test.ts has the life-line case
  // that words the provoked refusals in Hebrew).
  it('every life-line refusal is provoked for real through its operation and its message is recognised', () => {
    let n = 0;
    const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `lw${n++}_`, actor: 'test', allowInternal });
    const f = (frame: number) => T.frameTime(frame, { num: 30, den: 1 });
    const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
    const video = (hash: string, capture?: Capture) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov, ...(capture ? { capture } : {}) });
    const evening: Capture = { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' };
    const copy = { ...video('d'), provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_t', capabilityId: 'test.fixture', capabilityVersion: '0.0.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: ['?'], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, sourceRangeStart: T.rt(2, 1), audio: 'source-copied' } } };
    const sound = { kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(8, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
    const table = { kind: 'lut' as const, name: 'look.cube', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 2, title: null }, provenance: prov };
    let r = tx(createProject({ id: 'prj_lw', name: 'LW' }), [video('a', evening), video('b', { at: '2024-03-24', utcOffsetMinutes: null, source: 'filename', circa: true }), video('c'), sound, table].map((asset) => ({ op: 'import_asset', args: { asset } })), true);
    const [a, dayOnly, undated, soundId, lut] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string, string];
    r = tx(r.doc, [{ op: 'import_asset', args: { asset: { ...copy, provenance: { ...copy.provenance, derived: { ...copy.provenance.derived, sourceAssetIds: [a] } } } } }], true);
    const copyId = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: '{date}', start: f(0), duration: f(60) } }, { op: 'add_event', args: { assetIds: [a, dayOnly] } }]);
    const d = r.doc, clipId = r.results[0]!.output!.clipId as string, titleId = r.results[1]!.output!.clipId as string, eventId = r.results[2]!.output!.eventId as string;
    /** The document with `count` more library files like `like`, and their ids. */
    const more = (doc: ProjectDocument, like: string, count: number, tag: string, change: (asset: ProjectDocument['assets'][string]) => void = () => {}) => {
      const out = structuredClone(doc), ids = Array.from({ length: count }, (_, i) => `ast_${tag}${i}`);
      for (const id of ids) { out.assets[id] = { ...structuredClone(out.assets[like]!), id }; change(out.assets[id]!); }
      return { doc: out, ids };
    };
    const noDate = more(d, undated, 2, 'u'), days = more(d, dayOnly, 40, 'y'), copies = more(d, copyId, 6, 'k'), drifted = more(d, a, 2, 'x', (asset) => { asset.capture = { ...evening, shiftedMinutes: MAX_CAPTURE_SHIFT_MINUTES }; });
    const event = (id: string, assetIds: string[]): LifeEvent => ({ id, name: '', afterSunset: null, assetIds, origin: { method: 'manual', gapMinutes: null, createdBy: 'test', edited: true } });
    const full: ProjectDocument = { ...structuredClone(d), events: Object.fromEntries(Array.from({ length: MAX_LIFE_EVENTS }, (_, i) => [`evt_${i}`, event(`evt_${i}`, [undated])])) };
    const crowd = more(d, undated, MAX_EVENT_FILES, 'm');
    crowd.doc.events = { evt_big: event('evt_big', crowd.ids) };
    const on: OpCall = { op: 'set_text_fields', args: { clipId: titleId, enabled: true } };
    const text = (t: string): OpCall => ({ op: 'update_text', args: { clipId: titleId, text: t } });
    const provoke: Record<LifeRefusalKey, [ProjectDocument, OpCall[]]> = {
      assetNotFound: [d, [{ op: 'set_asset_capture', args: { assetId: 'ast_w1', capture: null } }]],
      eventNotFound: [d, [{ op: 'remove_event', args: { eventId: 'evt_w1' } }]],
      lutHasNoDate: [d, [{ op: 'set_asset_capture', args: { assetId: lut, capture: { at: '2024-12-25' } } }]],
      noSuchDay: [d, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2023-02-29' } } }]],
      dateOutOfRange: [d, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2100-12-31' } } }, { op: 'shift_asset_captures', args: { assetIds: [undated], minutes: 1440 } }]],
      captureUnchanged: [d, [{ op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2021-06-01' } } }, { op: 'set_asset_capture', args: { assetId: undated, capture: { at: '2021-06-01' } } }]],
      noCaptureToRemove: [d, [{ op: 'set_asset_capture', args: { assetId: soundId, capture: null } }]],
      listedTwice: [d, [{ op: 'shift_asset_captures', args: { assetIds: [a, a], minutes: 60 } }]],
      shiftNoDate: [noDate.doc, [{ op: 'shift_asset_captures', args: { assetIds: [a, undated, ...noDate.ids], minutes: 60 } }]], // 3 without a date
      shiftDayOnly: [days.doc, [{ op: 'shift_asset_captures', args: { assetIds: [a, dayOnly, ...days.ids], minutes: 60 } }]], // 41 with a day only
      shiftInherited: [copies.doc, [{ op: 'shift_asset_captures', args: { assetIds: [copyId, ...copies.ids], minutes: 60 } }]], // 7 copies
      shiftTooFar: [drifted.doc, [{ op: 'shift_asset_captures', args: { assetIds: [a, ...drifted.ids], minutes: 60 } }]], // 2 with a total at its bound
      notATitle: [d, [{ op: 'set_text_fields', args: { clipId, enabled: true } }]],
      fieldsAlready: [d, [on, on]],
      notFields: [d, [text('{weather} {date:fancy} a { b'), on]],
      fieldsStillThere: [d, [on, { op: 'set_text_fields', args: { clipId: titleId, enabled: false } }]],
      noDatedFiles: [tx(d, [{ op: 'remove_event', args: { eventId } }, { op: 'set_asset_capture', args: { assetId: a, capture: null } }, { op: 'set_asset_capture', args: { assetId: dayOnly, capture: null } }]).doc, [{ op: 'cluster_events', args: {} }]],
      tooManyEvents: [full, [{ op: 'cluster_events', args: {} }]],
      eventFileKind: [d, [{ op: 'update_event', args: { eventId, addAssetIds: [soundId] } }]],
      eventLastFile: [d, [{ op: 'update_event', args: { eventId, removeAssetIds: [dayOnly, a] } }]],
      eventTooManyFiles: [crowd.doc, [{ op: 'update_event', args: { eventId: 'evt_big', addAssetIds: [a, dayOnly] } }]],
      eventNothingToChange: [d, [{ op: 'update_event', args: { eventId, addAssetIds: [a] } }]],
      eventFileNotIn: [d, [{ op: 'update_event', args: { eventId, removeAssetIds: [undated] } }]],
      eventAddAndRemove: [d, [{ op: 'update_event', args: { eventId, addAssetIds: [undated], removeAssetIds: [undated] } }]],
    };
    expect(Object.keys(provoke).sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const [key, [doc, ops]] of Object.entries(provoke) as [LifeRefusalKey, [ProjectDocument, OpCall[]]][]) {
      let thrown: unknown;
      try { tx(doc, ops); } catch (e) { thrown = e; }
      expect(thrown, `${key} was not refused`).toBeInstanceOf(OpError);
      expect((thrown as OpError).message, key).toBe(SAMPLES[key]);
      expect((thrown as OpError).code, key).toBe(LIFE_REFUSALS[key].code);
      expect(translateRefusal('he', (thrown as OpError).message), key).toMatch(/[֐-׿]/);
    }
  });
});
