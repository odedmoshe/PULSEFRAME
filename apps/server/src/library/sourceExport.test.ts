/**
 * The export answers of files from stock sources and links (wave 8 `sources`, W1; verify C3, C14, C15): libraryExportWarnings reads
 * source records through collectCredits (licensedOrigins). A licence finding is a non-blocking warning that names the licence and
 * quotes its own deed sentence; a due source credit gets the reminder and the on-screen check; a fetched non-commercial file is named
 * with its licence in neutral words (the library-only wording is pinned by credits.golden.test.ts). exportLicence carries
 * licenceNotes, and the editor's reader (apps/web library.logic.ts) reads them as written.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, SOURCE_TERMS, type ProjectDocument, type SourceRecord } from '@pulseframe/core';
import { exportLicence, libraryExportWarnings, LIBRARY_EXPORT_CODES } from '../export.ts';

const hx = (n: number) => n.toString(16).padStart(64, '0');
const rec = (n: number, over: Partial<SourceRecord> = {}): SourceRecord => ({
  provider: 'openverse', itemId: `ov-${n}`, kind: 'photo', title: `Photo ${n}`, author: 'Someone', fetchedAt: '2026-11-26T10:00:00Z', sha256: hx(n), byteSize: 100,
  licence: { id: 'CC-BY-4.0', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', from: 'item' },
  credit: { text: `"Photo ${n}" by Someone, CC BY 4.0`, placement: 'description', due: true }, flags: {}, ...over,
});
const fetched = (r: SourceRecord) => ({ kind: 'image', name: `${r.itemId}.png`, contentHash: `sha256:${r.sha256}`, byteSize: 100, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 64, codec: 'png', hasAlpha: false }, provenance: { origin: 'upload', importedAt: '2026-11-26T10:00:00Z', importedBy: 'agent:test', source: r } });
let n = 0;
function project(records: SourceRecord[]): ProjectDocument {
  let doc = createProject({ id: 'prj_srcx', name: 'X', width: 640, height: 360, frameRate: { num: 30, den: 1 } });
  records.forEach((r, i) => {
    const t = applyTransaction(doc, [{ op: 'use_source_item', args: { asset: fetched(r) } }], { idSeed: `x${n++}_`, actor: 'agent:test', allowInternal: true });
    const assetId = (t.results[0]!.output as { assetId: string }).assetId;
    doc = applyTransaction(t.doc, [{ op: 'add_clip', args: { assetId, start: T.rt(2 * i, 1), duration: T.rt(2, 1) } }], { idSeed: `x${n++}_`, actor: 'agent:test' }).doc;
  });
  return doc;
}
const ND: Partial<SourceRecord> = { licence: { id: 'CC-BY-ND-4.0', name: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/', from: 'item' }, flags: { noDerivatives: true, licenceUnconfirmed: true, notShareable: true } };
const NC: Partial<SourceRecord> = { licence: { id: 'CC-BY-NC-4.0', name: 'CC BY-NC 4.0', from: 'item' }, flags: { nonCommercial: true, notShareable: true } };

describe('export answers of source files (W1)', () => {
  it('a project with only a CC BY source credit gets the reminder in neutral words; nothing blocks', () => {
    const doc = project([rec(1)]);
    const w = libraryExportWarnings(doc);
    expect(w.map((x) => x.code)).toEqual(['credits_for_description']);
    expect(w[0]!.message).toMatch(/^1 credit line\(s\) that the files' licences ask for belong in the video's description/);
    expect(w[0]!.message).not.toContain('library');
    const lic = exportLicence(doc)!;
    expect(lic.lines.map((l) => l.text)).toEqual([rec(1).credit!.text]);
    expect(lic.credits.descriptionText).toBe(`קרדיטים\n\n${rec(1).credit!.text}`);
    expect('licenceNotes' in lic).toBe(false);
  });
  it('an NC item and an ND item: non_commercial_content names the licence; licence_no_derivatives quotes the deed; an on-screen source credit is checked', () => {
    const doc = project([rec(2, NC), rec(3, { ...ND, credit: { text: '"Photo 3" by Someone, CC BY-ND 4.0', placement: 'on_screen', due: true } })]);
    const w = libraryExportWarnings(doc);
    expect(w.map((x) => x.code)).toEqual(['non_commercial_content', 'credits_for_description', 'credit_not_on_screen', 'licence_no_derivatives']);
    expect(w.every((x) => (LIBRARY_EXPORT_CODES as readonly string[]).includes(x.code))).toBe(true);
    expect(w[0]!.message).toContain('"Photo 2" (CC BY-NC 4.0)');
    expect(w[0]!.message).not.toContain('library');
    const nd = w.find((x) => x.code === 'licence_no_derivatives')!;
    expect(nd.message).toContain(SOURCE_TERMS['cc.nd']!.quote);
    expect(nd.message).toContain('CC BY-ND 4.0');
    expect(nd.hint).toMatch(/^The export goes ahead/);
    const lic = exportLicence(doc)!;
    expect(lic.licenceNotes?.map((x) => x.code)).toEqual(['licence_no_derivatives']);
    expect(lic.nonCommercial.map((x) => x.title)).toEqual(['Photo 2']);
  });
  it('an unknown licence with no credit still writes the export licence (its warning), and the editor reads the notes as written', async () => {
    const doc = project([rec(4, { licence: { id: 'unknown', name: '', from: 'none' }, credit: undefined, flags: { licenceUnconfirmed: true, notShareable: true } })]);
    expect(libraryExportWarnings(doc).map((x) => [x.code, x.message])).toEqual([['licence_unknown', '"Photo 4": licence unknown: the service or the link named no licence']]);
    const written = exportLicence(doc)!;
    expect(written.lines).toEqual([]);
    const { exportLicence: editorReads } = await import('../../../web/src/editor/library/library.logic.ts');
    const read = editorReads(JSON.parse(JSON.stringify({ licence: written })) as Record<string, unknown>);
    expect(read).toEqual({ nonCommercial: [], credits: null, people: 0, licenceNotes: [{ code: 'licence_unknown', title: 'Photo 4', licenceName: '', termIds: [], message: written.licenceNotes![0]!.message }] });
  });
});
