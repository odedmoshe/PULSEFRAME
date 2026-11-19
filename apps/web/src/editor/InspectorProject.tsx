/** Nothing is selected: the inspector shows the project itself (UX_REDESIGN §4.6): format, frame rate, length, loudness target and the last flash check. */
import * as T from '@pulseframe/time';
import { useEditorState } from './store.ts';
import { INSPECTOR_STRINGS } from './inspector.strings.ts';
import { secondsText } from './inspector.model.ts';

export function ProjectPanel() {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const doc = state.doc;
  if (!doc) return null;
  const rate = doc.settings.frameRate;
  const clips = (doc.sequences[doc.mainSequenceId]?.tracks ?? []).reduce((n, tr) => n + tr.clips.length, 0);
  const target = doc.settings.loudness?.target ?? null;
  const flash = state.exportJob?.status === 'succeeded' ? state.exportJob.output?.photosensitivity?.verdict ?? null : null;
  const variants = Object.values(doc.variants ?? {});
  return (
    <div className="insp-project" data-testid="insp-project">
      <dl className="insp-facts">
        <dt>{S.format}</dt><dd><bdi className="num">{doc.settings.width}×{doc.settings.height}</bdi></dd>
        <dt>{S.frameRate}</dt><dd><bdi className="num">{(rate.num / rate.den).toFixed(rate.den === 1 ? 0 : 2)} fps</bdi></dd>
        <dt>{S.duration}</dt><dd><bdi className="num">{secondsText(T.toSeconds(editor.duration))} {S.seconds}</bdi></dd>
        <dt>{S.clips}</dt><dd><bdi className="num">{clips}</bdi></dd>
        <dt>{S.loudness}</dt><dd>{target === null ? S.loudnessOff : <bdi className="num">{target} LUFS</bdi>}</dd>
        <dt>{S.flash}</dt><dd className={flash === 'fail' ? 'is-attention' : flash === 'pass' ? 'is-ok' : undefined}>{flash === 'pass' ? S.flashPass : flash === 'fail' ? S.flashFail : S.flashNone}</dd>
        <dt>{S.formats}</dt><dd>{variants.length === 0 ? S.none : variants.map((v) => <bdi key={v.id} className="num insp-fmt">{v.width}×{v.height}</bdi>)}</dd>
      </dl>
      <p className="muted insp-note">{S.nothingHint}</p>
    </div>
  );
}
