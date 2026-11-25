/**
 * «הדבקת מאפיינים» (Ctrl+Alt+V): a modal (design-system Dialog: focus kept inside, Escape closes, focus returns). The source is the
 * first live clip of the clipboard, named at the top; one checkbox per group with a line of what it would do on the selected
 * clips («11 קליפים · 1 ידולג: …»); a group the source lacks is disabled with the reason. The rows below are the commit's own
 * routine run on a copy (core planPasteAttributes), so they equal what Enter applies and skips. Enter pastes in ONE transaction
 * at the revision the rows were made from (commitExact); a project that moved says «הפרויקט השתנה — בדקו שוב» and plans again.
 * Ticks are remembered per browser.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ATTRIBUTE_GROUPS, findClip, type AttributeGroup } from '@pulseframe/core';
import { Dialog } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { clipLabel } from '../Timeline.tsx';
import { CRAFT_TESTIDS as TID } from './craft.testids.ts';
import { craftSurface } from './craft.state.ts';
import { groupName, pasteGroupRows, pastePlanOf, pasteOps, pasteTargets, readTicks, say, skipReason, writeTicks, type Failure } from './craft.logic.ts';

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export function PasteAttributesDialog() {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const doc = state.doc;
  const [ticks, setTicks] = useState<AttributeGroup[]>(() => readTicks());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [stale, setStale] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const close = () => craftSurface.set(null);
  const sourceId = editor.clipboardLive[0] ?? null;
  const sel = state.selection;
  const { targets, leftOut } = useMemo(() => (sourceId ? pasteTargets(sel, sourceId) : { targets: [], leftOut: false }), [sel, sourceId]);
  const groups = useMemo(() => (doc && sourceId && targets.length ? pasteGroupRows(doc, sourceId, targets, lang) : []), [doc, sourceId, targets, lang]);
  const effective = ticks.filter((g) => !groups.find((r) => r.group === g)?.disabled);
  const plan = useMemo(() => (doc && sourceId ? pastePlanOf(doc, sourceId, targets, effective) : null), [doc, sourceId, targets, effective.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc) return null;
  const source = sourceId ? findClip(doc, sourceId)?.clip : undefined;
  const label = (id: string) => { const c = findClip(doc, id)?.clip; const t = c ? clipLabel(doc, c, lang).replace(/\s+/g, ' ').trim() : id; return t.length > 40 ? `${t.slice(0, 39)}…` : t || id; };
  const tooMany = targets.length > 200;
  const applies = !!plan && plan.applied.length > 0 && !tooMany;
  const toggle = (g: AttributeGroup) => { const next = ticks.includes(g) ? ticks.filter((x) => x !== g) : [...ticks, g]; setTicks(next); writeTicks(next); setStale(false); setFailure(null); };
  const apply = async () => {
    if (!applies || busy || !sourceId) return;
    setBusy(true); setFailure(null); setStale(false);
    const ops = pasteOps(sourceId, targets, effective);
    const r = await editor.commitExact(ops, 'Paste attributes', state.revision, `craft:paste:${state.revision}:${hash(JSON.stringify(ops))}`);
    setBusy(false);
    if (r.kind === 'committed') {
      const out = r.result.results[0]?.output as { applied?: unknown[]; skipped?: unknown[] } | undefined;
      const clips = new Set((out?.applied as { clipId: string }[] | undefined)?.map((a) => a.clipId)).size;
      const skipped = out?.skipped?.length ?? 0;
      craftSurface.set(null);
      editor.notify({ kind: r.result.transactionId ? 'undo' : 'info', title: say(lang, 'pasteDone', { n: clips }), ...(skipped ? { body: say(lang, 'pasteDoneSkips', { n: skipped }) } : {}), ...(r.result.transactionId ? { undoes: r.result.transactionId } : {}) });
    } else if (r.kind === 'stale') setStale(true);
    else setFailure({ code: r.code, message: r.message });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void apply(); }
  };
  const nothing = !sourceId || !source ? say(lang, 'pasteNoSource') : !targets.length ? say(lang, 'pasteNoTargets') : null;
  return (
    <Dialog open onClose={close} title={say(lang, 'pasteTitle')} size="md" closeLabel={say(lang, 'close')} testId={TID.pasteDialog}
      footer={<>
        <button type="button" className="ghost" onClick={close}>{say(lang, 'cancel')}</button>
        <button type="button" className="primary" data-testid={TID.pasteApply} disabled={!applies || busy} aria-busy={busy || undefined} onClick={() => void apply()}>{say(lang, 'pasteApply')}</button>
      </>}>
      <div ref={body} dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} onKeyDown={onKey} className="pf-craft-versions">
        {nothing ? <p role="status" data-testid="craft-paste-empty">{nothing}</p> : (
          <>
            <p data-testid={TID.pasteSource}>{say(lang, 'pasteFrom')}<bdi dir="auto"><strong>{label(sourceId!)}</strong></bdi> · {targets.length}</p>
            {leftOut && <p className="pf-craft-hint">{say(lang, 'pasteSourceLeftOut')}</p>}
            {tooMany && <p role="alert" className="pf-craft-error">{say(lang, 'pasteTooMany')}</p>}
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend>{say(lang, 'pasteGroupsLabel')}</legend>
              <ul className="pf-craft-groups">
                {ATTRIBUTE_GROUPS.map((g) => {
                  const row = groups.find((r) => r.group === g);
                  const off = row?.disabled ?? true;
                  const id = `pg-${g}`;
                  return (
                    <li key={g}>
                      <label htmlFor={id}>
                        <input id={id} type="checkbox" checked={!off && ticks.includes(g)} disabled={off} aria-describedby={`${id}-d`} data-testid={`craft-paste-group-${g}`} data-ok={row?.ok ?? 0} data-skipped={row?.skipped ?? 0} onChange={() => toggle(g)} />
                        <span><strong>{groupName(lang, g)}</strong><span className="why" id={`${id}-d`}>{row?.line ?? ''}</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            {!effective.length && <p className="pf-craft-hint" role="status">{say(lang, 'pasteNothingTicked')}</p>}
            {effective.length > 0 && plan && !plan.applied.length && <p role="status" className="pf-craft-error" data-testid="craft-paste-none">{say(lang, 'pasteNothingApplies')}</p>}
            {plan && plan.keysLeftOut > 0 && <p className="pf-craft-hint">{say(lang, 'pasteKeysLeft', { n: plan.keysLeftOut })}</p>}
            {plan && (plan.applied.length > 0 || plan.skipped.length > 0) && (
              <>
                <h3 style={{ margin: 0, fontSize: 13 }} id="pf-paste-rows">{say(lang, 'pasteRowsLabel')}</h3>
                <ul className="pf-craft-rows" aria-labelledby="pf-paste-rows" data-testid={TID.pasteRows} data-applied={plan.applied.length} data-skipped={plan.skipped.length}>
                  {plan.applied.map((a) => <li key={`a-${a.clipId}-${a.group}`} data-skipped="false" data-clip={a.clipId} data-group={a.group}><bdi dir="auto">{label(a.clipId)}</bdi> · {groupName(lang, a.group)}: {say(lang, 'pasteRowApplied')}</li>)}
                  {plan.skipped.map((s) => <li key={`s-${s.clipId}-${s.group}`} data-skipped="true" data-code={s.code} data-clip={s.clipId} data-group={s.group}><bdi dir="auto">{label(s.clipId)}</bdi> · {groupName(lang, s.group)}: {say(lang, 'pasteSkipped')} — {skipReason(lang, s.code, s.message)}</li>)}
                </ul>
              </>
            )}
          </>
        )}
        {stale && <p role="alert" className="pf-craft-error" data-testid="craft-paste-stale">{say(lang, 'projectChanged')}</p>}
        {failure && <p role="alert" className="pf-craft-error" data-code={failure.code ?? undefined}><bdi dir="auto">{failure.message}</bdi></p>}
      </div>
    </Dialog>
  );
}
