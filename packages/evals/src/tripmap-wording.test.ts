/**
 * Keeps the Hebrew wording of the trip map's refusals (packages/i18n/src/tripMap.ts HE_TRIPMAP) in step with the fixed English of core
 * mapContract.ts MAP_REFUSALS: every sentence is worded in Hebrew, says what to do next, and every pattern is used. Also: the strings
 * exist in both languages with the same keys, the honest sentences are there, the timing line is not masculine (C11), and no string
 * calls a map checked, right or safe. W1 owns this file after the pre-pass (provoke every refusal through its op once built).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MAP_LOOKS, MAP_MODES, MAP_OPS_BUILT, MAP_PUBLIC_OPS, MAP_REFUSALS, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries, HE_TRIPMAP, translateRefusal, TRIPMAP_EN, TRIPMAP_HE, TRIPMAP_REFUSAL_PATTERNS } from '../../i18n/src/index.ts';

/** Every refusal sentence with sample values (the ops provoke them for real once MAP_OPS_BUILT). */
const SAMPLES: Record<keyof typeof MAP_REFUSALS, string> = {
  notBuilt: MAP_REFUSALS.notBuilt.message('add_trip_map'),
  stopCount: MAP_REFUSALS.stopCount.message(13),
  stopName: MAP_REFUSALS.stopName.message(2),
  noLabel: MAP_REFUSALS.noLabel.message(),
  stopPlace: MAP_REFUSALS.stopPlace.message(0),
  samePlace: MAP_REFUSALS.samePlace.message(1),
  stopIds: MAP_REFUSALS.stopIds.message(),
  times: MAP_REFUSALS.times.message(),
  firstVia: MAP_REFUSALS.firstVia.message(),
  tooShort: MAP_REFUSALS.tooShort.message(3, 30),
  noMusic: MAP_REFUSALS.noMusic.message(),
  noBars: MAP_REFUSALS.noBars.message(),
  unitsShort: MAP_REFUSALS.unitsShort.message(5, 3),
  notMap: MAP_REFUSALS.notMap.message('clp_x'),
};
const FORBIDDEN_EN = [/\bsafe\b/i, /\bverified\b/i, /\bchecked\b/i, /\bcorrect\b/i, /\baccurate\b/i];
const FORBIDDEN_HE = ['בטוח', 'מאומת', 'אומת', 'מדויק', 'נכון'];

