/**
 * The Hanukkah and birthday packs (ADR-0022): what each holds, that everything they name exists, that nothing in them breaks
 * the rules of packs/contract.ts or the owner's decisions (no hexagram, no songs or blessings, no divine name), and a hash of
 * all the pack data (snapshot.json): a change to any word, id, colour or drawing fails here until the snapshot is renewed on
 * purpose (PF_UPDATE_SNAPSHOT=1 pnpm vitest run packages/core/src/packs/packs.test.ts). Ids are frozen once shipped, so a
 * renewed snapshot goes with new ids, never with changed values under old ones.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementSvg, findEffect, findFont, findTextPreset, MOTION_PRESETS, TRANSITION_IDS, TEMPLATES, findTemplate, packFieldsIn } from '../index.ts';
import { NEVER_IN_A_PACK, packIssues } from './check.ts';
import { PACKS, findPack } from './index.ts';
import { PACK_ELEMENTS } from './elements.ts';
import { summarizePack } from './use.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hanukkah = findPack('pack.hanukkah')!, birthday = findPack('pack.birthday')!;
const motion = new Set(MOTION_PRESETS.map((m) => m.id)), transitions = new Set<string>(TRANSITION_IDS), elements = new Set(ELEMENTS.map((e) => e.id));

/** Every string a pack holds, with where it is. */
function strings(value: unknown, where = ''): { where: string; text: string }[] {
  if (typeof value === 'string') return [{ where, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${where}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, `${where}.${k}`));
  return [];
}

