/**
 * The «גרסה לקהל» group of the format prism's «+» menu (wave 8 audiences track). W3 builds it. FormatPrism.tsx appends these items to
 * its menu while AUDIENCE_UI_BUILT; choosing one commits ONE add_audience_version (name in the interface language,
 * AUDIENCE_DEFAULT_NAMES) and then views the new version (editor.setViewVariant), as the format items do.
 * W3 ALSO OWNS the fix the verifier names (C14): FormatPrism renders the «+» menu only while some format profile is still addable
 * (`addable.length > 0`), so once all four formats exist the audience group disappears. The menu must render regardless.
 */
import type { MenuItem } from '../../ds/index.ts';
import type { Lang } from '@pulseframe/i18n';

/** The menu items (ids `audience:calm`, `audience:grandparents`, testIds AUDIENCE_TESTIDS.menuCalm / menuGrandparents). Empty until built. */
export function audienceMenuItems(lang: Lang): MenuItem[] {
  void lang;
  return [];
}
/** Whether a menu id is one of this group's (FormatPrism's onSelect routes it to W3's handler). */
export const isAudienceMenuId = (id: string): boolean => id.startsWith('audience:');
