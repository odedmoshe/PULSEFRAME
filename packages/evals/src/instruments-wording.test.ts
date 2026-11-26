/**
 * Keeps the Hebrew wording of «כלים מוקלטים» (packages/i18n/src/instruments.ts HE_INSTRUMENTS) in step with the fixed English of
 * apps/server/src/instruments/contract.ts INSTRUMENTS_SERVER_REFUSALS: every sentence is worded in Hebrew with a next step and every
 * pattern is used. Also: the strings exist in both languages, the labels of core match the dictionary, and no instruments string says a
 * recorded kit sounds better, real, warm or natural (core INSTRUMENTS_FORBIDDEN_WORDS). Builder W2 owns this file after the pre-pass
 * (it adds a row per refusal provoked for real through the recorded path).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { MUSIC_KITS, INSTRUMENTS_FORBIDDEN_WORDS, INSTRUMENTS_FORBIDDEN_WORDS_HE, MUSIC_RECORDED_HEARD_LABEL, MUSIC_RECORDED_UNHEARD_LABEL } from '@pulseframe/core';
import { INSTRUMENTS_SERVER_REFUSALS } from '../../../apps/server/src/instruments/contract.ts';
import { checkKit, kitNotes, loadBank } from '../../../apps/server/src/instruments/bank.ts';
import { markKitHeard } from '../../../apps/server/src/instruments/heard.ts';
import { loadConfig } from '../../../apps/server/src/config.ts';
import { Governance } from '../../../apps/server/src/governance.ts';
import { closeLibraryService, libraryServiceFor } from '../../../apps/server/src/library/index.ts';
import { addMusic, createMusicQueue, makeMusic } from '../../../apps/server/src/music.ts';
import { renderMusic } from '../../../apps/server/src/music/render.ts';
import { prepareMusicFit } from '../../../apps/server/src/musicfit/plan.ts';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { INSTRUMENTS_UI_STRINGS } from '../../../apps/web/src/editor/instruments/instruments.strings.ts';
import { refreshKitTable, standInPlanZones, SYNTHETIC_SOURCES, writeLedger, writeSyntheticKit } from '../../fixtures/src/instruments.ts';
import { dictionaries, INSTRUMENTS_EN, INSTRUMENTS_HE, INSTRUMENTS_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

/** One sample sentence per refusal, made by the table's own message function. */
const ARGS: Record<keyof typeof INSTRUMENTS_SERVER_REFUSALS, unknown[]> = {
  notBuilt: [], libraryNotSet: [], noKit: ['music.pop'], kitNotReady: ['kit.calm.vsco@1'], itemMissing: ['vsco-2-ce/repo'], itemVersion: ['vsco-2-ce/repo'],
  licence: ['vsco-2-ce/repo', 'licence_share_alike'], fileMissing: ['Strings/a.wav'], fileChanged: ['Strings/a.wav'], pathEscape: [], unreadable: ['Strings/a.wav', 'truncated data chunk'],
  format: ['Strings/a.flac', 'flac'], range: ['piano'], tooLarge: [96], notFittable: [], ownerOnly: [],
};
const samples: string[] = (Object.keys(INSTRUMENTS_SERVER_REFUSALS) as (keyof typeof INSTRUMENTS_SERVER_REFUSALS)[]).map((k) => (INSTRUMENTS_SERVER_REFUSALS[k].message as (...a: unknown[]) => string)(...ARGS[k]));
const heb = /[֐-׿]/;
const enWord = (w: string) => new RegExp(`\\b${w}\\b`, 'i');
const heWord = (w: string) => new RegExp(`(^|[^\\u0590-\\u05FF])${w}([^\\u0590-\\u05FF]|$)`);

