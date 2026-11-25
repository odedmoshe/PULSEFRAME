import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { agentAnswerOf, createProject, type Asset, type FootageIndexStatus, type Moment, type ProjectDocument } from '@pulseframe/core';
import { canForget, canScan, clockText, liveKey, ownerOf, pictureLineOf, pictureMomentsOf, rowsOf, sectionState, setupReasonKey, sizeText, sourcesOf, spanText, timeAttr, type IndexView } from './search.logic.ts';

const status = (over: Partial<Omit<FootageIndexStatus, 'files'>> & { files?: Partial<FootageIndexStatus['files']> } = {}): FootageIndexStatus => ({
  setup: { code: 'ready', detail: 'ok' }, embedder: 'TEST-DOUBLE-embedder/1', bytes: 0, job: null, ...over,
  files: { scanned: 0, stale: 0, of: 3, ...(over.files ?? {}) },
});
const view = (s: FootageIndexStatus | null, failure: IndexView['failure'] = null): IndexView => ({ status: s, failure });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = (id: string, name: string): Asset => ({ id, kind: 'video', name, contentHash: `sha256:${id}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 320, height: 180, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: prov }) as Asset;

describe('the picture status line', () => {
  it('names every state of the contract from the index view', () => {
    expect(pictureLineOf(view(null))).toBeNull();
    expect(pictureLineOf(view(null, { status: 501, code: 'footage_search_not_built' }))).toBe('not_built');
    expect(pictureLineOf(view(null, { status: 403, code: 'owner_required' }))).toBe('owner_only');
    expect(pictureLineOf(view(null, { status: 0, code: 'network' }))).toBeNull();
    expect(pictureLineOf(view(status({ setup: { code: 'not_built', detail: '' } })))).toBe('not_built');
    for (const code of ['engine_not_configured', 'engine_not_working', 'engine_unverified', 'model_missing', 'licence_blocked', 'disk_insufficient'] as const) {
      expect(pictureLineOf(view(status({ setup: { code, detail: 'x' } })))).toBe('not_installed');
    }
    expect(pictureLineOf(view(status()))).toBe('not_scanned');
    expect(pictureLineOf(view(status({ files: { scanned: 3 } })))).toBe('ready');
    expect(pictureLineOf(view(status({ files: { scanned: 1 } })))).toBe('partly_scanned');
    expect(pictureLineOf(view(status({ files: { scanned: 1, stale: 2 } })))).toBe('stale');
    expect(pictureLineOf(view(status({ job: { jobId: 'job_1', status: 'running' } })))).toBe('busy');
    expect(pictureLineOf(view(status({ files: { scanned: 3 }, job: { jobId: 'job_1', status: 'succeeded' } })))).toBe('ready');
  });
  it('a missing setup is said before anything about the scan, in the order a person fixes things', () => {
    expect(pictureLineOf(view(status({ setup: { code: 'model_missing', detail: '', missingBytes: 5 }, files: { scanned: 3 }, job: { jobId: 'j', status: 'running' } })))).toBe('not_installed');
  });
  it('a project with no video is not offered a scan', () => {
    const none = view(status({ files: { of: 0 } }));
    expect(pictureLineOf(none)).toBe('not_scanned');
    expect(canScan(none)).toBe(false);
  });
  it('scan, stop and forget are offered only when they can do something', () => {
    expect(canScan(view(status()))).toBe(true);
    expect(canScan(view(status({ files: { scanned: 3 } })))).toBe(false);
    expect(canScan(view(status({ setup: { code: 'model_missing', detail: '' } })))).toBe(false);
    expect(canScan(view(status({ job: { jobId: 'j', status: 'running' } })))).toBe(false);
    expect(canScan(view(null))).toBe(false);
    expect(canForget(view(status()))).toBe(false);
    expect(canForget(view(status({ files: { scanned: 1 } })))).toBe(true);
    expect(canForget(view(status({ bytes: 800 })))).toBe(true);
    expect(canForget(view(status({ files: { scanned: 1 }, job: { jobId: 'j', status: 'running' } })))).toBe(false);
  });
  it('the owner is known only from the index route (403 is not the owner, 501 is: the owner rule runs first)', () => {
    expect(ownerOf(view(null))).toBeNull();
    expect(ownerOf(view(status()))).toBe(true);
    expect(ownerOf(view(null, { status: 501, code: 'footage_search_not_built' }))).toBe(true);
    expect(ownerOf(view(null, { status: 403, code: 'owner_required' }))).toBe(false);
    expect(ownerOf(view(null, { status: 0, code: 'network' }))).toBeNull();
  });
  it('the setup reason key follows the server\'s own code', () => {
    expect(setupReasonKey({ code: 'model_missing', detail: '' })).toBe('footage.setup.model_missing');
    expect(setupReasonKey(undefined)).toBe('footage.setup.not_built');
  });
});

describe('moments as rows', () => {
  const doc = (() => { const d = createProject({ id: 'prj_t', name: 't' }); (d as ProjectDocument).assets = { a1: video('a1', 'colours.mp4'), a2: { ...video('a2', 'tone.wav'), kind: 'audio', video: undefined, audio: { sampleRate: 48000, channels: 1, codec: 'pcm' } } as Asset, a3: { id: 'a3', kind: 'image', name: 'beach.png', contentHash: 'sha256:a3', byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 8, height: 8, codec: 'png', hasAlpha: false }, provenance: prov } as Asset }; return d; })();
  const m = (assetId: string, start: [number, number] | null, end: [number, number] | null, sources: Moment['sources']): Moment => ({ assetId, start: start && T.rt(...start), end: end && T.rt(...end), sources });
  it('only a video offers «הצג»; the file name comes from the document; a removed file is no row', () => {
    const rows = rowsOf(doc, [m('a1', [2, 1], [6, 1], ['transcript']), m('a2', null, null, ['name']), m('a3', null, null, ['name']), m('gone', null, null, ['name'])], 'exact');
    expect(rows.map((r) => [r.name, r.kind, r.canView])).toEqual([['colours.mp4', 'video', true], ['tone.wav', 'audio', false], ['beach.png', 'image', false]]);
    expect(rowsOf(null, [m('a1', null, null, ['name'])], 'exact')).toEqual([]);
  });
  it('a file called __proto__ or constructor is not read from the prototype', () => {
    expect(rowsOf(doc, [m('constructor', null, null, ['name']), m('__proto__', null, null, ['name'])], 'exact')).toEqual([]);
  });
  it('a picture row names only the picture as its source; an exact row names what the moment carries', () => {
    const pic = rowsOf(doc, [m('a1', [1, 1], [5, 1], ['picture'])], 'picture')[0]!;
    expect(sourcesOf(pic)).toEqual(['picture']);
    const ex = rowsOf(doc, [m('a1', [1, 1], [5, 1], ['name', 'transcript'])], 'exact')[0]!;
    expect(sourcesOf(ex)).toEqual(['name', 'transcript']);
  });
  it('the row keys differ by span, so two moments of one file are two rows', () => {
    const rows = rowsOf(doc, [m('a1', [0, 1], [2, 1], ['transcript']), m('a1', [4, 1], [6, 1], ['transcript'])], 'exact');
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
  it('picture rows come only from an answer whose state can hold them, and keep the answer\'s order', () => {
    const a = (state: 'ready' | 'not_installed' | 'owner_only', picture: Moment[]) => ({ pictureState: state, picture });
    const two = [m('a1', [1, 1], [3, 1], ['picture']), m('a2', null, null, ['picture'])];
    expect(pictureMomentsOf(a('ready', two))).toEqual(two);
    expect(pictureMomentsOf(a('not_installed', two))).toEqual([]);
    expect(pictureMomentsOf(a('owner_only', two))).toEqual([]);
    expect(pictureMomentsOf(null)).toEqual([]);
  });
  it('no row carries a number the interface could show as a score', () => {
    const picture: Moment = { assetId: 'a1', start: T.rt(1, 1), end: T.rt(3, 1), sources: ['picture'], frame: 12 };
    const shown = JSON.stringify(rowsOf(doc, [picture], 'picture').map((r) => ({ name: r.name, time: spanText(r.moment), start: timeAttr(r.moment.start) })));
    expect(shown).not.toMatch(/score|relevance|percent|%|★|\brank/i);
  });
});

describe('numbers shown to people', () => {
  it('clock text is exact and floors, never rounds up into the next tenth', () => {
    expect(clockText(T.rt(2, 1))).toBe('0:02.0');
    expect(clockText(T.rt(75, 30))).toBe('0:02.5');
    expect(clockText(T.rt(1999, 1000))).toBe('0:01.9');
    expect(clockText(T.rt(125, 1))).toBe('2:05.0');
    expect(clockText(T.rt(30000 * 7, 30000))).toBe('0:07.0');
  });
  it('a span reads start–end and a whole file reads null', () => {
    expect(spanText({ start: T.rt(2, 1), end: T.rt(6, 1) })).toBe('0:02.0–0:06.0');
    expect(spanText({ start: null, end: null })).toBeNull();
    expect(timeAttr(T.rt(75, 30))).toBe('75/30');
    expect(timeAttr(null)).toBe('');
  });
  it('sizes use decimal units', () => {
    expect(sizeText(0)).toBe('0 B');
    expect(sizeText(2_900_000)).toBe('2.9 MB');
    expect(sizeText(1_539_637_736)).toBe('1.5 GB');
    expect(sizeText(-1)).toBe('0 B');
  });
  it('a section says «לא נמצא דבר» only when it was asked', () => {
    expect(sectionState(false, 0)).toBeNull();
    expect(sectionState(true, 0)).toBe('empty');
    expect(sectionState(true, 3)).toBe('rows');
    expect(sectionState(false, 2)).toBe('rows');
  });
  it('the live region says none, one, or a count', () => {
    expect([0, 1, 7].map(liveKey)).toEqual(['footage.foundNone', 'footage.foundOne', 'footage.found']);
  });
});

describe('the privacy filter is not the editor\'s job', () => {
  it('agentAnswerOf is never needed here: the editor shows the owner\'s moments and imports no agent answer', () => {
    expect(typeof agentAnswerOf).toBe('function');
  });
});
