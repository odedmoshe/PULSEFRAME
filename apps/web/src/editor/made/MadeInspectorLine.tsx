/**
 * The Inspector line of a made clip (wave 8 motioncode, W3): «קליפ שנוצר בקוד», the honest line, the flash rate when over the limit
 * (the numbers from the record), and «עריכה ויצירה מחדש» opening the dialog on the clip's own page with the length locked to the clip.
 * Renders nothing for a clip whose file has no provenance.made.
 */
import { useState, type ReactElement } from 'react';
import type { Clip } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import { Button } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { MADE_TESTIDS as TID } from './made.testids.ts';
import { madeT } from './made.strings.ts';
import { flashOver } from './made.logic.ts';
import { MadeClipDialog } from './MadeClipDialog.tsx';
import './made.css';

export function MadeInspectorLine({ clip }: { clip: Clip }): ReactElement | null {
  const { state } = useEditorState();
  const [open, setOpen] = useState(false);
  const doc = state.doc;
  if (!doc || clip.type !== 'media') return null;
  const rec = doc.assets[clip.assetId]?.provenance?.made;
  if (!rec) return null;
  const t = madeT(state.lang);
  const flash = flashOver(rec);
  const frames = T.frameIndexAt(clip.duration, doc.settings.frameRate);
  return (
    <div className="pf-made-inspector" data-testid={TID.inspector}>
      <b>{t('inspector')}</b>
      <p className="pf-made-note">{t('unseen')}</p>
      {flash && <p className="pf-made-note">{t('ui.flashInspector', { rate: String(Math.round(flash.rate * 100) / 100), on: t(`on.${flash.on}`) })}</p>}
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid={TID.edit}>{t('edit')}</Button>
      {open && <MadeClipDialog edit={{ assetId: clip.assetId, clipFrames: frames }} onClose={() => setOpen(false)} />}
    </div>
  );
}
