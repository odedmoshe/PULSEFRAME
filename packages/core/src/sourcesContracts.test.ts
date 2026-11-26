/**
 * The sources track's contract in core (wave 8 `sources`, part A; sources-verify.md C1–C17): the record, its validation rule
 * (source_provenance, C4a/C5, data facts only), the one licence table (licenceFacts, C14), the term rows (C15), the download limit
 * (C6) and use_source_item's honest not-built state. The it.todo rows name what W1 must make pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, CREDIT_PLACEMENTS, FIT_METHOD, getOp, LEARN, licenceFacts, OpError, ProjectSchema, SOURCE_OP_REFUSALS, SOURCE_TERMS, SourceRecordSchema,
  sourceRecordKey, sourceRecordProblems, SOURCES_BUILT, sourcesMaxBytes, SPDX_LICENCES, validateProject, type ProjectDocument, type SourceRecord,
} from './index.ts';

const HEX = 'a'.repeat(64);
const rec = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  provider: 'openverse', itemId: 'ov-1', kind: 'photo', title: 'Rain', author: 'Someone', fetchedAt: '2026-11-26T10:00:00Z', sha256: HEX, byteSize: 100,
  licence: { id: 'CC-BY-4.0', name: 'by 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', from: 'item' },
  credit: { text: '"Rain" by Someone is licensed under CC BY 4.0.', placement: 'description', due: true }, flags: {}, ...over,
});
const asset = (provenance: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ id: 'a1', kind: 'image', name: 'rain.jpg', contentHash: `sha256:${HEX}`, byteSize: 100, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: 64, height: 64, codec: 'mjpeg', hasAlpha: false }, provenance: { origin: 'upload', importedAt: '2026-11-26T10:00:00Z', importedBy: 'user:local', ...provenance }, ...over });
const issuesOf = (a: Record<string, unknown>) => {
  const doc: ProjectDocument = createProject({ id: 'prj_src', name: 'S', width: 640, height: 360 });
  doc.assets.a1 = a as never;
  expect(ProjectSchema.safeParse(doc).success).toBe(true);
  return validateProject(doc).filter((i) => i.code === 'source_provenance').map((i) => i.message.replace(/^asset a1: /, ''));
};

describe('the record (schema)', () => {
  it('parses; unknown keys, a false flag, a prefixed hash and a bad provider id do not', () => {
    expect(SourceRecordSchema.safeParse(rec()).success).toBe(true);
    expect(SourceRecordSchema.safeParse({ ...rec(), extra: 1 }).success).toBe(false);
    expect(SourceRecordSchema.safeParse(rec({ flags: { nonCommercial: false } as never })).success).toBe(false);
    expect(SourceRecordSchema.safeParse(rec({ sha256: `sha256:${HEX}` })).success).toBe(false);
    expect(SourceRecordSchema.safeParse(rec({ provider: 'Open Verse' })).success).toBe(false);
  });
  it('credit placements are schema.ts CREDIT_PLACEMENTS (the contract imports only zod)', () => {
    expect(SourceRecordSchema.shape.credit.unwrap().shape.placement.options).toEqual([...CREDIT_PLACEMENTS]);
  });
  it('"the same record" ignores fetchedAt and byteSize and key order (C5.2)', () => {
    expect(sourceRecordKey(rec())).toBe(sourceRecordKey(rec({ fetchedAt: '2027-01-01T00:00:00Z', byteSize: 5 })));
    expect(sourceRecordKey(rec())).not.toBe(sourceRecordKey(rec({ title: 'Rain 2' })));
  });
});

describe('validate source_provenance (C4a, C5; data facts only)', () => {
  it('an upload with a matching record has no issue; nor does a CC BY-SA, CC BY-ND or unknown licence marked as such', () => {
    expect(issuesOf(asset({ source: rec() }))).toEqual([]);
    expect(issuesOf(asset({ source: rec({ licence: { id: 'CC-BY-SA-4.0', name: 'by-sa 4.0', from: 'item' }, flags: { shareAlike: true, licenceUnconfirmed: true, notShareable: true } }) }))).toEqual([]);
    expect(issuesOf(asset({ source: rec({ licence: { id: 'CC-BY-ND-4.0', name: 'by-nd 4.0', from: 'item' }, flags: { noDerivatives: true, licenceUnconfirmed: true, notShareable: true } }) }))).toEqual([]);
    expect(issuesOf(asset({ source: rec({ licence: { id: 'unknown', name: '', from: 'none' }, credit: undefined, flags: { licenceUnconfirmed: true, notShareable: true } }) }))).toEqual([]);
  });
  it('the hash is the original\'s: a conformed copy compares conform.originalContentHash (C5)', () => {
    const conform = { originalContentHash: `sha256:${HEX}`, originalByteSize: 100, reasons: ['codec'], original: { codec: 'x', width: 64, height: 64, avgFrameRate: '0/0', rFrameRate: '0/0', rotation: 0, frameCount: null, durationSeconds: 0 }, frameMapping: 'identity', method: 'test' };
    expect(issuesOf(asset({ source: rec() }, { contentHash: `sha256:${'b'.repeat(64)}`, conform }))).toEqual([]);
    expect(issuesOf(asset({ source: rec() }, { contentHash: `sha256:${'b'.repeat(64)}` }))).toEqual(['the source record names other bytes than the file\'s original']);
  });
  it('only an upload, never beside an upload or library record; only a link names how it was fetched', () => {
    expect(issuesOf(asset({ origin: 'generated', source: rec() }))).toEqual(['only a fetched file (or a song shortened from one) carries a source record']);
    expect(issuesOf(asset({ source: rec(), upload: { via: 'browser', jobId: 'job_1' } }))).toEqual(['a fetched file has no upload record']);
    const lib = { itemId: 'x/y', sourceId: 'x', kind: 'illustration', title: 'Y', sourceSha256: HEX, ledger: { item: 'x' }, licence: { id: 'CC0-1.0' }, flags: {} };
    expect(issuesOf(asset({ source: rec(), library: lib }))).toEqual(['a file carries a library record or a source record, not both']);
    expect(issuesOf(asset({ source: rec({ provider: 'link' }) }))).toEqual(['a link records how it was fetched, and only a link does']);
    expect(issuesOf(asset({ source: rec({ provider: 'link', link: { via: 'direct', host: 'example.invalid' } }) }))).toEqual([]);
  });
  it('a shortened song carries its one source\'s record (origin derived + fitted, C4a): no source_provenance issue', () => {
    const fitted = { sourceAssetId: 'ast_s', method: FIT_METHOD, startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(28, 1) }, crossfade: T.rt(40, 1000), joinAt: T.rt(8, 1), measured: { similarity: 0.9, levelStepDb: 0.4, phraseBars: 4, tempoSpreadMs: 0, beatConfidence: 0.9 } };
    const song = { kind: 'audio', name: 's.wav', contentHash: `sha256:${'c'.repeat(64)}`, container: 'wav', mimeType: 'audio/wav', duration: T.rt(40, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, image: undefined };
    expect(issuesOf(asset({ origin: 'derived', fitted, source: rec({ kind: 'music' }) }, song))).toEqual([]);
  });
  it('a record weaker than its own licence id, or missing the credit it names, is a data fact', () => {
    expect(issuesOf(asset({ source: rec({ credit: undefined }) }))).toEqual(['its licence "CC-BY-4.0" names a credit, and the source record has none']);
    expect(sourceRecordProblems(rec({ licence: { id: 'CC-BY-NC-4.0', name: 'by-nc', from: 'item' } }))).toEqual([{ key: 'recordWeaker', what: 'non-commercial' }, { key: 'recordWeaker', what: 'not-shareable' }]);
    expect(sourceRecordProblems(rec({ credit: { text: 'x', placement: 'either', due: false } }))).toEqual([{ key: 'recordWeaker', what: 'credit-due' }]);
    expect(sourceRecordProblems(rec({ licence: { id: 'provider:pixabay', name: 'Pixabay Content License', from: 'provider' }, credit: { text: 'by X on Pixabay', placement: 'either', due: false } }))).toEqual([{ key: 'recordWeaker', what: 'licence-unconfirmed' }, { key: 'recordWeaker', what: 'not-shareable' }]);
  });
});

describe('one licence table (C14)', () => {
  it('admitted ids answer the library table\'s own values', () => {
    for (const id of Object.keys(SPDX_LICENCES)) {
      const f = licenceFacts(id);
      expect([id, f.known, f.shareAlike, f.noDerivatives]).toEqual([id, true, false, false]);
      expect([id, f.credit]).toEqual([id, SPDX_LICENCES[id]!.credit]);
    }
    expect(licenceFacts('CC-BY-NC-4.0')).toEqual({ known: true, credit: true, nonCommercial: true, shareAlike: false, noDerivatives: false, shareable: false });
  });
  it('ids outside the table: share-alike, no-derivatives, unknown; never shareable; CC BY family names a credit', () => {
    expect(licenceFacts('CC-BY-SA-4.0')).toEqual({ known: false, credit: true, nonCommercial: false, shareAlike: true, noDerivatives: false, shareable: false });
    expect(licenceFacts('CC-BY-NC-ND-4.0')).toEqual({ known: false, credit: true, nonCommercial: true, shareAlike: false, noDerivatives: true, shareable: false });
    expect(licenceFacts('provider:pixabay')).toEqual({ known: false, credit: false, nonCommercial: false, shareAlike: false, noDerivatives: false, shareable: false });
    expect(licenceFacts('unknown').known).toBe(false);
  });
});

describe('term rows (C15): quotes with link and date, no conclusion', () => {
  it('every row has a quote, a https link, the day read and both languages; the deed rows quote the deeds verbatim', () => {
    for (const [id, r] of Object.entries(SOURCE_TERMS)) expect([id, r.quote.length > 20, r.url.startsWith('https://'), r.readOn, r.he.length > 0, r.en.length > 0]).toEqual([id, true, true, '2026-11-26', true, true]);
    expect(SOURCE_TERMS['cc.nd']!.quote).toBe('If you remix, transform, or build upon the material, you may not distribute the modified material.');
    expect(SOURCE_TERMS['cc.sa']!.quote).toBe('If you remix, transform, or build upon the material, you must distribute your contributions under the same license as the original.');
    for (const id of ['cc.nd', 'cc.sa']) expect(SOURCE_TERMS[id]!.he).toContain('תרגום');
  });
});

describe('download limit (C6)', () => {
  it('the setting, never above the upload limit; none = the upload limit', () => {
    expect(sourcesMaxBytes(null, 2000)).toBe(2000);
    expect(sourcesMaxBytes(500, 2000)).toBe(500);
    expect(sourcesMaxBytes(5000, 2000)).toBe(2000);
  });
});

describe('use_source_item before W1', () => {
  it('is registered internal, with a LEARN row (C17c)', () => {
    expect(getOp('use_source_item')?.internal).toBe(true);
    expect(LEARN.use_source_item).toBeDefined();
  });
  it.runIf(!SOURCES_BUILT.op)('refuses with sources_not_built and changes nothing; an API client cannot issue it', () => {
    const doc = createProject({ id: 'prj_src2', name: 'S', width: 640, height: 360 });
    const before = JSON.stringify(doc);
    const { id: _id, ...a } = asset({ source: rec() });
    let err: unknown;
    try { applyTransaction(doc, [{ op: 'use_source_item', args: { asset: a } }], { idSeed: 's_', actor: 'test', allowInternal: true }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OpError);
    expect((err as OpError).message).toBe(SOURCE_OP_REFUSALS.notBuilt.message());
    expect((err as OpError).details).toMatchObject({ why: 'sources_not_built' });
    let forbidden: unknown;
    try { applyTransaction(doc, [{ op: 'use_source_item', args: { asset: a } }], { idSeed: 's_', actor: 'test' }); } catch (e) { forbidden = e; }
    expect((forbidden as OpError).code).toBe('forbidden_op');
    expect(JSON.stringify(doc)).toBe(before);
  });
  it.todo('W1: adds the asset; the same record again (sourceRecordKey) is deduplicated; undo restores exactly');
  it.todo('W1: bytes uploaded by hand get the record (upload record gives way); a library copy keeps its library record (libraryKept, C5.1)');
  it.todo('W1: refuses only data facts (notSourceAsset, hashMismatch, recordWeaker, creditMissing); CC BY-SA/ND, provider: and unknown licences are added with warnings');
  it.todo('W1: sourceDuties — warnings in order, deed rows quoted (cc.nd, cc.sa), term rows of the record, non_commercial_content');
  it.todo('W1: licensedOrigins yields library and source origins over derived/voice/instruments/fitted; collectCredits, creditDue, shareable, archiveLibraryPlan, export lines and the summary read it; credits.golden stays byte-identical');
  it.todo('W1: a CC BY source credit is due: on-screen missing, in the export reminder, and enough for add_credits_card (C3)');
  it.todo('W1: music fit — a source song is shortened with a warning (never refused for ND/SA/unknown), its copy carries the source record (C4); soundRoleOf counts source music');
});
