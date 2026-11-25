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

/**
 * What a row's licence demands. `licence` is the row's own (an icon set's SPDX, or the ledger entry's licence); `flags` the ledger
 * entry's. Fail-closed as described above; the stricter of the table and the flags wins. Pure; the same in Node and Chromium.
 */
export function licenceDuties(sourceId: string, licence: LedgerLicenceInput, flags: Readonly<Record<string, boolean>>): LicenceDuties {
  void sourceId; void licence; void flags;
  throw new Error('licenceDuties is not built yet (library worker B)');
}

/**
 * Problems of a stored LibraryRecord against the table (validate.ts code library_provenance): diskOnly must be set when the licence
 * is not shareable, nonCommercial when it is non-commercial, a credit when it needs one, and the licence id must be one the table
 * admits. Returns English sentences without the "asset <id>: " prefix. Worker B; until then it reports nothing, and no record exists
 * because use_library_item refuses (notBuilt).
 */
export function libraryRecordIssues(record: LibraryRecord): string[] {
  void record;
  return [];
}