describe('trip map wording', () => {
  it('every refusal is worded in Hebrew with a next step, by its own pattern, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', msg);
      expect(he, k).toBeTruthy();
      expect(/[א-ת]/.test(he!), k).toBe(true);
      expect(he!.includes('. ') || he!.includes('; '), `${k}: says what to do next`).toBe(true);
      const own = HE_TRIPMAP.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    expect(TRIPMAP_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('the strings exist in both languages with the same keys, with every op, mode and look, and the honest sentences', () => {
    expect(Object.keys(TRIPMAP_EN).sort()).toEqual(Object.keys(TRIPMAP_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const op of MAP_PUBLIC_OPS) expect(d[`op.${op}`], `${lang} ${op}`).toBeTruthy();
      for (const m of MAP_MODES) expect(d[`tripMap.mode.${m}`], `${lang} ${m}`).toBeTruthy();
      for (const l of MAP_LOOKS) expect(d[`tripMap.look.${l}`], `${lang} ${l}`).toBeTruthy();
    }
    expect(TRIPMAP_HE['tripMap.new']).toBe('מפת טיול חדשה');
    expect(TRIPMAP_HE['tripMap.unseen']).toContain('לא נבדק בעין');
    expect(TRIPMAP_HE['tripMap.coastsOnly']).toContain('בלי גבולות');
    expect(TRIPMAP_HE['tripMap.agents']).toContain('גלויים לסוכנים');
    expect(TRIPMAP_HE['tripMap.timedTo']).toBe('התזמון לפי התיבות של: {name}'); // C11: not «מתוזמן»
    expect(Object.values(TRIPMAP_HE).some((v) => v.includes('מתוזמן'))).toBe(false);
  });
  it('no string calls a map checked, accurate or safe', () => {
    for (const v of Object.values(TRIPMAP_EN)) for (const re of FORBIDDEN_EN) expect(re.test(v), v).toBe(false);
    for (const v of Object.values(TRIPMAP_HE)) for (const w of FORBIDDEN_HE) expect(v.includes(w), v).toBe(false);
  });
  it('every refusal is provoked through its op (MAP_OPS_BUILT) and its real sentence has its Hebrew wording with a next step', () => {
    expect(MAP_OPS_BUILT).toBe(true);
    const R = { num: 30, den: 1 }, f = (n: number) => T.frameTime(n, R);
    let seed = 0;
    const tx = (d: ProjectDocument, ops: OpCall[]) => applyTransaction(d, ops, { idSeed: `tmw${seed++}_`, actor: 'test' });
    const refused = (d: ProjectDocument, c: OpCall): OpError => { try { tx(d, [c]); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error(`${c.op} was accepted`); };
    // a title, a map at 1 s … 7 s, and (for the bar refusals) a sound file whose analysis has beats every 0.5 s from 0.317 s
    const base = tx(createProject({ id: 'prj_tmw', name: 'W' }), [{ op: 'add_text', args: { text: 'טיול', start: f(0), duration: f(30) } }]).doc;
    const A = { name: 'תל אביב', lon: 34_770_000, lat: 32_080_000 }, B = { name: 'ירושלים', lon: 35_210_000, lat: 31_780_000 };
    const withMap = tx(base, [{ op: 'add_trip_map', args: { start: f(30), duration: f(180), stops: [A, B, { name: 'לונדון', lon: -120_000, lat: 51_500_000 }] } }]);
    const doc = withMap.doc, mapId = withMap.results[0]!.output!.clipId as string, titleId = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text')!.id;
    const music = (bars: boolean, periodBeats: number) => {
      const d = structuredClone(doc);
      d.assets.ast_m = { id: 'ast_m', kind: 'audio', name: 'loop.wav', contentHash: `sha256:${'2'.padStart(64, '0')}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } } as ProjectDocument['assets'][string];
      const beats = Array.from({ length: 100 }, (_, k) => T.normalize(T.rt(317 + 500 * k, 1000)));
      d.analyses.ast_m = { assetId: 'ast_m', beats: { origin: { method: 'test grid', params: {}, createdAt: '2026-11-26T00:00:00Z', createdBy: 'test', edited: false }, bpm: 120, confidence: 0.9, beats, downbeats: bars ? beats.filter((_, k) => k % periodBeats === 0) : [], meter: 4 } } as ProjectDocument['analyses'][string];
      return tx(d, [{ op: 'add_clip', args: { assetId: 'ast_m', start: T.ZERO, withLinkedAudio: false } }]).doc;
    };
    const add = (stops: unknown[], duration = 240): OpCall => ({ op: 'add_trip_map', args: { start: f(300), duration: f(duration), stops } });
    const cases: [keyof typeof MAP_REFUSALS, ProjectDocument, OpCall][] = [
      ['stopCount', doc, add(Array.from({ length: 13 }, (_, i) => ({ name: `s${i}`, lon: i * 1_000_000, lat: 0 })))],
      ['firstVia', doc, add([{ ...A, via: 'boat' }, B])],
      ['stopName', doc, add([A, { ...B, name: 'א'.repeat(41) }])],
      ['stopPlace', doc, add([A, { ...B, lat: 81_000_000 }])],
      ['noLabel', doc, add([{ ...A, hidden: true }, { ...B, hidden: true }])],
      ['stopIds', doc, add([{ ...A, id: 'x' }, { ...B, id: 'x' }])],
      ['samePlace', doc, add([A, { ...A, name: 'יפו' }])],
      ['times', doc, add([{ ...A, at: 0 }, B])],
      ['tooShort', doc, add([A, B], 100)],
      ['notMap', doc, { op: 'update_trip_map', args: { clipId: titleId, look: 'night' } }],
      ['noMusic', doc, { op: 'time_trip_map', args: { clipId: mapId, to: 'bars' } }],
      ['noBars', music(false, 4), { op: 'time_trip_map', args: { clipId: mapId, to: 'bars' } }],
      ['unitsShort', music(true, 16), { op: 'time_trip_map', args: { clipId: mapId, to: 'bars' } }], // a bar every 8 s
    ];
    const provoked = new Set<string>();
    for (const [key, d, call] of cases) {
      const e = refused(d, call);
      expect(e.details.reason, key).toBe(MAP_REFUSALS[key].reason);
      expect(e.code, key).toBe(MAP_REFUSALS[key].code);
      const he = translateRefusal('he', e.message);
      expect(he && /[א-ת]/.test(he), `${key}: ${e.message}`).toBe(true);
      expect(he!.includes('. ') || he!.includes('; '), `${key}: says what to do next`).toBe(true);
      provoked.add(key);
    }
    // notBuilt can no longer be provoked: the ops are built; its sentence stays worded (the first test) for an older build's answers
    expect(Object.keys(MAP_REFUSALS).filter((k) => !provoked.has(k))).toEqual(['notBuilt']);
    // integration: a text op aimed at a map clip is worded as a trip map in Hebrew (not «ציור»), with where the map is changed
    for (const c of [{ op: 'update_text', args: { clipId: mapId, text: 'x' } }, { op: 'apply_text_preset', args: { clipId: mapId, presetId: 'clean' } }] as OpCall[]) {
      const e = refused(doc, c);
      expect(e.code).toBe('drawn_not_text');
      const he = translateRefusal('he', e.message)!;
      expect(he, c.op).toContain('מפת טיול');
      expect(he, c.op).not.toContain('ציור');
      expect(he, c.op).toContain('«עריכת המפה»');
    }
  });
});

