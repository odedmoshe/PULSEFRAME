/**
 * A pack's page (ADR-0022; plan §8): a back button and Tabs תבניות / כותרות / אלמנטים / מראה / כתוביות / צליל (PACK_TABS).
 * Every action is ONE transaction through existing operations and routes: a template opens the template dialog; a title is one
 * add_text (packTitleOp); a look is one add_adjustment (packLookOp); a caption look is one apply_caption_look; an element or a
 * sound goes through the existing element and sound routes (the clip is one undo, the file stays in the library, and the page
 * says so). Test ids: PACK_TESTIDS.page, back, tab(t), panel(t) and the item ids (each item is a list item carrying its
 * data-*-id, with the action button inside).
 *
 * PackPageView is the page with nothing wired (props in, callbacks out); PackPage wires it to the editor. A pack action that the
 * server or the editor refuses shows the editor's own error and no «נוסף» line: nothing is claimed that did not happen.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { elementSvg, packTitleText, type PackFieldsInput, type PackLook, type PackSummary, type PackTitle } from '@pulseframe/core';
import { Badge, Button, Tabs, Tile } from '../ds/index.ts';
import { DS, CheckIcon, cx } from '../ds/util.tsx';
import { api, ApiFailure } from '../api.ts';
import { useEditorState } from './store.ts';
import { PACK_TESTIDS as TID, type PackTab } from './packs.testids.ts';
import { PACK_STRINGS, type PackStrings } from './packs.strings.ts';
import { PackFields } from './PackFields.tsx';
import {
  captionAction, captionTargets, elementColours, isPackTab, lookAction, packView, pickCaptionTarget, tabSpecs, titleAction, titleFieldValues,
  type PackView,
} from './packs.logic.ts';
import './packs.css';

type Lang = 'he' | 'en';
type Words = { he: string; en: string };
export interface PackStatus { kind: 'ok' | 'err'; text: string }

export interface PackPageViewProps {
  pack: PackSummary; view: PackView; lang: Lang; tab: PackTab; onTab: (t: PackTab) => void; onBack: () => void; onOpenTemplate: (templateId: string) => void;
  captionTracks: readonly { id: string; name: string }[]; captionTrackId: string | null; onCaptionTrack: (id: string) => void;
  fields: PackFieldsInput; onFields: (next: PackFieldsInput) => void;
  /** the id of the item an action is running for (its button says «מוסיף…» and cannot be pressed twice) */
  busy: string | null; status: PackStatus | null;
  /** the title animation switch: a visible, editable default (the viewer's reduced-motion setting only sets it at first), never a silent decision */
  motionNone: boolean; onMotionNone: (none: boolean) => void;
  onAddTitle: (title: PackTitle) => void; onApplyLook: (look: PackLook) => void; onApplyCaption: (lookId: string) => void; onAddElement: (id: string, name: Words) => void; onAddSound: (id: string, name: string) => void;
}

