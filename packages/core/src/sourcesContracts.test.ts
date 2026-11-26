/**
 * The sources track's contract in core (wave 8 `sources`, part A; sources-verify.md C1–C17): the record, its validation rule
 * (source_provenance, C4a/C5, data facts only), the one licence table (licenceFacts, C14), the term rows (C15), the download limit
 * (C6), and W1's bodies: use_source_item, sourceDuties, licensedOrigins with every credit reader (C3), and music fit of a source song (C4).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, archiveLibraryPlan, collectCredits, createProject, creativeProjection, creditDue, creditsView, CREDIT_PLACEMENTS, diffEntities, FIT_GRID_METHOD, FIT_METHOD, fitLicenceProblem, fitSourceNotes, fittedLibraryRecord, fittedSourceRecord, getOp, LEARN,
  licenceFacts, licensedOrigins, MUSICFIT_REFUSALS, OpError, ProjectSchema, restoreEntities, shareable, soundRoleOf, SOURCE_OP_REFUSALS, SOURCE_TERMS, sourceDuties, SourceRecordSchema, sourceRecordKey,
  sourceRecordProblems, sourcesMaxBytes, SPDX_LICENCES, summarize, validateProject, type Asset, type LibraryRecord, type ProjectDocument, type SourceRecord, type UseSourceItemOutput,
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
  it('open mode with no upload limit set (ADR-0036 I9; uploadCapFor = none): the setting alone, or none (null: the free space and the disk reserve are the limit)', () => {
    expect(sourcesMaxBytes(null, null)).toBeNull();
    expect(sourcesMaxBytes(5000, null)).toBe(5000);
    expect(sourcesMaxBytes(5000, Number.POSITIVE_INFINITY)).toBe(5000);
    expect(sourcesMaxBytes(null, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('use_source_item registration', () => {
  it('is registered internal, with a LEARN row (C17c)', () => {
    expect(getOp('use_source_item')?.internal).toBe(true);
    expect(LEARN.use_source_item).toBeDefined();
  });
  it('an API client cannot issue it (internal: forbidden_op) and nothing changes', () => {
    const doc = createProject({ id: 'prj_src2', name: 'S', width: 640, height: 360 });
    const before = JSON.stringify(doc);
    const { id: _id, ...a } = asset({ source: rec() });
    let forbidden: unknown;
    try { applyTransaction(doc, [{ op: 'use_source_item', args: { asset: a } }], { idSeed: 's_', actor: 'test' }); } catch (e) { forbidden = e; }
    expect((forbidden as OpError).code).toBe('forbidden_op');
    expect(JSON.stringify(doc)).toBe(before);
  });
});

// ---------------------------------------------------------------- W1: the bodies
const R30 = { num: 30, den: 1 };
let seedN = 0;
const tx = (doc: ProjectDocument, ops: { op: string; args: unknown }[]) => applyTransaction(doc, ops, { idSeed: `w1_${seedN++}_`, actor: 'agent:test', allowInternal: true });
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const hx = (n: number) => n.toString(16).padStart(64, '0');
/** A fetched file (AssetSchema without id) whose bytes are hx(n) and whose record is `r` (sha256 set to the bytes). */
const fetched = (n: number, r: Partial<SourceRecord> = {}, over: Record<string, unknown> = {}) => {
  const { id: _i, ...a } = asset({ source: { ...rec(), sha256: hx(n), ...r } }, { contentHash: `sha256:${hx(n)}`, ...over });
  return a;
};
const ND = { licence: { id: 'CC-BY-ND-4.0', name: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/', from: 'item' as const }, flags: { noDerivatives: true, licenceUnconfirmed: true, notShareable: true } as SourceRecord['flags'] };
const SA = { licence: { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', from: 'item' as const }, flags: { shareAlike: true, licenceUnconfirmed: true, notShareable: true } as SourceRecord['flags'] };
const NC = { licence: { id: 'CC-BY-NC-4.0', name: 'CC BY-NC 4.0', from: 'item' as const }, flags: { nonCommercial: true, notShareable: true } as SourceRecord['flags'] };
const PIXABAY = { licence: { id: 'provider:pixabay', name: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/', from: 'provider' as const }, credit: undefined, flags: { licenceUnconfirmed: true, notShareable: true } as SourceRecord['flags'], terms: ['pixabay.licence_unread', 'pixabay.hotlink'] };
const UNKNOWN = { licence: { id: 'unknown', name: '', from: 'none' as const }, credit: undefined, flags: { licenceUnconfirmed: true, notShareable: true } as SourceRecord['flags'] };
const blank = () => createProject({ id: 'prj_w1', name: 'W1', width: 640, height: 360, frameRate: R30 });
const out = (r: ReturnType<typeof tx>) => r.results[0]!.output as unknown as UseSourceItemOutput;
/** Adds the fetched file and places it at `at` seconds for 2 s on a new track of the main sequence. */
function placed(doc: ProjectDocument, a: ReturnType<typeof fetched>, at = 0) {
  const r = tx(doc, [{ op: 'use_source_item', args: { asset: a } }]);
  const id = out(r).assetId;
  return { doc: tx(r.doc, [{ op: 'add_clip', args: { assetId: id, start: T.rt(at, 1), duration: T.rt(2, 1) } }]).doc, id };
}

describe('use_source_item (W1)', () => {
  it('adds the asset; the same record again (sourceRecordKey) is deduplicated with no change; undo restores exactly', () => {
    const doc = blank();
    const r = tx(doc, [{ op: 'use_source_item', args: { asset: fetched(1) } }]);
    const o = out(r);
    expect(o).toEqual({ assetId: o.assetId, deduplicated: false, recordAttached: false, libraryKept: false, warnings: [] });
    expect(r.doc.assets[o.assetId]!.provenance.source).toEqual({ ...rec(), sha256: hx(1) });
    expect(r.affectedIds).toEqual([o.assetId]);
    expect(validateProject(r.doc)).toEqual([]);
    // fetched again later: another fetch time and size count as the same record (C5.2)
    const again = tx(r.doc, [{ op: 'use_source_item', args: { asset: fetched(1, { fetchedAt: '2026-11-27T00:00:00Z', byteSize: 101 }) } }]);
    expect(out(again)).toMatchObject({ assetId: o.assetId, deduplicated: true, recordAttached: false, libraryKept: false });
    expect(again.affectedIds).toEqual([]);
    expect(JSON.stringify(again.doc)).toBe(JSON.stringify(r.doc));
    // generic undo: restore the entities the commit touched
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
    expect(Object.keys(back.assets)).toEqual([]);
    // the op stays internal
    expect(refusal(() => applyTransaction(doc, [{ op: 'use_source_item', args: { asset: fetched(1) } }], { idSeed: 'x_', actor: 'agent:test' })).code).toBe('forbidden_op');
  });
  it('bytes uploaded by hand get the record (the upload record gives way); another record of the same bytes replaces it; a library copy keeps its library record (C5.1)', () => {
    const doc = blank();
    doc.assets.ast_up = { ...fetched(2), id: 'ast_up', provenance: { origin: 'upload', importedAt: '2026-11-26T09:00:00Z', importedBy: 'user:local', upload: { via: 'browser', jobId: 'job_1' } } } as Asset;
    const r = tx(doc, [{ op: 'use_source_item', args: { asset: fetched(2) } }]);
    expect(out(r)).toMatchObject({ assetId: 'ast_up', deduplicated: true, recordAttached: true, libraryKept: false });
    expect(r.doc.assets.ast_up!.provenance.upload).toBeUndefined();
    expect(r.doc.assets.ast_up!.provenance.source?.sha256).toBe(hx(2));
    expect(r.doc.assets.ast_up!.provenance.importedAt).toBe('2026-11-26T09:00:00Z');
    expect(validateProject(r.doc)).toEqual([]);
    const other = tx(r.doc, [{ op: 'use_source_item', args: { asset: fetched(2, { title: 'Rain, again' }) } }]);
    expect(out(other)).toMatchObject({ assetId: 'ast_up', recordAttached: true });
    expect(other.doc.assets.ast_up!.provenance.source?.title).toBe('Rain, again');
    const lib: LibraryRecord = { itemId: 'x/y', sourceId: 'x', kind: 'illustration', title: 'Y', sourceSha256: hx(3), ledger: { item: 'x' }, licence: { id: 'CC0-1.0' }, flags: {} };
    const withLib = blank();
    withLib.assets.ast_lib = { ...fetched(3), id: 'ast_lib', provenance: { origin: 'upload', importedAt: '2026-11-26T09:00:00Z', importedBy: 'user:local', library: lib } } as Asset;
    const kept = tx(withLib, [{ op: 'use_source_item', args: { asset: fetched(3, ND) } }]);
    expect(out(kept)).toEqual({ assetId: 'ast_lib', deduplicated: true, recordAttached: false, libraryKept: true, warnings: [] });
    expect(kept.affectedIds).toEqual([]);
    expect(JSON.stringify(kept.doc)).toBe(JSON.stringify(withLib));
  });
  it('refuses only data facts (notSourceAsset, hashMismatch, recordWeaker, creditMissing), changing nothing; CC BY-SA/ND, provider: and unknown licences are added with warnings', () => {
    const doc = blank();
    const before = JSON.stringify(doc);
    const why = (a: unknown) => { const e = refusal(() => tx(doc, [{ op: 'use_source_item', args: { asset: a } }])); return [e.code, e.details.why, e.message]; };
    const { source: _s, ...noRecord } = fetched(4).provenance as Record<string, unknown>;
    expect(why({ ...fetched(4), provenance: noRecord })).toEqual(['invalid_args', 'source_no_record', SOURCE_OP_REFUSALS.notSourceAsset.message()]);
    expect(why(fetched(4, {}, { contentHash: `sha256:${hx(5)}` }))).toEqual(['invalid_args', 'source_hash_mismatch', SOURCE_OP_REFUSALS.hashMismatch.message()]);
    expect(why(fetched(4, { licence: NC.licence }))).toEqual(['invalid_args', 'source_record_weaker', SOURCE_OP_REFUSALS.recordWeaker.message('non-commercial')]);
    expect(why(fetched(4, { credit: undefined }))).toEqual(['incompatible', 'source_credit_missing', SOURCE_OP_REFUSALS.creditMissing.message()]);
    expect(JSON.stringify(doc)).toBe(before);
    // licence findings are never refusals
    for (const [extra, codes] of [[ND, ['licence_no_derivatives']], [SA, ['licence_share_alike']], [PIXABAY, ['licence_unconfirmed', 'source_terms']], [UNKNOWN, ['licence_unknown']], [NC, ['non_commercial_content']]] as const) {
      const r = tx(doc, [{ op: 'use_source_item', args: { asset: fetched(6, extra) } }]);
      expect(out(r).warnings.map((w) => w.code)).toEqual(codes);
      expect(out(r).warnings.every((w) => w.assetId === out(r).assetId)).toBe(true);
      expect(validateProject(r.doc)).toEqual([]);
    }
  });
});

describe('sourceDuties (W1): warnings in order, the licence named, deed rows quoted, never a conclusion', () => {
  it('orders ND/SA, unknown, unconfirmed, terms, non-commercial; quotes cc.nd / cc.sa verbatim with the licence name and link', () => {
    const nd = sourceDuties({ ...rec(), ...ND, licence: { ...ND.licence, id: 'CC-BY-NC-ND-4.0', name: 'by-nc-nd 4.0' }, flags: { ...ND.flags, nonCommercial: true }, terms: ['wikimedia.attribution'] }, 'Bird');
    expect(nd.map((w) => [w.code, w.termIds])).toEqual([['licence_no_derivatives', ['cc.nd']], ['source_terms', ['wikimedia.attribution']], ['non_commercial_content', []]]);
    expect(nd[0]!.message).toContain(SOURCE_TERMS['cc.nd']!.quote);
    expect(nd[0]!.message).toContain('"by-nc-nd 4.0" (CC-BY-NC-ND-4.0)');
    expect(nd[0]!).toMatchObject({ title: 'Bird', licenceId: 'CC-BY-NC-ND-4.0', licenceName: 'by-nc-nd 4.0' });
    expect(nd[1]!.message).toContain(SOURCE_TERMS['wikimedia.attribution']!.quote);
    const sa = sourceDuties({ ...rec(), ...SA }, 'Sea');
    expect(sa.map((w) => w.code)).toEqual(['licence_share_alike']);
    expect(sa[0]!.message).toContain(SOURCE_TERMS['cc.sa']!.quote);
    expect(sa[0]!.message).toContain(SA.licence.url);
    expect(sourceDuties({ ...rec(), ...UNKNOWN }, 'X').map((w) => w.code)).toEqual(['licence_unknown']);
    // a pasted link (C11): the warning names the host, never the link's path (a share link's path is its token; job rows carry warnings)
    const linked = sourceDuties({ ...rec(), ...UNKNOWN, provider: 'link', itemId: 'f'.repeat(32), pageUrl: 'https://files.example.invalid/s/tok3n/clip.mp4', link: { via: 'direct', host: 'files.example.invalid' } }, 'clip.mp4');
    expect(linked[0]!.message).toContain('files.example.invalid');
    expect(linked[0]!.message).not.toContain('tok3n');
    expect(sourceDuties({ ...rec(), ...PIXABAY }, 'X').map((w) => w.code)).toEqual(['licence_unconfirmed', 'source_terms']);
    expect(sourceDuties({ ...rec(), licence: { id: 'CC0-1.0', name: 'cc0', from: 'item' }, credit: undefined }, 'X')).toEqual([]);
    expect(sourceDuties(rec(), 'X')).toEqual([]);
    // an unknown term id is not quoted (nothing is made up)
    expect(sourceDuties({ ...rec(), terms: ['nobody.knows'] }, 'X')).toEqual([]);
    const all = [nd, sa, sourceDuties({ ...rec(), ...UNKNOWN }, 'X'), sourceDuties({ ...rec(), ...PIXABAY }, 'X')].flat().map((w) => w.message).join('\n');
    // our own words, without the verbatim quotes (a service's terms may say "allowed"; that is their sentence, not ours)
    const ours = Object.values(SOURCE_TERMS).reduce((t, row) => t.split(row.quote).join(''), all);
    expect(ours).not.toMatch(/\bsafe\b|\bverified\b|\ballowed\b|forbids|may not be used|must not/i);
  });
});

describe('licensedOrigins and the credit readers (W1, C3)', () => {
  it('yields library and source origins over derived, voice and fitted; collectCredits, creditDue, shareable, archive and summary read it', () => {
    let { doc, id: by } = placed(blank(), fetched(10), 0);
    const nd = placed(doc, fetched(11, { ...ND, title: 'Statue', credit: { text: '"Statue" by B, CC BY-ND 4.0', placement: 'on_screen', due: true } }), 2); doc = nd.doc;
    const px = placed(doc, fetched(12, { ...PIXABAY, title: 'Dog', kind: 'video' }), 4); doc = px.doc;
    // a provider result made from the CC BY photo carries its duties
    doc.assets.ast_der = { ...fetched(13, {}, {}), id: 'ast_der', provenance: { origin: 'generated', importedAt: '2026-11-26T10:00:00Z', importedBy: 'agent:test', derived: { sourceAssetIds: [by] } } } as unknown as Asset;
    expect(licensedOrigins(doc, 'ast_der').map((o) => [o.origin, o.asset.id, o.due, o.shareable])).toEqual([['source', by, true, true]]);
    expect(licensedOrigins(doc, px.id)[0]).toMatchObject({ origin: 'source', due: false, shareable: false, licenceId: 'provider:pixabay', group: 'picture' });
    expect(licensedOrigins(doc, px.id)[0]!.licenceNotes.map((n) => [n.code, n.assetId])).toEqual([['licence_unconfirmed', px.id], ['source_terms', px.id]]);
    const r = collectCredits(doc);
    expect(r.lines.map((l) => [l.assetId, l.text, l.placement])).toEqual([[by, rec().credit!.text, 'description'], [nd.id, '"Statue" by B, CC BY-ND 4.0', 'on_screen']]);
    expect(r.lines.map((l) => creditDue(doc, l))).toEqual([true, true]);
    // C3: a due on-screen source credit not shown is missing on screen
    expect(r.onScreenMissing.map((l) => l.assetId)).toEqual([nd.id]);
    expect(r.licenceNotes?.map((n) => [n.code, n.assetId])).toEqual([['licence_no_derivatives', nd.id], ['licence_unconfirmed', px.id], ['source_terms', px.id]]);
    expect(creditsView(r, 'en').licenceNotes).toEqual(r.licenceNotes);
    expect(r.descriptionText('en')).toBe(`Credits\n\n${rec().credit!.text}\n\n"Statue" by B, CC BY-ND 4.0`);
    expect([shareable(doc.assets[by]!), shareable(doc.assets[nd.id]!), shareable(doc.assets[px.id]!)]).toEqual([true, false, false]);
    const plan = archiveLibraryPlan(doc);
    expect(plan.omitted.map((o) => [o.assetId, o.licenceId, o.title])).toEqual([[nd.id, 'CC-BY-ND-4.0', 'Statue'], [px.id, 'provider:pixabay', 'Dog']].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
    expect(plan.notices.find((n) => n.licenceId === 'CC-BY-ND-4.0')).toEqual({ title: 'Statue', licenceId: 'CC-BY-ND-4.0', credit: '"Statue" by B, CC BY-ND 4.0', url: ND.licence.url });
    const sum = (summarize(doc).assets as { id: string; source?: Record<string, unknown>; library?: unknown }[]).find((a) => a.id === nd.id)!;
    expect(sum.library).toBeUndefined();
    expect(sum.source).toMatchObject({ provider: 'openverse', licenceId: 'CC-BY-ND-4.0', licenceName: 'CC BY-ND 4.0', credit: '"Statue" by B, CC BY-ND 4.0', creditPlacement: 'on_screen', creditDue: true, shareable: false, warnings: ['licence_no_derivatives'] });
  });
  it('a project with only a CC BY source credit gets a credits card; a credit that is a courtesy (due false) does not make one', () => {
    const { doc } = placed(blank(), fetched(20));
    const card = tx(doc, [{ op: 'add_credits_card', args: { lang: 'en' } }]);
    const texts = card.doc.sequences[card.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).flatMap((c) => (c.type === 'text' && c.role === 'credits' ? [c.text] : []));
    expect(texts).toEqual(['Credits', rec().credit!.text]);
    const courtesy = placed(blank(), fetched(21, { licence: { id: 'CC0-1.0', name: 'cc0', from: 'item' }, credit: { text: 'Thanks to Someone', placement: 'description', due: false } })).doc;
    expect(collectCredits(courtesy).lines.map((l) => creditDue(courtesy, l))).toEqual([false]);
    expect(refusal(() => tx(courtesy, [{ op: 'add_credits_card', args: {} }])).message).toBe('nothing in this sequence needs a credit');
  });
  it('a file with no record has no origin and no notes; library-only reports carry no licenceNotes key', () => {
    const doc = blank();
    expect(licensedOrigins(doc, 'nope')).toEqual([]);
    expect('licenceNotes' in collectCredits(doc)).toBe(false);
    expect('licenceNotes' in creditsView(collectCredits(doc), 'he')).toBe(false);
  });
});

describe('music fit of a source song (W1, C4) and source music in soundRoleOf', () => {
  const songOf = (extra: Partial<SourceRecord>) => {
    const doc = blank();
    doc.assets.ast_s = { ...fetched(30, { kind: 'music', ...extra }, { kind: 'audio', name: 'song.wav', container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, image: undefined }), id: 'ast_s' } as Asset;
    const beats = Array.from({ length: 100 }, (_, k) => T.rt(k, 2));
    doc.analyses.ast_s = { assetId: 'ast_s', beats: { origin: { method: 'test grid', params: {}, createdAt: '2026-11-26T00:00:00Z', createdBy: 'test', edited: false }, bpm: 120, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0), meter: 4 } };
    return doc;
  };
  const made = (source: SourceRecord | null) => ({
    kind: 'audio', name: 'song (shortened).wav', contentHash: `sha256:${hx(77)}`, byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(40, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' },
    provenance: { origin: 'derived', importedAt: '2026-11-26T10:00:00Z', importedBy: 'agent:test', ...(source ? { source } : {}), fitted: { sourceAssetId: 'ast_s', method: FIT_METHOD, startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(28, 1) }, crossfade: T.rt(40, 1000), joinAt: T.rt(8, 1), measured: { similarity: 0.9, levelStepDb: 0.4, phraseBars: 4, tempoSpreadMs: 0, beatConfidence: 0.9 } } },
  });
  const g = () => { const beats = Array.from({ length: 80 }, (_, k) => T.rt(k, 2)); return { method: FIT_GRID_METHOD, bpm: 120, meter: 4, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0) }; };
  it('a CC BY-SA song is shortened with the share-alike warning quoting the deed; its copy carries the source record; its credit is listed as shortened', () => {
    const doc = songOf(SA);
    expect(fitLicenceProblem(doc, 'ast_s')).toBeNull();
    expect(fittedLibraryRecord(doc, 'ast_s')).toBeNull();
    const record = fittedSourceRecord(doc, 'ast_s')!;
    expect(record).toEqual(doc.assets.ast_s!.provenance.source);
    const notes = fitSourceNotes(doc, 'ast_s');
    expect(notes.map((n) => n.code)).toEqual(['licence_share_alike']);
    expect(notes[0]!.message).toContain(SOURCE_TERMS['cc.sa']!.quote);
    const r = tx(doc, [{ op: 'add_fitted_music', args: { asset: made(record), grid: g(), place: { start: T.ZERO } } }]);
    const id = (r.results[0]!.output as { assetId: string }).assetId;
    expect(r.doc.assets[id]!.provenance.source).toEqual(record);
    expect(validateProject(r.doc)).toEqual([]);
    const c = collectCredits(r.doc);
    expect(c.lines).toEqual([{ assetId: id, title: 'Rain', text: rec().credit!.text, placement: 'description', group: 'music', modified: 'shortened' }]);
    expect(c.descriptionText('en')).toContain('(shortened in the editor');
    // the made file must carry exactly its source's record (as the library one)
    expect(refusal(() => tx(doc, [{ op: 'add_fitted_music', args: { asset: made(null), grid: g() } }])).message).toBe(MUSICFIT_REFUSALS.licenceUnknown.message('CC-BY-SA-4.0'));
    // ND and unknown licences: warnings too, never refused
    expect(fitLicenceProblem(songOf(ND), 'ast_s')).toBeNull();
    expect(fitSourceNotes(songOf(ND), 'ast_s').map((n) => n.code)).toEqual(['licence_no_derivatives']);
    expect(fitSourceNotes(songOf(UNKNOWN), 'ast_s').map((n) => n.code)).toEqual(['licence_unknown']);
  });
  it('a file made from a library song and a source song stays refused (many origins, a fact); the library side is unchanged', () => {
    const doc = songOf({});
    const lib: LibraryRecord = { itemId: 'l/a', sourceId: 'l', kind: 'music', title: 'L', sourceSha256: hx(31), ledger: { item: 'l' }, licence: { id: 'CC0-1.0' }, flags: {} };
    doc.assets.ast_l = { ...doc.assets.ast_s!, id: 'ast_l', contentHash: `sha256:${hx(31)}`, provenance: { origin: 'upload', importedAt: '2026-11-26T10:00:00Z', importedBy: 'user:local', library: lib } } as Asset;
    doc.assets.ast_mix = { ...doc.assets.ast_s!, id: 'ast_mix', contentHash: `sha256:${hx(32)}`, provenance: { origin: 'generated', importedAt: '2026-11-26T10:00:00Z', importedBy: 'agent:test', derived: { sourceAssetIds: ['ast_l', 'ast_s'] } } } as unknown as Asset;
    expect(fitLicenceProblem(doc, 'ast_mix')).toEqual({ key: 'licenceManyOrigins', licenceId: null });
    expect(fitLicenceProblem(doc, 'ast_l')).toBeNull();
    expect(fitSourceNotes(doc, 'ast_l')).toEqual([]);
    expect(fittedSourceRecord(doc, 'ast_l')).toBeNull();
  });
  it('soundRoleOf counts a track of source music as music', () => {
    const doc = songOf({});
    const r = tx(doc, [{ op: 'add_clip', args: { assetId: 'ast_s', start: T.ZERO, duration: T.rt(4, 1), withLinkedAudio: false } }]).doc;
    const track = r.sequences[r.mainSequenceId]!.tracks.find((t) => t.kind === 'audio' && t.clips.length)!;
    expect(soundRoleOf(r, track)).toMatchObject({ role: 'music', why: 'music_files' });
  });
});
