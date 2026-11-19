/**
 * The mounts of the content packs, the built-in music and the fonts in the browser drawer (ADR-0022; docs/design/UX_REDESIGN.md
 * §4.4). Nothing here reaches into the components it mounts:
 * - PacksSection: the Templates drawer's first section «חבילות» (PacksShelf), and a pack's page (PackPage) when a pack is opened.
 *   A pack is reachable in two clicks from an open project: the rail's Templates, then the pack's tile. A pack's template opens
 *   the template dialog of the drawer (TemplateDialog), and what it applies is the drawer's own post-apply bar's business.
 *   The catalogue of packs is core's own (PACKS), the same data GET /api/v1/packs lists; the day for suggestions is the viewer's
 *   local day; a birthday pack is suggested from the owner's people on the owner's own screen.
 * - MusicTab: the audio drawer's second tab «מוזיקה מובנית» (MusicBrowser). The routes it calls (/music, /music/:styleId/audio,
 *   POST /projects/:id/music) are the server's; a refusal or a missing route is MusicBrowser's own honest state.
 * - FontsSection: the Text drawer's «גופנים» (FontPicker) for the title selected on the timeline; disabled, with the reason, until one is.
 * Every edit is an operation through Editor.commit (or the pack page's own routes); nothing is kept in browser storage here.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { PACKS, summarizePack, type TemplateSummary } from '@pulseframe/core';
import { Button } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { editEnd } from '../commands.ts';
import { FontPicker } from '../FontPicker.tsx';
import { MusicBrowser } from '../MusicBrowser.tsx';
import { PackPage } from '../PackPage.tsx';
import { PacksShelf } from '../PacksShelf.tsx';
import { TemplateDialog, type AppliedTemplate } from '../TemplateDialog.tsx';
import { templateApi } from '../templateDialog.logic.ts';
import { templateRefusal } from '../templateRefusals.ts';
import { PACKS_MOUNT_STRINGS, type PacksMountKey } from './packs.mount.strings.ts';
import { birthdayHints, fitSecondsOf, localGDate } from './packsMount.logic.ts';
import { fill } from './lifeline.strings.ts';

const words = (lang: 'he' | 'en') => (k: PacksMountKey): string => PACKS_MOUNT_STRINGS[lang][k];
const SUMMARIES = PACKS.map(summarizePack);

export function PacksSection(): ReactElement | null {
  const { editor, state } = useEditorState();
  const doc = state.doc;
  const lang = state.lang;
  const w = words(lang);
  const [open, setOpen] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TemplateSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const today = useMemo(() => localGDate(new Date()), []);
  const hints = useMemo(() => birthdayHints(doc, today), [doc?.people, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => { setFailed(null); templateApi.list().then((r) => setTemplates(r.templates)).catch((e) => { const f = templateRefusal(lang, e); setFailed(f.hint ? `${f.message} — ${f.hint}` : f.message); }); };
  // the list of templates is read when a pack is first opened (a pack's template card needs its summary)
  useEffect(() => { if (open && !templates && !failed) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc) return <p className="pf-bw-lead" role="status">{w('packsNeedProject')}</p>;
  const pack = open ? SUMMARIES.find((p) => p.id === open) ?? null : null;
  const applied = (s: TemplateSummary, a: AppliedTemplate) => {
    setDialog(null);
    editor.setTemplateRun({ runId: a.result.runId, templateId: s.id, name: s.name, params: a.params, alternatives: a.alternatives, created: a.result.createdIds.length, revision: a.result.revision });
  };
  return (
    <div className="pf-packs-mount" data-testid="packs-mount">
      {pack ? (
        <>
          <PackPage pack={pack} projectId={doc.id} lang={lang} onBack={() => { setOpen(null); setMissing(false); }}
            onOpenTemplate={(id) => { const s = templates?.find((x) => x.id === id); if (s && s.available) { setMissing(false); setDialog(s); } else setMissing(true); }} />
          {missing && <p className="pf-bw-lead" role="status">{w('templateMissing')}</p>}
          {failed && <p className="pf-bw-lead danger" role="alert">{fill(w('templatesFailed'), { why: failed })} <Button size="sm" variant="ghost" onClick={load}>{w('retry')}</Button></p>}
          {!templates && !failed && <p className="pf-bw-lead" role="status">{w('templatesLoading')}</p>}
          {dialog && <TemplateDialog summary={dialog} onClose={() => setDialog(null)} onApplied={(a) => applied(dialog, a)} />}
        </>
      ) : (
        <PacksShelf packs={SUMMARIES} today={today} hints={hints} lang={lang} onOpen={setOpen} />
      )}
    </div>
  );
}

/** The built-in music of the audio drawer's second tab. */
export function MusicTab(): ReactElement | null {
  const { state } = useEditorState();
  const w = words(state.lang);
  const doc = state.doc;
  if (!doc) return <p className="pf-bw-lead" role="status">{w('musicNeedProject')}</p>;
  return <MusicBrowser projectId={doc.id} lang={state.lang} fitSeconds={fitSecondsOf(editEnd(doc))} />;
}

/** The fonts of the Text drawer: the picker for the selected title, one update_text per choice. */
export function FontsSection(): ReactElement {
  const { editor, state } = useEditorState();
  const w = words(state.lang);
  const sel = editor.selected?.clip;
  const title = sel && sel.type === 'text' ? sel : null;
  return (
    <section className="pf-fonts-mount" aria-label={w('fontsTitle')} data-testid="fonts-mount">
      <h3 className="pf-bw-title">{w('fontsTitle')}</h3>
      <p className="pf-bw-lead">{title ? w('fontsLead') : w('fontsNeedTitle')}</p>
      <FontPicker label={w('fontsTitle')} lang={state.lang} disabled={!title} value={{ family: title?.style.fontFamily ?? 'Heebo', weight: title?.style.fontWeight ?? 700 }}
        onChange={(f) => { if (title) void editor.commit([{ op: 'update_text', args: { clipId: title.id, style: { fontFamily: f.family, fontWeight: f.weight } } }], 'Font'); }} />
    </section>
  );
}
