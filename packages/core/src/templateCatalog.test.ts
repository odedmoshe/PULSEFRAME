/**
 * The built-in templates (ADR-0016) are well-formed data: they parse, their ids, names and keys are unique, every catalogue id
 * they name exists in this build, every look runs on the CPU and may go on an adjustment clip, nothing in them flashes, and
 * every reference inside a template (a slot, a text, a tag) names something that template has. Sound effect ids live in the
 * server's catalogue and are checked there (apps/server/src/templateCatalog.test.ts).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  adjustmentRefusal, applyTransaction, elementIdChoices, createProject, ELEMENTS, findEffect, findTemplate, findTextPreset, GPU_EFFECT_IDS, GPU_TRANSITION_IDS, MODEL_GATED_TEMPLATES, MOTION_PRESETS,
  TemplateDefSchema, BUILTIN_TEMPLATES, TEMPLATES, TRANSITION_IDS, validateProject, type OpCall, type ProjectDocument,
} from './index.ts';

const IDS = ['tpl.travel-montage', 'tpl.photo-dump', 'tpl.birthday', 'tpl.quote-card', 'tpl.countdown-list', 'tpl.home-video'];
const INHERITED = new Set(Object.getOwnPropertyNames(Object.prototype));
const HEBREW = /[֐-׿]/;

describe('built-in templates', () => {
  it('the six built-ins, version 1 each, parse with TemplateDefSchema and are found by id', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual(IDS);
    expect(TEMPLATES.slice(0, IDS.length)).toEqual(BUILTIN_TEMPLATES); // the content packs' templates come after the six
    for (const t of TEMPLATES) {
      const parsed = TemplateDefSchema.safeParse(t);
      expect(parsed.success, `${t.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
      expect(t.version).toBe(1);
      expect(findTemplate(t.id)).toBe(t);
    }
    // the model-gated ones are never built-ins
    for (const g of MODEL_GATED_TEMPLATES) expect(findTemplate(g.id)).toBeUndefined();
  });
  it('ids and Hebrew and English names are unique; names, hints, roles and default texts exist in both languages', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.name.he)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.name.en)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      for (const w of [t.name, t.hint, ...t.slots.map((s) => s.role), ...t.texts.map((x) => x.role)]) expect([t.id, HEBREW.test(w.he), w.en.length > 0]).toEqual([t.id, true, true]);
      for (const x of t.texts) {
        if (x.perSlot === 'count-down' || x.perSlot === 'count-up') expect([x.key, x.default.he.includes('{n}'), x.default.en.includes('{n}')]).toEqual([x.key, true, true]);
        else expect([x.key, HEBREW.test(x.default.he)]).toEqual([x.key, true]);
        // a default fits its own limit in both languages
        expect([x.key, x.default.he.length <= x.maxChars, x.default.en.length <= x.maxChars]).toEqual([x.key, true, true]);
      }
    }
  });
  it('keys are unique within each template across slots, texts, elements, sound effects and looks, and none is a name every object answers to', () => {
    for (const t of TEMPLATES) {
      const keys = [...t.slots, ...t.texts, ...t.elements, ...t.sfx, ...t.adjust].map((x) => x.key);
      expect([t.id, new Set(keys).size]).toEqual([t.id, keys.length]);
      expect(keys.filter((k) => INHERITED.has(k))).toEqual([]);
    }
  });
  it('every effect, motion preset, text preset, transition and element id exists in this build', () => {
    const motions = new Set(MOTION_PRESETS.map((m) => m.id)), elements = new Set(ELEMENTS.map((e) => e.id)), transitions = new Set<string>(TRANSITION_IDS);
    for (const t of TEMPLATES) {
      for (const s of t.slots) {
        if (s.motion) expect([s.key, motions.has(s.motion.presetId)]).toEqual([s.key, true]);
        if (s.transitionIn) expect([s.key, transitions.has(s.transitionIn.type)]).toEqual([s.key, true]);
      }
      for (const x of t.texts) expect([x.key, !!findTextPreset(x.presetId)]).toEqual([x.key, true]);
      for (const e of t.elements) {
        for (const id of elementIdChoices(e, t.slots.length)) expect([e.key, id, elements.has(id)]).toEqual([e.key, id, true]);
        if (e.motion) expect([e.key, motions.has(e.motion.presetId)]).toEqual([e.key, true]);
      }
      for (const a of t.adjust) for (const fx of a.effects) expect([a.key, fx.type, !!findEffect(fx.type)]).toEqual([a.key, fx.type, true]);
    }
  });
  it('every look is a CPU effect that may go on an adjustment clip, with valid parameters; every transition runs on the CPU', () => {
    for (const t of TEMPLATES) {
      for (const a of t.adjust)
        for (const fx of a.effects) {
          expect([fx.type, GPU_EFFECT_IDS.includes(fx.type), adjustmentRefusal(fx.type)]).toEqual([fx.type, false, null]);
          const parsed = findEffect(fx.type)!.params.safeParse(fx.params ?? {});
          expect([fx.type, parsed.success]).toEqual([fx.type, true]);
        }
      for (const s of t.slots) if (s.transitionIn) expect([s.transitionIn.type, GPU_TRANSITION_IDS.includes(s.transitionIn.type)]).toEqual([s.transitionIn.type, false]);
    }
  });
  it('nothing flashes: no strobe, no dip to white, no flicker', () => {
    for (const t of TEMPLATES) {
      expect(t.adjust.flatMap((a) => a.effects.map((e) => e.type)).filter((x) => x === 'light.strobe')).toEqual([]);
      expect(t.slots.filter((s) => s.transitionIn?.type === 'dip-white' || s.transitionIn?.type === 'flash')).toEqual([]);
      expect([...t.slots, ...t.elements].filter((s) => s.motion?.presetId === 'motion.loop.flicker')).toEqual([]);
    }
  });
  it('what each template asks of the operations is accepted by them: its looks as adjustments, its motions, transitions, text styles and animations', () => {
    const R = { num: 30, den: 1 }, f = (k: number) => T.frameTime(k, R);
    let k = 0;
    const tx = (doc: ProjectDocument, ops: OpCall[], internal = false) => applyTransaction(doc, ops, { idSeed: `cat${k++}_`, actor: 'test', allowInternal: internal });
    const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: 'x', importedBy: 'x' } };
    let r = tx(createProject({ id: 'prj_cat', name: 'C', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: still } }], true);
    const pic = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: pic, start: f(0), duration: f(90) } }, { op: 'add_clip', args: { assetId: pic, start: f(90), duration: f(90) } }, { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(180) } }]);
    const [a, b, title] = r.results.map((x) => x.output!.clipId as string) as [string, string, string];
    const doc = r.doc;
    for (const t of TEMPLATES) {
      for (const look of t.adjust) {
        const ops: OpCall[] = [{ op: 'add_adjustment', args: { span: 'edit', effects: look.effects } }];
        expect(validateProject(tx(doc, ops).doc)).toEqual([]);
      }
      for (const s of t.slots) {
        if (s.motion) tx(doc, [{ op: 'apply_motion_preset', args: { clipId: a, presetId: s.motion.presetId, ...(s.motion.amount !== undefined ? { amount: s.motion.amount } : {}) } }]);
        if (s.transitionIn) tx(doc, [{ op: 'set_transition', args: { clipId: b, type: s.transitionIn.type, frames: Math.round(s.transitionIn.seconds * 30) } }]);
      }
      for (const x of t.texts) {
        const anim = x.anim ? [{ op: 'set_text_animation', args: { clipId: title, animation: { by: x.anim.by, in: x.anim.in, out: x.anim.out, loop: x.anim.loop, inFrames: Math.round(x.anim.inSeconds * 30), outFrames: Math.round(x.anim.outSeconds * 30) } } }] : [];
        tx(doc, [{ op: 'apply_text_preset', args: { clipId: title, presetId: x.presetId } }, { op: 'set_clip_transform', args: { clipId: title, transform: { x: x.place.x, y: x.place.y } } }, ...anim]);
      }
    }
  });
  it('every reference inside a template names something it has; slot use asks for no more slots than there are', () => {
    for (const t of TEMPLATES) {
      const slots = new Set(t.slots.map((s) => s.key)), texts = new Set(t.texts.map((x) => x.key)), tags = new Set(t.slots.map((s) => s.tag).filter(Boolean));
      for (const x of [...t.texts, ...t.elements]) expect([t.id, x.key, slots.has(x.at.slot)]).toEqual([t.id, x.key, true]);
      for (const s of t.sfx) if (typeof s.at === 'object') expect([t.id, s.key, 'slot' in s.at ? slots.has(s.at.slot) : texts.has(s.at.text)]).toEqual([t.id, s.key, true]);
      for (const a of t.adjust) {
        if (a.span === 'all') continue;
        if ('slots' in a.span) for (const k of a.span.slots) expect([t.id, a.key, slots.has(k)]).toEqual([t.id, a.key, true]);
        else expect([t.id, a.key, tags.has(a.span.tag)]).toEqual([t.id, a.key, true]);
      }
      expect([t.id, t.slotUse.min <= t.slots.length]).toEqual([t.id, true]);
      if (t.music.need === 'none') expect(t.sfx.length + t.slots.length).toBeGreaterThan(0);
    }
  });
});
