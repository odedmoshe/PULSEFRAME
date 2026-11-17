import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DERIVATIVE_RETRY_MS, DerivativeLoader, derivativeStep, thumbTileAt, type DerivativeKind, type LoadedDerivative, type ThumbMeta } from './mediaThumb.ts';

// ---- a labelled stand-in for the server and the browser (test only): derivative rows per asset, counted requests, countable pictures ----
interface FakeBitmap { n: number; closed: boolean; close(): void }
type Shown = LoadedDerivative<FakeBitmap> | null;
const META: ThumbMeta = { tileWidth: 160, tileHeight: 90, columns: 10, rows: 6, frameIndices: Array.from({ length: 60 }, (_, i) => i * 30) };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function world() {
  const rows = new Map<string, string>(); // `${assetId}|${kind}` -> status
  const count = { list: 0, blob: 0, decoded: 0, closed: 0, closedWhileShown: 0, withoutSignal: 0 };
  const signals: AbortSignal[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const cards: { shown: Shown }[] = [];
  let listOk = true;
  let hold: Promise<void> | null = null;
  const fetch = async (url: string, signal: AbortSignal) => {
    if (!signal) count.withoutSignal++;
    signals.push(signal);
    const m = /\/projects\/([^/]+)\/assets\/([^/]+)\/derivatives(?:\/(\w+))?$/.exec(url);
    if (!m) throw new Error(`unexpected url ${url}`);
    const asset = decodeURIComponent(m[2]!), kind = m[3];
    if (kind) count.blob++; else count.list++;
    const then = new Map(rows); // the server answers with the state it had when the request arrived
    const status = (k: string) => then.get(`${asset}|${k}`);
    await new Promise((r) => setImmediate(r));
    if (hold) await hold;
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (!kind) return { ok: listOk, json: async () => ({ assetId: asset, derivatives: ['thumbnails', 'waveform'].filter((k) => status(k)).map((k) => ({ kind: k, status: status(k)!, meta: status(k) === 'ready' ? (k === 'thumbnails' ? META : { sampleRate: 48000, totalSamples: 0, levels: [] }) : null })) }), blob: async () => new Blob(), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: status(kind) === 'ready', json: async () => ({}), blob: async () => new Blob(['jpeg']), arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const decode = async (): Promise<FakeBitmap> => {
    await new Promise((r) => setImmediate(r));
    const bmp: FakeBitmap = { n: ++count.decoded, closed: false, close() { if (this.closed) throw new Error('closed twice'); this.closed = true; count.closed++; if (cards.some((c) => c.shown?.kind === 'thumbnails' && c.shown.bitmap === this)) count.closedWhileShown++; } };
    return bmp;
  };
  const card = () => {
    const c: { shown: Shown; changes: number; loader: DerivativeLoader<FakeBitmap> } = { shown: null, changes: 0, loader: undefined as never };
    c.loader = new DerivativeLoader<FakeBitmap>({ fetch, decode, onChange: (v) => { c.shown = v; c.changes++; }, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: (h) => { const i = timers.indexOf(h as (typeof timers)[number]); if (i >= 0) timers.splice(i, 1); } });
    cards.push(c);
    return c;
  };
  const id = (assetId: string, kind: DerivativeKind = 'thumbnails', contentHash = `sha256:${assetId}`) => ({ projectId: 'p1', assetId, contentHash, kind });
  /** The card goes away, the way the component does it: it lets go of what it shows, then disposes the loader. */
  const leave = (c: { shown: Shown; loader: DerivativeLoader<FakeBitmap> }) => { c.shown = null; c.loader.dispose(); };
  return {
    rows, count, signals, timers, card, id, leave,
    set: (assetId: string, status: string, kind: DerivativeKind = 'thumbnails') => void rows.set(`${assetId}|${kind}`, status),
    failLists: (fail: boolean) => { listOk = !fail; },
    /** Requests stay unanswered until the returned function is called. */
    holdRequests: () => { let open!: () => void; hold = new Promise<void>((r) => { open = r; }); return () => { hold = null; open(); }; },
    /** Let the next pending retry timer fire. */
    fireTimer: () => { const t = timers.shift(); if (!t) throw new Error('no timer pending'); t.fn(); return t.ms; },
  };
}

describe('DerivativeLoader: a media card loads its filmstrip once (finding 17)', () => {
  it('derivative events of other assets cost a loaded card nothing: 30 loaded cards and 90 events make no request and decode nothing', async () => {
    const w = world();
    const cards = Array.from({ length: 30 }, (_, k) => { w.set(`a${k}`, 'ready'); const c = w.card(); c.loader.show(w.id(`a${k}`)); return c; });
    await settle();
    expect(w.count).toMatchObject({ list: 30, blob: 30, decoded: 30, closed: 0 });
    expect(cards.every((c) => c.shown?.kind === 'thumbnails')).toBe(true);
    for (let e = 0; e < 90; e++) { for (const c of cards) c.loader.poke(); await settle(); }
    expect(w.count).toMatchObject({ list: 30, blob: 30, decoded: 30, closed: 0 }); // before the fix: 2730 of each
    expect(cards.every((c) => c.changes === 1)).toBe(true);
    for (const c of cards) w.leave(c);
    expect(w.count).toMatchObject({ decoded: 30, closed: 30, closedWhileShown: 0, withoutSignal: 0 }); // every picture created is closed when its card goes away
  });

  it('a card that is waiting looks at its own asset on an event and downloads the filmstrip only once it is ready', async () => {
    const w = world();
    w.set('v', 'queued');
    const c = w.card();
    c.loader.show(w.id('v'));
    await settle();
    expect(w.count).toMatchObject({ list: 1, blob: 0, decoded: 0 });
    w.set('v', 'running'); c.loader.poke(); await settle(); // an event: this asset is running, or it was another asset's event
    expect(w.count).toMatchObject({ list: 2, blob: 0, decoded: 0 });
    expect(c.shown).toBeNull();
    w.set('v', 'ready'); c.loader.poke(); await settle();
    expect(w.count).toMatchObject({ list: 3, blob: 1, decoded: 1 });
    expect(c.shown).toMatchObject({ kind: 'thumbnails', meta: META });
    expect(w.timers).toHaveLength(0);
    for (let e = 0; e < 20; e++) { c.loader.poke(); await settle(); }
    expect(w.count).toMatchObject({ list: 3, blob: 1, decoded: 1, closed: 0 });
  });

  it('without events it looks again a bounded number of times, then stops; an event starts the looks afresh', async () => {
    const w = world();
    w.set('v', 'running');
    const c = w.card();
    c.loader.show(w.id('v'));
    await settle();
    const waits: number[] = [];
    while (w.timers.length) { waits.push(w.fireTimer()); await settle(); }
    expect(waits).toEqual([...DERIVATIVE_RETRY_MS]);
    expect(w.count).toMatchObject({ list: 1 + DERIVATIVE_RETRY_MS.length, blob: 0 });
    await settle();
    expect(w.timers).toHaveLength(0); // gave up: no request without a new event
    c.loader.poke(); await settle();
    expect(w.count.list).toBe(2 + DERIVATIVE_RETRY_MS.length);
    expect(w.timers.map((t) => t.ms)).toEqual([DERIVATIVE_RETRY_MS[0]]);
  });

  it('an event while a retry is pending looks now and replaces the pending retry (never two chains at once)', async () => {
    const w = world();
    w.set('v', 'queued');
    const c = w.card();
    c.loader.show(w.id('v'));
    await settle();
    expect(w.timers).toHaveLength(1);
    c.loader.poke();
    expect(w.timers).toHaveLength(0);
    await settle();
    expect(w.count.list).toBe(2);
    expect(w.timers).toHaveLength(1);
  });

  it('events that arrive while a look is in flight are folded into one further look', async () => {
    const w = world();
    w.set('v', 'running');
    const c = w.card();
    const release = w.holdRequests();
    c.loader.show(w.id('v'));
    await settle();
    for (let e = 0; e < 9; e++) c.loader.poke(); // nine events of one import
    expect(w.count.list).toBe(1);
    w.set('v', 'ready'); // became ready after the first look had read "running"
    release();
    await settle();
    expect(w.count).toMatchObject({ list: 2, blob: 1, decoded: 1 });
    expect(c.shown?.kind).toBe('thumbnails');
  });

  it('a derivative that does not apply is never asked for again', async () => {
    const w = world();
    w.set('m', 'not-applicable');
    const c = w.card();
    c.loader.show(w.id('m'));
    await settle();
    for (let e = 0; e < 10; e++) { c.loader.poke(); await settle(); }
    expect(w.count).toMatchObject({ list: 1, blob: 0, decoded: 0 });
    expect(w.timers).toHaveLength(0);
    expect(c.shown).toBeNull();
  });

  it('a failed derivative or a failing server is retried within the same bounds', async () => {
    const w = world();
    w.set('v', 'failed');
    const c = w.card();
    c.loader.show(w.id('v'));
    await settle();
    expect(w.timers).toHaveLength(1);
    w.set('v', 'ready'); w.failLists(true);
    w.fireTimer(); await settle();
    expect(w.count).toMatchObject({ list: 2, blob: 0 });
    w.failLists(false);
    w.fireTimer(); await settle();
    expect(w.count).toMatchObject({ list: 3, blob: 1, decoded: 1 });
    expect(c.shown?.kind).toBe('thumbnails');
  });

  it('the same file shown again asks nothing; another file replaces the picture, and the old one is closed only after the card was given the new state', async () => {
    const w = world();
    w.set('v', 'ready');
    const c = w.card();
    c.loader.show(w.id('v'));
    await settle();
    const first = c.shown!.kind === 'thumbnails' ? c.shown!.bitmap : null;
    c.loader.show(w.id('v')); // a re-render with the same asset
    await settle();
    expect(w.count).toMatchObject({ list: 1, blob: 1, decoded: 1, closed: 0 });
    c.loader.show(w.id('v', 'thumbnails', 'sha256:replaced')); // the asset now has other content
    expect(c.shown).toBeNull(); // told at once ...
    expect(first!.closed).toBe(true); // ... and only then closed
    expect(w.count.closedWhileShown).toBe(0);
    await settle();
    expect(w.count).toMatchObject({ list: 2, blob: 2, decoded: 2, closed: 1 });
    expect(c.shown?.kind === 'thumbnails' && c.shown.bitmap.closed).toBe(false);
    c.loader.show(null);
    expect(c.shown).toBeNull();
    expect(w.count).toMatchObject({ decoded: 2, closed: 2, closedWhileShown: 0 });
  });

  it('a card that goes away while its request is in flight aborts it and downloads nothing more', async () => {
    const w = world();
    w.set('v', 'ready');
    const c = w.card();
    const release = w.holdRequests();
    c.loader.show(w.id('v'));
    await settle();
    c.loader.dispose();
    expect(w.signals[0]!.aborted).toBe(true);
    release();
    await settle();
    expect(w.count).toMatchObject({ list: 1, blob: 0, decoded: 0 });
    expect(c.changes).toBe(0);
    c.loader.poke(); c.loader.show(w.id('other')); await settle(); // a disposed loader stays quiet
    expect(w.count).toMatchObject({ list: 1, blob: 0 });
  });

  it('a picture decoded for a card that went away, or that meanwhile shows another file, is closed and never shown', async () => {
    const w = world();
    w.set('v', 'ready'); w.set('u', 'queued');
    const gone = w.card(), moved = w.card();
    gone.loader.show(w.id('v')); moved.loader.show(w.id('v'));
    while (w.count.blob < 2) await new Promise((r) => setImmediate(r)); // both filmstrips requested ...
    await new Promise((r) => setImmediate(r)); // ... and handed to the decoder
    gone.loader.dispose();
    moved.loader.show(w.id('u'));
    await settle();
    expect(w.count.decoded).toBe(w.count.closed);
    expect(gone.shown).toBeNull();
    expect(moved.shown).toBeNull(); // 'u' is still queued
    expect(gone.changes).toBe(0);
  });

  it('a waveform is loaded once too and holds nothing to close', async () => {
    const w = world();
    w.set('m', 'ready', 'waveform');
    const c = w.card();
    c.loader.show(w.id('m', 'waveform'));
    await settle();
    expect(c.shown).toMatchObject({ kind: 'waveform' });
    for (let e = 0; e < 10; e++) { c.loader.poke(); await settle(); }
    expect(w.count).toMatchObject({ list: 1, blob: 1, decoded: 0 });
    c.loader.dispose();
    expect(w.count.closed).toBe(0);
  });

  it('no picture is left open after a storm: cards come, wait, load, change and go while events arrive', async () => {
    const w = world();
    const cards = Array.from({ length: 12 }, (_, k) => { w.set(`a${k}`, k % 3 === 0 ? 'ready' : 'queued'); const c = w.card(); c.loader.show(w.id(`a${k}`)); return c; });
    for (let e = 0; e < 30; e++) {
      if (e % 2 === 0) w.set(`a${(e / 2) % 12}`, 'ready');
      if (e === 7) cards[0]!.loader.show(w.id('a1'));
      if (e === 11) w.leave(cards[3]!);
      for (const c of cards) c.loader.poke();
      if (e % 4 === 0) await settle();
    }
    await settle();
    const shownNow = cards.filter((c) => c.shown?.kind === 'thumbnails').length;
    expect(shownNow).toBe(11);
    expect(w.count.decoded - w.count.closed).toBe(shownNow); // exactly the pictures on screen are open
    expect(w.count.blob).toBe(13); // one filmstrip per card, and one more for the card that changed file: 30 events on 12 cards downloaded nothing twice
    for (const c of cards) w.leave(c);
    expect(w.count.decoded).toBe(w.count.closed);
    expect(w.count.closedWhileShown).toBe(0); // a card never held a closed picture
  });
});

describe('derivativeStep', () => {
  it('downloads only what is ready, gives up only on not-applicable, waits otherwise', () => {
    expect(derivativeStep('ready')).toBe('load');
    expect(derivativeStep('not-applicable')).toBe('never');
    for (const s of ['queued', 'running', 'failed', undefined]) expect(derivativeStep(s)).toBe('wait');
  });
});

describe('thumbTileAt: the tile shown by a card, and by the hover scrub (finding 20)', () => {
  // tile sizes as the server makes them: height 90, width = the video aspect rounded to an even number
  const meta = (tileWidth: number, frames = 25, columns = 10): ThumbMeta => ({ tileWidth, tileHeight: 90, columns, rows: Math.ceil(frames / columns), frameIndices: Array.from({ length: frames }, (_, i) => i * 12) });
  it('the canvas gets the size of one tile, so it has the aspect of the video: portrait, square, 4:3, 16:9 and wide', () => {
    for (const [w, h, tileWidth] of [[1080, 1920, 50], [1080, 1080, 90], [640, 480, 120], [1920, 1080, 160], [2560, 1080, 214]] as const) {
      const t = thumbTileAt(meta(tileWidth), 0);
      expect([t.width, t.height]).toEqual([tileWidth, 90]);
      expect(Math.abs(t.width / t.height - w / h)).toBeLessThan(0.02); // not 16:9 unless the video is
    }
  });
  it('the pointer position across the card picks the frame: left edge the first, right edge the last', () => {
    const m = meta(50);
    expect(thumbTileAt(m, 0).index).toBe(0);
    expect(thumbTileAt(m, 0.5).index).toBe(12);
    expect(thumbTileAt(m, 0.999).index).toBe(24);
    expect(thumbTileAt(m, 1).index).toBe(24);
    expect([thumbTileAt(m, -0.2).index, thumbTileAt(m, 1.7).index, thumbTileAt(m, NaN).index]).toEqual([0, 24, 0]);
    expect(Array.from({ length: 25 }, (_, i) => thumbTileAt(m, (i + 0.5) / 25).index)).toEqual(Array.from({ length: 25 }, (_, i) => i)); // every frame is reachable
  });
  it('reads the tile from its row and column of the sprite', () => {
    const m = meta(50);
    expect(thumbTileAt(m, 0)).toEqual({ index: 0, sx: 0, sy: 0, width: 50, height: 90 });
    expect(thumbTileAt(m, 9.5 / 25)).toEqual({ index: 9, sx: 450, sy: 0, width: 50, height: 90 });
    expect(thumbTileAt(m, 10.5 / 25)).toEqual({ index: 10, sx: 0, sy: 90, width: 50, height: 90 });
    expect(thumbTileAt(m, 24.5 / 25)).toEqual({ index: 24, sx: 200, sy: 180, width: 50, height: 90 });
  });
  it('a filmstrip of one frame always shows that frame', () => {
    expect(thumbTileAt(meta(90, 1), 0.8)).toEqual({ index: 0, sx: 0, sy: 0, width: 90, height: 90 });
  });
});

describe('mediaLibrary.css: the card picture is fitted, not stretched (finding 20)', () => {
  const css = fs.readFileSync(new URL('./mediaLibrary.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Declarations that apply to a selector, from every rule that lists it. */
  const declared = (selector: string) => {
    const out: Record<string, string> = {};
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!m[1]!.split(',').map((s) => s.trim()).includes(selector)) continue;
      for (const d of m[2]!.split(';')) { const i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    }
    return out;
  };
  it('the filmstrip canvas fills the 16:9 box with object-fit: contain, like the still picture', () => {
    expect(declared('.media-card .mc-thumb canvas')).toMatchObject({ 'object-fit': 'contain', width: '100%', height: '100%' });
    expect(declared('.media-card .mc-thumb img')).toMatchObject({ 'object-fit': 'contain' });
  });
  it('the box is 16:9 and black, so the bars beside a portrait frame are black', () => {
    expect(declared('.media-card .mc-thumb')).toMatchObject({ 'aspect-ratio': '16 / 9', background: '#000' });
  });
});
