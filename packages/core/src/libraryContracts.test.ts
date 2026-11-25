/**
 * The library track's contract (wave 7; .artifacts/wave7/library-decisions.md): the ledger mirror, the tool's "last appended wins"
 * rule, the optional schema fields and the validate rule, and the two operations' honest "not built" state. The it.todo rows name
 * what worker B must make pass (licenceDuties, collectCredits, archiveLibraryPlan, the op bodies).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as T from '@pulseframe/time';
import {
  applyTransaction, archiveLibraryPlan, collectCredits, createProject, creativeProjection, currentEntries, CUSTOM_LICENCES, diffEntities, getOp, LedgerEntrySchema, LedgerSchema,
  libraryRecordIssues, licenceDuties, LIBRARY_OPS_BUILT, LIBRARY_REFUSALS, LibraryRecordSchema, OpError, ProjectSchema, restoreEntities, sanitiseSvg, shareable, SPDX_LICENCES,
  TextClipSchema, validateProject, type LibraryRecord, type ProjectDocument,
} from './index.ts';

const sample = JSON.parse(fs.readFileSync(new URL('../../fixtures/library/ledger.sample.json', import.meta.url), 'utf8'));
const record: LibraryRecord = {
  itemId: 'synthetic-tones/a440.wav', sourceId: 'synthetic-tones', kind: 'music', title: 'A440', sourceSha256: 'a'.repeat(64),
  ledger: { item: 'tones/a440' }, licence: { id: 'CC0-1.0' }, flags: {},
};
const asset = (provenance: Record<string, unknown>) => ({ kind: 'audio' as const, name: 'a440.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(2, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload', importedAt: '2026-11-25T10:00:00Z', importedBy: 'user:local', ...provenance } });

describe('the ledger mirror (tools/library/fetch.d.mts LedgerEntry)', () => {
  it('reads the sample ledger and every entry of it', () => {
    const led = LedgerSchema.parse(sample);
    for (const e of led.entries) expect(LedgerEntrySchema.safeParse(e).success).toBe(true);
  });
  it('refuses a ledger of another version, as fetch.mjs does', () => {
    expect(LedgerSchema.safeParse({ ...sample, ledgerVersion: 2 }).success).toBe(false);
  });
  it('the current entry of an item is the last appended, never the one with the latest time (fetch.mjs findLast)', () => {
    const cur = currentEntries(LedgerSchema.parse(sample).entries.map((e) => LedgerEntrySchema.parse(e)));
    const tone = cur.find((e) => e.item === 'tones/a440')!;
    expect(tone.sha256).toBe('b'.repeat(64)); // appended second, with an EARLIER time
    expect(cur.map((e) => e.item)).toEqual(['tones/a440', 'ccby/track', 'icons/package', 'personal/sound']);
  });
});

describe('the optional schema fields', () => {
  it('a library record and the credits role parse; unknown keys and a non-true flag do not', () => {
    expect(LibraryRecordSchema.safeParse(record).success).toBe(true);
    expect(LibraryRecordSchema.safeParse({ ...record, extra: 1 }).success).toBe(false);
    expect(LibraryRecordSchema.safeParse({ ...record, flags: { nonCommercial: false } }).success).toBe(false);
    expect(TextClipSchema.shape.role.safeParse('credits').success).toBe(true);
    expect(TextClipSchema.shape.role.safeParse('title').success).toBe(false);
  });
  it('validate: a library record only on an upload, never beside an upload record, a raster only on a picture', () => {
    const doc = createProject({ id: 'prj_lib', name: 'L', width: 640, height: 360 });
    doc.assets.a1 = { id: 'a1', ...asset({ library: record }) } as never;
    expect(ProjectSchema.safeParse(doc).success).toBe(true);
    expect(validateProject(doc).filter((i) => i.code === 'library_provenance')).toEqual([]);
    doc.assets.a1 = { id: 'a1', ...asset({ origin: 'fixture', library: record, upload: { via: 'browser', jobId: 'job_1' } }) } as never;
    doc.assets.a2 = { id: 'a2', ...asset({ library: { ...record, raster: { longSide: 512, by: 'ffmpeg-librsvg' } } }), contentHash: `sha256:${'c'.repeat(64)}` } as never;
    expect(validateProject(doc).filter((i) => i.code === 'library_provenance').map((i) => i.ids[0])).toEqual(['a1', 'a1', 'a2']);
  });
});

describe('the licence tables (fail-closed contract)', () => {
  it('no share-alike, no-derivatives or GPL id is admitted, and every custom row names its exact ledger string and a quote', () => {
    expect(Object.keys(SPDX_LICENCES).filter((id) => /-SA|-ND|GPL/.test(id))).toEqual([]);
    for (const [id, row] of Object.entries(CUSTOM_LICENCES)) expect({ id, custom: row.custom.length > 0, quote: row.quote.length > 20 }).toEqual({ id, custom: true, quote: true });
  });
  it('the SVG check refuses everything until it is built (fail-closed)', () => {
    expect(sanitiseSvg('<svg xmlns="http://www.w3.org/2000/svg"/>').ok).toBe(false);
  });
});

describe('the library operations before worker B', () => {
  it('both are registered: use_library_item internal, add_credits_card public', () => {
    expect(getOp('use_library_item')?.internal).toBe(true);
    expect(getOp('add_credits_card')?.internal ?? false).toBe(false);
  });
  it.runIf(!LIBRARY_OPS_BUILT)('each refuses with notBuilt and changes nothing', () => {
    const doc = createProject({ id: 'prj_lib2', name: 'L', width: 640, height: 360 });
    const before = JSON.stringify(doc);
    for (const [op, args] of [['use_library_item', { asset: asset({ library: record }) }], ['add_credits_card', {}]] as const) {
      let err: unknown;
      try { applyTransaction(doc, [{ op, args }], { idSeed: 'lc_', actor: 'test', allowInternal: true }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(OpError);
      expect((err as OpError).message).toBe(LIBRARY_REFUSALS.notBuilt.message(op));
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
});

// ---------- worker B: the bodies ----------
/** The flags the fetch tool always writes, at their permissive values (each test makes them stricter). */
const OPEN = { diskOnly: false, creditInExport: false, shareAlike: false, people: false, aiGenerated: false, repoAllowed: true } as const;

