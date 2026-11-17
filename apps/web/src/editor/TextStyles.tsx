/**
 * The text styles as tiles (UX_REDESIGN §4.4): every style drawn with the selected title's own words (or a sample word) over the
 * dimmed frame on screen, by the shared compositor. Picking one is the registered `apply_text_preset` op on the selected title.
 * It replaces the text-style select: the group carries `data-testid="text-preset"` and each tile its `data-value` (§8).
 */
import { useMemo } from 'react';
import { TEXT_PRESETS } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { StyleTiles, type StyleItem } from './styleTiles.tsx';
import { SPREAD_STRINGS } from './gallery.strings.ts';
import { addPicture, step, f } from './EffectGallery.tsx';

const NEED_TITLE = { he: 'בחרו כותרת קודם', en: 'Select a title first' } as const;

export function TextStyles({ titleClipId }: { titleClipId?: string }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const SP = SPREAD_STRINGS[lang];
  const sel = titleClipId ? undefined : editor.selected;
  const clipId = titleClipId ?? (sel?.clip.type === 'text' ? sel.clip.id : undefined);
  const clip = clipId && state.doc ? (clipId === sel?.clip.id ? sel.clip : editor.doc && Object.values(editor.doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === clipId)) : undefined;
  const words = clip && clip.type === 'text' && clip.text.trim() ? clip.text.trim().slice(0, 24) : SP.sampleText;
  const items = useMemo<StyleItem[]>(() => TEXT_PRESETS.map((p) => ({
    id: p.id, name: p.name[lang],
    build: (scene) => {
      const a = step(scene.base, [addPicture(scene, scene.a, 0, 150), { op: 'add_text', args: { text: words, start: f(0), duration: f(150) } }]);
      const textId = a.out[1]!.clipId as string;
      // a tile is small, so its words are drawn larger than on the video: the same ops, with a scale on the title
      return { doc: step(a.doc, [{ op: 'apply_text_preset', args: { clipId: textId, presetId: p.id } }, { op: 'set_clip_transform', args: { clipId: textId, transform: { scale: 2.4 } } }]).doc, frame: 12 };
    },
  })), [lang, words]);
  return (
    <StyleTiles items={items} value={null} label={lang === 'he' ? 'סגנונות טקסט' : 'Text styles'} testId="text-preset" cacheTag={`text:${words}`} appliedLabel={SP.checkMark}
      disabledReason={clipId ? undefined : NEED_TITLE[lang]}
      onPick={(id) => { if (clipId) void editor.commit([{ op: 'apply_text_preset', args: { clipId, presetId: id } }], 'Text style'); }} />
  );
}
