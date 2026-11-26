/**
 * The booth routes (wave 8 booth track; booth/contract.ts BOOTH_ROUTES). The first line of every handler is
 * `boothOwner(need(c, 'observe'))`: 403 owner_required before the id, a query or the body is read. While BOOTH_BUILT is false (until
 * the lead flips it at integration) every route answers 501 booth_not_built after that check; `built` lets a test mount the real
 * handlers on its own app before then (http.ts passes nothing, so the flag decides).
 *
 * Nothing here answers free server text: refusals only through boothError (wording frozen in i18n), rows through checks.ts, notes
 * scrubbed (core scrubNote) with this machine's user name, home folder, host name, data folder and library folder as literals before
 * they are stored; namesInNote counts people-sheet names in the note and nothing about the match is kept (L2).
 */
import {
  BOOTH_FIRST_GROUPS, BOOTH_FIRST_SITTING_CARDS, BOOTH_GROUPS, BOOTH_LIMITS, BoothAnswerBodySchema, BoothItemIdSchema, BOOTH_ASCII,
  namesInNote, peopleOf, scrubNote, type BoothAnswer, type BoothAnswerResult, type BoothItem, type BoothView,
} from '@pulseframe/core';
import { libraryServiceFor } from '../library/index.ts';
import type { Store } from '../store.ts';
import { boothBuild, boothMachine } from './build.ts';
import { isServerCheck, lastExportGpuAdapter, machineLiterals, runBoothCheck } from './checks.ts';
import { BOOTH_BUILT, boothError, boothOwner, type BoothApp, type BoothRouteDeps } from './contract.ts';
import { boothAudio, boothExportStill, servedSha } from './media.ts';
import { boothRegistry } from './registry.ts';
import { deleteAnswer, itemViews, putAnswer, readOwnerReview } from './store.ts';
import { boothPictures } from './testPicture.ts';

/** This machine's names a note must never carry (scrubNote's literals): user, home folder, host, data folder, library folder. */
export function boothScrubLiterals(deps: Pick<BoothRouteDeps, 'cfg'>): string[] {
  const out: string[] = machineLiterals();
  const add = (f: () => string | null | undefined) => { try { const v = f(); if (v) out.push(v); } catch { /* not readable here */ } };
  add(() => deps.cfg.dataDir);
  add(() => deps.cfg.libraryDir);
  add(() => libraryServiceFor(deps.cfg).configuredRoot());
  return out;
}
/** Every name of every project's people sheet (the owner's own session reads them; nothing is kept). */
export function boothPeopleNames(store: Store): string[] {
  const names: string[] = [];
  for (const row of store.listProjects()) {
    try { for (const p of Object.values(peopleOf(store.wholeProject(row.id).doc))) names.push(p.name); } catch { /* a project that cannot be opened has no names here */ }
  }
  return names;
}

const asciiQuery = (v: string | undefined) => (v !== undefined && v.length <= BOOTH_LIMITS.adapterChars && BOOTH_ASCII.test(v) && v.length > 0 ? v : null);

export function registerBoothRoutes(app: BoothApp, deps: BoothRouteDeps, built: boolean = BOOTH_BUILT): void {
  const { need, cfg, store } = deps;
  /** After the owner check: 501 until the booth is built in this build. */
  const gate = () => { if (!built) throw boothError('notBuilt'); };
  const itemOf = async (raw: string): Promise<BoothItem> => {
    const id = BoothItemIdSchema.safeParse(raw);
    const item = id.success ? (await boothRegistry()).find((i) => i.id === id.data) : undefined;
    if (!item) throw boothError('unknownItem');
    return item;
  };

  app.get('/api/v1/booth', async (c) => {
    boothOwner(need(c, 'observe'));
    gate();
    const items = await boothRegistry();
    const view: BoothView = {
      build: boothBuild(cfg.webDist), machine: boothMachine(),
      firstSitting: { cards: BOOTH_FIRST_SITTING_CARDS, groups: BOOTH_FIRST_GROUPS }, groups: BOOTH_GROUPS,
      items: itemViews(items, readOwnerReview(cfg.dataDir), { played: servedSha, browserAdapter: asciiQuery(c.req.query('browserAdapter')), exportAdapter: asciiQuery(c.req.query('exportAdapter')) ?? lastExportGpuAdapter() }),
    };
    return c.json(view, 200, { 'cache-control': 'no-store' });
  });
  app.get('/api/v1/booth/items/:id/audio', async (c) => {
    boothOwner(need(c, 'observe'));
    gate();
    const item = await itemOf(c.req.param('id'));
    if (item.kind !== 'audio') throw boothError('unknownItem');
    const { bytes, headers } = await boothAudio(item, deps, c.req.raw.signal);
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'audio/wav', 'content-length': String(bytes.length), 'cache-control': 'private, no-store', ...headers });
  });
  app.get('/api/v1/booth/test-picture/:which', (c) => {
    boothOwner(need(c, 'observe'));
    gate();
    const which = c.req.param('which');
    if (which !== 'a' && which !== 'b') throw boothError('unknownItem');
    const pic = boothPictures()[which];
    return c.body(new Uint8Array(pic.png), 200, { 'content-type': 'image/png', 'content-length': String(pic.byteSize), 'cache-control': 'private, max-age=3600', 'x-pf-content-sha256': pic.contentHash });
  });
  app.get('/api/v1/booth/items/:id/export-still', async (c) => {
    boothOwner(need(c, 'observe'));
    gate();
    const item = await itemOf(c.req.param('id'));
    const { bytes, headers } = await boothExportStill(item, deps);
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'image/png', 'content-length': String(bytes.length), 'cache-control': 'private, no-store', ...headers });
  });
  app.put('/api/v1/booth/answers/:id', async (c) => {
    boothOwner(need(c, 'observe'));
    gate();
    const item = await itemOf(c.req.param('id'));
    const text = await c.req.text();
    let raw: unknown;
    try { raw = text.length <= 16_384 ? JSON.parse(text) : undefined; } catch { raw = undefined; }
    const body = BoothAnswerBodySchema.safeParse(raw);
    if (!body.success) throw boothError('invalidAnswer');
    if (body.data.recipe !== item.recipe) throw boothError('staleRecipe');
    const { note: rawNote, ...rest } = body.data;
    const note = rawNote === undefined ? undefined : scrubNote(rawNote, { literals: boothScrubLiterals(deps) }).slice(0, BOOTH_LIMITS.noteChars);
    const answer: BoothAnswer = { ...rest, ...(note ? { note } : {}), id: item.id, at: new Date().toISOString(), build: boothBuild(cfg.webDist).commit };
    putAnswer(cfg.dataDir, answer);
    const result: BoothAnswerResult = { answer, namesInNote: note ? namesInNote(note, boothPeopleNames(store)).length : 0 };
    return c.json(result);
  });
  app.delete('/api/v1/booth/answers/:id', async (c) => {
    boothOwner(need(c, 'observe'));
    gate();
    const id = BoothItemIdSchema.safeParse(c.req.param('id'));
    if (!id.success) throw boothError('unknownItem');
    deleteAnswer(cfg.dataDir, id.data);
    return c.body(null, 204);
  });
  app.post('/api/v1/booth/checks/:rowId', async (c) => {
    const owner = boothOwner(need(c, 'observe'));
    gate();
    const id = c.req.param('rowId');
    if (!isServerCheck(id)) throw boothError('unknownCheck');
    return c.json(await runBoothCheck(id, { ...deps, owner }));
  });
}
