/** Loads GET /api/v1/music/kits once and on demand (wave 7 instruments track; builder W3). A failure is a state with its words, never an empty list. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from '../../api.ts';
import type { KitsLoad } from './instruments.logic.ts';

export function useMusicKits(lang: 'he' | 'en'): { load: KitsLoad; reload: () => Promise<void> } {
  const [load, setLoad] = useState<KitsLoad>({ phase: 'loading' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const reload = useCallback(async () => {
    try {
      const r = await api.musicKits();
      if (alive.current) setLoad({ phase: 'ok', kits: r.kits });
    } catch (e) {
      if (alive.current) setLoad({ phase: 'failed', why: e instanceof ApiFailure && lang === 'he' ? `HTTP ${e.status}` : e instanceof Error ? e.message : String(e) });
    }
  }, [lang]);
  useEffect(() => { void reload(); }, [reload]);
  return { load, reload };
}
