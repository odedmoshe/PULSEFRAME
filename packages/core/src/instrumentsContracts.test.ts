/**
 * The instruments track's contract in core (wave 7 «כלים מוקלטים»; .artifacts/wave7/instruments-decisions.md): the kit table and its
 * schema, the bank input (a function of the table only), the request field (absent = today's request), the optional provenance field
 * and its validation (the honest generator both ways), the record a kit source gives through the licence table (fail-closed;
 * share-alike / no-derivatives / unknown refuse), and the UNION of duties of a kit that mixes sources (credits, the non-commercial line,
 * the archive rule) through libraryOrigins. Synthetic records only: no real sample set is named as installed.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  archiveLibraryPlan, collectCredits, createProject, kitBankInput, kitCalibrated, kitForStyle, kitKey, kitLibraryRecord, libraryOrigins, libraryRecordIssues, licenceDuties,
  MUSIC_GENERATOR, MUSIC_KITS, MUSIC_RECORDED_GENERATOR, MusicKitSchema, MusicRequestSchema, ProjectSchema, validateProject, applyTransaction,
  type Asset, type LibraryRecord, type MusicKit, type ProjectDocument,
} from './index.ts';

const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const record = (over: Partial<LibraryRecord> = {}): LibraryRecord => ({ itemId: 'syn-a/strings.sfz', sourceId: 'syn-a', kind: 'music', title: 'Synthetic strings', sourceSha256: 'a'.repeat(64), ledger: { item: 'syn-a/repo' }, licence: { id: 'CC0-1.0' }, flags: {}, ...over });
const BY = record({ itemId: 'syn-b/piano.sfz', sourceId: 'syn-b', title: 'Synthetic piano', licence: { id: 'CC-BY-4.0' }, credit: { text: 'Synthetic piano by Nobody, CC BY 4.0', placement: 'description' } });
const NC = record({ itemId: 'syn-c/harp.sfz', sourceId: 'syn-c', title: 'Synthetic harp', licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'Synthetic harp by Nobody, CC BY-NC 4.0', placement: 'description' }, flags: { nonCommercial: true, diskOnly: true } });
const recorded = (records: LibraryRecord[], over: Partial<Asset['provenance']> = {}): Asset => ({
  id: 'ast_r', kind: 'audio', name: 'Calm and warm · 8 bars · recorded instruments.wav', contentHash: hash(9), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(24, 1),
  audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' },
  provenance: { origin: 'generated', importedAt: '2026-11-25T00:00:00Z', importedBy: 'user:local', procedural: { id: 'music.calm', version: 1, generator: MUSIC_RECORDED_GENERATOR, params: { bars: 8, seed: 1, bpm: 80, meter: 4, synth: 1 } }, instruments: { kitId: 'kit.calm.test', kitVersion: 1, sampler: 1, bank: '0123456789abcdef', records }, ...over },
});
const docWith = (a: Asset, clip = true): ProjectDocument => {
  let doc = createProject({ id: 'prj_ins', name: 'I' });
  doc.assets[a.id] = a;
  if (clip) doc = applyTransaction(doc, [{ op: 'add_clip', args: { assetId: a.id, start: T.ZERO, withLinkedAudio: false } }], { idSeed: 'ins_', actor: 'test' }).doc;
  return doc;
};
const issues = (doc: ProjectDocument) => validateProject(doc).filter((i) => i.code === 'instruments_provenance' || i.code === 'library_provenance');

describe('the kit table (decisions §4.1)', () => {
  it('every kit parses, names instruments it has, and maps only pitched roles; v1 has one kit, calm, unheard', () => {
    for (const k of MUSIC_KITS) {
      expect(MusicKitSchema.safeParse(k).success).toBe(true);
      for (const p of Object.values(k.parts)) expect(k.instruments.some((i) => i.id === p!.instrument)).toBe(true);
      expect(k.review).toBe('unheard');
    }
    expect(MUSIC_KITS.map(kitKey)).toEqual(['kit.calm.vsco@1']);
    expect(kitForStyle('music.calm')?.id).toBe('kit.calm.vsco');
    expect(kitForStyle('music.pop')).toBeUndefined();
    expect(Object.keys(MUSIC_KITS[0]!.parts).sort()).toEqual(['arp', 'double', 'lead', 'pad']);
    for (const p of Object.values(MUSIC_KITS[0]!.parts)) expect(p!.gainDb).toBe(-18);
  });
  it('a kit is calibrated only when every used instrument names its entry and lists its files (never offered otherwise)', () => {
    // both instruments of the real kit were read on the owner's computer on 2026-11-26
    expect(MUSIC_KITS[0]!.instruments.map((i) => [i.id, i.entry, i.files.length])).toEqual([['strings', 'ViolaEnsSusVib.sfz', 27], ['piano', 'UprightPiano.sfz', 70]]);
    expect(kitCalibrated(MUSIC_KITS[0]!)).toBe(true);
    const unread: MusicKit = structuredClone(MUSIC_KITS[0]!) as MusicKit;
    unread.instruments[0]!.entry = null; unread.instruments[0]!.files = [];
    expect(kitCalibrated(unread)).toBe(false);
    const k: MusicKit = structuredClone(MUSIC_KITS[0]!) as MusicKit;
    for (const i of k.instruments) { i.entry = `${i.id}.sfz`; i.files = [{ path: `${i.id}.sfz`, bytes: 10, sha256: 'b'.repeat(64) }, { path: `${i.id}/c4.wav`, bytes: 100, sha256: 'c'.repeat(64) }]; }
    expect(kitCalibrated(k)).toBe(true);
    k.instruments[1]!.files = k.instruments[1]!.files.slice(1);
    expect(kitCalibrated(k)).toBe(false); // the .sfz itself must be a listed file
  });
  it('a path in a kit is inside its item: no .., no backslash, no absolute path', () => {
    const k = structuredClone(MUSIC_KITS[0]!) as MusicKit;
    for (const bad of ['../x.wav', 'a\\b.wav', '/abs.wav', 'C:/x.wav', 'a//b.wav', './a.wav']) {
      k.instruments[0]!.files = [{ path: bad, bytes: 1, sha256: 'b'.repeat(64) }];
      expect(MusicKitSchema.safeParse(k).success, bad).toBe(false);
    }
  });
  it('the bank input is a function of the table only: equal tables, equal text; any file or part change changes it', () => {
    const k = structuredClone(MUSIC_KITS[0]!) as MusicKit;
    k.instruments[0]!.files = [{ path: 'b.wav', bytes: 2, sha256: 'd'.repeat(64) }, { path: 'a.wav', bytes: 1, sha256: 'e'.repeat(64) }];
    const k2 = structuredClone(k); k2.instruments[0]!.files.reverse();
    expect(kitBankInput(k)).toBe(kitBankInput(k2)); // sorted, so the order of the table does not matter
    const k3 = structuredClone(k); k3.instruments[0]!.files[0]!.sha256 = 'f'.repeat(64);
    expect(kitBankInput(k3)).not.toBe(kitBankInput(k));
    const k4 = structuredClone(k); k4.parts.pad!.gainDb = -12;
    expect(kitBankInput(k4)).not.toBe(kitBankInput(k));
    expect(kitBankInput(k, 2)).not.toBe(kitBankInput(k));
  });
  it('edge (0..12, whole, optional): a kit without it has the bank text it had before the field; 0 is the same; edge > 0 changes it', () => {
    // pinned from kitBankInput as it was before `edge` existed (the same kit, the same text, the same sha256)
    const pinned: MusicKit = {
      id: 'kit.calm.pinned', version: 1, styleId: 'music.calm', review: 'unheard',
      instruments: [
        { id: 'strings', title: { he: 'מיתרים', en: 'Strings' }, ledgerItem: 'test/strings', ledgerPin: 'c1', entry: 's.sfz', files: [{ path: 's.sfz', bytes: 10, sha256: 'a'.repeat(64) }, { path: 's/c4.wav', bytes: 100, sha256: 'b'.repeat(64) }], cc: { '1': 20 } },
        { id: 'piano', title: { he: 'פסנתר', en: 'Piano' }, ledgerItem: 'test/piano', ledgerPin: 'c2', entry: 'p.sfz', files: [{ path: 'p.sfz', bytes: 11, sha256: 'c'.repeat(64) }] },
      ],
      parts: {
        pad: { instrument: 'strings', gainDb: -18, vel: [40, 100] },
        double: { instrument: 'strings', gainDb: -18, vel: [40, 100], releaseMax: 1 },
        lead: { instrument: 'piano', gainDb: -12, vel: [50, 120], attackMax: 0.1 },
      },
    };
    const sha = (t: string) => createHash('sha256').update(t).digest('hex');
    expect(MusicKitSchema.safeParse(pinned).success).toBe(true);
    expect(kitBankInput(pinned)).toBe('["pulseframe-kit-bank",1,"kit.calm.pinned",1,1,[["pad","strings",-18,40,100,null,null],["lead","piano",-12,50,120,0.1,null],["double","strings",-18,40,100,null,1]],[["strings","test/strings","c1","s.sfz",[["1",20]]],["piano","test/piano","c2","p.sfz",[]]],[["test/piano","c2","p.sfz",11,"' + 'c'.repeat(64) + '"],["test/strings","c1","s.sfz",10,"' + 'a'.repeat(64) + '"],["test/strings","c1","s/c4.wav",100,"' + 'b'.repeat(64) + '"]]]');
    expect(sha(kitBankInput(pinned))).toBe('4222cfaf021925a621f1d20022cdee20d9471c252261e9b531b100a25930474f');
    const zero = structuredClone(pinned); zero.parts.pad!.edge = 0;
    expect(MusicKitSchema.safeParse(zero).success).toBe(true);
    expect(kitBankInput(zero)).toBe(kitBankInput(pinned));
    const two = structuredClone(pinned); two.parts.pad!.edge = 2;
    expect(MusicKitSchema.safeParse(two).success).toBe(true);
    expect(kitBankInput(two)).not.toBe(kitBankInput(pinned));
    expect(JSON.parse(kitBankInput(two))[5][0]).toEqual(['pad', 'strings', -18, 40, 100, null, null, 2]);
    const one = structuredClone(pinned); one.parts.pad!.edge = 1;
    expect(kitBankInput(one)).not.toBe(kitBankInput(two));
    // bounds: whole semitones 0..12 on a part, and the part stays strict
    for (const bad of [-1, 13, 1.5]) { const k = structuredClone(pinned); k.parts.pad!.edge = bad; expect(MusicKitSchema.safeParse(k).success, String(bad)).toBe(false); }
    const extra = structuredClone(pinned) as unknown as { parts: { pad: Record<string, unknown> } }; extra.parts.pad.edges = 2;
    expect(MusicKitSchema.safeParse(extra).success).toBe(false);
  });
  it('kit.calm.vsco: edge 2 on pad and double only, nothing else about those parts changed', () => {
    const p = MUSIC_KITS[0]!.parts;
    expect([p.pad, p.double]).toEqual([{ instrument: 'strings', gainDb: -18, vel: [40, 100], edge: 2 }, { instrument: 'strings', gainDb: -18, vel: [40, 100], edge: 2 }]);
    expect([p.arp?.edge, p.lead?.edge]).toEqual([undefined, undefined]);
  });
});

describe('the request (decisions §4.2)', () => {
  it('instruments is optional: an old request parses to the same object; only synth or recorded are accepted', () => {
    expect(MusicRequestSchema.parse({ styleId: 'music.calm', bars: 8 })).toEqual({ styleId: 'music.calm', bars: 8, seed: 1 });
    expect(MusicRequestSchema.parse({ styleId: 'music.calm', bars: 8, instruments: 'recorded' }).instruments).toBe('recorded');
    expect(MusicRequestSchema.safeParse({ styleId: 'music.calm', bars: 8, instruments: 'sampled' }).success).toBe(false);
  });
});

describe('provenance.instruments and its validation (decisions §4.4)', () => {
  it('a recorded track with passing records is valid and parses', () => {
    const doc = docWith(recorded([record(), BY, NC]));
    expect(ProjectSchema.safeParse(doc).success).toBe(true);
    expect(issues(doc)).toEqual([]);
  });
  it('the generator is honest both ways: recorded ⇔ instruments present', () => {
    const synthWithInstruments = recorded([record()]);
    synthWithInstruments.provenance.procedural!.generator = MUSIC_GENERATOR;
    expect(issues(docWith(synthWithInstruments, false)).map((i) => i.message)).toEqual(['asset ast_r: a track made with recorded samples cannot say it has no samples']);
    const claimWithout = recorded([record()]);
    delete claimWithout.provenance.instruments;
    expect(issues(docWith(claimWithout, false)).length).toBe(1);
  });
  it('only a generated built-in sound file, with no library, upload, fitted, derived or voice record beside it', () => {
    expect(issues(docWith(recorded([record()], { origin: 'upload' }), false)).some((i) => /generated file/.test(i.message))).toBe(true);
    const lib = recorded([record()], { library: record() });
    expect(issues(docWith(lib, false)).some((i) => /in instruments only/.test(i.message))).toBe(true);
    const other = recorded([record()]); other.provenance.procedural!.id = 'sfx.whoosh';
    expect(issues(docWith(other, false)).some((i) => /built-in music only/.test(i.message))).toBe(true);
  });
  it('every record passes the licence table: a share-alike, unknown or weaker record is an issue', () => {
    expect(issues(docWith(recorded([record({ licence: { id: 'CC-BY-SA-4.0' } })]), false)).length).toBeGreaterThan(0);
    expect(issues(docWith(recorded([record({ licence: { id: 'custom:salamander-piano' }, sourceId: 'salamander-piano' })]), false)).length).toBeGreaterThan(0);
    expect(issues(docWith(recorded([record({ licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'x', placement: 'description' } })]), false)).length).toBeGreaterThan(0); // not marked nc/disk-only
    expect(ProjectSchema.safeParse(docWith(recorded([]), false)).success).toBe(false); // at least one record
  });
});

describe('a kit source through the licence table (decisions §3)', () => {
  const entry = (licence: { spdx?: string; custom?: string }, flags: Record<string, boolean>, credit: string | null = null) => ({
    item: 'syn-a/repo', source: 'syn-a', sourceTitle: 'Synthetic set', credit, flags, commit: 'c'.repeat(40), licence: { ...licence, url: 'https://example.invalid/licence', readOn: '2026-11-25', quote: 'synthetic' },
  });
  const base = { diskOnly: false, creditInExport: false, shareAlike: false, people: false, aiGenerated: false, repoAllowed: true };
  const ins = { entry: 'Strings/sus.sfz', title: { he: 'מיתרים', en: 'Strings' } };
  it('CC0: a record that passes the table, shareable, no credit', () => {
    const e = entry({ spdx: 'CC0-1.0' }, base);
    const r = kitLibraryRecord(e, licenceDuties(e.source, e.licence, e.flags), ins, 'b'.repeat(64));
    expect('record' in r && libraryRecordIssues(r.record)).toEqual([]);
    expect('record' in r && r.record.flags).toEqual({});
  });
  it('CC BY-NC: carried as non-commercial and disk-only, with its credit', () => {
    const e = entry({ spdx: 'CC-BY-NC-4.0' }, base, 'Harp by Nobody');
    const r = kitLibraryRecord(e, licenceDuties(e.source, e.licence, e.flags), ins, 'b'.repeat(64));
    expect('record' in r && r.record.flags).toEqual({ nonCommercial: true, diskOnly: true });
    expect('record' in r && libraryRecordIssues(r.record)).toEqual([]);
  });
  it('share-alike, no-derivatives, unknown custom, and a credit that is due but missing: the kit is refused', () => {
    for (const [e, why] of [
      [entry({ spdx: 'CC-BY-SA-3.0' }, base), 'licence_share_alike'], [entry({ spdx: 'CC-BY-ND-4.0' }, base), 'licence_no_derivatives'],
      [entry({ custom: 'Public domain by the author\'s 2022 statement' }, base), 'licence_unknown'], [entry({ spdx: 'CC-BY-4.0' }, base), 'credit_missing'],
      [entry({ spdx: 'CC0-1.0' }, { ...base, shareAlike: true }), 'licence_share_alike'],
    ] as const) expect(kitLibraryRecord(e, licenceDuties(e.source, e.licence, e.flags), ins, 'b'.repeat(64))).toEqual({ problem: why });
  });
});

describe('the union of duties of a kit that mixes sources (decisions §3)', () => {
  it('libraryOrigins visits every record; credits list each due line; the non-commercial line names the track', () => {
    const doc = docWith(recorded([record(), BY, NC]));
    expect(libraryOrigins(doc, 'ast_r').map((o) => o.record.sourceId)).toEqual(['syn-a', 'syn-b', 'syn-c']);
    const c = collectCredits(doc);
    expect(c.lines.map((l) => l.text)).toEqual([BY.credit!.text, NC.credit!.text]);
    expect(c.nonCommercial.map((n) => n.assetId)).toEqual(['ast_r']);
    expect(c.descriptionText('he')).toContain('לשימוש לא מסחרי בלבד');
  });
  it('the shared archive leaves out a track with one restricted source, and keeps one whose sources all may travel', () => {
    expect(archiveLibraryPlan(docWith(recorded([record(), BY, NC]))).omit).toEqual([hash(9)]);
    expect(archiveLibraryPlan(docWith(recorded([record(), BY]))).omit).toEqual([]);
  });
});
