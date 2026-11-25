/**
 * Licence duties of library items (wave 7 library track; library-decisions.md §2.7). WORKER B builds the bodies; the lead's
 * pre-pass fixes the signatures and the TABLES, which are the contract (licence qualification: the lead reviews any change).
 *
 * FAIL-CLOSED RULES
 * - An SPDX id is admitted only when it is a key of SPDX_LICENCES, matched exactly. A compound expression ("MIT AND BSD-3-Clause")
 *   is unknown unless listed whole. Anything else, or no licence, is `licence_unknown`.
 * - A `custom` licence is admitted only through CUSTOM_LICENCES[sourceId] whose `custom` string equals the ledger's exactly; the
 *   row's values are the decided ones in that table. A ledger flag can never admit or loosen anything.
 * - Ledger flags can only make a row stricter: diskOnly or repoAllowed === false → not shareable; personalOnly → non-commercial and
 *   not shareable; shareAlike → licence_share_alike; creditInExport → credit placement on_screen.
 * - An SPDX id containing "-NC" is non-commercial (and therefore not shareable); "-SA" is share-alike; "-ND" no-derivatives.
 * - A row whose duties say credit and whose credit text is empty after its reader ran is `credit_missing`.
 */
import type { LibraryRecord } from './schema.ts';
import type { LibraryUnusable } from './libraryContract.ts';

