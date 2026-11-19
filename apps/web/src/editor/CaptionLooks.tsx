/**
 * The caption looks as tiles (UX_REDESIGN §4.4): every look drawn on the real text of the project's captions (the first cue it
 * has, or a sample line) over the dimmed frame on screen. Picking one is the registered `apply_caption_look` op on the caption
 * track. It replaces the caption-look select: the group carries `data-testid="caption-look"` and each tile its `data-value` (§8).
 */
import { useMemo } from 'react';
import { CAPTION_LOOKS } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { StyleTiles, type StyleItem } from './styleTiles.tsx';
import { SPREAD_STRINGS } from './gallery.strings.ts';
import { addPicture, step, f } from './EffectGallery.tsx';

export function CaptionLooks({ trackId, currentLookId, sampleText }: { trackId: string; currentLookId: string | null; sampleText?: string }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const SP = SPREAD_STRINGS[lang];
  const words = (sampleText ?? '').trim().slice(0, 40) || (lang === 'he' ? 'ככה זה נראה' : 'This is how it looks');
  const items = useMemo<StyleItem[]>(() => CAPTION_LOOKS.map((l) => ({
    id: l.id, name: l.name[lang], hint: l.hint[lang],
    build: (scene) => {
      const a = step(scene.base, [addPicture(scene, scene.a, 0, 150), { op: 'add_caption_track', args: { mode: 'manual' } }]);
      const tid = a.out[1]!.trackId as string;
      const b = step(a.doc, [{ op: 'add_cue', args: { trackId: tid, start: f(0), duration: f(150), text: words } }]);
      // a tile is small, so its words are drawn larger than on the video: the same look, with a bigger size
      return { doc: step(b.doc, [{ op: 'apply_caption_look', args: { trackId: tid, lookId: l.id } }, { op: 'set_caption_style', args: { trackId: tid, style: { sizeFrac: Math.min(0.12, ((l.style as { sizeFrac?: number }).sizeFrac ?? 0.045) * 2.2) } } }]).doc, frame: 20 };
    },
  })), [lang, words]);
  return (
    <div data-testid="caption-look-tiles">
      <p className="muted" style={{ margin: '0 0 var(--pf-sp-4)', fontSize: 'var(--pf-fs-xs)' }}>{CAPTION_LOOKS.length} · {SP.captionLooksHint}</p>
      <StyleTiles items={items} value={currentLookId} label={SP.captionLooks} testId="caption-look" cacheTag={`cap:${words}`} appliedLabel={SP.chosen}
        onPick={(id) => { void editor.commit([{ op: 'apply_caption_look', args: { trackId, lookId: id } }], 'Caption look'); }} />
    </div>
  );
}
