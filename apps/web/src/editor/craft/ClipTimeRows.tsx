/**
 * The start and duration rows of a clip's time block (InspectorObject.tsx TimeBlock). W3 makes them buttons that open the time
 * field («משך הקליפ» from the duration). In the pre-pass it renders exactly what InspectorObject.tsx rendered before.
 */
import * as T from '@pulseframe/time';
import type { Clip } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';

export function ClipTimeRows({ clip, t }: { clip: Clip; t: (k: Key) => string }) {
  return (
    <>
      <dt>{t('clip.start')}</dt><dd><bdi className="num">{T.toSeconds(clip.start).toFixed(3)}s</bdi></dd>
      <dt>{t('clip.duration')}</dt><dd><bdi className="num">{T.toSeconds(clip.duration).toFixed(3)}s</bdi></dd>
    </>
  );
}
