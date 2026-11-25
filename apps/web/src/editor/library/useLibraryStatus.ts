/** The library's status for a panel: asked once on mount, again every 1.5 s while the library is indexing, and on demand. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryStatus } from '@pulseframe/core';
import { api } from '../../api.ts';
import type { FailureLike } from './library.logic.ts';

export interface LibraryStatusResult { status: LibraryStatus | null; failure: FailureLike | null; reload: () => void; set: (s: LibraryStatus) => void }

export function useLibraryStatus(): LibraryStatusResult {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [failure, setFailure] = useState<FailureLike | null>(null);
  const alive = useRef(true);
  const load = useCallback(() => {
    api.libraryStatus().then(
      (s) => { if (alive.current) { setStatus(s); setFailure(null); } },
      (e: unknown) => { if (alive.current) setFailure(e as FailureLike); },
    );
  }, []);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  const indexing = status?.state === 'indexing';
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [indexing, load]);
  return { status, failure, reload: load, set: (s) => { setStatus(s); setFailure(null); } };
}
