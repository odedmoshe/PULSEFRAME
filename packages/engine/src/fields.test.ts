/**
 * Live title fields and the capture-sourced date stamp in the one evaluator (life line, ADR-0021, ADR-0005).
 * The claim under test: a title with a field is, to everything downstream of the evaluator, the same title with those words
 * typed by hand. So preview, stills and export cannot disagree, and neither can a time effect that shows another moment.
 * The expected words are typed here, never taken from the code under test.
 *
 * The first group holds with or without the core bodies of the life line. The group marked "core" runs once they are built
 * (LIFE_OPS_BUILT, set by the core worker): until then resolveFields gives the stored text and stampText gives ''.
 * Its documents are built without the life-line operations (a date on the file, the title's mark and an event are written
 * directly), so what is tested is the evaluator and the resolver, not the operations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { LIFE_OPS_BUILT, TEXT_ANIM_IN, applyTransaction, createProject, projectVariant, type Asset, type Capture, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, STAMP_TEXT, type Layer, type TextLayer } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `fl${seed++}_`, actor: 'test', allowInternal });
const file = (n: number, capture?: Capture): Omit<Asset, 'id'> => ({ kind: 'video', name: `clip-${n}.mp4`, contentHash: `sha256:${n.toString(16).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(600, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 18000 }, provenance: { origin: 'fixture', importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' }, ...(capture ? { capture } : {}) });
const out = (r: ReturnType<typeof tx>, i: number, key: string) => r.results[i]!.output![key] as string;
const titleOf = (layers: Layer[], clipId: string) => layers.find((l): l is TextLayer => l.kind === 'text' && l.clipId === clipId);
const stampOf = (layers: Layer[], clipId: string) => { const l = layers.find((x) => 'clipId' in x && x.clipId === clipId); return l && 'effects' in l ? l.effects?.find((e) => e.type === 'stylize.date-stamp') : undefined; };
/** The same document with this title's text replaced; `fields` chooses whether it is a title with fields or plain words. */
function retitled(doc: ProjectDocument, titleId: string, text: string, fields: boolean): ProjectDocument {
  const d = structuredClone(doc);
  for (const t of d.sequences[d.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === titleId && c.type === 'text') { c.text = text; if (fields) c.fields = true; else delete c.fields; }
  return d;
}

// 1 June 2021 is 21 Sivan 5781; 26 December 2024 (daytime) is 25 Kislev 5785. Both are daytime clocks, so the Hebrew day is certain.
const JUNE: Capture = { at: '2021-06-01T10:00:00', utcOffsetMinutes: 180, source: 'container' };
const DECEMBER: Capture = { at: '2024-12-26T10:00:00', utcOffsetMinutes: 120, source: 'container' };
const CUT = 60;
/** Clip A (June 2021) on frames 0–59, clip B (December 2024) on 60–119, each in an event with a typed name; a title on 30–89, across the cut. */
function acrossTheCut(text = 'x') {
  const lib = tx(createProject({ id: 'prj_fl', name: 'FL', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: file(1, JUNE) } }, { op: 'import_asset', args: { asset: file(2, DECEMBER) } }], true);
  const a = out(lib, 0, 'assetId'), b = out(lib, 1, 'assetId');
  const r = tx(lib.doc, [
    { op: 'add_clip', args: { assetId: a, start: f(0), duration: f(CUT), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: b, start: f(CUT), duration: f(60), withLinkedAudio: false } },
    { op: 'add_text', args: { text, start: f(30), duration: f(60) } },
  ]);
  const doc = structuredClone(r.doc);
  const origin = { method: 'manual' as const, gapMinutes: null, createdBy: 'test', edited: true };
  doc.events = { evt_a: { id: 'evt_a', name: 'יום בפארק', afterSunset: null, assetIds: [a], origin }, evt_b: { id: 'evt_b', name: 'חנוכה אצל סבתא', afterSunset: null, assetIds: [b], origin } };
  return { doc, a, b, clipA: out(r, 0, 'clipId'), clipB: out(r, 1, 'clipId'), titleId: out(r, 2, 'clipId') };
}