describe('what the two packs hold', () => {
  it('both are in the build, in this order, with the occasions the owner decided', () => {
    expect(PACKS.map((p) => p.id)).toEqual(['pack.hanukkah', 'pack.birthday']);
    expect(hanukkah.occasion).toEqual({ kind: 'holiday', family: 'hanukkah', leadDays: 21, trailDays: 10 });
    expect(birthday.occasion).toEqual({ kind: 'life-event', event: 'birthday', windowDays: 14 });
  });
  it.each([hanukkah, birthday])('$id: 4 templates, 25 elements, 3 looks, 3 caption looks, 6 text styles and 8 titles', (p) => {
    expect(p.templates.length + p.templateIds.length).toBe(4);
    expect(p.elementIds).toHaveLength(25);
    expect(p.looks).toHaveLength(3);
    expect(p.captionLooks).toHaveLength(3);
    expect(p.textPresets).toHaveLength(6);
    expect(p.titles).toHaveLength(8);
    expect(p.sfxIds.length).toBeGreaterThan(0);
    expect(p.musicStyleIds.length).toBeGreaterThan(0);
  });
  it('the birthday pack lists tpl.birthday unchanged beside its three new templates', () => {
    expect(birthday.templates.map((t) => t.id)).toEqual(['tpl.birthday-age', 'tpl.birthday-cake', 'tpl.birthday-invite']);
    expect(birthday.templateIds).toEqual(['tpl.birthday']);
    expect(findTemplate('tpl.birthday')!.pack).toBeUndefined();
    expect(hanukkah.templates.map((t) => t.id)).toEqual(['tpl.hanukkah-candles', 'tpl.hanukkah-eight-nights', 'tpl.hanukkah-party', 'tpl.hanukkah-greeting']);
    for (const t of [...hanukkah.templates, ...birthday.templates]) expect(TEMPLATES.some((x) => x.id === t.id)).toBe(true);
  });
  it('the 50 elements are the ones the packs list: 25 holiday and 25 party, in the order of the plan', () => {
    expect(PACK_ELEMENTS.filter((e) => e.category === 'holiday')).toHaveLength(25);
    expect(PACK_ELEMENTS.filter((e) => e.category === 'party')).toHaveLength(25);
    expect(PACK_ELEMENTS.filter((e) => e.category === 'holiday').map((e) => `element.holiday.${e.slug}`)).toEqual(hanukkah.elementIds);
    expect(PACK_ELEMENTS.filter((e) => e.category === 'party').map((e) => `element.party.${e.slug}`)).toEqual(birthday.elementIds);
    for (const slug of ['hanukkiah-1', 'hanukkiah-8', 'hanukkiah-outline', 'candle', 'candle-lit', 'candle-row', 'dreidel', 'dreidel-two-colour', 'dreidel-spinning', 'sufganiya', 'sufganiya-bitten', 'sufganiyot-plate', 'latke', 'oil-jug', 'gelt-coin', 'gelt-stack', 'gift', 'lights-garland', 'frame-candles'])
      expect(hanukkah.elementIds, slug).toContain(`element.holiday.${slug}`);
    for (const slug of ['balloon', 'balloon-shine', 'balloons-bunch', 'balloon-heart', 'cake', 'cake-candles', 'cupcake', 'candle-birthday', 'party-hat', 'crown-party', 'gift-box', 'gift-bow', 'bunting', 'streamer', 'confetti-burst', 'party-popper', 'blower', 'star-burst', 'number-badge', 'ribbon-banner', 'frame-polaroid', 'frame-bunting', 'lollipop', 'ice-cream', 'party-face'])
      expect(birthday.elementIds, slug).toContain(`element.party.${slug}`);
  });
  it('the age title comes in a boy\'s, a girl\'s and a neutral form', () => {
    const t = (id: string) => birthday.titles.find((x) => x.id === id)!;
    expect(t('title.birthday-boy').text.he).toBe('בן {age}!');
    expect(t('title.birthday-girl').text.he).toBe('בת {age}!');
    expect(t('title.birthday-turning').text.he).toBe('חוגגים {age}');
    for (const id of ['title.birthday-boy', 'title.birthday-girl', 'title.birthday-turning']) expect(t(id).fallback.he).not.toMatch(/\{/);
  });
  it('the summaries ask for the fields the titles and templates hold', () => {
    expect(summarizePack(hanukkah)).toMatchObject({ fields: ['name', 'night'], liveFields: true });
    expect(summarizePack(birthday).fields).toEqual(['name', 'age', 'place', 'when']);
  });
});

describe('everything a pack names exists', () => {
  it('the rules of packs/contract.ts hold (packIssues)', () => {
    for (const p of PACKS) expect(packIssues(p, PACKS.filter((o) => o !== p)), p.id).toEqual([]);
  });
  it('elements, effects, transitions, motion presets, text styles and fonts with that weight', () => {
    const missing: string[] = [];
    for (const p of PACKS) {
      const presets = new Set([...p.textPresets.map((x) => x.id)]);
      for (const id of p.elementIds) if (!elements.has(id)) missing.push(`${p.id}: element ${id}`);
      for (const l of p.looks) for (const e of l.effects) if (!findEffect(e.type)) missing.push(`${l.id}: effect ${e.type}`);
      for (const x of p.textPresets) { const f = findFont(x.style.fontFamily); if (!f?.weights.includes(x.style.fontWeight)) missing.push(`${x.id}: font ${x.style.fontFamily} ${x.style.fontWeight}`); }
      for (const l of p.captionLooks) { const f = findFont(l.style.fontFamily ?? 'Heebo'); if (!f?.weights.includes(l.style.fontWeight ?? 700)) missing.push(`${l.id}: font ${l.style.fontFamily} ${l.style.fontWeight}`); }
      for (const t of p.titles) if (!presets.has(t.presetId) && !findTextPreset(t.presetId)) missing.push(`${t.id}: text style ${t.presetId}`);
      for (const t of p.templates) {
        for (const e of t.elements) { if (!elements.has(e.elementId)) missing.push(`${t.id}: element ${e.elementId}`); if (e.motion && !motion.has(e.motion.presetId)) missing.push(`${t.id}: motion ${e.motion.presetId}`); if (!p.elementIds.includes(e.elementId)) missing.push(`${t.id}: element ${e.elementId} is not listed by the pack`); }
        for (const s of t.slots) { if (s.motion && !motion.has(s.motion.presetId)) missing.push(`${t.id}: motion ${s.motion.presetId}`); if (s.transitionIn && !transitions.has(s.transitionIn.type)) missing.push(`${t.id}: transition ${s.transitionIn.type}`); }
        for (const a of t.adjust) for (const e of a.effects) if (!findEffect(e.type)) missing.push(`${t.id}: effect ${e.type}`);
        for (const x of t.texts) if (!presets.has(x.presetId) && !findTextPreset(x.presetId)) missing.push(`${t.id}: text style ${x.presetId}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('keys are unique in every template, ids are unique in every pack, and nothing names the hexagram', () => {
    for (const p of PACKS) {
      for (const t of p.templates) {
        const keys = [...t.slots, ...t.texts, ...t.elements, ...t.sfx, ...t.adjust].map((x) => x.key);
        expect(new Set(keys).size, `${t.id} keys`).toBe(keys.length);
      }
      for (const list of [p.looks.map((x) => x.id), p.captionLooks.map((x) => x.id), p.textPresets.map((x) => x.id), p.titles.map((x) => x.id), p.elementIds, p.sfxIds, p.musicStyleIds]) expect(new Set(list).size).toBe(list.length);
      expect(JSON.stringify(p)).not.toContain('star-6');
      expect(p.elementIds).not.toContain(NEVER_IN_A_PACK);
    }
  });
  it('looks use no strobe, flicker or flash, and no pack template uses a flashing transition or motion', () => {
    for (const p of PACKS) {
      const effects = [...p.looks.flatMap((l) => l.effects), ...p.templates.flatMap((t) => t.adjust.flatMap((a) => a.effects))].map((e) => e.type);
      for (const e of effects) { expect(e).not.toMatch(/strobe|flicker|flash/); expect(findEffect(e)!.cost).toMatch(/^(filter|layer)$/); }
      for (const t of p.templates) {
        for (const s of t.slots) expect(s.transitionIn?.type ?? 'dissolve').not.toMatch(/dip-white|flash/);
        for (const x of [...t.slots.map((s) => s.motion?.presetId), ...t.elements.map((e) => e.motion?.presetId)]) expect(x ?? '').not.toMatch(/flicker/);
      }
    }
  });
});

describe('the templates', () => {
  it('tpl.hanukkah-eight-nights: eight slots that are all used, one hanukkiah of the night on each', () => {
    const t = findTemplate('tpl.hanukkah-eight-nights')!;
    expect(t.slotUse).toEqual({ mode: 'all', min: 8 });
    expect(t.slots).toHaveLength(8);
    expect(t.elements.map((e) => e.elementId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((i) => `element.holiday.hanukkiah-${i}`));
    t.elements.forEach((e, i) => expect(e.at.slot).toBe(t.slots[i]!.key));
    for (const s of t.slots) expect(s.span).toEqual({ bars: 1 });
  });
  it('the cake slot keeps its own sound and the candle lighting keeps the voices of the lighting', () => {
    expect(findTemplate('tpl.birthday-cake')!.slots.find((s) => s.key === 'cake')!.keepAudio).toBe(true);
    expect(findTemplate('tpl.hanukkah-candles')!.slots[0]!.keepAudio).toBe(true);
  });
  it('graphic elements of one template never share a time range, so the planner leaves none out', () => {
    for (const p of PACKS) for (const t of p.templates) {
      const at = new Map(t.slots.map((s, i) => [s.key, i]));
      const ranges = t.elements.map((e) => [at.get(e.at.slot)!, at.get(e.at.slot)! + (e.at.spanSlots ?? 1)] as const);
      ranges.forEach((r, i) => ranges.forEach((q, j) => { if (i < j) expect(r[1] <= q[0] || q[1] <= r[0], `${t.id}: ${t.elements[i]!.key} and ${t.elements[j]!.key}`).toBe(true); }));
    }
  });
  it('every template carries a built-in music suggestion, a pack field or a live field in a title, and a token-free fallback for each', () => {
    for (const p of PACKS) for (const t of p.templates) {
      expect(t.music.builtin, t.id).toMatch(/^music\./);
      expect(t.genre).toBe('celebration');
      for (const x of t.texts) {
        const holds = packFieldsIn(x.default.he).length > 0 || /\{(date|hebrewDate|year|hebrewYear|event)\}/.test(x.default.he);
        if (holds) { expect(x.fallback, `${t.id}.${x.key}`).toBeDefined(); expect(x.fallback!.he + x.fallback!.en).not.toMatch(/[{}]/); }
      }
    }
    for (const t of ['tpl.hanukkah-candles', 'tpl.hanukkah-eight-nights', 'tpl.hanukkah-greeting']) expect(findTemplate(t)!.texts.map((x) => x.default.he).join(' ')).toMatch(/\{(night|n|hebrewDate)\}/);
    for (const t of ['tpl.birthday-age', 'tpl.birthday-cake', 'tpl.birthday-invite']) expect(findTemplate(t)!.texts.map((x) => x.default.he).join(' ')).toMatch(/\{(age|name|when|place)\}/);
  });
});

describe('what the packs must never say', () => {
  const FORBIDDEN = [
    // song incipits and titles (Hebrew and English), blessings and the divine name
    'מעוז צור', 'סביבון סב סב', 'נר לי דלוק', 'הנרות הללו', 'אני סביבון', 'שיר יום הולדת', 'happy birthday to you', 'maoz tzur', 'rock of ages', 'sevivon sov', 'hanerot halalu',
    'ברוך אתה', 'שהחיינו', 'להדליק נר', 'בורא פרי', 'יהוה', 'ה׳', 'אדוני', 'blessed are you', 'shehecheyanu', 'adonai',
  ];
  it('no default text, name or hint holds a song, a blessing or the divine name', () => {
    const all = PACKS.flatMap((p) => strings(p, p.id)).map((s) => ({ ...s, lower: s.text.toLowerCase() }));
    for (const f of FORBIDDEN) expect(all.filter((s) => s.lower.includes(f.toLowerCase())).map((s) => s.where), f).toEqual([]);
  });
  it('no name, hint or title is empty', () => {
    for (const p of PACKS) for (const s of strings({ name: p.name, hint: p.hint, titles: p.titles, looks: p.looks, captionLooks: p.captionLooks.map((c) => ({ name: c.name, hint: c.hint })) })) expect(s.text.trim().length, s.where).toBeGreaterThan(0);
  });
});

describe('the snapshot of the pack data', () => {
  it('equals snapshot.json: any change to a word, id, colour or drawing is deliberate', () => {
    const data = { packs: PACKS, elements: PACK_ELEMENTS.map((e) => ({ id: `element.${e.category}.${e.slug}`, he: e.he, en: e.en, w: e.width, h: e.height, colors: e.colors, defaults: e.defaults, version: e.version ?? null, svg: elementSvg(`element.${e.category}.${e.slug}`) })) };
    const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const file = path.join(dir, 'snapshot.json');
    const now = { hash, packs: PACKS.map((p) => ({ id: p.id, version: p.version, templates: p.templates.length, elements: p.elementIds.length, looks: p.looks.length, captionLooks: p.captionLooks.length, textPresets: p.textPresets.length, titles: p.titles.length })) };
    if (process.env.PF_UPDATE_SNAPSHOT === '1') fs.writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')), 'pack data changed: if on purpose, give changed values NEW ids and renew with PF_UPDATE_SNAPSHOT=1').toEqual(now);
  });
});
