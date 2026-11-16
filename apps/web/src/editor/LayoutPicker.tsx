/**
 * Layouts for several picture clips at once (split screen, grids, picture-in-picture). Shown when two or more picture
 * clips are selected; applying one is the registered `apply_layout` op through editor.commit.
 */
import { LAYOUTS, type Clip } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import './layoutPicker.css';

const STR = {
  he: { title: 'פריסה', intro: (n: number) => `${n} קליפים של תמונה נבחרו. הפריסה ממקמת כל אחד בתא שלו; התאים מתמלאים מהערוץ התחתון כלפי מעלה.`, none: (n: number) => `אין פריסה מוכנה ל-${n} תמונות.`, hint: 'כדי שהתמונות ייראו יחד, הקליפים צריכים להתנגן באותו זמן בערוצים שונים.', cells: (n: number) => `${n} תאים` },
  en: { title: 'Layout', intro: (n: number) => `${n} picture clips are selected. A layout puts each in its own cell; cells are filled from the bottom track up.`, none: (n: number) => `There is no ready-made layout for ${n} pictures.`, hint: 'To see the pictures together, the clips must play at the same time on different tracks.', cells: (n: number) => `${n} cells` },
} as const;

export function LayoutPicker() {
  const { editor, state } = useEditorState();
  const doc = editor.doc;
  if (!doc || state.selection.length < 2) return null;
  const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
  const picked: Clip[] = [];
  for (const tr of tracks) if (tr.kind === 'video') for (const c of tr.clips) if (state.selection.includes(c.id) && c.type === 'media') picked.push(c);
  if (picked.length < 2 || picked.length !== state.selection.length) return null; // only when the whole selection is picture clips
  const S = STR[state.lang];
  const fits = LAYOUTS.filter((l) => l.count === picked.length);
  const aspect = doc.settings.width / doc.settings.height;
  const W = aspect >= 1 ? 72 : Math.round(72 * aspect), H = aspect >= 1 ? Math.round(72 / aspect) : 72;
  return (
    <fieldset className="layout-picker" data-testid="layout-picker">
      <legend>{S.title}</legend>
      <p className="muted">{S.intro(picked.length)}</p>
      {fits.length === 0 ? <p className="muted" data-testid="layout-none">{S.none(picked.length)}</p> : (
        <div className="lp-grid" role="group" aria-label={S.title}>
          {fits.map((l) => (
            <button key={l.id} type="button" className="lp-tile" data-testid="layout-tile" data-id={l.id} aria-label={`${l.name[state.lang]} (${S.cells(l.count)})`}
              onClick={() => void editor.commit([{ op: 'apply_layout', args: { layoutId: l.id, clipIds: picked.map((c) => c.id) } }], `Layout ${l.id}`)}>
              <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false" className="lp-thumb">
                <rect x={0} y={0} width={W} height={H} className="lp-frame" />
                {l.slots.map((s, i) => <rect key={i} x={s.x * W + 0.75} y={s.y * H + 0.75} width={Math.max(1, s.w * W - 1.5)} height={Math.max(1, s.h * H - 1.5)} rx={2} className={`lp-cell lp-cell-${i % 4}`} />)}
              </svg>
              <span className="lp-name">{l.name[state.lang]}</span>
            </button>
          ))}
        </div>
      )}
      <p className="muted">{S.hint}</p>
    </fieldset>
  );
}
