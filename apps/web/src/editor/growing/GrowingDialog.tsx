/**
 * The «גדלים מול העיניים» dialog (wave 8 growing; W3 builds it after the pre-pass, shaped like story/StoryDialog.tsx): «בחרו תמונות»
 * · «סמנו עיניים» (marking on the source viewer's one-clip document, editor/sourceDocument.ts, in SHOWN coordinates) · «איך זה
 * ייראה», the live preview after the second picture through the real planGrowing + evaluate + compositor (C13), the C7 privacy
 * sentence, the ask before closing (C8), focus trap, Escape, focus back to the opener in the same commit. Mounted once in App.tsx.
 * The eye marks live in this component's memory only: no store field, no browser storage; they travel once in api.planGrowing /
 * api.applyGrowing / api.regenerateGrowing.
 * PRE-PASS STUB: renders nothing (the entry is not shown until GROWING_BUILT), and closes itself if opened before it is built.
 */
import { useEffect, type ReactElement } from 'react';
import { GROWING_BUILT } from '@pulseframe/core';
import { useEditorState } from '../store.ts';

/** True once W3 has built this dialog (W3 flips it). The start-hub card shows only when this and core GROWING_BUILT are both true. */
export const GROWING_UI_BUILT: boolean = false;

export function GrowingDialog(_props: { lang: 'he' | 'en' }): ReactElement | null {
  const { editor, state } = useEditorState();
  const open = state.growingOpen;
  useEffect(() => { if (open && !(GROWING_BUILT && GROWING_UI_BUILT)) editor.closeGrowing(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