describe('instruments refusals in Hebrew', () => {
  it('every sentence of the server table is worded, in Hebrew, with a next step', () => {
    for (const s of samples) {
      const he = translateRefusal('he', s);
      expect(he, s).toBeTruthy();
      expect(heb.test(he!), s).toBe(true);
      // a next step: a second sentence after the reason
      expect(/[.;—]\s|\. |, /.test(he!) || he!.includes('. '), s).toBe(true);
    }
  });
  it('each sentence is worded by its own pattern, and every pattern is used', () => {
    const used = new Set<number>();
    for (const s of samples) {
      const i = INSTRUMENTS_REFUSAL_PATTERNS.findIndex((re) => re.test(s));
      expect(i, s).toBeGreaterThanOrEqual(0);
      used.add(i);
    }
    expect(used.size).toBe(INSTRUMENTS_REFUSAL_PATTERNS.length);
  });
  it('every refusal carries an English hint (the next step) and an instruments_ or owner code', () => {
    for (const r of Object.values(INSTRUMENTS_SERVER_REFUSALS)) { expect(r.hint.length).toBeGreaterThan(10); expect(/^(instruments_|owner_required$)/.test(r.code)).toBe(true); }
  });
  it('each refusal of the recorded path, provoked for real over the labelled synthetic test kit, is the table\'s sentence and is worded in Hebrew', async () => {
    const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
    const made: string[] = [];
    const got = new Map<string, ApiError>();
    const take = async (p: Promise<unknown> | (() => unknown)) => { try { await (typeof p === 'function' ? p() : p); } catch (e) { if (e instanceof ApiError) { got.set(e.code, e); return; } throw e; } throw new Error('no refusal'); };
    const stand = { planZones: (n: Parameters<typeof standInPlanZones>[0], b: Parameters<typeof standInPlanZones>[1]) => standInPlanZones(n, b) } as never;
    const world = (o: Parameters<typeof writeSyntheticKit>[1] = {}, library = true) => {
      const data = tmp('pf-insw-data-'); made.push(data);
      const lib = library ? writeSyntheticKit(tmp('pf-insw-lib-'), o) : null; if (lib) made.push(lib.root);
      const cfg = { ...loadConfig({}), dataDir: data, libraryDir: lib?.root ?? null };
      libraryServiceFor(cfg, { noStartupBuild: true });
      return { cfg, lib, store: new Store(data) };
    };
    try {
      const n = world({}, false);
      await take(makeMusic(n.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const }, 't')); // no Config wired: not built
      await take(makeMusic(n.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const }, 't', createMusicQueue(), { cfg: n.cfg }));
      const w = world();
      const kit = w.lib!.kit;
      await take(makeMusic(w.store, { styleId: 'music.pop', bars: 4, seed: 1, instruments: 'recorded' as const }, 't', createMusicQueue(), { cfg: w.cfg, kits: [kit] }));
      // a kit with an instrument that has no entry and no files is not calibrated (the shipped kit was, until 2026-11-26)
      const unread = structuredClone(kit); unread.instruments[0]!.entry = null; unread.instruments[0]!.files = [];
      await take(makeMusic(w.store, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' as const }, 't', createMusicQueue(), { cfg: w.cfg, kits: [unread] }));
      const check = await checkKit(w.cfg, kit);
      if (check.state !== 'ready') throw check.error;
      await take(loadBank(check, kit, [{ part: 'lead', midi: 127, vel: 1, gate: 10 }], undefined, stand));
      await take(loadBank(check, kit, kitNotes(kit, 'music.calm', 4, 1), undefined, { ...(stand as object), maxDecodedBytes: 1 } as never));
      const gov = new Governance(w.store);
      const pid = w.store.createProject({ name: 'w' }).doc.id;
      // LABELLED STAND-IN renderer (until W1's sampler is merged): the synthesiser's bytes; only the refusal after it is checked here
      const half = async (id: string, bars: number, seed: number, o: { cancel: { cancelled: boolean } }) => renderMusic(id, bars, seed, { cancel: o.cancel });
      const r = await addMusic(w.store, gov, { actor: 'owner', kind: 'user', scopes: ['observe', 'edit'] }, pid, { styleId: 'music.calm', bars: 4, seed: 1, start: T.ZERO, instruments: 'recorded' as const }, createMusicQueue({}, half), { cfg: w.cfg, kits: [kit], load: stand });
      const p = w.store.getProject(pid);
      await take(prepareMusicFit(w.store, pid, p.doc, p.revision, { target: { clipId: r.clipId! }, music: { keep: true }, tailor: true }));
      await take(() => markKitHeard(w.cfg.dataDir, { actor: 'agent:a', kind: 'agent', scopes: ['observe', 'edit'], mode: 'edit' } as never, kit.id, true, '2026-11-25T00:00:00Z'));
      const at = async (mut: () => void, k = kit) => { mut(); const c = await checkKit(w.cfg, k); if (c.state !== 'ready') got.set(c.error.code, c.error); writeLedger(w.lib!.root, w.lib!.ledger); };
      await at(() => writeLedger(w.lib!.root, []));
      await at(() => writeLedger(w.lib!.root, w.lib!.ledger.map((e) => ({ ...e, commit: 'other' }))));
      const wav = path.join(w.lib!.items.piano.dir, 'samples', 'piano-c4.wav');
      const keep = fs.readFileSync(wav);
      await at(() => fs.rmSync(wav));
      await at(() => { const b = Buffer.from(keep); b[b.length - 1]! ^= 1; fs.writeFileSync(wav, b); });
      fs.writeFileSync(wav, keep.subarray(0, 100));
      await at(() => {}, refreshKitTable(w.lib!));
      fs.writeFileSync(wav, Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(100)]));
      await at(() => {}, refreshKitTable(w.lib!));
      fs.writeFileSync(wav, keep);
      fs.appendFileSync(path.join(w.lib!.items.piano.dir, 'piano.sfz'), '<region> sample=../../../x.wav key=1\n');
      await at(() => {}, refreshKitTable(w.lib!));
      const l = world({ piano: SYNTHETIC_SOURCES.ccBySa });
      const lc = await checkKit(l.cfg, l.lib!.kit);
      if (lc.state !== 'ready') got.set(lc.error.code, lc.error);
      for (const d of made) closeLibraryService(d);
    } finally { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); }
    const want = Object.values(INSTRUMENTS_SERVER_REFUSALS).map((x) => x.code).sort();
    expect([...got.keys()].sort()).toEqual(want);
    for (const [code, e] of got) {
      const row = Object.values(INSTRUMENTS_SERVER_REFUSALS).find((x) => x.code === code)!;
      expect([code, e.status, e.hint]).toEqual([code, row.status, row.hint]);
      const he = translateRefusal('he', e.message);
      expect(he && heb.test(he), `${code}: ${e.message}`).toBe(true);
    }
    expect(MUSIC_KITS.length).toBe(1);
  }, 120_000);
});

