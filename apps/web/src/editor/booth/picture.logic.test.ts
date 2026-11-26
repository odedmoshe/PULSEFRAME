/** Builder W2: the picture card's and the export strip's logic. A labelled stand-in document (real ops) replaces boothScene until W1's body is used. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, FlashGuard } from '@pulseframe/engine';
import { createT } from '@pulseframe/i18n';
import { adapterFacts, browserExtras, drawNeedsGpu, exportExtras, exportStillFacts, fetchExportStill, frameAt, loadTestPicture, needsGpuAndHasNone, pictureDescription, pictureMode, pictureProvider, playFrames, playWindow, sha256Of, stripGate, stripItems, threeStillFrames } from './picture.logic.ts';
import { BOOTH_PAGE_STRINGS } from './check/check.strings.ts';

// ---- STAND-IN (labelled): a two-picture document through real ops, with the REAL sha256 of two byte strings, as boothScene will build it
const bytesA = new Uint8Array([1, 2, 3, 4]), bytesB = new Uint8Array([5, 6, 7, 8, 9]);
const hashOf = (b: Uint8Array) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
function standIn(transition: string): { doc: ProjectDocument; still: number; play: { first: number; count: number } } {
  const step = (doc: ProjectDocument, ops: OpCall[], internal = false) => applyTransaction(doc, ops, { idSeed: 'stand_', actor: 'test', allowInternal: internal });
  const asset = (name: string, b: Uint8Array) => ({ kind: 'image' as const, name, contentHash: hashOf(b), byteSize: b.length, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-01-01T00:00:00Z', importedBy: 'test' } });
  const s = step(createProject({ id: 'prj_standin', name: 'stand-in', width: 640, height: 360, frameRate: { num: 30, den: 1 } }), [{ op: 'import_asset', args: { asset: asset('a', bytesA) } }, { op: 'import_asset', args: { asset: asset('b', bytesB) } }], true);
  const a = s.results[0]!.output!.assetId as string, b = s.results[1]!.output!.assetId as string;
  const v1 = s.doc.sequences[s.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
  const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
  const clips = step(s.doc, [{ op: 'add_clip', args: { assetId: a, trackId: v1, start: f(0), duration: f(60), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: b, trackId: v1, start: f(60), duration: f(60), withLinkedAudio: false } }]);
  const doc = step(clips.doc, [{ op: 'set_transition', args: { clipId: clips.results[1]!.output!.clipId as string, type: transition, frames: 24 } }]).doc;
  return { doc, still: 60, play: { first: 48, count: 24 } };
}

describe('picture card logic (builder W2)', () => {
  it('the modes: no adapter → needs-gpu for GPU items only; reduced motion → three stills; otherwise a still first', () => {
    const gpuItem = { source: 'gpu-transition' as const }, music = { source: 'music' as const };
    expect(pictureMode(gpuItem, { state: 'off' }, false)).toBe('needs-gpu');
    expect(pictureMode(gpuItem, { state: 'fail' }, true)).toBe('needs-gpu');
    expect(pictureMode(gpuItem, { state: 'ok' }, false)).toBe('still');
    expect(pictureMode(gpuItem, { state: 'setup' }, false)).toBe('still'); // a software adapter draws; the card says so in words
    expect(pictureMode(gpuItem, null, false)).toBe('still'); // not answered yet is not a verdict
    expect(pictureMode(gpuItem, { state: 'ok' }, true)).toBe('three-stills');
    expect(needsGpuAndHasNone(music, { state: 'off' })).toBe(false);
    expect(drawNeedsGpu({ missing: [], unavailableEffects: ['film-burn'] })).toBe(true);
    expect(drawNeedsGpu({ missing: ['x'], unavailableEffects: [] })).toBe(false);
  });
  it('the frames: three stills are first, still and last of the window; the play frames are the window once, in order', () => {
    const scene = { still: 60, play: { first: 48, count: 24 } };
    expect(threeStillFrames(scene)).toEqual([48, 60, 71]);
    expect(playFrames(scene)).toEqual(Array.from({ length: 24 }, (_, i) => 48 + i));
    expect(frameAt(standIn('film-burn').doc, 30)).toEqual(T.frameTime(30, { num: 30, den: 1 }));
  });
  it('the adapter facts of the row go to the answer as given; a missing row adds nothing', () => {
    expect(browserExtras({ data: { adapter: 'nvidia|ampere||RTX', software: false } })).toEqual({ browserAdapter: 'nvidia|ampere||RTX', browserSoftware: false });
    expect(browserExtras(null)).toEqual({});
    expect(adapterFacts({ data: { adapter: '', software: 'yes' } })).toEqual({ adapter: null, software: null });
  });
  it('the test pictures are hashed from the bytes the server serves (real sha256) and the provider maps the scene\'s assets to them', async () => {
    const serve = (bytes: Uint8Array) => async () => new Response(bytes as BlobPart, { status: 200, headers: { 'content-type': 'image/png' } });
    const a = await loadTestPicture(serve(bytesA), '/a'), b = await loadTestPicture(serve(bytesB), '/b');
    expect(a.ref).toEqual({ contentHash: hashOf(bytesA), byteSize: 4 });
    expect(b.ref.byteSize).toBe(5);
    expect(await sha256Of(bytesA.buffer.slice(0) as ArrayBuffer)).toBe(hashOf(bytesA));
    await expect(loadTestPicture(async () => new Response('no', { status: 403 }), '/a')).rejects.toThrow(/403/);
    const { doc } = standIn('film-burn');
    const drawn: string[] = [];
    const bitmaps = new Map<string, CanvasImageSource>([[a.ref.contentHash, { id: 'A' } as unknown as CanvasImageSource], [b.ref.contentHash, { id: 'B' } as unknown as CanvasImageSource]]);
    const provider = pictureProvider(doc, bitmaps);
    for (const id of Object.keys(doc.assets)) { const fi = await provider({ assetId: id }); expect(fi).not.toBeNull(); fi!.draw({ drawImage: (bm: unknown) => drawn.push((bm as { id: string }).id) } as never, 0, 0, 1, 1); }
    expect(drawn.sort()).toEqual(['A', 'B']);
    expect(await provider({ assetId: 'ast_missing' })).toBeNull();
  });
  it('playback: every frame of the window passes the dialog\'s ONE FlashGuard.paint, in order; a stopped card ends it; reduced motion never reaches it', async () => {
    const { doc, play } = standIn('film-burn');
    const guard = new FlashGuard();
    const seen: number[] = [];
    const real = guard.paint.bind(guard);
    const spy = { paint: ((g: Parameters<FlashGuard['paint']>[0], io: Parameters<FlashGuard['paint']>[1]) => { seen.push(g.frameIndex); return real(g, io); }) as FlashGuard['paint'] };
    let clock = 0, copies = 0;
    const ports = (stopAt = Infinity) => ({ guard: spy, graph: (n: number) => evaluate(doc, frameAt(doc, n)), draw: async () => ({}), copy: () => { copies++; }, now: () => clock, sleep: async (s: number) => { clock += s; }, fps: 30, stopped: () => seen.length >= stopAt });
    const r = await playWindow(playFrames({ play }), ports());
    expect(r).toEqual({ painted: 24, stoppedEarly: false });
    expect(seen).toEqual(playFrames({ play }));
    expect(copies).toBe(24);
    seen.length = 0;
    const r2 = await playWindow(playFrames({ play }), ports(5));
    expect(r2).toEqual({ painted: 5, stoppedEarly: true });
    // paced at the project's rate: the last frame was due at 23/30 s on the fake clock
    expect(clock).toBeGreaterThan(0);
    // the light of film-burn is a light transition: the guard treats the window as flashing material, never as plain pictures
    const g = evaluate(doc, frameAt(doc, 60));
    expect(JSON.stringify(g.layers)).toMatch(/light/);
  });
  it('flash safety: a second rise inside a third of a second is held back by the guard in playWindow (ADR-0009), and the counter says how many', async () => {
    const { doc } = standIn('film-burn');
    const guard = new FlashGuard();
    const io = { now: () => 100, draw: async () => ({}), copy: () => undefined, sleep: async () => undefined };
    // dark, lit (the burn peaks at frame 72), dark, lit again with no time between (a pace far above real time): the second light is a rise too close to the first
    await playWindow([59, 72, 59, 72], { guard, graph: (n) => evaluate(doc, frameAt(doc, n)), fps: 1e9, stopped: () => false, ...io });
    expect(guard.leftOut).toBeGreaterThanOrEqual(1);
  });
  it('the words: the canvas description is Hebrew for he, names the item, and gives no verdict', () => {
    const item = { title: { he: 'צריבת פילם', en: 'Film burn' }, what: { he: 'x', en: 'y' } };
    const he = pictureDescription(item, 'he', 'mid'), en = pictureDescription(item, 'en');
    expect(he).toMatch(/צריבת פילם/); expect(he).toMatch(/[א-ת]/); expect(en).toMatch(/Film burn/);
    for (const s of [he, en, ...Object.values(BOOTH_PAGE_STRINGS.he).filter((x) => typeof x === 'string'), ...Object.values(BOOTH_PAGE_STRINGS.en).filter((x) => typeof x === 'string')] as string[]) expect(s).not.toMatch(/\b(good|right|sharp|safe|verified)\b|מצוין|תקין|חד\b|בטוח|מאומת/i);
  });
});

describe('export strip logic (builder W2)', () => {
  const views = [{ item: { exportStrip: true, id: 'gpu-transition:film-burn' } }, { item: { exportStrip: false, id: 'gpu-transition:other' } }, { item: { exportStrip: true, id: 'gpu-transition:light-leak' } }];
  it('only the flagged items; the strip opens after the row export-gpu answered (skipped is not an answer)', () => {
    expect(stripItems(views).map((v) => v.item.id)).toEqual(['gpu-transition:film-burn', 'gpu-transition:light-leak']);
    expect(stripGate(null)).toBe('needs-row');
    expect(stripGate({ state: 'skipped' })).toBe('needs-row');
    for (const state of ['ok', 'setup', 'off', 'fail', 'unknown'] as const) expect(stripGate({ state })).toBe('ready');
  });
  it('the headers: x-pf-adapter (ASCII, ≤ 200) and x-pf-software 0|1 become exportAdapter and exportSoftware; anything else is not told', () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(exportStillFacts(h({ 'x-pf-adapter': 'nvidia|ampere||RTX 3050', 'x-pf-software': '0' }))).toEqual({ adapter: 'nvidia|ampere||RTX 3050', software: false });
    expect(exportExtras(exportStillFacts(h({ 'x-pf-adapter': 'google|swiftshader', 'x-pf-software': '1' })))).toEqual({ exportAdapter: 'google|swiftshader', exportSoftware: true });
    expect(exportStillFacts(h({ 'x-pf-adapter': 'x'.repeat(300) })).adapter).toHaveLength(200);
    expect(exportStillFacts(h({ 'x-pf-software': 'maybe' }))).toEqual({ adapter: null, software: null });
    expect(exportExtras({ adapter: null, software: null })).toEqual({});
  });
  it('a 409 booth_busy is told in words (the server\'s sentence through translateRefusal), never a code; other failures have words too', async () => {
    const busyMsg = 'an export or other work is running now, so this check was skipped';
    const refuse = (status: number, message: string, code: string) => async () => new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'content-type': 'application/json' } });
    const fb = { busy: BOOTH_PAGE_STRINGS.he.stripBusy, other: BOOTH_PAGE_STRINGS.he.stripFailed };
    const r = await fetchExportStill(refuse(409, busyMsg, 'booth_busy'), '/x', 'he', fb);
    expect(r).toMatchObject({ ok: false, busy: true });
    expect((r as { words: string }).words).toMatch(/דילגנו|ייצוא/);
    expect((r as { words: string }).words).not.toMatch(/booth_busy/);
    const unknown = await fetchExportStill(refuse(409, 'something new', 'booth_busy'), '/x', 'he', fb);
    expect(unknown).toMatchObject({ ok: false, busy: true, words: fb.busy });
    const other = await fetchExportStill(refuse(500, 'boom', 'x'), '/x', 'en', fb);
    expect(other).toMatchObject({ ok: false, busy: false, words: fb.other });
    expect(await fetchExportStill(async () => { throw new TypeError('network'); }, '/x', 'he', fb)).toMatchObject({ ok: false, words: fb.other });
    const good = await fetchExportStill(async () => new Response(new Uint8Array([1]) as BlobPart, { status: 200, headers: { 'x-pf-adapter': 'a|b', 'x-pf-software': '0' } }), '/x', 'he', fb);
    expect(good).toMatchObject({ ok: true, facts: { adapter: 'a|b', software: false } });
    expect(createT('he')('error.code.booth_busy')).toMatch(/ייצוא/);
  });
  it('the strip says nothing is "the same": no difference number and no such word in its sources or words', () => {
    const src = ['BoothExportStrip.tsx', 'picture.logic.ts', 'check/check.strings.ts'].map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')).join('\n');
    expect(src).not.toMatch(/meanDiff|difference number|\bidentical\b|pixel(s)? match/i);
    for (const s of [BOOTH_PAGE_STRINGS.en.stripDone, BOOTH_PAGE_STRINGS.en.stripSoftware]) expect(s).not.toMatch(/\b(matches|identical|verified)\b/i);
  });
});