describe('licenceDuties (fail-closed table)', () => {
  it('admits exact SPDX ids only; compound ids, case variants, unknown custom strings and no licence are licence_unknown', () => {
    expect(licenceDuties('s', { spdx: 'CC0-1.0' }, OPEN)).toEqual({ use: 'ok', licenceId: 'CC0-1.0', credit: false, nonCommercial: false, shareable: true, placement: 'description' });
    expect(licenceDuties('s', { spdx: 'CC-BY-4.0' }, OPEN)).toMatchObject({ use: 'ok', credit: true, nonCommercial: false, shareable: true });
    for (const spdx of ['MIT AND BSD-3-Clause AND BSD-2-Clause', 'MIT OR Apache-2.0', 'cc0-1.0', 'CC0', 'CC-BY-4.0 ', 'Proprietary', 'toString', '__proto__', 'constructor'])
      expect({ spdx, use: licenceDuties('s', { spdx }, OPEN).use }).toEqual({ spdx, use: 'licence_unknown' });
    expect(licenceDuties('s', {}, OPEN).use).toBe('licence_unknown');
    expect(licenceDuties('s', { spdx: '', custom: '' }, OPEN).use).toBe('licence_unknown');
    expect(licenceDuties('s', { spdx: 'CC0-1.0', custom: 'anything' }, OPEN).use).toBe('licence_unknown');
    // a custom licence only through its own source's row and its exact string
    const musopen = CUSTOM_LICENCES['musopen-flac']!.custom;
    expect(licenceDuties('musopen-flac', { custom: musopen }, OPEN)).toEqual({ use: 'ok', licenceId: 'custom:musopen-flac', credit: false, nonCommercial: false, shareable: false, placement: 'description' });
    expect(licenceDuties('musopen-flac', { custom: `${musopen}.` }, OPEN).use).toBe('licence_unknown');
    expect(licenceDuties('other-source', { custom: musopen }, OPEN).use).toBe('licence_unknown');
    expect(licenceDuties('sonniss', { custom: 'Sonniss GDC licence' }, OPEN).use).toBe('licence_unknown');
    expect(licenceDuties('toString', { custom: 'x' }, OPEN).use).toBe('licence_unknown');
  });
  it('-SA, -ND and GPL ids are refused by name; -NC is non-commercial and never shareable', () => {
    for (const spdx of ['CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'GPL-3.0-only', 'LGPL-2.1-or-later', 'AGPL-3.0-only', 'CC-BY-NC-SA-4.0']) expect({ spdx, use: licenceDuties('s', { spdx }, OPEN).use }).toEqual({ spdx, use: 'licence_share_alike' });
    for (const spdx of ['CC-BY-ND-4.0', 'CC-BY-NC-ND-4.0']) expect({ spdx, use: licenceDuties('s', { spdx }, OPEN).use }).toEqual({ spdx, use: 'licence_no_derivatives' });
    for (const spdx of ['CC-BY-NC-3.0', 'CC-BY-NC-4.0']) expect(licenceDuties('s', { spdx }, OPEN)).toMatchObject({ use: 'ok', credit: true, nonCommercial: true, shareable: false });
  });
  it('flags only make a row stricter, and no duty is lifted by a flag being absent', () => {
    const cc0 = (flags: Record<string, boolean>) => licenceDuties('s', { spdx: 'CC0-1.0' }, flags);
    expect(cc0({ ...OPEN, personalOnly: true })).toMatchObject({ use: 'ok', nonCommercial: true, shareable: false });
    expect(cc0({ ...OPEN, diskOnly: true })).toMatchObject({ use: 'ok', nonCommercial: false, shareable: false });
    expect(cc0({ ...OPEN, repoAllowed: false })).toMatchObject({ use: 'ok', shareable: false });
    expect(cc0({ ...OPEN, shareAlike: true }).use).toBe('licence_share_alike');
    // a credit goes in the description: creditInExport means "due with every export" (lead decision 2026-11-25), not on screen;
    // only creditOnScreen: true (not written by the fetch tool today) asks for it on screen
    expect(licenceDuties('s', { spdx: 'CC-BY-4.0' }, { ...OPEN, creditInExport: true }).placement).toBe('description');
    expect(licenceDuties('s', { spdx: 'CC-BY-4.0' }, { ...OPEN, creditInExport: true, creditOnScreen: true })).toMatchObject({ use: 'ok', credit: true, placement: 'on_screen' });
    expect(licenceDuties('s', { spdx: 'CC-BY-4.0' }, { ...OPEN, creditOnScreen: false }).placement).toBe('description');
    // absent flags: never the permissive answer
    const { diskOnly: _d, ...noDisk } = OPEN, { repoAllowed: _r, ...noRepo } = OPEN, { creditInExport: _c, ...noCredit } = OPEN, { shareAlike: _s, ...noSa } = OPEN;
    expect(cc0(noDisk).shareable).toBe(false);
    expect(cc0(noRepo).shareable).toBe(false);
    expect(licenceDuties('s', { spdx: 'CC-BY-4.0' }, noCredit)).toMatchObject({ use: 'ok', credit: true, placement: 'description' });
    expect(cc0(noSa).use).toBe('licence_unknown');
    expect(cc0({}).use).toBe('licence_unknown');
    // a flag this build does not know, set true, may be a restriction: unknown. Known benign ones and false values pass.
    expect(cc0({ ...OPEN, noRemix: true }).use).toBe('licence_unknown');
    expect(cc0({ ...OPEN, noRemix: false, needsOwnerKey: true, trademark: true }).use).toBe('ok');
    // no flag can loosen the table: an NC row stays non-commercial and disk-only whatever the flags say
    expect(licenceDuties('s', { spdx: 'CC-BY-NC-4.0' }, { ...OPEN, personalOnly: false })).toMatchObject({ nonCommercial: true, shareable: false, credit: true });
    expect(licenceDuties('musopen-flac', { custom: CUSTOM_LICENCES['musopen-flac']!.custom }, { ...OPEN, diskOnly: false, repoAllowed: true }).shareable).toBe(false);
  });
  it('every admitted row of the tables gives use ok with the table\'s own values (no row is loosened by the code)', () => {
    for (const [id, row] of Object.entries(SPDX_LICENCES)) expect(licenceDuties('s', { spdx: id }, OPEN)).toEqual({ use: 'ok', licenceId: id, credit: row.credit, nonCommercial: row.nonCommercial, shareable: row.shareable, placement: 'description' });
  });
});

describe('libraryRecordIssues', () => {
  const rec = (over: Partial<LibraryRecord>): LibraryRecord => ({ ...record, ...over });
  it('a record as the table wants it has no issue; weaker ones are named', () => {
    expect(libraryRecordIssues(record)).toEqual([]);
    expect(libraryRecordIssues(rec({ licence: { id: 'CC-BY-4.0' }, credit: { text: 'A by B', placement: 'description' } }))).toEqual([]);
    expect(libraryRecordIssues(rec({ licence: { id: 'CC-BY-4.0' } }))).toEqual(['its library licence requires a credit, and the record has none']);
    expect(libraryRecordIssues(rec({ licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'c', placement: 'either' } }))).toEqual([
      'the library record is weaker than its licence: it must be marked non-commercial', 'the library record is weaker than its licence: it must be marked disk-only']);
    expect(libraryRecordIssues(rec({ licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'c', placement: 'either' }, flags: { nonCommercial: true, diskOnly: true } }))).toEqual([]);
    // non-commercial by the ledger (personalOnly) on a CC0 file: must stay on this computer
    expect(libraryRecordIssues(rec({ flags: { nonCommercial: true } }))).toEqual(['the library record is weaker than its licence: it must be marked disk-only']);
    expect(libraryRecordIssues(rec({ sourceId: 'musopen-flac', licence: { id: 'custom:musopen-flac' } }))).toEqual(['the library record is weaker than its licence: it must be marked disk-only']);
    expect(libraryRecordIssues(rec({ sourceId: 'musopen-flac', licence: { id: 'custom:musopen-flac' }, flags: { diskOnly: true } }))).toEqual([]);
  });
  it('an unknown licence id is an issue: other source\'s custom row, unknown SPDX, ND, SA', () => {
    for (const [id, word] of [['custom:musopen-flac', 'is not one the editor knows'], ['custom:sonniss', 'is not one the editor knows'], ['MIT AND ISC', 'is not one the editor knows'], ['CC-BY-ND-4.0', 'forbids changing'], ['CC-BY-SA-4.0', 'would require sharing']] as const)
      expect({ id, issue: libraryRecordIssues(rec({ licence: { id } }))[0]?.includes(word) }).toEqual({ id, issue: true });
  });
});

