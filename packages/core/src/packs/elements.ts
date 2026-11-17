/**
 * The original elements of the content packs (ADR-0022), in the order they are listed after the library's own elements
 * (elements.ts adds them to its table as `element.<category>.<slug>`).
 *
 * CONTRACT FILE (lead pre-pass): the export and its type are fixed; W1 fills the two lists it gathers. The rules of a row are
 * on PackElementEntry (elementKit.ts). Run-time imports: elementKit.ts and other pack data files only.
 */
import type { PackElementEntry } from '../elementKit.ts';
import { HANUKKAH_ELEMENTS } from './elements.hanukkah.ts';
import { BIRTHDAY_ELEMENTS } from './elements.birthday.ts';

export const PACK_ELEMENTS: readonly PackElementEntry[] = [...HANUKKAH_ELEMENTS, ...BIRTHDAY_ELEMENTS];
