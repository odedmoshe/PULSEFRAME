/**
 * The Hanukkah pack (ADR-0022): the first pack of the build (Hanukkah 5787 begins on the evening of 4 December 2026).
 *
 * CONTRACT FILE (lead pre-pass): W1 replaces `null` by the PackDef `pack.hanukkah` (packs/contract.ts holds the type and
 * every rule; packs/check.ts packIssues and packs/contract.test.ts check them). Until then the pack does not exist: it is
 * not listed, suggested or applied anywhere.
 * Run-time imports: elementKit.ts and other pack data files only; everything else is `import type`.
 */
import type { PackDef } from './contract.ts';

export const HANUKKAH_PACK: PackDef | null = null;
