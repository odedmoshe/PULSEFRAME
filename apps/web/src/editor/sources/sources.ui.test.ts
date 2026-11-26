/** «מאגר» parts (wave 8 sources, W3): rendered as static markup with fixed test ids, the licence quoted verbatim, nothing called safe, the pure helpers. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SOURCE_TERMS, type Asset, type SourceRecord, type SourceResultRow, type SourceState, type SourceWarning } from '@pulseframe/core';
import { ExportLicenceLinesView, licenceNotesOf } from '../library/ExportLicenceLines.tsx';
import { LibraryAssetBadgesView } from '../library/LibraryAssetBadges.tsx';
import { ConnectionCard } from './ConnectionsSection.tsx';
import { DownloadRow, LinkBox, TermRows, WarningLine } from './SourceParts.tsx';
import { ResultCard } from './SourcesTab.tsx';
import { SourceAssetLines } from './SourceAssetLines.tsx';
import { SOURCES_TESTIDS as TID } from './sources.testids.ts';
import { gridNext, licenceLabel, limitLine, parseStage, percentOf, recordWarnings, remainingLine, safePageUrl, sx, termLines, warningHead } from './sources.logic.ts';

const nd: SourceWarning = { code: 'licence_no_derivatives', licenceName: 'CC BY-ND 4.0', licenceId: 'CC-BY-ND-4.0', termIds: ['cc.nd'], message: '' };
const row = (over: Partial<SourceResultRow> = {}): SourceResultRow => ({
  provider: 'openverse', itemId: 'i1', kind: 'music', title: 'שיר <b>x</b>', author: 'Kevin', durationSeconds: 10, width: null, height: null,
  licence: { id: 'CC-BY-ND-4.0', name: 'CC BY-ND 4.0', url: null, from: 'item' }, flags: { noDerivatives: true }, creditPreview: null, pageUrl: null, preview: 'h1', thumb: 'h2', renditions: [], warnings: [nd], ...over,
});
const rec = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  provider: 'openverse', itemId: 'i1', kind: 'music', title: 'Song', author: 'Kevin', pageUrl: 'https://example.org/p', fetchedAt: '2026-11-26T10:00:00Z', sha256: 'a'.repeat(64), byteSize: 5,
  licence: { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', from: 'item' }, credit: { text: 'Song by Kevin', placement: 'description', due: true }, flags: { shareAlike: true }, terms: ['cc.sa', 'wikimedia.people'], ...over,
});

describe('licence lines quote the licence', () => {
  it('a warning names the licence and quotes its own sentence verbatim, with the translation marked (he) and the link and date', () => {
    const he = renderToStaticMarkup(createElement(WarningLine, { w: nd, lang: 'he' }));
    expect(he).toContain('CC BY-ND 4.0');
    expect(he).toContain(SOURCE_TERMS['cc.nd']!.quote);
    expect(he).toContain('(תרגום');
    expect(he).toContain('rel="noopener noreferrer"');
    expect(he).toContain('2026-11-26');
    const en = renderToStaticMarkup(createElement(WarningLine, { w: nd, lang: 'en' }));
    expect(en).toContain(SOURCE_TERMS['cc.nd']!.quote);
    expect(en).not.toContain('תרגום');
  });
  it('no string of ours calls anything safe, allowed or verified', () => {
    const html = [renderToStaticMarkup(createElement(WarningLine, { w: nd, lang: 'he' })), renderToStaticMarkup(createElement(ResultCard, { row: row(), lang: 'en', active: false, onPick: () => {} }))].join('');
    expect(html).not.toMatch(/safe|allowed|verified|בטוח|מותר|מאומת/i);
  });
  it('unknown term ids are skipped, never invented', () => {
    expect(termLines('en', ['nope'])).toEqual([]);
    expect(renderToStaticMarkup(createElement(TermRows, { ids: ['nope'], lang: 'en' }))).toBe('');
  });
});

describe('result card and link box', () => {
  it('the badge is named by the licence name; titles, authors and licence names sit in <bdi>; the title is escaped text', () => {
    const html = renderToStaticMarkup(createElement(ResultCard, { row: row(), lang: 'he', active: true, onPick: () => {} }));
    expect(html).toContain(`data-testid="${TID.badge('i1')}"`);
    expect(html).toContain('aria-label="CC BY-ND 4.0"');
    expect(html).toContain('<bdi>CC BY-ND 4.0</bdi>');
    expect(html).toContain('<bdi>Kevin</bdi>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('role="option"'); expect(html).toContain('aria-selected="true"');
    expect(html).toContain(`data-testid="${TID.row('openverse', 'i1')}"`); expect(html).toContain(`data-testid="${TID.warnings('i1')}"`);
    expect(html).toContain('/api/v1/source-previews/h2');
  });
  it('the link box has its fixed ids, a describing hint, and is disabled with no project', () => {
    const html = renderToStaticMarkup(createElement(LinkBox, { lang: 'he', projectId: null, place: () => undefined, onStarted: () => {} }));
    for (const id of [TID.linkInput, TID.linkImport, TID.linkAnswer]) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('disabled'); expect(html).toContain('aria-describedby="pf-src-link-hint"');
  });
  it('a download row has its progress ids and a cancel button', () => {
    const html = renderToStaticMarkup(createElement(DownloadRow, { jobId: 'job_1', title: 'clip.mp4', lang: 'en', onDone: () => {} }));
    expect(html).toContain(`data-testid="${TID.download('job_1')}"`); expect(html).toContain(`data-testid="${TID.downloadCancel('job_1')}"`);
  });
});

describe('asset lines and export lines', () => {
  it('a source file shows where it came from, its licence by name, the credit, a plain noopener link, and the share-alike deed sentence', () => {
    const html = renderToStaticMarkup(createElement(SourceAssetLines, { source: rec(), lang: 'he' }));
    expect(html).toContain(`data-testid="${TID.assetSource}"`); expect(html).toContain(`data-testid="${TID.openPage}"`);
    expect(html).toContain('href="https://example.org/p"'); expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Song by Kevin'); expect(html).toContain(SOURCE_TERMS['cc.sa']!.quote); expect(html).toContain(SOURCE_TERMS['wikimedia.people']!.quote);
    expect(renderToStaticMarkup(createElement(SourceAssetLines, { source: rec({ pageUrl: 'javascript:alert(1)' }), lang: 'en' }))).not.toContain('asset-source-open-page');
  });
  it('LibraryAssetBadgesView shows the source lines for a source asset and nothing for a plain one', () => {
    const a = { id: 'a', name: 'n', provenance: { origin: 'upload', source: rec() } } as unknown as Asset;
    expect(renderToStaticMarkup(createElement(LibraryAssetBadgesView, { asset: a, lang: 'en' }))).toContain('CC BY-SA 4.0');
    expect(renderToStaticMarkup(createElement(LibraryAssetBadgesView, { asset: { id: 'b', name: 'n', provenance: { origin: 'upload' } } as unknown as Asset, lang: 'en' }))).toBe('');
  });
  it('the export lines show the licence notes with the deed quote; unknown shapes are skipped; no notes, no change', () => {
    const out = { licence: { lines: [], onScreenMissing: [], nonCommercial: [], people: [], credits: null, licenceNotes: [nd, { code: 'bogus' }, 7] } };
    expect(licenceNotesOf(out)).toEqual([nd]);
    const html = renderToStaticMarkup(createElement(ExportLicenceLinesView, { output: out, lang: 'en' }));
    expect(html).toContain('CC BY-ND 4.0'); expect(html).toContain(SOURCE_TERMS['cc.nd']!.quote);
    expect(renderToStaticMarkup(createElement(ExportLicenceLinesView, { output: { licence: { lines: [], nonCommercial: [] } }, lang: 'en' }))).toBe('');
  });
});

describe('connection cards', () => {
  const st = (over: Partial<SourceState>): SourceState => ({ provider: 'pixabay', state: 'needs_key', keySet: false, keyAddedAt: null, remaining: null, ...over });
  it('the owner sees the key field, save and a signup link; another session sees the state only (no dead button)', () => {
    const owner = renderToStaticMarkup(createElement(ConnectionCard, { s: st({}), lang: 'he', owner: true, onChanged: () => {} }));
    expect(owner).toContain(`data-testid="${TID.card('pixabay')}"`); expect(owner).toContain(`data-testid="${TID.save('pixabay')}"`); expect(owner).toContain('type="password"'); expect(owner).toContain('rel="noopener noreferrer"');
    const other = renderToStaticMarkup(createElement(ConnectionCard, { s: st({}), lang: 'he', owner: false, onChanged: () => {} }));
    expect(other).not.toContain('<button'); expect(other).not.toContain('<input');
  });
  it('Forget shows only when a key is stored; Openverse shows the hourly number; Wikimedia links its policy', () => {
    expect(renderToStaticMarkup(createElement(ConnectionCard, { s: st({ state: 'ready', keySet: true, keyAddedAt: '2026-11-26' }), lang: 'en', owner: true, onChanged: () => {} }))).toContain(`data-testid="${TID.forget('pixabay')}"`);
    const ov = renderToStaticMarkup(createElement(ConnectionCard, { s: st({ provider: 'openverse', state: 'ready', mode: 'anonymous', remaining: { count: 5, perSeconds: 3600 } }), lang: 'he', owner: true, onChanged: () => {} }));
    expect(ov).toContain('5 חיפושים בשעה'); expect(ov.indexOf('api.openverse.org')).toBeLessThan(ov.indexOf('type="password"'));
    expect(renderToStaticMarkup(createElement(ConnectionCard, { s: st({ provider: 'wikimedia', state: 'needs_contact' }), lang: 'en', owner: true, onChanged: () => {} }))).toContain(SOURCE_TERMS['wikimedia.user_agent']!.url);
  });
});

describe('pure helpers', () => {
  it('licence label: the service\'s name, else the id, else nothing stated', () => {
    expect(licenceLabel('en', { id: 'x', name: ' Custom ' })).toBe('Custom');
    expect(licenceLabel('en', { id: 'CC0-1.0', name: '' })).toBe('CC0-1.0');
    expect(licenceLabel('en', { id: 'unknown', name: '' })).toBe('No licence stated');
  });
  it('job stage: JSON or a bare word; percent only from numbers the job gave', () => {
    expect(parseStage(JSON.stringify({ stage: 'downloading', bytes: 50, total: 200 }))).toEqual({ stage: 'downloading', bytes: 50, total: 200 });
    expect(percentOf(parseStage(JSON.stringify({ stage: 'downloading', bytes: 50, total: 200 })))).toBe(25);
    expect(parseStage('importing')).toEqual({ stage: 'importing', bytes: null, total: null });
    expect(percentOf(parseStage('importing'))).toBeNull();
  });
  it('grid keys follow the page direction; remaining line only when the service counts', () => {
    expect(gridNext(0, 'ArrowRight', 3, 'ltr')).toBe(1); expect(gridNext(0, 'ArrowLeft', 3, 'rtl')).toBe(1); expect(gridNext(0, 'ArrowLeft', 3, 'ltr')).toBe(0);
    expect(gridNext(1, 'End', 3, 'ltr')).toBe(2); expect(gridNext(1, 'x', 3, 'ltr')).toBeNull(); expect(gridNext(0, 'ArrowDown', 0, 'ltr')).toBeNull();
    expect(remainingLine('he', { count: 4, perSeconds: 3600 })).toBe('נשארו 4 חיפושים בשעה הזאת'); expect(remainingLine('he', null)).toBeNull();
  });
  it('record warnings follow the flags; page links are http(s) only; head sentences name the licence', () => {
    expect(recordWarnings(rec()).map((w) => w.code)).toEqual(['licence_share_alike']);
    expect(recordWarnings(rec({ flags: { licenceUnconfirmed: true }, licence: { id: 'unknown', name: '', from: 'none' } })).map((w) => w.code)).toEqual(['licence_unknown']);
    expect(safePageUrl('https://a.test/x')).toBe('https://a.test/x'); expect(safePageUrl('data:text/html,x')).toBeNull(); expect(safePageUrl(undefined)).toBeNull();
    expect(warningHead('en', nd)).toBe(sx('en', 'sources.warn.licence_no_derivatives', { name: 'CC BY-ND 4.0' }));
  });
});

describe('the download limit line (C6 with ADR-0036 I9)', () => {
  it('guarded or a set upload limit: at most the upload limit; open mode with none: says so, and the setting alone limits', () => {
    expect(limitLine('he', { maxDownloadBytes: null, maxUploadBytes: 2 * 1024 ** 3, effectiveMaxBytes: 2 * 1024 ** 3 })).toBe('לכל היותר מגבלת ההעלאה (2.0 GB). בלי מגבלה משלכם');
    expect(limitLine('en', { maxDownloadBytes: 100 * 1024 ** 2, maxUploadBytes: 2 * 1024 ** 3, effectiveMaxBytes: 100 * 1024 ** 2 })).toBe('At most the upload limit (2.0 GB). The limit in effect: 100.0 MB');
    expect(limitLine('he', { maxDownloadBytes: null, maxUploadBytes: null, effectiveMaxBytes: null })).toBe(`${sx('he', 'sources.connect.noUploadCap')}. ${sx('he', 'sources.connect.noLimit')}`);
    expect(limitLine('en', { maxDownloadBytes: 5 * 1024 ** 3, maxUploadBytes: null, effectiveMaxBytes: 5 * 1024 ** 3 })).toBe(`${sx('en', 'sources.connect.noUploadCap')}. The limit in effect: 5.0 GB`);
    expect(sx('en', 'sources.connect.noUploadCap')).not.toBe('sources.connect.noUploadCap');
  });
});
