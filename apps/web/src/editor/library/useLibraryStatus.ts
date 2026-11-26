/**
 * The library's status for a panel: asked once on mount, again every 1.5 s while the library is indexing, and on demand. Every
 * panel that uses it hears every answer: a folder set or a scan started in Settings reaches a library tab that is already open
 * (before, the open tab kept saying «הספרייה לא מוגדרת» until it was opened again).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryStatus } from '@pulseframe/core';
import { api } from '../../api.ts';
import type { FailureLike } from './library.logic.ts';

export interface LibraryStatusResult { status: LibraryStatus | null; failure: FailureLike | null; reload: () => void; set: (s: LibraryStatus) => void }

/** The panels listening now; each answer (asked by any of them, or set from a route's reply) is given to all. */
const listeners = new Set<(s: LibraryStatus) => void>();
const publish = (s: LibraryStatus) => { for (const l of listeners) l(s); };

export function useLibraryStatus(): LibraryStatusResult {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [failure, setFailure] = useState<FailureLike | null>(null);
  const alive = useRef(true);
  const load = useCallback(() => {
    api.libraryStatus().then(
      (s) => { if (alive.current) publish(s); },
      (e: unknown) => { if (alive.current) setFailure(e as FailureLike); },
    );
  }, []);
  useEffect(() => {
    alive.current = true;
    const hear = (s: LibraryStatus) => { if (alive.current) { setStatus(s); setFailure(null); } };
    listeners.add(hear);
    load();
    return () => { alive.current = false; listeners.delete(hear); };
  }, [load]);
  const indexing = status?.state === 'indexing';
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [indexing, load]);
  return { status, failure, reload: load, set: publish };
}
