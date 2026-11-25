/**
 * The library panels' logic and presentational parts. The rows below are a MOCK of the contract types (core libraryContract.ts),
 * made here for the tests: no server answers them (the routes answer 501 library_not_built until the server track is merged).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Asset, LibraryRow, LibraryStatus } from '@pulseframe/core';
import {
  archiveModes, assetBadges, auditionable, exportLicence, facetsOf, filtersActive, formatLength, hasHebrew, lengthLabel, NO_FILTERS, ownerArchiveHref, panelState,
  queryOf, restrictedAssets, rowBadges, shownKinds, tempoLabel, useBody, AUDIO_KINDS, VISUAL_KINDS,
} from './library.logic.ts';
import { LibraryRowView } from './LibraryBrowser.tsx';
import { ArchiveChoiceView } from './ArchiveLibraryOption.tsx';
import { ExportLicenceLinesView } from './ExportLicenceLines.tsx';
import { LibraryAssetBadgesView } from './LibraryAssetBadges.tsx';
import { CreditsView_ } from './CreditsPanel.tsx';
import { LibraryStatusView } from './LibrarySettings.tsx';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: 'it/a.mp3', entry: 'it', sourceId: 's', kind: 'music', title: 'שיר ראשון', author: 'Kevin', licenceId: 'CC-BY-4.0', credit: undefined,
  duties: { credit: true, nonCommercial: false, shareable: true }, badges: {}, bytes: 3_400_000, meta: { durationSeconds: 67, bpm: 120, genre: ['calm'], mood: ['happy'], instruments: [], tags: [] }, ...over,
} as LibraryRow);
const status = (over: Partial<LibraryStatus> = {}): LibraryStatus => ({ state: 'ready', counts: { music: 2, sticker: 5 }, notListed: [], unusable: {}, problems: [], indexedAt: null, verifiedAt: null, svgRasteriser: false, ...over });

describe('query', () => {
  it('leaves out what is not set, maps the buckets to the server ranges', () => {
    expect(queryOf('music', '  ', NO_FILTERS)).toEqual({ kind: 'music', limit: 40 });
    expect(queryOf('music', 'חנוכיה', { ...NO_FILTERS, tempo: 'mid', length: 'long', noCredit: true, commercial: true, genre: 'calm' }, 'c1'))
      .toEqual({ kind: 'music', limit: 40, q: 'חנוכיה', genre: 'calm', bpmMin: 90, bpmMax: 130, durMin: 181, credit: 'none', commercial: 'allowed', cursor: 'c1' });
  });
  it('tempo and length filters are for audio kinds only', () => {
    expect(queryOf('icon', '', { ...NO_FILTERS, tempo: 'fast', genre: 'x' })).toEqual({ kind: 'icon', limit: 40 });
  });
  it('labels and helpers', () => {
    expect([tempoLabel('slow'), tempoLabel('mid'), tempoLabel('fast')]).toEqual(['<90', '90–130', '131+']);
    expect([lengthLabel('short'), lengthLabel('mid'), lengthLabel('long')]).toEqual(['0:00–0:59', '1:00–3:00', '3:01+']);
    expect(formatLength(67)).toBe('1:07');
    expect(hasHebrew('menorah')).toBe(false); expect(hasHebrew('חנוכיה')).toBe(true);
    expect(filtersActive(NO_FILTERS, ' ')).toBe(false); expect(filtersActive({ ...NO_FILTERS, mood: 'x' }, '')).toBe(true);
    expect(facetsOf([row(), row({ meta: { genre: ['jazz', 'calm'], mood: [], instruments: [], tags: [] } })])).toEqual({ genre: ['calm', 'jazz'], mood: ['happy'] });
  });
});

describe('panel state', () => {
  const say = () => 'said';
  it('maps every status and the 501 of an unbuilt server', () => {
    expect(panelState(null, null, say)).toEqual({ kind: 'loading' });
    expect(panelState(null, { status: 501, code: 'library_not_built' }, say)).toEqual({ kind: 'not_built' });
    expect(panelState(null, { status: 500, code: 'x' }, say)).toEqual({ kind: 'error', message: 'said' });
    expect(panelState(status({ state: 'not_configured' }), null, say)).toEqual({ kind: 'setup', state: 'not_configured' });
    expect(panelState(status({ state: 'ledger_invalid' }), null, say)).toEqual({ kind: 'setup', state: 'ledger_invalid' });
    expect(panelState(status({ state: 'indexing', progress: { rows: 7, entriesDone: 1, entriesTotal: 3 } }), null, say)).toEqual({ kind: 'indexing', rows: 7 });
    expect(panelState(status(), null, say)).toEqual({ kind: 'ready' });
  });
  it('kinds shown: music and sounds always, the rest with rows', () => {
    expect(shownKinds(status(), AUDIO_KINDS)).toEqual(['music', 'sound']);
    expect(shownKinds(status(), VISUAL_KINDS)).toEqual(['sticker']);
  });
});

describe('rows', () => {
  it('badges follow the duties, most restrictive first', () => {
    expect(rowBadges(row({ duties: { credit: true, nonCommercial: true, shareable: false }, badges: { people: true } }))).toEqual(['nonCommercial', 'credit', 'people', 'diskOnly']);
    expect(rowBadges(row({ duties: { credit: false, nonCommercial: false, shareable: true } }))).toEqual([]);
  });
  it('m4a is not auditioned; use sends the playhead, the target track and a valid colour for icons only', () => {
    expect(auditionable(row({ key: 'x/a.m4a' }))).toBe(false); expect(auditionable(row())).toBe(true);
    const at = { start: { value: '48', timescale: 24 }, trackId: 'a1', color: '#ff0000' };
    expect(useBody(row(), at)).toEqual({ key: 'it/a.mp3', start: at.start, trackId: 'a1' });
    expect(useBody(row({ kind: 'icon', key: 'i/x' }), at)).toMatchObject({ color: '#FF0000' });
    expect(useBody(row({ kind: 'icon', key: 'i/x' }), { ...at, color: 'red', trackId: null })).toEqual({ key: 'i/x', start: at.start });
  });
  it('renders the fixed test ids, the credit with dir=auto, numbers in .num, the unusable reason with its next step', () => {
    const html = renderToStaticMarkup(createElement(LibraryRowView, { row: row({ credit: { text: 'Song by Kevin', placement: 'description' } }), lang: 'he', playing: true, busy: false, thumb: false, onPlay: () => {}, onUse: () => {} }));
    for (const id of [TID.row, TID.play, TID.use, TID.licence, TID.badge]) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('aria-pressed="true"'); expect(html).toContain('dir="auto">Song by Kevin'); expect(html).toContain('class="num"');
    const bad = renderToStaticMarkup(createElement(LibraryRowView, { row: row({ unusable: 'credit_missing' }), lang: 'en', playing: false, busy: false, thumb: true, onPlay: () => {}, onUse: () => {} }));
    expect(bad).toContain(`data-testid="${TID.unusable}"`); expect(bad).toContain('aria-disabled="true"'); expect(bad).toContain('/thumb?size=128');
  });
});

const asset = (lib: Record<string, unknown> | undefined): Asset => ({ id: 'a', name: 'n.mp3', provenance: { origin: 'upload', ...(lib ? { library: lib } : {}) } } as unknown as Asset);
const rec = (flags: Record<string, true>, credit = true) => ({ itemId: 'i', title: 'T', licence: { id: 'CC-BY-4.0', url: 'https://x.test/l' }, ...(credit ? { credit: { text: 'by K', placement: 'description' } } : {}), flags });
describe('project file card, export lines, archive', () => {
  it('badges come from the record; none without one', () => {
    expect(assetBadges(asset(undefined))).toEqual([]);
    expect(assetBadges(asset(rec({ nonCommercial: true, people: true })))).toEqual(['nonCommercial', 'credit', 'people']);
    expect(renderToStaticMarkup(createElement(LibraryAssetBadgesView, { asset: asset(undefined), lang: 'he' }))).toBe('');
    expect(renderToStaticMarkup(createElement(LibraryAssetBadgesView, { asset: asset(rec({ nonCommercial: true })), lang: 'he' }))).toContain('לשימוש לא מסחרי בלבד');
  });
  it('export lines read output.licence only; nothing without it', () => {
    expect(exportLicence({})).toBeNull();
    const out = { licence: { nonCommercial: [{ assetId: 'a', title: 'Song' }, { assetId: 'b', title: 'Song' }], credits: { lines: [{}], descriptionText: 'Credits\n\nby K' }, people: [] } };
    expect(exportLicence(out)).toEqual({ nonCommercial: ['Song'], credits: { lines: 1, descriptionText: 'Credits\n\nby K' }, people: 0 });
    expect(renderToStaticMarkup(createElement(ExportLicenceLinesView, { output: {}, lang: 'he' }))).toBe('');
    const html = renderToStaticMarkup(createElement(ExportLicenceLinesView, { output: out, lang: 'he' }));
    expect(html).toContain('לשימוש לא מסחרי בלבד: Song'); for (const id of [TID.exportNonCommercial, TID.exportCredits, TID.exportCreditsCopy]) expect(html).toContain(id);
  });
  it('archive choice: restricted files are counted; «לעצמי» is the owner\'s only', () => {
    expect(restrictedAssets({ a: asset(rec({ diskOnly: true })), b: asset(rec({})), c: asset(undefined) } as never).map((x) => x.id)).toEqual(['a']);
    expect(archiveModes(false)).toEqual(['strip']); expect(archiveModes(true)).toEqual(['strip', 'keep']);
    expect(ownerArchiveHref('p 1')).toBe('/api/v1/projects/p%201/archive?library=keep');
    const html = renderToStaticMarkup(createElement(ArchiveChoiceView, { lang: 'he', count: 2, owner: false, mode: 'strip', onChange: () => {} }));
    expect(html).toContain(TID.archiveStrip); expect(html).not.toContain(TID.archiveKeep);
  });
  it('credits panel lists lines, the missing-on-screen alert and the buttons', () => {
    const line = { assetId: 'a', title: 'T', text: 'by K', placement: 'on_screen' as const, group: 'music' as const };
    const html = renderToStaticMarkup(createElement(CreditsView_, { view: { lines: [line], descriptionText: 'x', onScreenMissing: [line], nonCommercial: [], people: [] }, lang: 'he', copied: false, busy: false, onCopy: () => {}, onCard: () => {} }));
    for (const id of [TID.credits, TID.creditsLine, TID.creditsCopy, TID.creditsCard, TID.creditsMissing]) expect(html).toContain(`"${id}"`);
    const none = renderToStaticMarkup(createElement(CreditsView_, { view: { lines: [], descriptionText: '', onScreenMissing: [], nonCommercial: [], people: [] }, lang: 'he', copied: false, busy: false, onCopy: () => {}, onCard: () => {} }));
    expect(none).toContain('אין בסרטון חומר שדורש קרדיט'); expect(none).not.toContain(TID.creditsCopy);
  });
  it('settings status: state in words, counts, not verified since download', () => {
    const html = renderToStaticMarkup(createElement(LibraryStatusView, { lang: 'he', status: status({ state: 'indexing', progress: { rows: 9, entriesDone: 1, entriesTotal: 2 }, notListed: [{ dir: 'models', entries: 3 }], unusable: { credit_missing: 2 } }) }));
    expect(html).toContain('סורקים את הספרייה'); expect(html).toContain('לא אומת מאז ההורדה'); expect(html).toContain(TID.settingsCounts); expect(html).toContain('לא נקרא');
  });
});
