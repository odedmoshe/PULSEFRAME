/**
 * The story dialog (W3), a modal on the design system's Dialog (focus trapped, Escape closes, focus returns to the opener), Hebrew
 * first and right to left: «תמונות וקליפים» (a strip in show order, Alt+arrows or the two buttons to move, remove, «הוספה מהספרייה»),
 * «הקול» (the recorder, a sound file of the library, the phone), «אפשרויות» (music from the project's sound files with each one's
 * length beside the narration's, «הוסיפו מוזיקה מובנית», the clips' own sound, the opening title, the transcript row), and the two
 * ways to build: «הקישו את המעברים» (plans, closes the dialog, switches to the perform workspace; the «סיפור» tab opens) and «בנו
 * בלי הקשות» (plans and applies at the plan's revision).
 * An unplayable narration shows «הקובץ לא מתנגן בעורך (קודק …)» and disables both build buttons.
 * PRIVACY: every way of closing goes through `close()`, which releases the microphone (the recorder's release) first; «מהטלפון»
 * releases it the same way, then keeps the choices (Editor.storyToPhone) so the dialog reopens as it was when the phone dialog closes.
 * Mounted once in App.tsx; open while editor state storyOpen.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { AnchoredError, Button, Dialog } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { MusicBrowser } from '../MusicBrowser.tsx';
import { StoryRecorder } from './StoryRecorder.tsx';
import { storyStrings } from './story.strings.ts';
import { STORY_TESTIDS as ID } from './story.testids.ts';
import {
  addableAssets, assetSeconds, buildBlocker, buildStoryParams, codecOf, initialChoices, moveItem, moveOfKey, musicShort, probePlayable, soundFiles, storyFailure,
  type Playable, type StoryChoices,
} from './story.logic.ts';
import './story.css';

const enc = encodeURIComponent;
export const contentUrl = (projectId: string, assetId: string) => `/api/v1/projects/${enc(projectId)}/assets/${enc(assetId)}/content`;

export function StoryDialog({ lang }: { lang: 'he' | 'en' }): ReactElement | null {
  const { state } = useEditorState();
  if (!state.storyOpen || !state.doc || !state.storySource) return null;
  return <StoryDialogBody lang={lang} />;
}

function StoryDialogBody({ lang }: { lang: 'he' | 'en' }): ReactElement {
  const { editor, state, t } = useEditorState();
  const S = storyStrings(lang);
  const doc = state.doc!, source = state.storySource!;
  const rtl = lang === 'he';
  const [c, setC] = useState<StoryChoices>(() => initialChoices(source, doc, lang, state.storyKept));
  const [playable, setPlayable] = useState<Playable>('ok');
  const [busy, setBusy] = useState<null | 'planning' | 'building'>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [builtin, setBuiltin] = useState(false);
  const releaseMic = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** THE close: the microphone is released first, whatever closes the dialog (button, Escape, backdrop, a build, a route change unmounts the recorder too). */
  const close = () => { releaseMic.current?.(); editor.closeStory(); };

  const sounds = useMemo(() => soundFiles(doc), [doc]);
  const patch = (p: Partial<StoryChoices>) => setC((x) => ({ ...x, ...p }));
  const narration = c.narrationAssetId ? doc.assets[c.narrationAssetId] : undefined;

  // the narration is opened in the browser: when it cannot be played, the dialog says so and builds nothing
  useEffect(() => {
    if (!c.narrationAssetId) { setPlayable('ok'); return; }
    if (typeof Audio === 'undefined') { setPlayable('unknown'); return; }
    setPlayable('checking');
    const p = probePlayable(() => new Audio() as never, contentUrl(doc.id, c.narrationAssetId));
    let on = true;
    void p.result.then((r) => { if (on) setPlayable(r); });
    return () => { on = false; p.cancel(); };
  }, [c.narrationAssetId, doc.id]);

  const blocker = buildBlocker(c, playable, lang, codecOf(narration));
  const params = buildStoryParams(c);
  const short = musicShort(doc, c.musicAssetId, c.narrationAssetId);
  const candidates = addableAssets(doc, c.assetIds);

  const move = (i: number, d: -1 | 1) => patch({ assetIds: moveItem(c.assetIds, i, i + d) });
  const onItemKey = (i: number) => (e: KeyboardEvent) => { const d = moveOfKey(e, rtl); if (d) { e.preventDefault(); move(i, d); } };

  const fail = (e: unknown) => { setError(storyFailure(lang, e, t as never).message); };
  const tapAlong = async () => {
    if (!params || blocker) return;
    setBusy('planning'); setError(null);
    try {
      const view = await api.planStory(doc.id, params);
      if (!alive.current) return;
      editor.setStoryDraft({ params, view, returnTo: state.workspace });
      close();
      editor.setWorkspace('perform');
    } catch (e) { if (alive.current) fail(e); } finally { if (alive.current) setBusy(null); }
  };
  const buildNow = async () => {
    if (!params || blocker) return;
    setBusy('building'); setError(null);
    try {
      const view = await api.planStory(doc.id, params);
      if (view.blocking.length) { setError(view.blocking[0]!.message); return; }
      const r = await api.applyStory(doc.id, params, view.revision);
      editor.setStoryRun({ runId: r.runId, params, picks: r.picks, excluded: r.excluded, chips: r.chips });
      await editor.load(doc.id);
      if (alive.current) close();
    } catch (e) { if (alive.current) fail(e); } finally { if (alive.current) setBusy(null); }
  };

  const footer = (
    <>
      <Button variant="ghost" data-testid={ID.close} onClick={close}>{S.close}</Button>
      <span className="pf-story-spacer" />
      <Button data-testid={ID.buildNoTaps} busy={busy === 'building'} disabledReason={blocker ?? (busy === 'planning' ? S.planning : undefined)} onClick={() => void buildNow()}>{S.buildNoTaps}</Button>
      <Button variant="primary" data-testid={ID.tapAlong} busy={busy === 'planning'} disabledReason={blocker ?? (busy === 'building' ? S.building : undefined)} onClick={() => void tapAlong()}>{S.tapAlong}</Button>
    </>
  );

  return (
    <Dialog open onClose={close} title={S.name} size="lg" closeLabel={S.close} dismissOnBackdrop footer={footer} testId={ID.dialog} className="pf-story-dialog">
      <div className="pf-story-body" dir={rtl ? 'rtl' : 'ltr'} lang={lang}>
        <section className="pf-story-section" aria-label={S.pictures}>
          <h3>{S.pictures} <span className="pf-story-muted">{isolate(String(c.assetIds.length))}</span></h3>
          {c.assetIds.length === 0 ? <p className="pf-story-muted">{S.stripEmpty}</p> : (
            <ol className="pf-story-strip" data-testid={ID.strip} dir={rtl ? 'rtl' : 'ltr'} aria-label={S.stripLabel}>
              {c.assetIds.map((id, i) => {
                const a = doc.assets[id];
                return (
                  <li key={id} className="pf-story-item" data-testid={ID.item} data-asset-id={id} tabIndex={0} onKeyDown={onItemKey(i)} aria-label={`${i + 1}. ${a?.name ?? id}. ${S.moveHint}`}>
                    <img className="pf-story-thumb" src={contentUrl(doc.id, id)} alt="" loading="lazy" draggable={false} />
                    <span className="pf-story-item-name">{isolate(a?.name ?? id)}</span>
                    <span className="pf-story-item-tools">
                      <button type="button" className="pf-story-icon" aria-label={`${S.earlier}: ${a?.name ?? id}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                      <button type="button" className="pf-story-icon" aria-label={`${S.later}: ${a?.name ?? id}`} disabled={i === c.assetIds.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                      <button type="button" className="pf-story-icon" data-testid={ID.itemRemove} aria-label={`${S.removePicture}: ${a?.name ?? id}`} onClick={() => patch({ assetIds: c.assetIds.filter((x) => x !== id) })}><X size={14} aria-hidden="true" /></button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="pf-story-row">
            <Button size="sm" data-testid={ID.add} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{S.addFromLibrary}</Button>
          </div>
          {adding && (candidates.length === 0 ? <p className="pf-story-muted">{S.noMorePictures}</p> : (
            <ul className="pf-story-picker" aria-label={S.libraryPicker}>
              {candidates.map((a) => (
                <li key={a.id}><button type="button" className="pf-story-choice" onClick={() => patch({ assetIds: [...c.assetIds, a.id].slice(0, 200) })}>{S.add}: {isolate(a.name)}</button></li>
              ))}
            </ul>
          ))}
        </section>

        <section className="pf-story-section" aria-label={S.voice}>
          <h3>{S.voice}</h3>
          <StoryRecorder lang={lang} releaseRef={releaseMic} onSaved={(assetId) => patch({ narrationAssetId: assetId })} />
          <div className="pf-story-row">
            <label className="pf-story-field">
              <span>{S.recordingsLabel}</span>
              <select data-testid={ID.fromLibrary} value={c.narrationAssetId ?? ''} onChange={(e) => patch({ narrationAssetId: e.target.value || null, musicAssetId: e.target.value && e.target.value === c.musicAssetId ? null : c.musicAssetId })}>
                <option value="">{S.narrationNone}</option>
                {sounds.map((a) => <option key={a.id} value={a.id}>{a.name} ({S.musicLength(assetSeconds(a))})</option>)}
              </select>
            </label>
          </div>
          <p className="pf-story-muted" data-testid={ID.fromPhone}>{S.phoneHint}</p>
          <div className="pf-story-row"><Button size="sm" onClick={() => { releaseMic.current?.(); editor.storyToPhone(c); }}>{S.fromPhone}</Button></div>
          {narration && (
            <p className="pf-story-narration" data-testid={ID.narration} data-asset-id={narration.id}>{isolate(narration.name)} · {isolate(S.narrationChosen(assetSeconds(narration)))}</p>
          )}
          {playable === 'checking' && <p className="pf-story-muted" role="status">{S.checking}</p>}
          {playable === 'unplayable' && <p className="pf-story-error" role="alert" data-testid={ID.unplayable}>{isolate(S.unplayable(codecOf(narration)))}</p>}
        </section>

        <section className="pf-story-section" aria-label={S.options}>
          <h3>{S.options}</h3>
          <fieldset className="pf-story-fieldset">
            <legend>{S.musicLabel}</legend>
            <div role="radiogroup" aria-label={S.musicLabel} className="pf-story-music">
              <label className="pf-story-opt"><input type="radio" name="story-music" data-testid={ID.musicNone} checked={c.musicAssetId === null} onChange={() => patch({ musicAssetId: null })} /> <span>{S.musicNone}</span></label>
              {sounds.filter((a) => a.id !== c.narrationAssetId).map((a) => (
                <label key={a.id} className="pf-story-opt" data-testid={ID.music} data-asset-id={a.id}>
                  <input type="radio" name="story-music" checked={c.musicAssetId === a.id} onChange={() => patch({ musicAssetId: a.id })} /> <span>{isolate(a.name)}</span> <span className="pf-story-muted">{isolate(S.musicLength(assetSeconds(a)))}</span>
                </label>
              ))}
            </div>
            {sounds.filter((a) => a.id !== c.narrationAssetId).length === 0 && <p className="pf-story-muted">{S.musicNoSound}</p>}
            {short && <p className="pf-story-warn" role="status" data-testid={ID.musicShort}>{isolate(S.musicShort(short.music, short.narration))}</p>}
            <div className="pf-story-row"><Button size="sm" data-testid={ID.musicAddBuiltin} aria-expanded={builtin} onClick={() => setBuiltin((v) => !v)}>{S.musicAddBuiltin}</Button></div>
            {builtin && <MusicBrowser projectId={doc.id} lang={lang} fitSeconds={null} onAdded={(r) => patch({ musicAssetId: r.assetId })} />}
            <p className="pf-story-muted">{S.musicNote}</p>
          </fieldset>
          <fieldset className="pf-story-fieldset">
            <legend>{S.ownSound}</legend>
            <div role="radiogroup" aria-label={S.ownSound} className="pf-story-music">
              <label className="pf-story-opt"><input type="radio" name="story-own" data-testid={ID.soundUnder} checked={c.ownSound === 'under'} onChange={() => patch({ ownSound: 'under' })} /> <span>{S.ownSoundUnder}</span></label>
              <label className="pf-story-opt"><input type="radio" name="story-own" data-testid={ID.soundMute} checked={c.ownSound === 'mute'} onChange={() => patch({ ownSound: 'mute' })} /> <span>{S.ownSoundMute}</span></label>
            </div>
            <p className="pf-story-muted">{S.ownSoundNote}</p>
          </fieldset>
          <label className="pf-story-opt"><input type="checkbox" data-testid={ID.titleToggle} checked={c.openingTitle} onChange={(e) => patch({ openingTitle: e.target.checked })} /> <span>{S.openingTitle}</span></label>
          {c.openingTitle && (
            <label className="pf-story-field"><span>{S.titleField}</span>
              <input type="text" data-testid={ID.titleField} maxLength={200} value={c.openingText} placeholder={c.event?.name ?? ''} onChange={(e) => patch({ openingText: e.target.value })} aria-describedby="pf-story-title-hint" />
            </label>
          )}
          {c.openingTitle && <p id="pf-story-title-hint" className="pf-story-muted">{S.titleHint}</p>}
          <p className="pf-story-muted" data-testid={ID.transcriptRow}>{t('story.transcriptRow' as never)}</p>
        </section>
        <p className="pf-story-muted">{t('story.draft' as never)} · {t('story.voiceMeasure' as never)}</p>
        {error && <div className="pf-story-errorbox" data-testid={ID.error}><AnchoredError blocking onDismiss={() => setError(null)} dismissLabel={S.close}>{error}</AnchoredError></div>}
        {busy && <p role="status" className="pf-story-muted">{busy === 'planning' ? S.planning : S.building}</p>}
      </div>
    </Dialog>
  );
}
