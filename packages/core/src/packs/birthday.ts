/**
 * The birthday pack (ADR-0022). The existing template tpl.birthday stays exactly as it is and joins the pack by id
 * (PackDef.templateIds); the pack adds new templates beside it.
 *
 * CONTRACT FILE (lead pre-pass): W1 replaces `null` by the PackDef `pack.birthday` (packs/contract.ts holds the type and
 * every rule; packs/check.ts packIssues and packs/contract.test.ts check them). Until then the pack does not exist: it is
 * not listed, suggested or applied anywhere.
 * Run-time imports: elementKit.ts and other pack data files only; everything else is `import type`.
 */
import type { PackDef } from './contract.ts';

export const BIRTHDAY_PACK: PackDef | null = null;
