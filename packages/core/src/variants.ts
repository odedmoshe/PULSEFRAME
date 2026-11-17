/**
 * Linked formats (SPEC §19.8): one master edit, several output shapes. A variant stores only its frame size, how pictures
 * fill the frame, safe-area guides and per-clip overrides. The variant document is PROJECTED from the master at render time,
 * so every master edit reaches every variant and overrides (keyed by clip id) survive those edits.
 */
import { ANIMATABLE, type ProjectDocument, type SafeArea } from './schema.ts';
import { own } from './own.ts';

/**
 * Starting points for common shapes. The safe-area insets are GENERIC guides for where app interfaces usually cover the picture;
 * they are not any platform's official numbers, which change. They are editable per variant.
 */
export const FORMAT_PROFILES = [
  { id: 'vertical-9x16', name: { he: 'אנכי 9:16', en: 'Vertical 9:16' }, width: 1080, height: 1920, fit: 'cover', safeArea: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.12 } },
  { id: 'portrait-4x5', name: { he: 'פורטרט 4:5', en: 'Portrait 4:5' }, width: 1080, height: 1350, fit: 'cover', safeArea: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 } },
  { id: 'square-1x1', name: { he: 'ריבוע 1:1', en: 'Square 1:1' }, width: 1080, height: 1080, fit: 'cover', safeArea: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 } },
  { id: 'landscape-16x9', name: { he: 'רוחבי 16:9', en: 'Landscape 16:9' }, width: 1920, height: 1080, fit: 'contain', safeArea: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 } },
] as const satisfies readonly { id: string; name: { he: string; en: string }; width: number; height: number; fit: 'contain' | 'cover'; safeArea: SafeArea }[];
export const findProfile = (id: string) => FORMAT_PROFILES.find((p) => p.id === id);

/** The document a variant renders: the master with the variant's frame, fill mode and overrides applied. Pure; the master is not changed. */
export function projectVariant(doc: ProjectDocument, variantId: string): ProjectDocument {
  const v = own(doc.variants, variantId);
  if (!v) throw new Error(`variant ${variantId} not found`);
  const out = structuredClone(doc);
  out.settings.width = v.width;
  out.settings.height = v.height;
  out.settings.fit = v.fit;
  for (const seq of Object.values(out.sequences))
    for (const track of seq.tracks) {
      if (track.caption && v.captionStyle) track.caption.style = { ...track.caption.style, ...v.captionStyle };
      track.clips = track.clips.filter((c) => !v.overrides[c.id]?.hidden);
      for (const c of track.clips) {
        const ov = v.overrides[c.id];
        if (ov && c.type === 'text') { if (ov.text !== undefined) c.text = ov.text; if (ov.textStyle) c.style = { ...c.style, ...ov.textStyle }; }
        if (ov && c.type === 'caption' && ov.text !== undefined) { c.text = ov.text; delete c.words; } // per-word timing described the master wording
        const o = ov?.transform;
        if (!o) continue;
        c.transform = { ...c.transform, ...o };
        // An overridden property is fixed for this variant: the master's animation of that property does not apply here.
        if (c.keyframes) { for (const p of ANIMATABLE) if (o[p] !== undefined) delete c.keyframes[p]; if (Object.keys(c.keyframes).length === 0) delete c.keyframes; }
      }
    }
  if (v.phraseText)
    for (const tr of Object.values(out.transcripts ?? {}))
      for (const seg of tr.segments) {
        const text = own(v.phraseText, seg.id); // a phrase may be called "constructor": only the format's own wording counts
        if (text === undefined) continue;
        seg.text = text; seg.words = []; seg.timing = 'segment'; // the word timing described the master wording
      }
  return out;
}