// ---------- the operations ----------
const ctx = (seed: string, allowInternal = true) => ({ idSeed: seed, actor: 'test', allowInternal });
const hashOf = (k: string) => `sha256:${k.repeat(64).slice(0, 64)}`;
const libAsset = (k: string, lib: Partial<LibraryRecord>, over: Record<string, unknown> = {}) => ({ ...asset({ library: { ...record, itemId: `s/${k}.wav`, title: `T${k}`, sourceSha256: k.repeat(64).slice(0, 64), ...lib } }), contentHash: hashOf(k), name: `${k}.wav`, ...over });
const undoOf = (before: ProjectDocument, after: ProjectDocument) => { const back = structuredClone(after); restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before }))); return back; };
const refusedBy = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return { code: e.code, message: e.message }; throw e; } return null; };
function fresh(): ProjectDocument { return createProject({ id: 'prj_ops', name: 'O', width: 640, height: 360 }); }

describe('use_library_item', () => {
  it('the bodies are built', () => expect(LIBRARY_OPS_BUILT).toBe(true));
  it('adds a new asset; the same record again is deduplicated; undo restores exactly', () => {
    const d0 = fresh();
    const r1 = applyTransaction(d0, [{ op: 'use_library_item', args: { asset: libAsset('1', {}) } }], ctx('u1_'));
    const out = r1.results[0]!.output as { assetId: string; deduplicated: boolean; recordAttached: boolean };
    expect(out).toEqual({ assetId: expect.any(String), deduplicated: false, recordAttached: false });
    expect(r1.doc.assets[out.assetId]!.provenance.library!.itemId).toBe('s/1.wav');
    expect(validateProject(r1.doc)).toEqual([]);
    expect(creativeProjection(undoOf(d0, r1.doc))).toBe(creativeProjection(d0));
    const r2 = applyTransaction(r1.doc, [{ op: 'use_library_item', args: { asset: libAsset('1', {}) } }], ctx('u2_'));
    expect(r2.results[0]!.output).toEqual({ assetId: out.assetId, deduplicated: true, recordAttached: false });
    expect(JSON.stringify(r2.doc)).toBe(JSON.stringify(r1.doc));
  });
  it('attaches the record to a file uploaded by hand (its upload record gives way); replaces a different record; undo restores each', () => {
    const d0 = applyTransaction(fresh(), [{ op: 'import_asset', args: { asset: { ...asset({ upload: { via: 'browser', jobId: 'job_1' } }), contentHash: hashOf('2') } } }], ctx('i_')).doc;
    const id = Object.keys(d0.assets)[0]!;
    const r1 = applyTransaction(d0, [{ op: 'use_library_item', args: { asset: libAsset('2', {}) } }], ctx('u3_'));
    expect(r1.results[0]!.output).toEqual({ assetId: id, deduplicated: true, recordAttached: true });
    expect(Object.keys(r1.doc.assets)).toEqual([id]);
    expect(r1.doc.assets[id]!.provenance.upload).toBeUndefined();
    expect(r1.doc.assets[id]!.provenance.library!.title).toBe('T2');
    expect(validateProject(r1.doc)).toEqual([]);
    expect(creativeProjection(undoOf(d0, r1.doc))).toBe(creativeProjection(d0));
    const r2 = applyTransaction(r1.doc, [{ op: 'use_library_item', args: { asset: libAsset('2', { title: 'Renamed', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Renamed by Someone', placement: 'description' } }) } }], ctx('u4_'));
    expect(r2.results[0]!.output).toEqual({ assetId: id, deduplicated: true, recordAttached: true });
    expect(r2.doc.assets[id]!.provenance.library!.licence.id).toBe('CC-BY-4.0');
    expect(creativeProjection(undoOf(r1.doc, r2.doc))).toBe(creativeProjection(r1.doc));
  });
  it('refuses, changing nothing: no record, unknown, ND, SA, credit missing, weaker records', () => {
    const d0 = fresh(), before = JSON.stringify(d0);
    const cases: [Record<string, unknown>, string][] = [
      [{ ...asset({}), contentHash: hashOf('3') }, LIBRARY_REFUSALS.notLibraryAsset.message()],
      [libAsset('3', { licence: { id: 'custom:unknown-source' } }), LIBRARY_REFUSALS.licenceUnknown.message()],
      [libAsset('3', { licence: { id: 'MIT AND ISC' } }), LIBRARY_REFUSALS.licenceUnknown.message()],
      [libAsset('3', { licence: { id: 'CC-BY-ND-4.0' } }), LIBRARY_REFUSALS.licenceNoDerivatives.message()],
      [libAsset('3', { licence: { id: 'CC-BY-SA-4.0' } }), LIBRARY_REFUSALS.licenceShareAlike.message()],
      [libAsset('3', { licence: { id: 'CC-BY-4.0' } }), LIBRARY_REFUSALS.creditMissing.message()],
      [libAsset('3', { licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'x', placement: 'either' } }), LIBRARY_REFUSALS.recordWeaker.message('non-commercial')],
      [libAsset('3', { licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'x', placement: 'either' }, flags: { nonCommercial: true } }), LIBRARY_REFUSALS.recordWeaker.message('disk-only')],
      [libAsset('3', { sourceId: 'musopen-flac', licence: { id: 'custom:musopen-flac' } }), LIBRARY_REFUSALS.recordWeaker.message('disk-only')],
    ];
    for (const [a, message] of cases) expect(refusedBy(() => applyTransaction(d0, [{ op: 'use_library_item', args: { asset: a } }], ctx('r_')))?.message).toBe(message);
    // internal: an API client cannot issue it
    expect(refusedBy(() => applyTransaction(d0, [{ op: 'use_library_item', args: { asset: libAsset('3', {}) } }], ctx('r_', false)))?.code).toBe('forbidden_op');
    expect(JSON.stringify(d0)).toBe(before);
  });
});

/** A project with a CC0 track (no credit), a CC-BY track (credit on screen), an NC sound and a CC-BY picture, laid out on the timeline. */
function creditsProject(): ProjectDocument {
  const uses = [
    libAsset('a', { kind: 'music', title: 'Zero' }),
    libAsset('b', { kind: 'music', title: 'Song', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Song Kevin   MacLeod (incompetech.com)\nLicensed under CC BY 4.0', placement: 'on_screen' } }),
    libAsset('c', { kind: 'sound', title: 'Bird', licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'Bird by Rec', placement: 'either' }, flags: { nonCommercial: true, diskOnly: true } }),
    { ...libAsset('d', { kind: 'sticker', title: 'Star', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Star set by Ann — CC BY 4.0 (https://example.invalid)', placement: 'description' } }), kind: 'image', container: 'png', mimeType: 'image/png', duration: T.ZERO, audio: undefined, image: { width: 64, height: 64, codec: 'png', hasAlpha: true } },
  ];
  let d = fresh();
  const ids: string[] = [];
  for (const [i, a] of uses.entries()) { const r = applyTransaction(d, [{ op: 'use_library_item', args: { asset: a } }], ctx(`c${i}_`)); d = r.doc; ids.push((r.results[0]!.output as { assetId: string }).assetId); }
  const f = (n: number) => T.frameTime(n, d.settings.frameRate);
  d = applyTransaction(d, [
    { op: 'add_clip', args: { assetId: ids[3], start: f(0), duration: f(30) } },
    { op: 'add_clip', args: { assetId: ids[2], start: f(10), duration: f(30) } },
    { op: 'add_clip', args: { assetId: ids[1], start: f(20), duration: f(30) } },
    { op: 'add_clip', args: { assetId: ids[0], start: f(30), duration: f(30) } },
    { op: 'add_clip', args: { assetId: ids[1], start: f(60), duration: f(10) } },
  ], ctx('cl_', false)).doc;
  return d;
}

describe('collectCredits', () => {
  it('timeline order inside music, sounds, pictures; verbatim; repeats dropped; CC0 absent; NC listed; description text he and en', () => {
    const d = creditsProject();
    const r = collectCredits(d);
    expect(r.lines.map((l) => [l.group, l.title, l.text])).toEqual([
      ['music', 'Song', 'Song Kevin   MacLeod (incompetech.com)\nLicensed under CC BY 4.0'],
      ['sound', 'Bird', 'Bird by Rec'],
      ['picture', 'Star', 'Star set by Ann — CC BY 4.0 (https://example.invalid)'],
    ]);
    expect(r.nonCommercial.map((n) => n.title)).toEqual(['Bird']);
    expect(r.descriptionText('he')).toBe('קרדיטים\n\nSong Kevin   MacLeod (incompetech.com)\nLicensed under CC BY 4.0\n\nBird by Rec\n\nStar set by Ann — CC BY 4.0 (https://example.invalid)\n\nלשימוש לא מסחרי בלבד: Bird');
    expect(r.descriptionText('en')).toBe('Credits\n\nSong Kevin   MacLeod (incompetech.com)\nLicensed under CC BY 4.0\n\nBird by Rec\n\nStar set by Ann — CC BY 4.0 (https://example.invalid)\n\nFor non-commercial use only: Bird');
    expect(r.onScreenMissing.map((l) => l.title)).toEqual(['Song']);
    expect(collectCredits(fresh()).descriptionText('he')).toBe('');
    expect(() => collectCredits(d, { sequenceId: 'seq_none' })).toThrow(/not found/);
  });
  it('muted and hidden clips still count; removing the clip removes its line', () => {
    const d = creditsProject();
    for (const t of d.sequences[d.mainSequenceId]!.tracks) { t.muted = true; t.hidden = true; }
    expect(collectCredits(d).lines.length).toBe(3);
    const star = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media' && d.assets[c.assetId]!.provenance.library!.title === 'Star')!;
    const d2 = applyTransaction(creditsProject(), [{ op: 'delete_clip', args: { clipId: star.id } }], ctx('del_', false)).doc;
    expect(collectCredits(d2).lines.map((l) => l.title)).toEqual(['Song', 'Bird']);
  });
  it('the owner\'s own title satisfies an on-screen credit (whitespace-normalised); a hidden title does not', () => {
    const d = creditsProject();
    const end = T.frameTime(70, d.settings.frameRate);
    const own = applyTransaction(d, [{ op: 'add_text', args: { text: 'Music: Song Kevin MacLeod (incompetech.com) Licensed under CC BY 4.0 — thanks', start: end, duration: T.frameTime(30, d.settings.frameRate) } }], ctx('t_', false));
    expect(collectCredits(own.doc).onScreenMissing).toEqual([]);
    const tid = (own.results[0]!.output as { trackId: string }).trackId;
    own.doc.sequences[own.doc.mainSequenceId]!.tracks.find((t) => t.id === tid)!.hidden = true;
    expect(collectCredits(own.doc).onScreenMissing.map((l) => l.title)).toEqual(['Song']);
  });
  it('a file made from a library file carries its credit and its marks', () => {
    const d = creditsProject();
    const bird = Object.values(d.assets).find((a) => a.provenance.library?.title === 'Bird')!;
    const derived = { ...asset({}), id: 'ast_stem', contentHash: hashOf('e'), provenance: { origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'job', derived: { jobId: 'job_x', capabilityId: 'x', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: [bird.id], outputName: 'o', outputRole: 'r', encoding: 'wav', provider: {} } } };
    const solo = fresh();
    solo.assets = { [bird.id]: bird, ast_stem: derived as never };
    solo.sequences[solo.mainSequenceId]!.tracks.push({ id: 'trk_a', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, clips: [{ id: 'clp_s', type: 'media', assetId: 'ast_stem', start: T.ZERO, duration: T.rt(1, 1), sourceIn: T.ZERO, gain: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } } as never] });
    const r = collectCredits(solo);
    expect(r.lines.map((l) => l.text)).toEqual(['Bird by Rec']);
    expect(r.nonCommercial.map((n) => n.title)).toEqual(['Bird']);
    expect(archiveLibraryPlan(solo).omit).toEqual([bird.contentHash, hashOf('e')].sort());
  });
});

describe('add_credits_card', () => {
  it('heading + body after the last clip, role credits, ltr body, frame-aligned; a second run replaces the first; undo restores the document', () => {
    const d0 = creditsProject();
    const r1 = applyTransaction(d0, [{ op: 'add_credits_card', args: {} }], ctx('cc1_', false));
    const out = r1.results[0]!.output as { clipIds: string[]; trackId: string; removed: number };
    expect(out.removed).toBe(0);
    const clips = r1.doc.sequences[r1.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text' && c.role === 'credits');
    expect(clips.map((c) => c.id).sort()).toEqual([...out.clipIds].sort());
    const [heading, body] = out.clipIds.map((id) => clips.find((c) => c.id === id)!) as [Extract<typeof clips[number], { type: 'text' }>, Extract<typeof clips[number], { type: 'text' }>];
    expect(heading.text).toBe('קרדיטים');
    expect(body.text).toBe(collectCredits(d0).lines.map((l) => l.text).join('\n'));
    expect(body.style.direction).toBe('ltr');
    expect(body.style.align).toBe('center');
    const rate = r1.doc.settings.frameRate;
    expect(T.eq(body.start, T.frameTime(70, rate))).toBe(true);
    expect(T.eq(body.duration, T.frameTime(Math.round((4 * rate.num) / rate.den), rate))).toBe(true);
    expect(T.isFrameAligned(body.start, rate) && T.isFrameAligned(body.duration, rate)).toBe(true);
    expect(collectCredits(r1.doc).onScreenMissing).toEqual([]);
    expect(validateProject(r1.doc)).toEqual([]);
    expect(creativeProjection(undoOf(d0, r1.doc))).toBe(creativeProjection(d0));
    // again, in English and 8 seconds: the earlier card goes, the new one starts where the earlier one started (after the last other clip)
    const r2 = applyTransaction(r1.doc, [{ op: 'add_credits_card', args: { lang: 'en', seconds: 8 } }], ctx('cc2_', false));
    const out2 = r2.results[0]!.output as { clipIds: string[]; removed: number };
    expect(out2.removed).toBe(2);
    const cards = r2.doc.sequences[r2.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text' && c.role === 'credits');
    expect(cards.map((c) => c.id).sort()).toEqual([...out2.clipIds].sort());
    expect(cards.every((c) => T.eq(c.start, T.frameTime(70, rate)))).toBe(true);
    expect(cards.some((c) => c.type === 'text' && c.text === 'Credits')).toBe(true);
    expect(creativeProjection(undoOf(r1.doc, r2.doc))).toBe(creativeProjection(r1.doc));
  });
  it('a frame rate where seconds are not whole frames still gives frame-aligned times', () => {
    const d = createProject({ id: 'prj_ntsc', name: 'N', width: 640, height: 360, frameRate: { num: 30000, den: 1001 } });
    const r = applyTransaction(d, [{ op: 'use_library_item', args: { asset: libAsset('b', { licence: { id: 'CC-BY-4.0' }, credit: { text: 'B by C', placement: 'description' } }) } }], ctx('n_'));
    const id = (r.results[0]!.output as { assetId: string }).assetId;
    const placed = applyTransaction(r.doc, [{ op: 'add_clip', args: { assetId: id, start: T.ZERO, duration: T.frameTime(7, d.settings.frameRate) } }], ctx('n2_', false)).doc;
    const card = applyTransaction(placed, [{ op: 'add_credits_card', args: { seconds: 3 } }], ctx('n3_', false)).doc;
    for (const c of card.sequences[card.mainSequenceId]!.tracks.flatMap((t) => t.clips)) expect(T.isFrameAligned(c.start, d.settings.frameRate) && T.isFrameAligned(c.duration, d.settings.frameRate)).toBe(true);
  });
  it('refuses, changing nothing: nothing needs a credit, too long, an earlier card on a locked track, unknown sequence', () => {
    const plain = fresh();
    expect(refusedBy(() => applyTransaction(plain, [{ op: 'add_credits_card', args: {} }], ctx('x_', false)))?.message).toBe(LIBRARY_REFUSALS.noCredits.message());
    // only a CC0 file: still nothing to credit
    const r = applyTransaction(plain, [{ op: 'use_library_item', args: { asset: libAsset('a', {}) } }], ctx('x1_'));
    const id = (r.results[0]!.output as { assetId: string }).assetId;
    const cc0 = applyTransaction(r.doc, [{ op: 'add_clip', args: { assetId: id, start: T.ZERO, duration: T.frameTime(5, r.doc.settings.frameRate) } }], ctx('x2_', false)).doc;
    expect(refusedBy(() => applyTransaction(cc0, [{ op: 'add_credits_card', args: {} }], ctx('x3_', false)))?.message).toBe(LIBRARY_REFUSALS.noCredits.message());
    // many long credits
    let big = fresh();
    for (let i = 0; i < 6; i++) {
      const k = 'abcdef'[i]!;
      const u = applyTransaction(big, [{ op: 'use_library_item', args: { asset: libAsset(k, { licence: { id: 'CC-BY-4.0' }, credit: { text: `${k} `.repeat(200).trim(), placement: 'description' } }) } }], ctx(`b${i}_`));
      big = applyTransaction(u.doc, [{ op: 'add_clip', args: { assetId: (u.results[0]!.output as { assetId: string }).assetId, start: T.frameTime(i * 5, big.settings.frameRate), duration: T.frameTime(5, big.settings.frameRate) } }], ctx(`bc${i}_`, false)).doc;
    }
    const n = collectCredits(big).lines.map((l) => l.text).join('\n').length;
    expect(refusedBy(() => applyTransaction(big, [{ op: 'add_credits_card', args: {} }], ctx('x4_', false)))?.message).toBe(LIBRARY_REFUSALS.creditsTooLong.message(n));
    // the earlier card on a locked track
    const carded = applyTransaction(creditsProject(), [{ op: 'add_credits_card', args: {} }], ctx('x5_', false));
    const cardTrack = (carded.results[0]!.output as { trackId: string }).trackId;
    const locked = applyTransaction(carded.doc, [{ op: 'update_track', args: { trackId: cardTrack, locked: true } }], ctx('x6_', false)).doc;
    const before = JSON.stringify(locked);
    expect(refusedBy(() => applyTransaction(locked, [{ op: 'add_credits_card', args: {} }], ctx('x7_', false)))?.code).toBe('track_locked');
    expect(refusedBy(() => applyTransaction(locked, [{ op: 'add_credits_card', args: { sequenceId: 'seq_none' } }], ctx('x8_', false)))?.code).toBe('not_found');
    expect(JSON.stringify(locked)).toBe(before);
  });
});

describe('archiveLibraryPlan', () => {
  it('omits exactly the non-shareable library blobs and their conform originals, with notices; nothing for shareable or plain files', () => {
    const d = creditsProject();
    expect(archiveLibraryPlan(fresh())).toEqual({ omit: [], omitted: [], notices: [] });
    const bird = Object.values(d.assets).find((a) => a.provenance.library?.title === 'Bird')!;
    bird.conform = { originalContentHash: hashOf('9'), method: 'x', frameMapping: 'identity' } as never;
    const plan = archiveLibraryPlan(d);
    expect(plan.omit).toEqual([bird.contentHash, hashOf('9')].sort());
    expect(plan.omitted.map((o) => [o.assetId, o.licenceId])).toEqual([[bird.id, 'CC-BY-NC-4.0'], [bird.id, 'CC-BY-NC-4.0']]);
    expect(plan.notices).toEqual([{ title: 'Bird', licenceId: 'CC-BY-NC-4.0', credit: 'Bird by Rec', url: null }]);
    for (const a of Object.values(d.assets)) expect({ t: a.provenance.library?.title, s: shareable(a) }).toEqual({ t: a.provenance.library?.title, s: a.id !== bird.id });
  });
  it('a disk-only record of an admitted licence, an unknown licence and a non-commercial record are never shareable', () => {
    const base = { ...asset({}), id: 'a' } as never as Parameters<typeof shareable>[0];
    const withLib = (lib: Partial<LibraryRecord>) => ({ ...base, provenance: { ...base.provenance, library: { ...record, ...lib } } });
    expect(shareable(base)).toBe(true);
    expect(shareable(withLib({}))).toBe(true);
    expect(shareable(withLib({ flags: { diskOnly: true } }))).toBe(false);
    expect(shareable(withLib({ flags: { nonCommercial: true } }))).toBe(false);
    expect(shareable(withLib({ licence: { id: 'Unknown-1.0' } }))).toBe(false);
    expect(shareable(withLib({ licence: { id: 'CC-BY-NC-4.0' } }))).toBe(false);
    expect(shareable(withLib({ sourceId: 'musopen-flac', licence: { id: 'custom:musopen-flac' } }))).toBe(false);
  });
});

describe('the summary\'s library part', () => {
  it('names the licence, the credit verbatim and the marks; a file without a record has none', async () => {
    const { summarize } = await import('./index.ts');
    const d = creditsProject();
    const parts = summarize(d).assets.map((a) => (a as { library?: unknown }).library ?? null);
    expect(parts).toContainEqual({ itemId: 's/c.wav', title: 'Bird', licenceId: 'CC-BY-NC-4.0', credit: 'Bird by Rec', creditPlacement: 'either', nonCommercial: true, shareable: false, people: false });
    expect(parts).toContainEqual({ itemId: 's/a.wav', title: 'Zero', licenceId: 'CC0-1.0', credit: null, creditPlacement: null, nonCommercial: false, shareable: true, people: false });
    expect(summarize(applyTransaction(fresh(), [{ op: 'import_asset', args: { asset: asset({}) } }], ctx('s_')).doc).assets[0]).not.toHaveProperty('library');
  });
});

describe('a courtesy credit (a licence that needs none) is listed, never a duty', () => {
  it('CC0 with a credit text: listed in the credits, never on-screen missing, never makes a credits card', async () => {
    const { recordNeedsCredit, creditDue } = await import('./index.ts');
    expect(recordNeedsCredit(record)).toBe(false);
    expect(recordNeedsCredit({ ...record, licence: { id: 'CC-BY-4.0' } })).toBe(true);
    const r = applyTransaction(fresh(), [{ op: 'use_library_item', args: { asset: libAsset('a', { title: 'Kind', credit: { text: 'Thanks to Kind Person', placement: 'on_screen' } }) } }], ctx('k_'));
    const id = (r.results[0]!.output as { assetId: string }).assetId;
    const d = applyTransaction(r.doc, [{ op: 'add_clip', args: { assetId: id, start: T.ZERO, duration: T.frameTime(5, r.doc.settings.frameRate) } }], ctx('k2_', false)).doc;
    const c = collectCredits(d);
    expect(c.lines.map((l) => l.text)).toEqual(['Thanks to Kind Person']);
    expect(creditDue(d, c.lines[0]!)).toBe(false);
    expect(c.onScreenMissing).toEqual([]);
    expect(refusedBy(() => applyTransaction(d, [{ op: 'add_credits_card', args: {} }], ctx('k3_', false)))?.message).toBe(LIBRARY_REFUSALS.noCredits.message());
  });
});
