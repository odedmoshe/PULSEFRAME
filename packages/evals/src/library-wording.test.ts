/**
 * Keeps the Hebrew wording of the library refusals (packages/i18n/src/library.ts HE_LIBRARY) in step with the fixed English
 * sentences of core libraryOps.ts LIBRARY_REFUSALS and apps/server/src/library/contract.ts LIBRARY_SERVER_REFUSALS: every sentence,
 * with every reason it can carry, is worded in Hebrew, says what to do next, and every pattern of the table is used.
 * notBuilt is provoked for real through both operations; the other operation refusals come from the table until worker B's
 * bodies exist — B then provokes each through its operation here (it.todo below).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, LIBRARY_OPS_BUILT, LIBRARY_REFUSALS, LIBRARY_UNUSABLE, OpError, type LibraryRefusalKey } from '@pulseframe/core';
import { LIBRARY_SERVER_REFUSALS, ROOT_REASONS, type LibraryServerRefusalKey } from '../../../apps/server/src/library/contract.ts';
import { dictionaries, LIBRARY_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };

/** Every operation sentence: notBuilt for real (while the bodies are not built), the rest from the table with sample values. */
function opSentences(): Record<LibraryRefusalKey, string[]> {
  const doc = createProject({ id: 'prj_lw', name: 'LW', width: 640, height: 360 });
  const asset = { kind: 'audio' as const, name: 'a.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(1, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
  const notBuilt = LIBRARY_OPS_BUILT
    ? ['use_library_item', 'add_credits_card'].map((op) => LIBRARY_REFUSALS.notBuilt.message(op))
    : [caught(() => applyTransaction(doc, [{ op: 'use_library_item', args: { asset } }], { idSeed: 'lw_', actor: 'test', allowInternal: true })),
      caught(() => applyTransaction(doc, [{ op: 'add_credits_card', args: {} }], { idSeed: 'lw2_', actor: 'test' }))];
  return {
    notBuilt,
    notLibraryAsset: [LIBRARY_REFUSALS.notLibraryAsset.message()],
    licenceUnknown: [LIBRARY_REFUSALS.licenceUnknown.message()],
    licenceNoDerivatives: [LIBRARY_REFUSALS.licenceNoDerivatives.message()],
    licenceShareAlike: [LIBRARY_REFUSALS.licenceShareAlike.message()],
    creditMissing: [LIBRARY_REFUSALS.creditMissing.message()],
    recordWeaker: ['non-commercial', 'disk-only', 'credit'].map((w) => LIBRARY_REFUSALS.recordWeaker.message(w)),
    noCredits: [LIBRARY_REFUSALS.noCredits.message()],
    creditsTooLong: [LIBRARY_REFUSALS.creditsTooLong.message(2417)],
  };
}
function serverSentences(): Record<LibraryServerRefusalKey, string[]> {
  const S = LIBRARY_SERVER_REFUSALS;
  return {
    notBuilt: [S.notBuilt.message()], notConfigured: [S.notConfigured.message()], rootInvalid: ROOT_REASONS.map((w) => S.rootInvalid.message(w)),
    itemMissing: [S.itemMissing.message()], itemUnusable: LIBRARY_UNUSABLE.map((u) => S.itemUnusable.message(u)), hashMismatch: [S.hashMismatch.message()],
    changedSinceIndex: [S.changedSinceIndex.message()], pathEscape: [S.pathEscape.message()], audioUnsupported: [S.audioUnsupported.message()],
    svgUnsafe: [S.svgUnsafe.message('it holds a <script> element')], archiveNeedsChoice: [S.archiveNeedsChoice.message(3)], ownerOnly: [S.ownerOnly.message()],
  };
}

describe('library refusals in Hebrew', () => {
  const all = [...Object.values(opSentences()).flat(), ...Object.values(serverSentences()).flat()];
  it('every sentence is worded, in Hebrew, with a next step, and no reason falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      // the next step: a second clause after a full stop, a dash or a colon
      expect({ en, nextStep: /[.:—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of the table is used by some sentence', () => {
    const unused = LIBRARY_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en)));
    expect(unused.map(String)).toEqual([]);
  });
  it('the shared strings exist in both languages, the operations have names', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = ['op.use_library_item', 'op.add_credits_card', ...LIBRARY_UNUSABLE.map((u) => `library.unusable.${u}`), ...Object.values(LIBRARY_SERVER_REFUSALS).map((r) => `error.code.${r.code}`)].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });
  it.runIf(LIBRARY_OPS_BUILT)('each operation refusal provoked for real through use_library_item and add_credits_card is a table sentence, worded in Hebrew', () => {
    const rec = { itemId: 's/a.wav', sourceId: 's', kind: 'music' as const, title: 'A', sourceSha256: 'a'.repeat(64), ledger: { item: 's/a' }, licence: { id: 'CC0-1.0' }, flags: {} };
    const base = { kind: 'audio' as const, name: 'a.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(2, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
    const use = (lib: Record<string, unknown> | null) => ({ op: 'use_library_item', args: { asset: { ...base, provenance: { ...base.provenance, ...(lib ? { library: { ...rec, ...lib } } : {}) } } } });
    const empty = createProject({ id: 'prj_lw3', name: 'LW', width: 640, height: 360 });
    const got: Partial<Record<LibraryRefusalKey, string>> = {
      notLibraryAsset: caught(() => applyTransaction(empty, [use(null)], { idSeed: 'a_', actor: 't', allowInternal: true })),
      licenceUnknown: caught(() => applyTransaction(empty, [use({ licence: { id: 'custom:nobody' } })], { idSeed: 'b_', actor: 't', allowInternal: true })),
      licenceNoDerivatives: caught(() => applyTransaction(empty, [use({ licence: { id: 'CC-BY-ND-4.0' } })], { idSeed: 'c_', actor: 't', allowInternal: true })),
      licenceShareAlike: caught(() => applyTransaction(empty, [use({ licence: { id: 'CC-BY-SA-4.0' } })], { idSeed: 'd_', actor: 't', allowInternal: true })),
      creditMissing: caught(() => applyTransaction(empty, [use({ licence: { id: 'CC-BY-4.0' } })], { idSeed: 'e_', actor: 't', allowInternal: true })),
      recordWeaker: caught(() => applyTransaction(empty, [use({ licence: { id: 'CC-BY-NC-4.0' }, credit: { text: 'x', placement: 'either' } })], { idSeed: 'f_', actor: 't', allowInternal: true })),
      noCredits: caught(() => applyTransaction(empty, [{ op: 'add_credits_card', args: {} }], { idSeed: 'g_', actor: 't' })),
    };
    // too long: one CC BY file placed, with a credit of 500 characters, five times over (different files)
    let doc = empty;
    for (let i = 0; i < 5; i++) {
      const h = String(i).repeat(64);
      const r = applyTransaction(doc, [{ ...use({ itemId: `s/${i}`, licence: { id: 'CC-BY-4.0' }, credit: { text: `${i}`.repeat(500), placement: 'description' } }), args: { asset: { ...base, contentHash: `sha256:${h}`, provenance: { ...base.provenance, library: { ...rec, itemId: `s/${i}`, licence: { id: 'CC-BY-4.0' }, credit: { text: `${i}`.repeat(500), placement: 'description' } } } } } }], { idSeed: `h${i}_`, actor: 't', allowInternal: true });
      const assetId = (r.results[0]!.output as { assetId: string }).assetId;
      doc = applyTransaction(r.doc, [{ op: 'add_clip', args: { assetId, start: T.rt(i, 1), duration: T.rt(1, 1) } }], { idSeed: `p${i}_`, actor: 't' }).doc;
    }
    got.creditsTooLong = caught(() => applyTransaction(doc, [{ op: 'add_credits_card', args: {} }], { idSeed: 'k_', actor: 't' }));
    const table = opSentences();
    for (const [key, en] of Object.entries(got) as [LibraryRefusalKey, string][]) {
      expect({ key, inTable: key === 'creditsTooLong' ? /^the credits are \d+ characters long; one card holds at most 2000$/.test(en) : table[key].includes(en) }).toEqual({ key, inTable: true });
      const he = translateRefusal('he', en);
      expect({ key, hebrew: !!he && /[֐-׿]/.test(he) && !/לא עבר בדיקה/.test(he) }).toEqual({ key, hebrew: true });
    }
    expect(Object.keys(got).sort()).toEqual(Object.keys(LIBRARY_REFUSALS).filter((k) => k !== 'notBuilt').sort());
  });
  it.todo('A: each server refusal provoked for real through its route (library/routes.ts)');
});
