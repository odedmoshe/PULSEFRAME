/** The source lines of a fetched file's media card (wave 8 sources, W3): where it came from, its licence by its own name, the credit, the page, the term rows. */
import type { ReactElement } from 'react';
import type { SourceRecord } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { TermRows, WarningLine } from './SourceParts.tsx';
import { SOURCES_TESTIDS as TID } from './sources.testids.ts';
import { flagKeys, licenceLabel, providerName, recordWarnings, safePageUrl, sx } from './sources.logic.ts';

export function SourceAssetLines({ source, lang }: { source: SourceRecord; lang: Lang }): ReactElement {
  const page = safePageUrl(source.pageUrl);
  const warn = recordWarnings(source);
  const named = new Set(warn.flatMap((w) => w.termIds));
  const extra = (source.terms ?? []).filter((t) => !named.has(t));
  return (
    <span className="pf-src-asset" data-testid={TID.assetSource}>
      <span dir="auto">{sx(lang, 'sources.from', { name: providerName(source.provider) })} · <bdi>{source.title}</bdi>{source.author && <> · <bdi>{source.author}</bdi></>}</span>
      <span className="pf-src-badge" role="note" aria-label={licenceLabel(lang, source.licence)}><bdi>{licenceLabel(lang, source.licence)}</bdi></span>
      {flagKeys(source.flags).map((k) => <span key={k} className="pf-src-muted">{sx(lang, k)}</span>)}
      {source.credit && <span className="pf-src-muted" dir="auto">{sx(lang, 'sources.credit')}: <bdi>{source.credit.text}</bdi></span>}
      <span className="pf-src-muted">{sx(lang, 'sources.fetchedAt', { at: source.fetchedAt })}</span>
      {page && <a href={page} target="_blank" rel="noopener noreferrer" dir="ltr" data-testid={TID.openPage}>{sx(lang, 'sources.openPage')}</a>}
      {warn.map((w, i) => <WarningLine key={`${w.code}-${i}`} w={w} lang={lang} />)}
      {extra.length > 0 && <TermRows ids={extra} lang={lang} />}
    </span>
  );
}
