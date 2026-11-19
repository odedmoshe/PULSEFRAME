/**
 * The bar's session: the Enter gate (a plan whose preview was not rendered is not committed), the idempotency key from the plan
 * hash, the strict commit at the plan's revision, the re-plan on 409, the actions, the nearest commands, the live region (only a
 * kind or intent change speaks, debounced), remembered intents (ids only). The editor port and the grammar are labelled stand-ins.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyTransaction, barIdempotencyKey, barPlanHash, createProject, type BarActionResult, type BarContext, type BarPlan, type BarResult, type OpCall } from '@pulseframe/core';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const U = await import('./useBarResult.ts');
const { BAR_KEYS } = await import('./commandBar.testids.ts');
const { barText } = await import('./commandBar.strings.ts');

const R = { num: 30, den: 1 };
const doc = applyTransaction(createProject({ id: 'prj_b', name: 'B', width: 1920, height: 1080, frameRate: R }), [], { idSeed: 'b_', actor: 't' }).doc;
const ctx = (revision = 7): BarContext => ({ doc, rawDoc: doc, activeSequenceId: doc.mainSequenceId, revision, selection: [], playheadFrame: 0, cutClipId: null, workspace: 'pro', performRecording: false, viewVariantId: null, lang: 'he', undoTarget: null, redoTarget: null, inject: (c) => c });

const ops: OpCall[] = [{ op: 'close_gaps', args: {} }];
const planAt = (rev: number): BarPlan => ({ kind: 'plan', intent: 'close_gaps', tokens: [], readings: [{ role: 'verb', span: [0, 4], value: null }], ops, steps: [{ op: 'close_gaps', detail: { kind: 'plain' } }], notes: [], label: 'Command bar: close_gaps', basisRevision: rev, planHash: barPlanHash('close_gaps', ops, rev) });
const action: BarActionResult = { kind: 'action', intent: 'export_to', tokens: [], readings: [], action: { kind: 'export_sheet', destination: 'whatsapp' }, notes: [] };

type Calls = { commit: unknown[][]; actions: string[]; closed: number; notices: unknown[]; commands: string[] };
function make(answer: (q: string, c: BarContext) => BarResult, commit: () => Promise<any>, rev = { n: 7 }) {
  const calls: Calls = { commit: [], actions: [], closed: 0, notices: [], commands: [] };
  const port: import('./useBarResult.ts').BarPort = {
    context: () => ctx(rev.n),
    commitExact: async (o, label, r, key) => { calls.commit.push([o, label, r, key]); return commit(); },
    undoTransaction: async (id) => { calls.actions.push(`undo:${id}`); }, redoTransaction: async (id) => { calls.actions.push(`redo:${id}`); },
    setWorkspace: (w) => calls.actions.push(`ws:${w}`), openExportSheet: (d) => calls.actions.push(`export:${d}`), seek: (f) => calls.actions.push(`seek:${f}`),
    play: () => calls.actions.push('play'), pause: () => calls.actions.push('pause'), selectAll: () => calls.actions.push('all'), deselect: () => calls.actions.push('none'),
    setLang: (l) => calls.actions.push(`lang:${l}`), runCommand: (id) => calls.commands.push(id), notify: (n) => calls.notices.push(n),
  };
  const session = new U.BarSession(port, { lang: 'he', close: () => { calls.closed++; } }, undefined, {});
  session.interpret = answer;
  const show = (q: string) => { session.currentQuery = q; session.setView(U.viewOf(q, port.context(), answer)); };
  return { calls, session, show, port };
}
const committed = (id: string | null = 'tx_9') => async () => ({ kind: 'committed' as const, replayed: false, result: { revision: 8, committed: true, transactionId: id, summary: '', affectedIds: [], results: [] } });

describe('the Enter gate', () => {
  it('a plan whose preview was not rendered is not committed; the next Enter, after the render, commits once', async () => {
    const { calls, session, show } = make(() => planAt(7), committed());
    show('סגור רווחים');
    expect(await session.activate(BAR_KEYS.result)).toBe('not_rendered');
    expect(calls.commit).toHaveLength(0);
    session.markRendered(session.view.entries[0]!.target);
    expect(await session.activate(BAR_KEYS.result)).toBe('committed');
    expect(calls.commit).toHaveLength(1);
    expect(calls.closed).toBe(1);
  });
  it('a preview of another plan does not unlock this one', async () => {
    const { calls, session, show } = make(() => planAt(7), committed());
    show('x');
    session.markRendered(planAt(6));
    expect(await session.activate(BAR_KEYS.result)).toBe('not_rendered');
    expect(calls.commit).toHaveLength(0);
  });
  it('an answer for older text (a large document still planning) is not acted on', async () => {
    const { calls, session, show } = make(() => planAt(7), committed());
    show('a');
    session.markRendered(session.view.entries[0]!.target);
    session.currentQuery = 'ab';
    expect(await session.activate(BAR_KEYS.result)).toBe('blocked');
    expect(calls.commit).toHaveLength(0);
  });
  it('a second Enter while the commit is running does nothing', async () => {
    let release!: (v: unknown) => void;
    const slow = () => new Promise((r) => { release = r; }) as Promise<any>;
    const { calls, session, show } = make(() => planAt(7), slow);
    show('x'); session.markRendered(session.view.entries[0]!.target);
    const first = session.activate(BAR_KEYS.result);
    expect(await session.activate(BAR_KEYS.result)).toBe('blocked');
    release(await committed()());
    expect(await first).toBe('committed');
    expect(calls.commit).toHaveLength(1);
  });
  it('rows that only talk (ambiguous question, incomplete, refused, unknown) run nothing', async () => {
    for (const r of [{ kind: 'incomplete', intent: 'add_title', tokens: [], readings: [], missing: ['text'], example: { he: 'a', en: 'b' } }, { kind: 'refused', intent: 'split_here', tokens: [], readings: [], code: 'nothing_selected' }, { kind: 'unknown', tokens: [], readings: [], unread: [[0, 1]], partial: [] }] as BarResult[]) {
      const { calls, session, show } = make(() => r, committed());
      show('x'); session.markRendered(null);
      expect(await session.activate(BAR_KEYS.result)).toBe('nothing');
      expect(calls.commit).toHaveLength(0); expect(calls.closed).toBe(0);
    }
  });
});

describe('the strict commit', () => {
  it('sends exactly the plan\'s ops, label and basis revision, with the key from the plan hash; remembers only the intent', async () => {
    const store = new Map<string, string>();
    const { calls, session, show } = make(() => planAt(7), committed());
    show('סגור רווחים'); session.markRendered(session.view.entries[0]!.target);
    await session.activate(BAR_KEYS.result);
    const p = planAt(7);
    expect(calls.commit[0]).toEqual([ops, 'Command bar: close_gaps', 7, barIdempotencyKey(p.planHash)]);
    expect(calls.commit[0]![3]).toBe(`bar:${p.planHash}`);
    expect(JSON.stringify(calls.commit)).not.toContain('סגור');
    U.rememberIntent('close_gaps', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } });
    expect(JSON.parse([...store.values()][0]!)).toEqual({ recent: ['close_gaps'] });
  });
  it('the live region and an undo toast name exactly the transaction that was made', async () => {
    const { calls, session, show } = make(() => planAt(7), committed('tx_42'));
    show('x'); session.markRendered(session.view.entries[0]!.target);
    await session.activate(BAR_KEYS.result);
    expect(calls.notices[0]).toMatchObject({ kind: 'undo', undoes: 'tx_42' });
    expect(session.live.text).toMatch(/^בוצע: .*Ctrl\+Z לביטול$/);
  });
  it('a refusal stays open, says why with the next step, and applied nothing', async () => {
    const { calls, session, show } = make(() => planAt(7), async () => ({ kind: 'failed', code: 'overlap', message: 'no room' }));
    show('x'); session.markRendered(session.view.entries[0]!.target);
    expect(await session.activate(BAR_KEYS.result)).toBe('failed');
    // Hebrew interface: the code's Hebrew headline and the bar's Hebrew next step; the English message is not shown
    expect(session.failure).toEqual({ code: 'overlap', reason: 'אין מקום פנוי ברצועה', next: barText('he', 'fail.hint'), untranslated: null });
    expect(session.live.text).toContain('אין מקום פנוי ברצועה');
    expect(session.live.text).not.toContain('no room');
    expect(calls.closed).toBe(0);
  });
});

describe('the re-plan on 409', () => {
  it('keeps the mark of a re-planned preview that was rendered before the commit resumed, so Enter commits it', async () => {
    const rev = { n: 7 };
    let n = 0;
    const ref: { show?: (q: string) => void; session?: ReturnType<typeof make>['session'] } = {};
    const ok = committed();
    const { session, show } = make((_q, c) => planAt(c.revision), async () => {
      if (n++) return ok();
      rev.n = 9;
      // the store reload re-plans and the palette renders and marks the new preview before commitExact returns
      ref.show!('x'); ref.session!.markRendered(ref.session!.view.entries[0]!.target);
      return { kind: 'stale', currentRevision: 9 };
    }, rev);
    ref.show = show; ref.session = session;
    show('x'); session.markRendered(session.view.entries[0]!.target);
    expect(await session.activate(BAR_KEYS.result)).toBe('stale');
    expect(session.rendered).not.toBeNull();
    expect(await session.activate(BAR_KEYS.result)).toBe('committed');
  });
  it('a refusal worded in Hebrew is shown in Hebrew only (its sentence carries the next step); the server hint is not shown', async () => {
    const { session, show } = make(() => planAt(7), async () => ({ kind: 'failed', code: 'track_locked', message: 'track trk_a is locked', hint: 'Unlock the track.' }));
    show('x'); session.markRendered(session.view.entries[0]!.target);
    await session.activate(BAR_KEYS.result);
    expect(session.failure).toEqual({ code: 'track_locked', reason: 'הרצועה נעולה; יש לבטל את הנעילה כדי לערוך בה', next: null, untranslated: null });
  });
  it('a refusal with no Hebrew wording at all shows the server\'s English words marked as not translated, beside a Hebrew next step', async () => {
    const { session, show } = make(() => planAt(7), async () => ({ kind: 'failed', code: 'some_new_code', message: 'no room', hint: 'move the clip' }));
    show('x'); session.markRendered(session.view.entries[0]!.target);
    await session.activate(BAR_KEYS.result);
    expect(session.failure).toEqual({ code: 'some_new_code', reason: 'הפעולה נכשלה', next: barText('he', 'fail.hint'), untranslated: { message: 'no room', hint: 'move the clip' } });
    expect(session.live.text).toContain('לא תורגם');
  });

  it('plans again on the new revision, shows «הפרויקט השתנה — בדקו שוב», keeps the palette open and commits nothing more', async () => {
    const rev = { n: 7 };
    const { calls, session, show } = make((_q, c) => planAt(c.revision), async () => { rev.n = 9; return { kind: 'stale', currentRevision: 9 }; }, rev);
    show('x'); session.markRendered(session.view.entries[0]!.target);
    const before = (session.view.result as BarPlan).planHash;
    expect(await session.activate(BAR_KEYS.result)).toBe('stale');
    expect(session.stale).toBe(true);
    expect((session.view.result as BarPlan).basisRevision).toBe(9);
    expect((session.view.result as BarPlan).planHash).not.toBe(before);
    expect(session.live.text).toBe('הפרויקט השתנה — בדקו שוב');
    expect(calls.closed).toBe(0);
    // the new plan needs its own render before it can be committed
    expect(await session.activate(BAR_KEYS.result)).toBe('not_rendered');
    expect(calls.commit).toHaveLength(1);
  });
  it('typing again clears the stale line', async () => {
    const { session, show } = make((_q, c) => planAt(c.revision), async () => ({ kind: 'stale', currentRevision: 8 }));
    show('x'); session.markRendered(session.view.entries[0]!.target);
    await session.activate(BAR_KEYS.result);
    expect(session.stale).toBe(true);
    show('xy');
    expect(session.stale).toBe(false);
  });
});

describe('actions', () => {
  it('an action runs on the editor, changes no project and closes the palette', async () => {
    const { calls, session, show } = make(() => action, committed());
    show('ייצא לוואטסאפ'); session.markRendered(action);
    expect(await session.activate(BAR_KEYS.result)).toBe('action');
    expect(calls.actions).toEqual(['export:whatsapp']);
    expect(calls.commit).toHaveLength(0);
    expect(calls.closed).toBe(1);
  });
  it('each action kind reaches its editor call', async () => {
    const kinds: [BarActionResult['action'], string][] = [
      [{ kind: 'undo', transactionId: 'tx_a', ops: [] }, 'undo:tx_a'], [{ kind: 'redo', transactionId: 'tx_b', ops: [] }, 'redo:tx_b'], [{ kind: 'workspace', workspace: 'sound' }, 'ws:sound'],
      [{ kind: 'seek', frame: 9 }, 'seek:9'], [{ kind: 'play' }, 'play'], [{ kind: 'pause' }, 'pause'], [{ kind: 'select_all' }, 'all'], [{ kind: 'deselect' }, 'none'], [{ kind: 'language', to: 'en' }, 'lang:en'],
    ];
    for (const [a, seen] of kinds) {
      const r: BarActionResult = { ...action, action: a };
      const { calls, session, show } = make(() => r, committed());
      show('q'); session.markRendered(r);
      await session.activate(BAR_KEYS.result);
      expect(calls.actions).toEqual([seen]);
    }
  });
  it('commands, zoom and recipes run a registry command by id after the palette closed', async () => {
    vi.useFakeTimers();
    for (const [a, id] of [[{ kind: 'command', commandId: 'view.openTemplates' }, 'view.openTemplates'], [{ kind: 'zoom', dir: -1 }, 'view.zoomOut'], [{ kind: 'recipe', recipeId: 'beat-montage' }, 'view.openTemplates']] as [BarActionResult['action'], string][]) {
      const r: BarActionResult = { ...action, action: a };
      const { calls, session, show } = make(() => r, committed());
      show('q'); session.markRendered(r);
      await session.activate(BAR_KEYS.result);
      vi.runAllTimers();
      expect(calls.commands).toEqual([id]);
      expect(calls.closed).toBe(1);
    }
    vi.useRealTimers();
  });
});

describe('rows of a request', () => {
  it('an ambiguous request gives the question row and one row per choice, each choice with its own plan', async () => {
    const amb: BarResult = { kind: 'ambiguous', intent: 'sync_beat', tokens: [], readings: [], question: { he: 'מה?', en: 'What?' }, choices: [{ he: 'א', en: 'a', result: planAt(7) }, { he: 'ב', en: 'b', result: action }] };
    const { calls, session, show } = make(() => amb, committed());
    show('סנכרן לקצב');
    expect(session.view.entries.map((e) => e.key)).toEqual(['bar', 'bar-choice-0', 'bar-choice-1']);
    expect(await session.activate('bar')).toBe('nothing');
    session.markRendered(session.view.entries[1]!.target);
    expect(await session.activate('bar-choice-0')).toBe('committed');
    expect(calls.commit).toHaveLength(1);
  });
  it('an unknown request offers at most 5 nearest commands that exist, running one runs that command', async () => {
    vi.useFakeTimers();
    const unk: BarResult = { kind: 'unknown', tokens: [], readings: [], unread: [[0, 3]], partial: ['split_here', 'undo', 'play'] };
    const { calls, session, show } = make(() => unk, committed());
    show('split');
    const near = session.view.entries.slice(1);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThanOrEqual(5);
    expect(near.map((e) => (e.target as { commandId: string }).commandId)[0]).toBe('edit.split');
    const cmds = near.filter((e) => e.target?.kind === 'nearest');
    expect(new Set(cmds.map((e) => (e.target as { commandId: string }).commandId)).size).toBe(cmds.length);
    // the rest of the five are the partial readings' example sentences (plan §6), never a duplicate
    expect(near.filter((e) => e.target?.kind === 'example').every((e) => ['split_here', 'undo', 'play'].includes((e.target as { intent: string }).intent))).toBe(true);
    session.markRendered(near[0]!.target);
    expect(await session.activate(near[0]!.key)).toBe('action');
    vi.runAllTimers();
    expect(calls.commands).toEqual(['edit.split']);
    vi.useRealTimers();
  });
  it('an empty query or no project shows nothing', () => {
    expect(U.viewOf('  ', ctx(), () => planAt(7)).entries).toEqual([]);
    expect(U.viewOf('x', null, () => planAt(7)).kind).toBeNull();
  });
  it('window.__pfBar.lastPlan is JSON-safe data of the plan shown', () => {
    const win: Record<string, unknown> = {};
    const s = new U.BarSession({} as never, { lang: 'he', close: () => {} }, undefined, win);
    const p = { ...planAt(7), readings: [{ role: 'amount', span: [0, 1], value: { num: 3n, den: 1n } }] } as BarPlan;
    s.markRendered(p);
    expect(JSON.parse(JSON.stringify(win.__pfBar)).lastPlan.planHash).toBe(p.planHash);
    s.markRendered(null);
    expect((win.__pfBar as { lastPlan: unknown }).lastPlan).toBeNull();
  });
  it('the hook also carries the plan\'s context without the documents (the proof rebuilds it in Node)', () => {
    const win: Record<string, unknown> = {};
    const s = new U.BarSession({ context: () => ({ ...ctx(7), selection: ['clp_a'], playheadFrame: 42 }) } as never, { lang: 'he', close: () => {} }, undefined, win);
    s.markRendered(planAt(7));
    const hook = JSON.parse(JSON.stringify(win.__pfBar)) as { context: Record<string, unknown> };
    expect(hook.context).toMatchObject({ revision: 7, selection: ['clp_a'], playheadFrame: 42, lang: 'he' });
    expect(Object.keys(hook.context)).not.toContain('doc');
    expect(Object.keys(hook.context)).not.toContain('rawDoc');
  });
  it('when no nearer command exists, an example sentence is offered (partial readings, else common ones); Enter on it only fills the input', async () => {
    const none = U.entriesOf({ kind: 'unknown', tokens: [], readings: [], unread: [[0, 9]], partial: [] }, 'תעשה שמח');
    const ex = none.slice(1).map((e) => e.target as { kind: string; text: string });
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((t) => t.kind === 'example' && /[א-ת]/.test(t.text))).toBe(true);
    const partial = U.entriesOf({ kind: 'unknown', tokens: [], readings: [], unread: [[6, 9]], partial: ['gain_change'] }, 'הגבר ב־3');
    expect((partial[1]!.target as { kind: string; intent: string }).intent).toBe('gain_change');
    const english = U.entriesOf({ kind: 'unknown', tokens: [], readings: [], unread: [[0, 5]], partial: [] }, 'hello world');
    expect(/[a-z]/i.test((english.slice(1).find((e) => e.target?.kind === 'example')!.target as { text: string }).text)).toBe(true);
    const inc = U.entriesOf({ kind: 'incomplete', intent: 'speed', tokens: [], readings: [], missing: ['amount'], example: { he: 'האט פי 2', en: 'speed 0.5' } }, 'מהירות');
    expect(inc.slice(1).map((e) => (e.target as { text?: string }).text)).toContain('האט פי 2');
    // Enter on an example: nothing committed, nothing closed, the input gets the sentence
    const set: string[] = [];
    const { calls, session, show } = make(() => ({ kind: 'unknown', tokens: [], readings: [], unread: [[0, 3]], partial: [] }), async () => { throw new Error('no commit'); });
    session.host = { ...session.host, setQuery: (q: string) => set.push(q) };
    show('xyz');
    const key = session.view.entries[1]!.key;
    session.markRendered(session.view.entries[1]!.target);
    expect(await session.activate(key)).toBe('nothing');
    expect(set.length).toBe(1);
    expect(calls.commit.length).toBe(0);
    expect(calls.closed).toBe(0);
  });
  it('incomplete, and refused with no choice, offer the command the intent stands beside as a nearest command', () => {
    const inc = U.entriesOf({ kind: 'incomplete', intent: 'add_title', tokens: [], readings: [], missing: ['text'], example: { he: 'x', en: 'x' } }, 'הוסף כותרת');
    expect(inc.slice(1).map((e) => (e.target as { commandId: string }).commandId)[0]).toBe('edit.addText');
    const ref = U.entriesOf({ kind: 'refused', intent: 'split_here', tokens: [], readings: [], code: 'no_clip_here' }, 'פצל כאן');
    expect(ref.slice(1).map((e) => (e.target as { commandId: string }).commandId)[0]).toBe('edit.split');
    expect(ref.length).toBeLessThanOrEqual(6);
  });
});

describe('the live region', () => {
  const view = (r: BarResult, q = 'x') => U.viewOf(q, ctx(), () => r);
  it('changes only when the kind or the intent changes, debounced; typing the same kind is silent', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const live = new U.LiveAnnouncer((t) => seen.push(t), { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as never) });
    live.update(view(planAt(7), 'ס'), 'he');
    live.update(view(planAt(7), 'סג'), 'he');
    live.update(view(planAt(7), 'סגו'), 'he');
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(499); expect(seen).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^הבנתי: .*Enter לביצוע$/);
    live.update(view(planAt(7), 'סגור'), 'he'); vi.advanceTimersByTime(2000);
    expect(seen).toHaveLength(1); // the same kind and intent: nothing new said
    live.update(view({ kind: 'unknown', tokens: [], readings: [], unread: [[0, 1]], partial: [] }), 'he'); vi.advanceTimersByTime(600);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/^לא הבנתי את הבקשה/);
    live.update(view({ ...planAt(7), intent: 'split_here' } as BarPlan), 'he'); vi.advanceTimersByTime(600);
    expect(seen).toHaveLength(3); // another intent of the same kind speaks
    vi.useRealTimers();
  });
  it('a quick change back and forth says only the last; say() speaks at once; the same text is not shouted on every key', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const live = new U.LiveAnnouncer((t) => seen.push(t), { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as never) });
    live.update(view(planAt(7)), 'he');
    live.update(view({ kind: 'unknown', tokens: [], readings: [], unread: [], partial: [] }), 'he');
    vi.advanceTimersByTime(600);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^לא הבנתי את הבקשה/);
    live.say('בוצע');
    expect(seen.at(-1)).toBe('בוצע');
    vi.useRealTimers();
  });
  it('liveKeyOf is the kind and the intent, never the text', () => {
    expect(U.liveKeyOf(view(planAt(7), 'a'))).toBe(U.liveKeyOf(view(planAt(7), 'b')));
    expect(U.liveKeyOf(U.EMPTY_VIEW)).toBeNull();
  });
});

describe('large documents', () => {
  it('counts clips across sequences', () => { expect(U.clipCountOf(doc)).toBe(0); expect(U.clipCountOf(null)).toBe(0); expect(U.LARGE_DOC_DEBOUNCE_MS).toBe(150); });
});