afterEach(() => vi.unstubAllGlobals());

describe('the render path of live fields (holds before and after the core bodies)', () => {
  it('evaluating a timeline with a field title and a capture-sourced stamp never touches Date or Intl: the one time-zone conversion happened at import', () => {
    const base = acrossTheCut('{date} · {hebrewDate} · {year} · {hebrewYear} · {event} · {date:numeric}');
    const stamped = tx(base.doc, [{ op: 'add_effect', args: { clipId: base.clipA, type: 'stylize.date-stamp', params: { source: 'capture', clock: true } } }, { op: 'add_effect', args: { clipId: base.clipB, type: 'stylize.date-stamp', params: { source: 'capture', dateOrder: 'dmy' } } }]);
    const doc = retitled(stamped.doc, base.titleId, '{date} · {hebrewDate} · {year} · {hebrewYear} · {event} · {date:numeric}', true);
    const RealDate = Date;
    const used: string[] = [];
    const trap = (name: string, real: object) => new Proxy(function () {} as never, {
      construct() { used.push(`new ${name}`); throw new Error(`${name} was constructed on the render path`); },
      apply() { used.push(`${name}()`); throw new Error(`${name} was called on the render path`); },
      get(_t, key) { if (key === Symbol.hasInstance || key === 'prototype') return Reflect.get(real, key); used.push(`${name}.${String(key)}`); throw new Error(`${name}.${String(key)} was read on the render path`); },
    });
    vi.stubGlobal('Date', trap('Date', RealDate));
    vi.stubGlobal('Intl', trap('Intl', Intl));
    let graphs = 0;
    try {
      for (let frame = 0; frame < 120; frame++) { evaluate(doc, f(frame)); graphs++; }
    } finally { vi.unstubAllGlobals(); }
    expect(used).toEqual([]);
    expect(graphs).toBe(120);
    expect(Date).toBe(RealDate);
  });
  it('a title without the mark is drawn as typed even when its text looks like fields and its picture has a date', () => {
    const base = acrossTheCut('{date} {hebrewDate} {{x}}');
    for (const frame of [30, 59, 60, 89]) expect(titleOf(evaluate(base.doc, f(frame)).layers, base.titleId)?.text).toBe('{date} {hebrewDate} {{x}}');
  });
});

