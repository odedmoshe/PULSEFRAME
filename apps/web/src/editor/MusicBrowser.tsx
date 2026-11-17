/**
 * The audio drawer's second tab «מוזיקה מובנית» (ADR-0022; plan §8; the lead mounts it after the redesign's audio drawer has
 * merged). Per style (listMusicStyles / GET /api/v1/music): name, «120 BPM» as a .num token and the line «קצב ידוע מהמתכון»
 * (never "measured"); length chips 8 / 16 / 32 bars and «כאורך הסרטון» (fitSeconds = `fitSeconds`); seconds and megabytes
 * before adding; play/stop preview through the preview route (no autoplay); the section strip from musicLayout with text labels
 * (i18n music.section.*), not colour alone; the attention badge «מוזיקה מובנית — עוד לא הושמעה לאף אחד» while a style is
 * unheard; «הוספה לציר הזמן» (POST /api/v1/projects/:id/music: one undo). Test ids: MUSIC_TESTIDS.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
export function MusicBrowser(_props: { projectId: string; lang: 'he' | 'en'; /** exact seconds of the edit as 'n' or 'n/d', for «כאורך הסרטון»; null = an empty timeline */ fitSeconds: string | null; onAdded?: (r: { assetId: string; clipId: string | null; revision: number }) => void }): ReactElement | null {
  return null;
}