const uri = (id: string, c: { color: string; color2?: string }): string | null => {
  try { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(elementSvg(id, c))}`; } catch { return null; }
};

function Row({ testId, dataKey, id, name, hint, action, lead }: { testId: string; dataKey: string; id: string; name: ReactNode; hint?: ReactNode; action: ReactNode; lead?: ReactNode }) {
  return (
    <li className="pf-pack-row" data-testid={testId} {...{ [dataKey]: id }}>
      {lead}
      <span className="pf-pack-row-text"><span className="pf-pack-row-name" dir="auto">{name}</span>{hint && <span className="pf-pack-row-hint" dir="auto">{hint}</span>}</span>
      {action}
    </li>
  );
}

export function PackPageView(p: PackPageViewProps) {
  const { pack, view, lang, tab } = p;
  const S: PackStrings = PACK_STRINGS[lang];
  const colours = elementColours(pack);
  const specs = tabSpecs(pack, S.tab);
  const act = (id: string, label: string, run: () => void, variant: 'primary' | 'secondary' = 'secondary', reason?: string) => (
    <Button size="sm" variant={variant} busy={p.busy === id} disabledReason={reason} onClick={() => { if (p.busy === null) run(); }}>{p.busy === id ? S.working : label}</Button>
  );
  const empty = <p className="pf-pack-note" role="status">{S.panelEmpty}</p>;
  const panel = (): ReactNode => {
    switch (tab) {
      case 'templates':
        return view.templates.length === 0 ? empty : (
          <ul className="pf-pack-list">{view.templates.map((t) => <Row key={t.id} testId={TID.template} dataKey="data-template-id" id={t.id} name={t.name[lang]} hint={t.hint[lang]} action={<Button size="sm" variant="primary" onClick={() => p.onOpenTemplate(t.id)}>{S.openTemplate}</Button>} />)}</ul>
        );
      case 'titles':
        return (
          <>
            {pack.fields.length > 0 && (<><PackFields fields={pack.fields} candle={false} value={p.fields} onChange={p.onFields} lang={lang} /><p className="pf-pack-note">{S.titleFieldsNote}</p></>)}
            {pack.liveFields && <p className="pf-pack-note">{S.titleDatedNote}</p>}
            <label className="check pf-pack-motion"><input type="checkbox" checked={p.motionNone} data-testid={TID.titleMotionNone} onChange={(e) => p.onMotionNone(e.target.checked)} /> {S.motionNone}</label>
            {view.titles.length === 0 ? empty : (
              <ul className="pf-pack-list">
                {view.titles.map((t) => {
                  const words = packTitleText(t, lang, titleFieldValues(p.fields), false);
                  return <Row key={t.id} testId={TID.title} dataKey="data-title-id" id={t.id} name={t.name[lang]} hint={<bdi dir="auto" lang={lang}>{words.text}</bdi>} action={act(t.id, S.addTitle, () => p.onAddTitle(t), 'primary')} />;
                })}
              </ul>
            )}
            <p className="pf-pack-note">{S.oneUndo}</p>
          </>
        );
      case 'elements':
        return view.elements.length === 0 ? empty : (
          <>
            <ul className="pf-pack-elements">
              {view.elements.map((e) => {
                const img = uri(e.id, colours);
                return (
                  <li key={e.id} data-testid={TID.element} data-element-id={e.id}>
                    <Tile name={e.name[lang]} image={img ? <img src={img} alt="" draggable={false} style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'contain' }} /> : undefined} state={{ loading: p.busy === e.id }} onActivate={() => { if (p.busy === null) p.onAddElement(e.id, e.name); }} />
                    <span className="pf-sr">{S.addElement}: {e.name[lang]}</span>
                  </li>
                );
              })}
            </ul>
            <p className="pf-pack-note">{S.libraryNote}</p>
          </>
        );
      case 'looks':
        return view.looks.length === 0 ? empty : (
          <>
            <ul className="pf-pack-list">{view.looks.map((l) => <Row key={l.id} testId={TID.look} dataKey="data-look-id" id={l.id} name={l.name[lang]} hint={l.hint[lang]} action={act(l.id, S.applyLook, () => p.onApplyLook(l))} />)}</ul>
            <p className="pf-pack-note">{S.lookNote} {S.oneUndo}</p>
          </>
        );
      case 'captions': {
        const none = p.captionTracks.length === 0;
        return view.captionLooks.length === 0 ? empty : (
          <>
            {none ? <p className="pf-pack-note" role="status">{S.noCaptionTrack}</p> : p.captionTracks.length > 1 && (
              <label className="pf-pack-select"><span className="pf-pfield-label">{S.captionTrack}</span>
                <select value={p.captionTrackId ?? ''} onChange={(e) => p.onCaptionTrack(e.target.value)}>{p.captionTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </label>
            )}
            <ul className="pf-pack-list">
              {view.captionLooks.map((l) => <Row key={l.id} testId={TID.captionLook} dataKey="data-caption-look-id" id={l.id} name={l.name[lang]} hint={<>{l.hint[lang]}{l.needsWordTiming && <> · {S.captionNeedsWords}</>}</>} action={act(l.id, S.applyCaption, () => p.onApplyCaption(l.id), 'secondary', none ? S.noCaptionTrack : undefined)} />)}
            </ul>
            <p className="pf-pack-note">{S.oneUndo}</p>
          </>
        );
      }
      case 'sound':
        return view.sfx.length === 0 && view.music.length === 0 ? empty : (
          <>
            {view.sfx.length > 0 && (<>
              <h4 className="pf-pack-sub">{S.soundsTitle}</h4>
              <ul className="pf-pack-list">{view.sfx.map((s) => <Row key={s.id} testId={TID.sound} dataKey="data-sfx-id" id={s.id} name={s.name ? s.name[lang] : s.id} action={act(s.id, S.addSound, () => p.onAddSound(s.id, s.name ? s.name[lang] : s.id))} />)}</ul>
              <p className="pf-pack-note">{S.libraryNote}</p>
            </>)}
            {view.music.length > 0 && (<>
              <h4 className="pf-pack-sub">{S.musicTitle}</h4>
              <ul className="pf-pack-list">{view.music.map((m) => <Row key={m.id} testId={TID.sound} dataKey="data-style-id" id={m.id} name={m.name[lang]} hint={m.hint[lang]} action={<Badge tone="attention">{S.musicUnheard}</Badge>} />)}</ul>
              <p className="pf-pack-note">{S.musicNote}</p>
            </>)}
          </>
        );
    }
  };
  return (
    <section className={cx(DS, 'pf-pack')} data-testid={TID.page} data-pack-id={pack.id} aria-label={pack.name[lang]} data-lang={lang}>
      <div className="pf-pack-top">
        <Button size="sm" variant="ghost" data-testid={TID.back} onClick={p.onBack}>{S.back}</Button>
        <h3 className="pf-pack-title" dir="auto">{pack.name[lang]}</h3>
      </div>
      <p className="pf-pack-hint" dir="auto">{pack.hint[lang]}</p>
      <Tabs label={S.tabsLabel} value={tab} onChange={(id) => { if (isPackTab(id)) p.onTab(id); }} panelPrefix="pf-pack-panel" tabs={specs.map((s) => ({ id: s.id, label: s.label, count: s.count, testId: TID.tab(s.id) }))} />
      <div role="tabpanel" id={`pf-pack-panel-${tab}`} aria-labelledby={`pf-pack-panel-tab-${tab}`} tabIndex={0} className="pf-pack-panel" data-testid={TID.panel(tab)}>{panel()}</div>
      <div aria-live="polite" role="status">{p.status && <p className={cx('pf-pack-status', p.status.kind === 'err' && 'is-err')}>{p.status.kind === 'ok' && <CheckIcon size={14} />} {p.status.text}</p>}</div>
      <p className="pf-pack-note">{S.source}</p>
    </section>
  );
}

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The pack page wired to the editor: every action is one commit (or one element/sound route call) and one undo. */
export function PackPage({ pack, projectId, lang, initialTab, onBack, onOpenTemplate }: { pack: PackSummary; projectId: string; lang: Lang; initialTab?: PackTab; onBack: () => void; onOpenTemplate: (templateId: string) => void }) {
  const { editor, state } = useEditorState();
  const S = PACK_STRINGS[lang];
  const [tab, setTab] = useState<PackTab>(initialTab ?? 'templates');
  const [fields, setFields] = useState<PackFieldsInput>({});
  // reduced motion in the viewer's system sets the default of a visible switch; the person can turn the animation back on
  const [motionNone, setMotionNone] = useState(reduced);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<PackStatus | null>(null);
  const [sfxNames, setSfxNames] = useState<Record<string, Words>>({});
  const [trackChoice, setTrackChoice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // sound names come from the server's catalogue; without them a sound is shown by its id (nothing is invented)
    api.soundEffects().then((list) => { if (live) setSfxNames(Object.fromEntries(list.map((s) => [s.id, s.name]))); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const view = useMemo(() => packView(pack, sfxNames), [pack, sfxNames]);
  const tracks = useMemo(() => captionTargets(state.doc), [state.doc]);
  const run = async (id: string, work: () => Promise<boolean>, what: string) => {
    setBusy(id); setStatus(null);
    try { setStatus((await work()) ? { kind: 'ok', text: S.added(what) } : null); }
    catch (e) { setStatus({ kind: 'err', text: e instanceof ApiFailure ? `${e.message}${e.hint ? ` ${e.hint}` : ''}` : e instanceof Error ? e.message : S.failed }); }
    finally { setBusy(null); }
  };
  const commit = async (op: Parameters<typeof editor.commit>[0], label: string) => (await editor.commit(op, label)) !== null;
  return (
    <PackPageView
      pack={pack} view={view} lang={lang} tab={tab} onTab={setTab} onBack={onBack} onOpenTemplate={onOpenTemplate}
      captionTracks={tracks} captionTrackId={pickCaptionTarget(tracks, trackChoice)} onCaptionTrack={setTrackChoice}
      fields={fields} onFields={setFields} motionNone={motionNone} onMotionNone={setMotionNone} busy={busy} status={status}
      onAddTitle={(t) => { const a = titleAction(t, { lang, start: editor.playhead, rate: editor.rate, fields, motion: motionNone ? 'none' : 'full' }); void run(t.id, () => commit([a.op], a.label), a.label); }}
      onApplyLook={(l) => { const a = lookAction(l, lang); void run(l.id, () => commit([a.op], a.label), a.label); }}
      onApplyCaption={(id) => { const track = pickCaptionTarget(tracks, trackChoice); const l = view.captionLooks.find((x) => x.id === id); if (track && l) void run(id, () => commit([captionAction(track, id)], l.name[lang]), l.name[lang]); }}
      onAddElement={(id, name) => void run(id, async () => { await api.addElement(projectId, { elementId: id, ...elementColours(pack), start: editor.playhead }); return true; }, name[lang])}
      onAddSound={(id, name) => void run(id, async () => { await api.addSoundEffect(projectId, { sfxId: id, start: editor.playhead }); return true; }, name)}
    />
  );
}
