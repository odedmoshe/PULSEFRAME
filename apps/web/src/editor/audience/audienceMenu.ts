/**
 * The «גרסה לקהל» group of the format prism's «+» menu (wave 8 audiences track). FormatPrism.tsx appends these items to its menu
 * while AUDIENCE_UI_BUILT; choosing one commits ONE add_audience_version (name in the interface language, AUDIENCE_DEFAULT_NAMES) and
 * then views the new version (editor.setViewVariant), as the format items do. FormatPrism renders the menu even when every format
 * profile exists (verifier C14).
 */
import type { MenuItem } from '../../ds/index.ts';
import type { Lang } from '@pulseframe/i18n';
import { AUDIENCE_DEFAULT_NAMES, type AudienceProfile } from '@pulseframe/core';
import { audienceT } from './audience.strings.ts';
import { AUDIENCE_TESTIDS } from './audience.testids.ts';

const PROFILES: readonly AudienceProfile[] = ['calm', 'grandparents'];
/** The menu items (ids `audience:calm`, `audience:grandparents`, testIds AUDIENCE_TESTIDS.menuCalm / menuGrandparents). */
export function audienceMenuItems(lang: Lang): MenuItem[] {
  const t = audienceT(lang);
  return PROFILES.map((p) => ({ id: `audience:${p}`, label: `${t('group')} · ${t(p)}`, testId: p === 'calm' ? AUDIENCE_TESTIDS.menuCalm : AUDIENCE_TESTIDS.menuGrandparents }));
}
/** Whether a menu id is one of this group's (FormatPrism's onSelect routes it to the handler). */
export const isAudienceMenuId = (id: string): boolean => id.startsWith('audience:');
/** The profile and the default name (interface language) of an audience menu id, or null. */
export function audienceMenuChoice(id: string, lang: Lang): { profile: AudienceProfile; name: string } | null {
  const p = id.slice('audience:'.length);
  return (PROFILES as readonly string[]).includes(p) ? { profile: p as AudienceProfile, name: AUDIENCE_DEFAULT_NAMES[p as AudienceProfile][lang] } : null;
}