export interface LicenceRow { use: 'ok'; credit: boolean; nonCommercial: boolean; shareable: boolean }
/** Exact SPDX ids the editor admits, and what each means for a video (non-commercial and share-alike ids are deliberately absent: see refusedSpdx). */
export const SPDX_LICENCES: Readonly<Record<string, LicenceRow>> = {
  'CC0-1.0': { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  'PDM-1.0': { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  MIT: { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  ISC: { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  'Apache-2.0': { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  'BSD-2-Clause': { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  'BSD-3-Clause': { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  'OFL-1.1': { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  'Unicode-3.0': { use: 'ok', credit: false, nonCommercial: false, shareable: true },
  'CC-BY-3.0': { use: 'ok', credit: true, nonCommercial: false, shareable: true },
  'CC-BY-4.0': { use: 'ok', credit: true, nonCommercial: false, shareable: true },
  'CC-BY-NC-3.0': { use: 'ok', credit: true, nonCommercial: true, shareable: false },
  'CC-BY-NC-4.0': { use: 'ok', credit: true, nonCommercial: true, shareable: false },
};
/** Icon sets of @iconify/json admitted by their own collections.json licence (lead decision: GPL, OFL, -SA, -NC, -ND sets are not indexed). */
export const ICON_SET_LICENCES = ['MIT', 'ISC', 'Apache-2.0', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0'] as const;
/** Icon set prefixes never indexed whatever their metadata says (visual-01 manifest note: Remix Icon's upstream licence changed in 2026-01). */
export const ICON_SET_EXCLUDED = ['ri'] as const;

export interface CustomLicenceRow extends LicenceRow { /** The ledger's `licence.custom`, exactly. */ custom: string; /** Why it is admitted, quoting the source. */ quote: string; decidedOn: string }
/**
 * Custom licences admitted by source id. ONE row this wave (library-decisions.md §2.7): Musopen's FLAC collection, labelled Public
 * Domain Mark 1.0 on archive.org by its (third-party) uploader; kept disk-only because the provenance rests on the item text.
 * No row for Sonniss (licence not quoted at the source), BBC, FSD50K, FSL10K (per-clip licences, no reader), or sources whose
 * kinds are never listed (Salamander, Natural Earth).
 */
export const CUSTOM_LICENCES: Readonly<Record<string, CustomLicenceRow>> = {
  'musopen-flac': {
    custom: 'Public Domain Mark 1.0 as labelled on the archive.org item (rights statement by the uploader, not by Musopen)',
    quote: 'archive.org item metadata (https://archive.org/metadata/MusopenCollectionAsFlac): licenseurl "http://creativecommons.org/publicdomain/mark/1.0/"; "This project raised money to purchase and release music to the public domain." (tools/library/manifests/audio-01.json, read 2026-11-25)',
    decidedOn: '2026-11-25',
    use: 'ok', credit: false, nonCommercial: false, shareable: false,
  },
};

export interface LedgerLicenceInput { spdx?: string; custom?: string }
export interface LicenceDuties { use: 'ok' | Extract<LibraryUnusable, 'licence_unknown' | 'licence_share_alike' | 'licence_no_derivatives'>; licenceId: string; credit: boolean; nonCommercial: boolean; shareable: boolean; placement: 'description' | 'on_screen' }

/** The ledger flags the fetch tool writes (tools/library/fetch.mjs FLAGS: always present, OPT_FLAGS: only when the source sets them). */
export const LEDGER_FLAGS = ['diskOnly', 'creditInExport', 'shareAlike', 'people', 'aiGenerated', 'repoAllowed'] as const;
export const LEDGER_OPT_FLAGS = ['needsOwnerKey', 'trademark', 'personalOnly'] as const;
const KNOWN_FLAGS: ReadonlySet<string> = new Set<string>([...LEDGER_FLAGS, ...LEDGER_OPT_FLAGS]);

/**
 * Why an SPDX id outside SPDX_LICENCES is refused: no-derivatives and share-alike (copyleft) ids are named, everything else is
 * unknown. Only explains a refusal; nothing outside the table is ever admitted.
 */
export function refusedSpdx(id: string): 'licence_no_derivatives' | 'licence_share_alike' | 'licence_unknown' {
  if (/-ND(-|$)/.test(id)) return 'licence_no_derivatives';
  if (/-SA(-|$)/.test(id) || /GPL/.test(id)) return 'licence_share_alike';
  return 'licence_unknown';
}

const refused = (use: Exclude<LicenceDuties['use'], 'ok'>, licenceId: string): LicenceDuties =>
  ({ use, licenceId, credit: false, nonCommercial: false, shareable: false, placement: 'description' });
const own = <V>(table: Readonly<Record<string, V>>, key: string): V | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/**
 * The table row of a licence id as a library record stores it: an exact key of SPDX_LICENCES, or `custom:<sourceId>` with a row in
 * CUSTOM_LICENCES for that source. Undefined = not admitted.
 */
function tableRow(licenceId: string, sourceId: string): LicenceRow | undefined {
  if (licenceId.startsWith('custom:')) return licenceId === `custom:${sourceId}` ? own(CUSTOM_LICENCES, sourceId) : undefined;
  return own(SPDX_LICENCES, licenceId);
}
/** The table's own answer, made stricter by the id itself: an id with "-NC" is non-commercial, and non-commercial is never shareable. */
function tableDuties(row: LicenceRow, licenceId: string): { credit: boolean; nonCommercial: boolean; shareable: boolean } {
  const nonCommercial = row.nonCommercial || /-NC(-|$)/.test(licenceId);
  return { credit: row.credit, nonCommercial, shareable: row.shareable && !nonCommercial };
}

/**
 * What a row's licence demands. `licence` is the row's own (an icon set's SPDX, or the ledger entry's licence); `flags` the ledger
 * entry's. Fail-closed as described above; the stricter of the table and the flags wins. Pure; the same in Node and Chromium.
 * No duty is lifted by a flag being absent: shareable needs `diskOnly: false` AND `repoAllowed: true` written in the ledger; a
 * description-only credit needs `creditInExport: false`; `shareAlike` must be written false (absent → licence_unknown); a flag
 * this build does not know that is true → licence_unknown (it may be a restriction the table cannot honour).
 */
export function licenceDuties(sourceId: string, licence: LedgerLicenceInput, flags: Readonly<Record<string, boolean>>): LicenceDuties {
  const spdx = typeof licence.spdx === 'string' && licence.spdx.length > 0 ? licence.spdx : undefined;
  const custom = typeof licence.custom === 'string' && licence.custom.length > 0 ? licence.custom : undefined;
  let licenceId: string;
  let row: LicenceRow | undefined;
  if (spdx !== undefined && custom !== undefined) return refused('licence_unknown', spdx); // two licences for one row: which one holds is not ours to pick
  if (spdx !== undefined) {
    licenceId = spdx;
    row = own(SPDX_LICENCES, spdx);
    if (!row) return refused(refusedSpdx(spdx), spdx);
  } else if (custom !== undefined) {
    licenceId = `custom:${sourceId}`;
    const c = own(CUSTOM_LICENCES, sourceId);
    if (!c || c.custom !== custom) return refused('licence_unknown', licenceId);
    row = c;
  } else return refused('licence_unknown', '');
  const flag = (k: string): boolean | undefined => { const v = own(flags, k); return typeof v === 'boolean' ? v : undefined; };
  for (const k of Object.keys(flags)) if (!KNOWN_FLAGS.has(k) && flag(k) === true) return refused('licence_unknown', licenceId);
  if (flag('shareAlike') === true) return refused('licence_share_alike', licenceId);
  if (flag('shareAlike') !== false) return refused('licence_unknown', licenceId);
  const t = tableDuties(row, licenceId);
  const nonCommercial = t.nonCommercial || flag('personalOnly') === true;
  const shareable = t.shareable && !nonCommercial && flag('diskOnly') === false && flag('repoAllowed') === true;
  return { use: 'ok', licenceId, credit: t.credit, nonCommercial, shareable, placement: flag('creditInExport') === false ? 'description' : 'on_screen' };
}

/** What a record lacks against the table, first problem first (the order use_library_item refuses in). */
export type RecordProblem =
  | { key: 'licenceUnknown' | 'licenceNoDerivatives' | 'licenceShareAlike' | 'creditMissing' }
  | { key: 'recordWeaker'; what: 'non-commercial' | 'disk-only' };
export function libraryRecordProblems(record: LibraryRecord): RecordProblem[] {
  const id = record.licence.id;
  const row = tableRow(id, record.sourceId);
  if (!row) {
    const why = id.startsWith('custom:') ? 'licence_unknown' : refusedSpdx(id);
    return [{ key: why === 'licence_no_derivatives' ? 'licenceNoDerivatives' : why === 'licence_share_alike' ? 'licenceShareAlike' : 'licenceUnknown' }];
  }
  const t = tableDuties(row, id);
  const out: RecordProblem[] = [];
  if (t.credit && !record.credit?.text.trim()) out.push({ key: 'creditMissing' });
  if (t.nonCommercial && record.flags.nonCommercial !== true) out.push({ key: 'recordWeaker', what: 'non-commercial' });
  // not shareable by the table, or marked non-commercial (the ledger's personalOnly): the file must stay on this computer
  if ((!t.shareable || record.flags.nonCommercial === true) && record.flags.diskOnly !== true) out.push({ key: 'recordWeaker', what: 'disk-only' });
  return out;
}

/**
 * Problems of a stored LibraryRecord against the table (validate.ts code library_provenance): diskOnly must be set when the licence
 * is not shareable (or the record is non-commercial), nonCommercial when it is non-commercial, a credit when it needs one, and the
 * licence id must be one the table admits. Returns English sentences without the "asset <id>: " prefix.
 */
export function libraryRecordIssues(record: LibraryRecord): string[] {
  return libraryRecordProblems(record).map((p) => {
    switch (p.key) {
      case 'licenceUnknown': return `its library licence "${record.licence.id}" is not one the editor knows`;
      case 'licenceNoDerivatives': return `its library licence "${record.licence.id}" forbids changing the work`;
      case 'licenceShareAlike': return `its library licence "${record.licence.id}" would require sharing the whole video under the same licence`;
      case 'creditMissing': return 'its library licence requires a credit, and the record has none';
      case 'recordWeaker': return `the library record is weaker than its licence: it must be marked ${p.what}`;
    }
  });
}

/**
 * May this record's file travel in a shared archive? Only when the table knows its licence and says so, and the record carries
 * neither diskOnly nor nonCommercial. An unknown licence is never shareable.
 */
export function recordShareable(record: LibraryRecord): boolean {
  if (record.flags.diskOnly === true || record.flags.nonCommercial === true) return false;
  const row = tableRow(record.licence.id, record.sourceId);
  return !!row && tableDuties(row, record.licence.id).shareable;
}
