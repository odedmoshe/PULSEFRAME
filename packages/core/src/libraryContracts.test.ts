/**
 * The library track's contract (wave 7; .artifacts/wave7/library-decisions.md): the ledger mirror, the tool's "last appended wins"
 * rule, the optional schema fields and the validate rule, and the two operations' honest "not built" state. The it.todo rows name
 * what worker B must make pass (licenceDuties, collectCredits, archiveLibraryPlan, the op bodies).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, currentEntries, CUSTOM_LICENCES, getOp, LedgerEntrySchema, LedgerSchema, LIBRARY_OPS_BUILT, LIBRARY_REFUSALS, LibraryRecordSchema,
  OpError, ProjectSchema, sanitiseSvg, SPDX_LICENCES, TextClipSchema, validateProject, type LibraryRecord,
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
  it('the SVG check (built by worker A) passes a plain SVG and refuses a script; svgSafety.test.ts holds the full list', () => {
    expect(sanitiseSvg('<svg xmlns="http://www.w3.org/2000/svg"/>').ok).toBe(true);
    expect(sanitiseSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>').ok).toBe(false);
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
  it.todo('B: licenceDuties — exact SPDX only; compound ids, unknown custom strings and no licence are licence_unknown; -SA/-ND/GPL refused; -NC and personalOnly non-commercial and not shareable; diskOnly or repoAllowed false not shareable; creditInExport → on_screen; flags never loosen');
  it.todo('B: libraryRecordIssues — diskOnly, nonCommercial and credit required where licenceDuties says so; an unknown licence id is an issue');
  it.todo('B: use_library_item — adds a new asset; attaches the record to an existing asset with the same content (recordAttached); replaces a different record; refuses notLibraryAsset, licenceUnknown, licenceNoDerivatives, licenceShareAlike, creditMissing, recordWeaker; undo restores exactly');
  it.todo('B: add_credits_card — heading + body after the last clip, role credits, ltr body, frame-aligned; a second run replaces the first card; noCredits, creditsTooLong, a locked text track refused as add_text; undo restores the document hash');
  it.todo('B: collectCredits — timeline order, verbatim, repeats dropped, muted clips count, CC0 absent, onScreenMissing satisfied by the owner\'s own title; descriptionText he and en');
  it.todo('B: archiveLibraryPlan — omits exactly the non-shareable library blobs and their conform originals, with notices');
});
