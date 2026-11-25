/**
 * The start hub (docs/design/UX_REDESIGN.md §4.14), shown over the stage while the project has no media and no clips:
 * the hero "מה יוצרים היום?", a drop zone (welcome-drop, with the file button welcome-import), format cards that set the
 * project's frame through the registered op set_project_format, "start from a moment" cards that are the editor's real
 * templates (their skeletons are drawn from the template's own slots, labelled as built from rules, not AI), and the recent
 * projects. Nothing here is made up: with no earlier project the list says so; with the server unreachable it says so.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUpFromLine, ChevronLeft, FolderOpen, ImagePlus, Plus, RotateCw, Smartphone } from 'lucide-react';
import type { TemplateSummary } from '@pulseframe/core';
import { Button } from '../ds/index.ts';
import { api, type ProjectListItem } from '../api.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { setHubSetAside, useChrome } from './chromeState.ts';
import { ProjectsDialog } from './ProjectsDialog.tsx';
import { useEditorState } from './store.ts';
import { TEMPLATE_TESTIDS } from './templates.testids.ts';
import { templateApi } from './templateDialog.logic.ts';
import { WELCOME_STRINGS } from './welcome.strings.ts';
import { OnThisDayCard } from './lifeline/OnThisDayCard.tsx';
import { FamilyFilmEntry } from './FamilyFilmEntry.tsx';
import { StoryEntry } from './story/StoryEntry.tsx';
import { sourceFromSelection } from './familyFilm.logic.ts';
import '../ds/chrome.css';
import './welcome.css';
import './templates.css';

const ACCEPT = 'video/*,audio/*,image/png,image/jpeg,image/webp,.cube'; // same list as the library input (.cube = a colour table)
const FORMATS = [
  { id: 'tall', w: 1080, h: 1920, ratio: '9:16', key: 'fmtTall' },
  { id: 'square', w: 1080, h: 1080, ratio: '1:1', key: 'fmtSquare' },
  { id: 'wide', w: 1920, h: 1080, ratio: '16:9', key: 'fmtWide' },
] as const;

/** «מהטלפון» in the start hub's drop zone (plan §7). */
const PHONE_WORD = { he: 'מהטלפון', en: 'From a phone' } as const;
/** Start hub over the stage of an empty project (no assets, no clips). */
export function Welcome() {
  const { editor, state } = useEditorState();
  const { hubSetAside } = useChrome();
  const { doc, uploading, lang } = state;
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [all, setAll] = useState(false);
  // the family film card of an empty project chooses files first; once they are all in, the film dialog opens on them
  const filmIntent = useRef(false);
  const [filmNext, setFilmNext] = useState(false);
  useEffect(() => {
    if (!filmNext || !doc || uploading) return;
    const src = sourceFromSelection(doc, []);
    if (!src.assetIds.length) return;
    setFilmNext(false);
    editor.openFilm(src);
  }, [filmNext, uploading, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => {
    setOffline(false);
    api.listProjectsFull().then((r) => setProjects(r.projects)).catch(() => { setOffline(true); setProjects([]); });
    templateApi.list().then((r) => setTemplates(r.templates.filter((x) => x.available))).catch(() => setTemplates([]));
  };
  const empty = !!doc && Object.keys(doc.assets).length === 0 && Object.values(doc.sequences).every((s) => s.tracks.every((t) => t.clips.length === 0));
  useEffect(() => { if (empty) load(); }, [empty, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc || !empty || hubSetAside) return null;
  const s = WELCOME_STRINGS[lang];
  const C = CHROME_STRINGS[lang];
  const take = (files: File[]) => { if (files.length) void editor.importFiles(files); }; // the import queue takes files one after another (ADR-0023)
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const others = (projects ?? []).filter((p) => p.id !== doc.id).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 5);
  const setFormat = (w: number, h: number) => { if (doc.settings.width !== w || doc.settings.height !== h) void editor.commit([{ op: 'set_project_format', args: { width: w, height: h } }], 'Project format'); };
  const startFrom = () => { setHubSetAside(true); editor.openTemplates(); };
  return (
    <section className="welcome pf-ds pf-hub" role="region" aria-label={C.hubRegion} data-testid="welcome">
      <div className="pf-hub-inner">
        <header className="pf-hub-hero">
          <h2 className="pf-hub-title"><span>{C.hubTitleA}</span> <em>{C.hubTitleB}</em></h2>
          <p className="pf-hub-lead">{C.hubLead}</p>
        </header>

        <div className={`welcome-drop pf-hub-drop${over ? ' over' : ''}`} data-testid="welcome-drop"
          onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
          onDrop={(e) => { setOver(false); const fs = [...(e.dataTransfer.files ?? [])]; if (!fs.length) return; e.preventDefault(); e.stopPropagation(); take(fs); }}>
          <span className="pf-hub-dropIc" aria-hidden="true"><ImagePlus size={26} strokeWidth={1.5} /></span>
          <span className="pf-hub-dropText"><strong>{C.hubDrop}</strong><span>{C.hubDropSub}</span></span>
          <button type="button" className="pf-btn pf-btn-primary pf-btn-lg" aria-busy={uploading || undefined} data-testid="welcome-import" onClick={() => { filmIntent.current = false; inputRef.current?.click(); }}>
            <ArrowUpFromLine size={18} strokeWidth={1.75} aria-hidden="true" /><span className="pf-btn-label">{uploading ? C.hubUploading : C.hubPick}</span>
          </button>
          {/* the phone drop (ADR-0023): the owner's own session only, since a code is the owner's to issue */}
          {state.actor === 'user:local' && (
            <button type="button" className="pf-btn pf-btn-secondary pf-btn-lg" data-testid="welcome-phone" onClick={() => editor.openPhoneDrop()}>
              <Smartphone size={18} strokeWidth={1.75} aria-hidden="true" /><span className="pf-btn-label">{PHONE_WORD[lang]}</span>
            </button>
          )}
          <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden tabIndex={-1} data-testid="welcome-input"
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length && filmIntent.current) setFilmNext(true); filmIntent.current = false; take(fs); }} />
        </div>

        {/* life line: files of this day of an earlier year; absent when there are none or this is not the owner's session; «פתיחה» opens that project with the event in view */}
        <OnThisDayCard onOpen={(projectId, assetId) => { location.assign(`/?project=${encodeURIComponent(projectId)}#life-asset=${encodeURIComponent(assetId)}`); }} />

        <div className="pf-hub-cols">
          <section className="pf-hub-sec" aria-labelledby="pf-hub-fmt">
            <h3 id="pf-hub-fmt" className="pf-hub-h">{C.hubFormats}</h3>
            <div className="pf-hub-formats" role="radiogroup" aria-label={C.hubFormats}>
              {FORMATS.map((f) => {
                const on = doc.settings.width === f.w && doc.settings.height === f.h;
                return (
                  <button key={f.id} type="button" role="radio" aria-checked={on} className={`pf-hub-fmt${on ? ' is-on' : ''}`} data-testid={`hub-format-${f.id}`} onClick={() => setFormat(f.w, f.h)} aria-label={`${C[f.key]} ${f.ratio}`}>
                    <span className="pf-hub-fmtShape" aria-hidden="true" style={{ aspectRatio: `${f.w} / ${f.h}` }} />
                    <span className="pf-hub-fmtName">{C[f.key]}</span><span className="num pf-hub-fmtRatio" dir="ltr">{f.ratio}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="pf-hub-sec" aria-labelledby="pf-hub-recent">
            <h3 id="pf-hub-recent" className="pf-hub-h">{C.hubRecent}</h3>
            {offline ? (
              <div className="pf-hub-note is-warn" role="alert" data-testid="hub-offline"><span>{C.hubOffline}</span><Button size="sm" variant="secondary" icon={<RotateCw size={14} aria-hidden="true" />} onClick={load}>{C.hubRetry}</Button></div>
            ) : others.length === 0 ? (
              <p className="pf-hub-note" data-testid="hub-recent-empty">{projects ? C.hubRecentEmpty : '…'}</p>
            ) : (
              <ul className="pf-hub-recent">
                {others.map((p) => (
                  <li key={p.id}>
                    <a className="pf-hub-proj" href={`/?project=${encodeURIComponent(p.id)}`} data-testid="hub-project" aria-label={C.hubOpen(p.name)}>
                      <span className="pf-hub-projIc" aria-hidden="true"><FolderOpen size={16} strokeWidth={1.75} /></span>
                      <span className="pf-hub-projName" dir="auto">{p.name}</span>
                      {p.updatedAt && <span className="num pf-hub-projDate" dir="ltr">{new Date(p.updatedAt).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB')}</span>}
                      <ChevronLeft size={14} aria-hidden="true" className="pf-hub-chev" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="pf-hub-more" onClick={() => setAll(true)}>{C.hubMore}…</button>
          </section>
        </div>

        <section className="pf-hub-sec" aria-labelledby="pf-hub-start">
          <div className="pf-hub-hrow"><h3 id="pf-hub-start" className="pf-hub-h">{C.hubStart}</h3>{templates && templates.length > 0 && <span className="pf-hub-sub">{C.hubStartNote}</span>}</div>
          {/* the family film (ADR-0026) beside the moments: in an empty project it asks for the files first */}
          <div className="pf-hub-film"><FamilyFilmEntry variant="start-hub" source={null} lang={lang} onEmpty={() => { filmIntent.current = true; inputRef.current?.click(); }} /><StoryEntry variant="start-hub" source={null} lang={lang} /></div>
          {templates && templates.length > 0 && (
            <ul className="pf-hub-cards">
              {templates.slice(0, 6).map((tp) => (
                <li key={tp.id}>
                  <button type="button" className="pf-hub-card" onClick={startFrom} data-template-id={tp.id} data-testid="hub-template">
                    <span className="pf-hub-skel" aria-hidden="true">{tp.slots.slice(0, 7).map((sl, i) => <i key={sl.key} style={{ flexGrow: 1 + ((i * 5 + tp.slots.length) % 3) }} data-kind={sl.accept} />)}</span>
                    <span className="pf-hub-cardName">{tp.name[lang]}</span>
                    <span className="pf-hub-cardMeta"><span className="num" dir="ltr">{Math.round(tp.seconds)}</span> {lang === 'he' ? 'ש׳' : 's'} · <span className="num">{tp.slots.length}</span> {lang === 'he' ? 'קליפים' : 'clips'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="pf-hub-foot">
          <button type="button" className="welcome-template pf-hub-ghost" data-testid={TEMPLATE_TESTIDS.welcomeTemplate} aria-describedby="welcome-template-hint" onClick={startFrom}><Plus size={14} aria-hidden="true" /> {s.s4}</button>
          <span id="welcome-template-hint" className="pf-hub-sub">{s.s4Hint}</span>
          <button type="button" className="pf-hub-ghost" onClick={() => setHubSetAside(true)} data-testid="hub-continue">{C.hubContinue}</button>
        </footer>
      </div>
      {all && <ProjectsDialog onClose={() => setAll(false)} />}
    </section>
  );
}
