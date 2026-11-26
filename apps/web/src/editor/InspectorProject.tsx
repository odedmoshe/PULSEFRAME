/**
 * Nothing is selected: the inspector shows the project itself (UX_REDESIGN §4.6): format, frame rate, length, loudness target
 * and the last flash check; under it how to work (DESIGN_REVIEW WP1): the most used keys, read from the command registry, and
 * «כל הקיצורים», which opens the palette's list of every key.
 */
import * as T from '@pulseframe/time';
import { Kbd } from '../ds/index.ts';
import { COMMANDS, chordLabel } from './commands.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { setPaletteView } from './chromeState.ts';
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
      <KeyList />
    </div>
  );
}

/** The keys of a command as the palette shows them (its first chord), or null when the command is not registered. */
const keyOf = (id: string): string | null => { const k = COMMANDS.find((c) => c.id === id)?.keys[0]; return k ? chordLabel(k) : null; };

/** The most used keys. Each row comes from a registered command; a row whose command is not registered (yet) is left out. */
function KeyList() {
  const { editor, state } = useEditorState();
  const K = CHROME_STRINGS[state.lang].keys;
  const both = (a: string | null, b: string | null) => (a && b ? `${a} / ${b}` : null);
  const rows: [string, string | null][] = [
    [K.play, keyOf('transport.toggle')],
    [K.split, keyOf('edit.split')],
    [K.delete, keyOf('edit.delete')],
    [K.undo, keyOf('history.undo')],
    [K.range, both(keyOf('range.in'), keyOf('range.out'))],
    [K.frames, both(keyOf('transport.prevFrame'), keyOf('transport.nextFrame'))],
    [K.palette, keyOf('view.palette')],
    [K.modes, 'Shift+1…7'],
  ];
  return (
    <section className="insp-keys" aria-labelledby="insp-keys-title" data-testid="insp-keys">
      <h3 id="insp-keys-title" className="insp-keys-title">{K.title}</h3>
      <dl className="insp-facts">
        {rows.filter((r): r is [string, string] => !!r[1]).map(([what, keys]) => (
          <div key={what} style={{ display: 'contents' }}><dt>{what}</dt><dd><bdi dir="ltr">{keys.split(' / ').map((chord, i) => <span key={i}>{i > 0 && ' / '}{chord.split('+').map((k, j) => <span key={j}>{j > 0 && '+'}<Kbd k={k} /></span>)}</span>)}</bdi></dd></div>
        ))}
      </dl>
      <button type="button" className="pf-btn pf-btn-ghost pf-btn-sm insp-keys-all" data-testid="insp-keys-all" aria-haspopup="dialog" onClick={() => { setPaletteView('shortcuts'); editor.set({ paletteOpen: true }); }}>{K.all}</button>
    </section>
  );
}
