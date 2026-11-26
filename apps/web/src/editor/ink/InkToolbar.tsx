/**
 * The toolbar of the drawing mode (wave 8 ink): brushes «טוש» «מדגש» «ניאון» (1–3), «צבע», «עובי» דק / בינוני / עבה ([ and ];
 * core INK_WIDTHS), «בטלו קו», «סיום», «ביטול»; role toolbar, follows the reading direction (the stage and the strokes are never
 * mirrored). Lead pre-pass: empty stub; W3 builds it.
 */
import type { InkBrush } from '@pulseframe/core';

export interface InkToolbarProps { brush: InkBrush; color: string; widthStep: 0 | 1 | 2; strokes: number; lang: 'he' | 'en' }
export function InkToolbar(props: InkToolbarProps) {
  void props;
  return null;
}
