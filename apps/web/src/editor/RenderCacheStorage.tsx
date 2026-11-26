/**
 * The render cache's storage row (ADR-0024; plan §8): in the status centre (the status bar's pips open it, SettingsDialog.tsx).
 * Its size against its limit, with every number in <bdi dir="ltr">, the honest note (counted in the ceiling, never backed up,
 * deleted with its project), and «ניקוי מטמון הרינדור» behind a confirmation: the owner's own session only (DELETE
 * /storage/render-cache is refused to anyone else). Segments of an export running now are kept and said so.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { RenderCacheStatus } from '@pulseframe/core';
import { Button } from '../ds/index.ts';
import { Numbers } from './RenderCacheLane.tsx';
import { cacheText, renderCacheStrings } from './renderCache.strings.ts';
import { RENDER_CACHE_TESTIDS as TID } from './renderCache.testids.ts';
import { useEditorState } from './store.ts';

export function RenderCacheStorage(): ReactElement | null {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const S = renderCacheStrings(lang);
  const [status, setStatus] = useState<RenderCacheStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
  const load = () => fetch('/api/v1/storage/render-cache', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((s) => setStatus(s as RenderCacheStatus | null), () => setStatus(null));
  useEffect(() => { void load(); }, []);
  if (!status) return null;
  const owner = state.actor === 'user:local';
  const clear = async () => {
    setConfirming(false);
    try {
      const r = await fetch('/api/v1/storage/render-cache', { method: 'DELETE', credentials: 'same-origin' });
      const body = await r.json();
      if (!r.ok) throw Object.assign(new Error(body?.error?.message ?? `HTTP ${r.status}`), { code: body?.error?.code });
      setCleared(S.cleared(body.bytes, body.keptPinned));
      setStatus(body.status as RenderCacheStatus);
      editor.refreshPlan();
    } catch (e) { editor.fail(e); }
  };
  return (
    <div className="pf-set-row rc-storage" data-testid={TID.storageRow}>
      <span><Numbers text={S.storageRow(status.usedBytes, status.capBytes)} /></span>
      {status.capBytes > 0 && owner && !confirming && (
        <Button size="sm" variant="secondary" data-testid={TID.clear} disabled={status.usedBytes === 0} onClick={() => { setCleared(null); setConfirming(true); }}>{cacheText(lang, 'cache.storage.clear')}</Button>
      )}
      {confirming && (
        <span className="rc-confirm" role="group" aria-label={cacheText(lang, 'cache.storage.clear')}>
          <span>{cacheText(lang, 'cache.storage.clearConfirm')}</span>
          <Button size="sm" variant="danger-quiet" data-testid={TID.clearConfirm} onClick={() => void clear()}>{cacheText(lang, 'cache.storage.clear')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{lang === 'he' ? 'ביטול' : 'Cancel'}</Button>
        </span>
      )}
      {cleared && <p role="status" data-testid={TID.cleared}><Numbers text={cleared} /></p>}
      <p className="pf-set-why">{cacheText(lang, 'cache.storage.note')}</p>
    </div>
  );
}
