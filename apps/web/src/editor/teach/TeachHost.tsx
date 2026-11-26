/** Hosts the teach dialog while it is open (teach.state.ts). Mounted once in Header.tsx beside <CraftHost /> (lead pre-pass line). */
import { useSyncExternalStore } from 'react';
import { teachSurface } from './teach.state.ts';
import { TeachDialog } from './TeachDialog.tsx';

export function TeachHost() {
  const s = useSyncExternalStore(teachSurface.subscribe, teachSurface.get);
  if (!s) return null;
  return <TeachDialog key={s.clipId} clipId={s.clipId} />;
}