describe('instruments strings', () => {
  it('Hebrew first, English for the same keys, both served by the dictionaries', () => {
    expect(Object.keys(INSTRUMENTS_EN).sort()).toEqual(Object.keys(INSTRUMENTS_HE).sort());
    for (const k of Object.keys(INSTRUMENTS_HE) as (keyof typeof INSTRUMENTS_HE)[]) {
      expect(heb.test(INSTRUMENTS_HE[k]) || /^[אב]$/.test(INSTRUMENTS_HE[k]), k).toBe(true);
      expect(dictionaries.he[k]).toBe(INSTRUMENTS_HE[k]);
      expect(dictionaries.en[k]).toBe(INSTRUMENTS_EN[k]);
    }
  });
  it('the labels of core are the dictionary\'s', () => {
    expect(INSTRUMENTS_HE['instruments.unheard']).toBe(MUSIC_RECORDED_UNHEARD_LABEL.he);
    expect(INSTRUMENTS_EN['instruments.unheard']).toBe(MUSIC_RECORDED_UNHEARD_LABEL.en);
    expect(INSTRUMENTS_HE['instruments.heardOn']).toBe(MUSIC_RECORDED_HEARD_LABEL.he);
    expect(INSTRUMENTS_EN['instruments.heardOn']).toBe(MUSIC_RECORDED_HEARD_LABEL.en);
  });
  it('the heard label is plural and impersonal, no gendered form (wave 8 booth pre-pass; decisions "booth"); the English is unchanged', () => {
    expect(MUSIC_RECORDED_HEARD_LABEL.he).toBe('כלים מוקלטים — נשמעו במחשב הזה ({date})');
    expect(MUSIC_RECORDED_HEARD_LABEL.he).not.toContain('בעל הפרויקט שמע');
    expect(MUSIC_RECORDED_HEARD_LABEL.en).toBe('Recorded instruments — the owner listened ({date})');
  });
  it('nothing says a recorded kit sounds better, real, warm or natural (the shared words, the editor\'s own words, the refusals)', () => {
    const texts = [...Object.values(INSTRUMENTS_HE), ...Object.values(INSTRUMENTS_EN), ...Object.values(INSTRUMENTS_UI_STRINGS.he), ...Object.values(INSTRUMENTS_UI_STRINGS.en), ...samples, ...samples.map((s) => translateRefusal('he', s) ?? ''),
      ...Object.values(INSTRUMENTS_SERVER_REFUSALS).map((r) => r.hint), MUSIC_RECORDED_UNHEARD_LABEL.he, MUSIC_RECORDED_UNHEARD_LABEL.en, MUSIC_RECORDED_HEARD_LABEL.he, MUSIC_RECORDED_HEARD_LABEL.en];
    for (const s of texts) {
      for (const w of INSTRUMENTS_FORBIDDEN_WORDS) expect({ s, w, hit: enWord(w).test(s) }).toEqual({ s, w, hit: false });
      for (const w of INSTRUMENTS_FORBIDDEN_WORDS_HE) expect({ s, w, hit: heWord(w).test(s) }).toEqual({ s, w, hit: false });
    }
  });
});
