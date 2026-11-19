/**
 * The content packs of this build (ADR-0022), in the order they are listed. One row per pack: its data file exports the
 * PackDef (packs/contract.ts), or null while it is not built. Run-time imports here are pack data files only (see the import
 * rule in contract.ts): the registries (templateCatalog.ts, textPresets.ts, captionPresets.ts) import this file.
 */
import type { PackDef } from './contract.ts';
import { HANUKKAH_PACK } from './hanukkah.ts';
import { BIRTHDAY_PACK } from './birthday.ts';

const ROWS: readonly (PackDef | null)[] = [HANUKKAH_PACK, BIRTHDAY_PACK];
/** The packs that are built. A row that is still null is simply not there: nothing lists, suggests or applies it. */
export const PACKS: readonly PackDef[] = ROWS.filter((p): p is PackDef => p !== null);
export const findPack = (id: string): PackDef | undefined => PACKS.find((p) => p.id === id);
