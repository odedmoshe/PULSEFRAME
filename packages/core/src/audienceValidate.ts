/**
 * Semantic checks of the audiences track's two optional fields (wave 8; audienceContract.ts). Lead-built, complete. Called by
 * validate.ts validateProject.
 *
 * audience_with_translation: a version for an audience is not also a language version (verifier C14): no `translation`, no `language`.
 * audience_keep_outside_version: VariantOverride.keep only in the overrides of a version that has `audience`.
 * audience_keep_not_keepable: every kept rule is keepable for the version's profile (KEEPABLE).
 * audience_keep_duplicate: no rule twice in one keep list.
 * Not checked: that an override's clip or a role's track still exists (overrides outlive their clips, as every format's do; readers
 * skip unknown ids).
 */
import type { ProjectDocument } from './schema.ts';
import type { Issue } from './validate.ts';
import { AUDIENCE_VALIDATION as V, KEEPABLE } from './audienceContract.ts';

export function audienceIssues(doc: ProjectDocument): Issue[] {
  const out: Issue[] = [];
  for (const v of Object.values(doc.variants ?? {})) {
    const a = v.audience;
    if (a && (v.translation || v.language !== undefined)) out.push({ code: V.withTranslation, message: `variant ${v.id}: a version for an audience is not a language version`, ids: [v.id] });
    for (const [clipId, ov] of Object.entries(v.overrides)) {
      if (!ov.keep) continue;
      if (!a) { out.push({ code: V.keepOutsideAudience, message: `variant ${v.id}: kept rules belong to versions for an audience (clip ${clipId})`, ids: [v.id, clipId] }); continue; }
      if (new Set(ov.keep).size !== ov.keep.length) out.push({ code: V.keepDuplicate, message: `variant ${v.id}: clip ${clipId} keeps a rule twice`, ids: [v.id, clipId] });
      for (const r of ov.keep) if (!KEEPABLE[a.profile].includes(r)) out.push({ code: V.keepNotKeepable, message: `variant ${v.id}: rule ${r} cannot be kept in a ${a.profile} version (clip ${clipId})`, ids: [v.id, clipId] });
    }
  }
  return out;
}
