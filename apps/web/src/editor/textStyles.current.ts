/**
 * Which text style a title is in now. A title does not record the name of the style it was given (apply_text_preset copies the
 * fields), so the style is recognised from what is on the clip: every field the preset sets is equal, every look field the preset
 * does not list is empty, and the drop shadow is there exactly when the preset has one. A title edited by hand matches none (null);
 * the tiles then show no current style rather than a wrong one.
 */
import { TEXT_LOOK_FIELDS, type TextPreset } from '@pulseframe/core';

interface TitleLike { style: object; effects?: readonly { type: string }[] }
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function currentTextPresetId(clip: TitleLike, presets: readonly TextPreset[]): string | null {
  const style = clip.style as Record<string, unknown>;
  const hasShadow = (clip.effects ?? []).some((e) => e.type === 'stylize.shadow');
  for (const p of presets) {
    const own = p.style as Record<string, unknown>;
    if (hasShadow !== !!p.shadow) continue;
    if (!Object.keys(own).every((k) => same(style[k], own[k]))) continue;
    if (!(TEXT_LOOK_FIELDS as readonly string[]).every((k) => k in own || style[k] == null)) continue;
    return p.id;
  }
  return null;
}