describe.runIf(LIFE_OPS_BUILT)('a title with a field is the same title with the words typed by hand (core)', () => {
  // [the field as stored, the words over clip A, the words over clip B]
  const KINDS: [string, string, string][] = [
    ['{date}', '1 ביוני 2021', '26 בדצמבר 2024'],
    ['{date:numeric}', '1.6.2021', '26.12.2024'],
    ['{date:monthYear}', 'יוני 2021', 'דצמבר 2024'],
    ['{year}', '2021', '2024'],
    ['{hebrewDate}', 'כ״א בסיוון תשפ״א', 'כ״ה בכסלו תשפ״ה'],
    ['{hebrewDate:noYear}', 'כ״א בסיוון', 'כ״ה בכסלו'],
    ['{hebrewYear}', 'תשפ״א', 'תשפ״ה'],
    ['{event}', 'יום בפארק', 'חנוכה אצל סבתא'],
  ];
  const wording = (inner: string) => `נועה · ${inner}\nסוף`;

  it('a title with a field and a plain title with the same words give equal text layers on preview-, still- and export-style evaluations', () => {
    const base = acrossTheCut();
    let compared = 0;
    for (const [token, wordsA, wordsB] of KINDS) {
      const field = retitled(base.doc, base.titleId, wording(token), true);
      const plainA = retitled(base.doc, base.titleId, wording(wordsA), false), plainB = retitled(base.doc, base.titleId, wording(wordsB), false);
      const plainAt = (frame: number) => (frame < CUT ? plainA : plainB);
      // still-style: one frame of a snapshot nobody evaluated before (render_frame)
      for (const frame of [30, 45, 59, 60, 75, 89]) {
        const got = evaluate(structuredClone(field), f(frame));
        expect(got, `${token} still ${frame}`).toEqual(evaluate(plainAt(frame), f(frame)));
        expect(titleOf(got.layers, base.titleId)?.text, `${token} still ${frame}`).toBe(wording(frame < CUT ? wordsA : wordsB));
        compared++;
      }
      // preview-style: the editor's own document object, scrubbed back and forth, and at times between two frames
      for (const frame of [89, 30, 60, 59, 61, 44, 60, 59]) {
        expect(evaluate(field, f(frame)), `${token} preview ${frame}`).toEqual(evaluate(plainAt(frame), f(frame)));
        const between = T.add(f(frame), T.rt(1, 90)); // a third of a frame later: still the same frame
        expect(evaluate(field, between), `${token} preview ${frame}+1/3`).toEqual(evaluate(plainAt(frame), between));
        compared += 2;
      }
      // export-style: the snapshot as the render page receives it (serialised and parsed), every frame of the title in order
      const sent = JSON.parse(JSON.stringify(field)) as ProjectDocument, sentA = JSON.parse(JSON.stringify(plainA)) as ProjectDocument, sentB = JSON.parse(JSON.stringify(plainB)) as ProjectDocument;
      for (let frame = 30; frame < 90; frame++) { expect(evaluate(sent, f(frame)), `${token} export ${frame}`).toEqual(evaluate(frame < CUT ? sentA : sentB, f(frame))); compared++; }
    }
    expect(compared).toBe(KINDS.length * (6 + 16 + 60));
  });
  it('outside the title nothing changes, and the title itself differs from its plain twin in its words only', () => {
    const base = acrossTheCut();
    const field = retitled(base.doc, base.titleId, wording('{date}'), true), plain = retitled(base.doc, base.titleId, wording('{date}'), false);
    for (const frame of [0, 29, 90, 119]) expect(evaluate(field, f(frame))).toEqual(evaluate(plain, f(frame)));
    const a = titleOf(evaluate(field, f(40)).layers, base.titleId)!, b = titleOf(evaluate(plain, f(40)).layers, base.titleId)!;
    expect({ ...a, text: '' }).toEqual({ ...b, text: '' });
    expect(a.text).toBe(wording('1 ביוני 2021'));
    expect(b.text).toBe(wording('{date}'));
  });
  it('a title with a letter animation, a look and keyframes: still equal to its plain twin, frame by frame', () => {
    const base = acrossTheCut();
    const dressed = tx(base.doc, [
      { op: 'add_effect', args: { clipId: base.titleId, type: 'stylize.date-stamp', params: { text: "'21 6 1" } } },
      { op: 'set_clip_transform', args: { clipId: base.titleId, transform: { x: 0.1, y: -0.2, scale: 1.3, rotation: 5 } } },
    ]).doc;
    const animated = tx(dressed, [{ op: 'set_text_animation', args: { clipId: base.titleId, animation: { by: 'letter', in: TEXT_ANIM_IN[0], inFrames: 12 } } }]).doc;
    expect(titleOf(evaluate(animated, f(40)).layers, base.titleId)?.animation).toBeDefined();
    for (const doc of [dressed, animated]) {
      const field = retitled(doc, base.titleId, wording('{hebrewDate}'), true);
      for (let frame = 30; frame < 90; frame += 7) expect(evaluate(field, f(frame)), `frame ${frame}`).toEqual(evaluate(retitled(doc, base.titleId, wording(frame < CUT ? 'כ״א בסיוון תשפ״א' : 'כ״ה בכסלו תשפ״ה'), false), f(frame)));
    }
  });
  it('a format\'s own wording resolves the same way on that format\'s projection', () => {
    const base = acrossTheCut();
    const v = tx(retitled(base.doc, base.titleId, 'master {year}', true), [{ op: 'add_variant', args: { name: 'Tall', width: 360, height: 640 } }]);
    const variantId = out(v, 0, 'variantId');
    const withWording = (text: string, fields: boolean) => {
      const d = retitled(v.doc, base.titleId, fields ? 'master {year}' : 'master 2021', fields);
      d.variants![variantId]!.overrides = { ...(d.variants![variantId]!.overrides ?? {}), [base.titleId]: { text } } as never;
      return d;
    };
    const field = projectVariant(withWording('tall {date:numeric}', true), variantId);
    expect(titleOf(evaluate(field, f(40)).layers, base.titleId)?.text).toBe('tall 1.6.2021');
    expect(titleOf(evaluate(field, f(70)).layers, base.titleId)?.text).toBe('tall 26.12.2024');
    expect(evaluate(field, f(40))).toEqual(evaluate(projectVariant(withWording('tall 1.6.2021', false), variantId), f(40)));
    // and the master of the same document keeps its own wording
    expect(titleOf(evaluate(withWording('tall {date:numeric}', true), f(40)).layers, base.titleId)?.text).toBe('master 2021');
  });
  it('words that come out of a field are never read as fields again, and doubled braces are single braces', () => {
    const base = acrossTheCut();
    const doc = retitled(base.doc, base.titleId, '{{ {event} }} {{date}} {event}', true);
    doc.events!.evt_a!.name = '{date} {{x}}';
    expect(titleOf(evaluate(doc, f(40)).layers, base.titleId)?.text).toBe('{ {date} {{x}} } {date} {date} {{x}}');
  });
  it('a field without data is an empty place in the words, never another clip\'s date and never the field\'s name', () => {
    const lib = tx(createProject({ id: 'prj_nd', name: 'ND', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: file(1) } }, { op: 'import_asset', args: { asset: file(2, DECEMBER) } }], true);
    const r = tx(lib.doc, [
      { op: 'add_clip', args: { assetId: out(lib, 0, 'assetId'), start: f(0), duration: f(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: out(lib, 1, 'assetId'), start: f(60), duration: f(60), withLinkedAudio: false } },
      { op: 'add_text', args: { text: 'x', start: f(0), duration: f(120) } },
    ]);
    const doc = retitled(r.doc, out(r, 2, 'clipId'), 'צולם ב־{date} ({hebrewYear})', true);
    for (const frame of [0, 30, 59]) expect(titleOf(evaluate(doc, f(frame)).layers, out(r, 2, 'clipId'))?.text, `frame ${frame}`).toBe('צולם ב־ ()');
    for (const frame of [60, 119]) expect(titleOf(evaluate(doc, f(frame)).layers, out(r, 2, 'clipId'))?.text, `frame ${frame}`).toBe('צולם ב־26 בדצמבר 2024 (תשפ״ה)');
  });
});

