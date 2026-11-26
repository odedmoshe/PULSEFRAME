/**
 * Badges of a project file copied from the library (wave 7 library track), on its media card: «לשימוש לא מסחרי בלבד», «דורש
 * קרדיט», «אנשים בקליפ», «נוצר בבינה מלאכותית», read from asset.provenance.library. The licence entry opens the record's licence id,
 * its link and its credit text (the card's own menu belongs to MediaLibrary, which this track does not edit).
 */
import { useState, type ReactElement } from 'react';
import type { Asset } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { useEditorState } from '../store.ts';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';
import { LIBRARY_UI_STRINGS } from './library.strings.ts';
import { assetBadges, badgeText } from './library.logic.ts';
import { SourceAssetLines } from '../sources/SourceAssetLines.tsx';

export function LibraryAssetBadgesView({ asset, lang }: { asset: Asset; lang: Lang }): ReactElement | null {
  const lib = asset.provenance?.library;
  const src = asset.provenance?.source;
  const [open, setOpen] = useState(false);
  // a file from «מאגר» (wave 8 sources) carries provenance.source instead: its own lines (a library copy keeps the library record)
  if (!lib) return src ? <SourceAssetLines source={src} lang={lang} /> : null;
  const L = LIBRARY_UI_STRINGS[lang];
  const badges = assetBadges(asset);
  return (
    <span className="pf-lib-assetbox">
      <span className="pf-lib-assetbadges" data-testid={TID.assetBadges}>
        {badges.map((b) => <span key={b} className={`pf-lib-badge is-${b}`} data-badge={b}>{badgeText(lang, b)}</span>)}
        <button type="button" className="pf-lib-assetlicence" data-testid={TID.assetLicence} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{L.licence}</button>
      </span>
      {open && (
        <span className="pf-lib-assetinfo" dir="auto">
          <bdi dir="ltr">{lib.licence.id}</bdi>
          {lib.licence.url && <> · <a href={lib.licence.url} target="_blank" rel="noopener noreferrer" dir="ltr">{lib.licence.url}</a></>}
          {lib.credit && <span className="pf-lib-credit" dir="auto">{lib.credit.text}</span>}
        </span>
      )}
    </span>
  );
}

export function LibraryAssetBadges({ asset }: { asset: Asset }) {
  const { state } = useEditorState();
  return <LibraryAssetBadgesView asset={asset} lang={state.lang} />;
}