describe.runIf(LIFE_OPS_BUILT)('time effects show a title\'s fields as they were at the moment shown (core)', () => {
  const A = 'A 1.6.2021', B = 'A 26.12.2024';
  const withEffect = (type: string, params: Record<string, unknown>) => {
    const base = acrossTheCut();
    const r = tx(retitled(base.doc, base.titleId, 'A {date:numeric}', true), [{ op: 'add_effect', args: { clipId: base.titleId, type, params } }]);
    return { ...base, doc: r.doc };
  };
  it('the stutter and echo paths resolve a title\'s fields at the time they show', () => {
    // stutter, 7 frames a step: the cut (frame 60) falls inside the step that starts at frame 56, so frames 60–62 still show frame 56
    const st = withEffect('time.stutter', { hold: 7 });
    let heldAcross = 0;
    for (let frame = 30; frame < 90; frame++) {
      const layer = titleOf(evaluate(st.doc, f(frame)).layers, st.titleId)!;
      const shown = layer.remap!.shownFrame;
      expect(shown).toBeLessThanOrEqual(frame);
      expect(layer.text, `stutter frame ${frame} shows ${shown}`).toBe(shown < CUT ? A : B);
      if (shown < CUT && frame >= CUT) heldAcross++;
    }
    expect(heldAcross).toBeGreaterThan(0); // the case that matters was met: a frame after the cut that shows the title of before it

    const echo = withEffect('time.echo', { count: 4, delay: 3 });
    let mixed = 0;
    for (let frame = 30; frame < 90; frame++) {
      const layer = titleOf(evaluate(echo.doc, f(frame)).layers, echo.titleId)!;
      expect(layer.text, `echo frame ${frame}`).toBe(frame < CUT ? A : B);
      const taps = layer.time!.taps;
      expect(taps.length).toBe(4);
      for (const tap of taps) {
        const at = T.frameIndexAt(tap.time, R);
        expect(tap.layer.kind === 'text' && tap.layer.text, `echo frame ${frame}, tap at ${at}`).toBe(at < CUT ? A : B);
      }
      if (new Set(taps.map((t) => T.frameIndexAt(t.time, R) < CUT)).size === 2) mixed++;
    }
    expect(mixed).toBeGreaterThan(0); // frames just after the cut draw both dates at once, each tap its own
  });
  it('a stuttered title equals its plain twin at the frame shown (same layer, same remap)', () => {
    const st = withEffect('time.stutter', { hold: 7 });
    for (let frame = 30; frame < 90; frame++) {
      const got = evaluate(st.doc, f(frame));
      const shown = titleOf(got.layers, st.titleId)!.remap!.shownFrame;
      expect(got, `frame ${frame}`).toEqual(evaluate(retitled(st.doc, st.titleId, shown < CUT ? A : B, false), f(frame)));
    }
  });
});

describe.runIf(LIFE_OPS_BUILT)('the date stamp that takes its date from the capture (core)', () => {
  // 25 December 2024, 18:15:30 where it was filmed
  const EVENING: Capture = { at: '2024-12-25T18:15:30', utcOffsetMinutes: 120, source: 'container' };
  function stamped(params: Record<string, unknown>, capture: Capture | undefined = EVENING) {
    const lib = tx(createProject({ id: 'prj_st', name: 'ST', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: file(1, capture) } }], true);
    const r = tx(lib.doc, [{ op: 'add_clip', args: { assetId: out(lib, 0, 'assetId'), start: f(0), duration: f(3600), withLinkedAudio: false } }]);
    const clipId = out(r, 0, 'clipId');
    const e = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'stylize.date-stamp', params: { source: 'capture', ...params } } }]);
    return { doc: e.doc, clipId, effectId: out(e, 0, 'effectId'), assetId: out(lib, 0, 'assetId') };
  }
  const textAt = (doc: ProjectDocument, clipId: string, frame: number) => stampOf(evaluate(doc, f(frame)).layers, clipId)?.params.text;

  it('a capture-sourced stamp shows the capture date of its own file, and of the topmost dated picture under an adjustment clip', () => {
    const own = stamped({});
    expect(textAt(own.doc, own.clipId, 0)).toBe("'24 12 25");
    expect(textAt(own.doc, own.clipId, 3599)).toBe("'24 12 25");
    const dmy = stamped({ dateOrder: 'dmy' });
    expect(textAt(dmy.doc, dmy.clipId, 0)).toBe('25.12.2024');
    expect(textAt(dmy.doc, dmy.clipId, 3599)).toBe('25.12.2024');
    // an adjustment clip over an undated sticker (top) and a dated video (below it): the dated one is read
    const lib = tx(createProject({ id: 'prj_ad', name: 'AD', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: file(1, EVENING) } }, { op: 'import_asset', args: { asset: file(2) } }], true);
    const upper = tx(lib.doc, [{ op: 'add_track', args: { kind: 'video', name: 'V2' } }]);
    const clips = tx(upper.doc, [
      { op: 'add_clip', args: { assetId: out(lib, 0, 'assetId'), trackId: 'trk_video', start: f(0), duration: f(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: out(lib, 1, 'assetId'), trackId: out(upper, 0, 'trackId'), start: f(0), duration: f(120), withLinkedAudio: false } },
    ]);
    const adj = tx(clips.doc, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(120) }, effects: [{ type: 'stylize.date-stamp', params: { source: 'capture' } }] } }]);
    const adjust = (frame: number) => evaluate(adj.doc, f(frame)).layers.find((l) => l.kind === 'adjust' && l.clipId === out(adj, 0, 'clipId'));
    const stampText = (frame: number) => { const l = adjust(frame); return l && 'effects' in l ? l.effects?.find((e) => e.type === 'stylize.date-stamp')?.params.text : undefined; };
    expect(stampText(30)).toBe("'24 12 25");
    expect(stampText(90)).toBe(''); // only the undated sticker lies under it there: nothing is drawn, no other clip's date is borrowed
  });
  it('with the clock, the minute moves on with the source: 60 seconds later it is the next minute, and at double speed after 30', () => {
    const c = stamped({ clock: true });
    expect(textAt(c.doc, c.clipId, 0)).toBe("'24 12 25 18:15");
    expect(textAt(c.doc, c.clipId, 29 * 30 + 29)).toBe("'24 12 25 18:15"); // 18:15:30 + 29.97 s
    expect(textAt(c.doc, c.clipId, 30 * 30)).toBe("'24 12 25 18:16");     // 18:15:30 + 30 s
    expect(textAt(c.doc, c.clipId, 60 * 30)).toBe("'24 12 25 18:16");
    expect(textAt(c.doc, c.clipId, 90 * 30)).toBe("'24 12 25 18:17");
    const fast = tx(c.doc, [{ op: 'set_clip_speed', args: { clipId: c.clipId, speed: 2 } }]);
    expect(textAt(fast.doc, c.clipId, 14 * 30 + 29)).toBe("'24 12 25 18:15");
    expect(textAt(fast.doc, c.clipId, 15 * 30)).toBe("'24 12 25 18:16"); // 15 s of timeline = 30 s of source
    const dmy = stamped({ clock: true, dateOrder: 'dmy' });
    expect(textAt(dmy.doc, dmy.clipId, 0)).toBe('25.12.2024 18:15');
  });
  it('the stamp crosses midnight with the source, a day-only date has no clock, and no date draws nothing', () => {
    const late = stamped({ clock: true }, { at: '2024-12-24T23:59:30', utcOffsetMinutes: 120, source: 'container' });
    expect(textAt(late.doc, late.clipId, 0)).toBe("'24 12 24 23:59");
    expect(textAt(late.doc, late.clipId, 30 * 30)).toMatch(/^'24 12 25 0?0:00$/); // the next day, at midnight
    const lateDmy = stamped({ dateOrder: 'dmy' }, { at: '2024-12-24T23:59:30', utcOffsetMinutes: 120, source: 'container' });
    expect(textAt(lateDmy.doc, lateDmy.clipId, 30 * 30 - 1)).toBe('24.12.2024');
    expect(textAt(lateDmy.doc, lateDmy.clipId, 30 * 30)).toBe('25.12.2024');
    const day = stamped({ clock: true }, { at: '2024-12-25', utcOffsetMinutes: null, source: 'filename', circa: true });
    expect(textAt(day.doc, day.clipId, 0)).toBe("'24 12 25");
    expect(textAt(day.doc, day.clipId, 3000)).toBe("'24 12 25");
    const none = stamped({ clock: true, text: "'99 1 1" }, undefined);
    expect(textAt(none.doc, none.clipId, 0)).toBe('');
  });
  it('whatever the date, the text fits the stamp\'s own pattern, and the rest of the stamp is exactly the typed stamp', () => {
    const c = stamped({ clock: true, dateOrder: 'dmy' });
    for (let frame = 0; frame < 3600; frame += 97) expect(STAMP_TEXT.test(String(textAt(c.doc, c.clipId, frame)))).toBe(true);
    // the same stamp typed by hand: every other parameter and the whole graph are equal
    const typed = tx(c.doc, [{ op: 'update_effect', args: { clipId: c.clipId, effectId: c.effectId, params: { source: 'text', text: '25.12.2024 18:15' } } }]);
    const got = evaluate(c.doc, f(10)), want = evaluate(typed.doc, f(10));
    const strip = (g: typeof got) => JSON.parse(JSON.stringify(g, (k, v) => (k === 'source' ? undefined : v)));
    expect(strip(got)).toEqual(strip(want));
  });
});
