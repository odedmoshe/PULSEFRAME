/**
 * The rules of a content pack (packs/contract.ts) held against every pack of the build, and the lead's pack functions
 * (packIssues, suggestPacks, candleNight, packTitleOp, packLookOp, summarizePack) on a fixture pack made here. The fixture is
 * not a pack of the build: the Hanukkah and birthday packs are W1's, and their own tests are packs/packs.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, validateProject, type OpCall, type ProjectDocument } from '../index.ts';
import type { PackDef } from './contract.ts';
import { PACKS } from './index.ts';
import { NEVER_IN_A_PACK, packIssues } from './check.ts';
import { candleNight, suggestPacks } from './suggest.ts';
import { packLookOp, packTitleOp, summarizePack } from './use.ts';

const words = (en: string, he = `${en} בעברית`) => ({ he, en });
const FIXTURE: PackDef = {
  id: 'pack.test', version: 1, name: words('Test pack', 'חבילת בדיקה'), hint: words('Only for this test', 'רק לבדיקה'), palette: ['#1B2A6B', '#FFD54A'],
  occasion: { kind: 'holiday', family: 'hanukkah', leadDays: 21, trailDays: 10 },
  templates: [], templateIds: ['tpl.birthday'],
  elementIds: ['element.symbol.check', 'element.symbol.plus', 'element.symbol.question'], coverElementIds: ['element.symbol.check', 'element.symbol.plus', 'element.symbol.question'],
  looks: [{ id: 'look.test-warm', name: words('Warm', 'חמים'), hint: words('Warm edges', 'שוליים חמים'), effects: [{ type: 'light.vignette' }] }],
  captionLooks: [],
  textPresets: [{ id: 'test-gold', name: words('Gold', 'זהב'), style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.08, color: '#FFD54A', background: null, stroke: null, strokeFrac: 0 }, shadow: null }],
  titles: [{ id: 'title.test-night', name: words('Candle', 'נר'), text: { he: 'נר {night} של חנוכה', en: 'Hanukkah candle {night}' }, fallback: { he: 'חנוכה שמח', en: 'Happy Hanukkah' }, presetId: 'test-gold', seconds: 3, anim: { by: 'letter', in: 'rise', out: 'fade', loop: null, inSeconds: 0.5, outSeconds: 0.4 }, place: { x: 0, y: -0.3, sizeFrac: 0.1 } }],
  sfxIds: ['sfx.chime'], musicStyleIds: ['music.festive'],
};
const day = (y: number, m: number, d: number) => ({ y, m, d });

describe('every pack of the build keeps the rules of packs/contract.ts', () => {
  it('packIssues finds nothing in any pack, and ids are unique across packs', () => {
    for (const p of PACKS) expect(packIssues(p, PACKS.filter((o) => o !== p)), p.id).toEqual([]);
    expect(new Set(PACKS.map((p) => p.id)).size).toBe(PACKS.length);
  });
  it('a pack data file and packs/index.ts import at run time only from elementKit.ts and other pack data files; packs/ holds only .ts and .json', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const LEAD = new Set(['contract.ts', 'check.ts', 'suggest.ts', 'use.ts']);
    for (const file of fs.readdirSync(dir)) {
      expect(file, file).toMatch(/\.(ts|json)$/);
      if (LEAD.has(file) || file.endsWith('.test.ts') || file.endsWith('.json')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of source.matchAll(/^\s*import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const from = m[1]!;
        const ok = from === '../elementKit.ts' || (from.startsWith('./') && !LEAD.has(from.slice(2)) && !from.endsWith('.test.ts'));
        expect(ok, `${file} imports ${from} at run time`).toBe(true);
      }
    }
  });
});

describe('packIssues', () => {
  it('a sound pack has none', () => {
    expect(packIssues(FIXTURE)).toEqual([]);
  });
  it('names each broken rule', () => {
    const issues = (p: Partial<PackDef>) => packIssues({ ...FIXTURE, ...p }).join('\n');
    expect(issues({ elementIds: [...FIXTURE.elementIds, NEVER_IN_A_PACK] })).toContain(`${NEVER_IN_A_PACK} is never part of a pack`);
    expect(issues({ looks: [{ ...FIXTURE.looks[0]!, effects: [{ type: 'time.strobe' }] }] })).toMatch(/time\.strobe/);
    expect(issues({ looks: [{ ...FIXTURE.looks[0]!, effects: [{ type: 'stylize.shadow' }] }] })).toContain('cannot go on an adjustment clip');
    expect(issues({ looks: [{ ...FIXTURE.looks[0]!, id: 'look.other-warm' }] })).toContain('the id must be look.test-<words>');
    expect(issues({ textPresets: [{ ...FIXTURE.textPresets[0]!, style: { ...FIXTURE.textPresets[0]!.style, fontFamily: 'Alef' } }] })).toContain('not bundled');
    expect(issues({ textPresets: [{ ...FIXTURE.textPresets[0]!, id: 'clean-white' }] })).toContain('exists already');
    expect(issues({ titles: [{ ...FIXTURE.titles[0]!, fallback: { he: 'נר {night}', en: 'Candle {night}' } }] })).toContain('a fallback is plain text');
    expect(issues({ titles: [{ ...FIXTURE.titles[0]!, text: { he: 'בן {age:per_1}', en: 'Age {age:per_1}' } }] })).toContain('people fields');
    expect(issues({ occasion: { kind: 'holiday', family: 'no-such-day', leadDays: 1, trailDays: 1 } })).toContain('no holiday family');
    expect(issues({ musicStyleIds: ['music.nope'] })).toContain('no built-in music style');
    expect(issues({ templateIds: ['tpl.nope'] })).toContain('is not an existing template');
    expect(issues({ coverElementIds: ['element.symbol.check', 'element.symbol.check', 'element.symbol.plus'] })).toContain('three different elements');
  });
});

describe('suggestPacks: from the life line\'s holiday table, counted to the evening that begins the holiday', () => {
  it('on 17 November 2026 Hanukkah is 17 days away: it begins on the evening of 4 December, its first day is 5 December', () => {
    expect(suggestPacks([FIXTURE], day(2026, 11, 17))).toEqual([{
      packId: 'pack.test', daysAway: 17, firstDay: day(2026, 12, 5), lastDay: day(2026, 12, 12), eveningBefore: true,
      reason: { he: 'חנוכה מתחיל בערב 4 בדצמבר · בעוד 17 ימים', en: 'Hanukkah begins on the evening of 4 December · in 17 days' },
    }]);
  });
  it('the window is 14 November to 22 December 2026; nothing on 5 January 2027', () => {
    expect(suggestPacks([FIXTURE], day(2026, 11, 13))).toEqual([]);
    expect(suggestPacks([FIXTURE], day(2026, 11, 14)).map((s) => s.daysAway)).toEqual([20]);
    expect(suggestPacks([FIXTURE], day(2026, 12, 4)).map((s) => [s.daysAway, s.reason.he])).toEqual([[0, 'חנוכה מתחיל הערב']]);
    expect(suggestPacks([FIXTURE], day(2026, 12, 8)).map((s) => s.daysAway)).toEqual([0]);
    expect(suggestPacks([FIXTURE], day(2026, 12, 22)).map((s) => s.daysAway)).toEqual([-10]);
    expect(suggestPacks([FIXTURE], day(2026, 12, 23))).toEqual([]);
    expect(suggestPacks([FIXTURE], day(2027, 1, 5))).toEqual([]);
    expect(suggestPacks([FIXTURE], day(2026, 2, 30))).toEqual([]); // a day that does not exist
  });
  it('a birthday the caller knows of is suggested within its window, nearest first; "always" is never suggested', () => {
    const birthday: PackDef = { ...FIXTURE, id: 'pack.party', occasion: { kind: 'life-event', event: 'birthday', windowDays: 14 } };
    const always: PackDef = { ...FIXTURE, id: 'pack.plain', occasion: { kind: 'always' } };
    const hints = [{ kind: 'birthday' as const, on: day(2026, 11, 20), name: 'נועה' }];
    expect(suggestPacks([FIXTURE, birthday, always], day(2026, 11, 17), hints).map((s) => [s.packId, s.daysAway, s.reason.he])).toEqual([
      ['pack.party', 3, 'יום ההולדת של נועה בעוד 3 ימים · 20 בנובמבר'], ['pack.test', 17, 'חנוכה מתחיל בערב 4 בדצמבר · בעוד 17 ימים'],
    ]);
    expect(suggestPacks([birthday], day(2026, 11, 17), [{ kind: 'birthday', on: day(2026, 12, 2) }])).toEqual([]);
  });
});

describe('candleNight: the Hanukkah candle of a day, from the life line\'s calendar', () => {
  it('4 December 2026 at the lighting is the first candle; its daytime is not Hanukkah yet; 12 December is the eighth day', () => {
    expect(candleNight(day(2026, 12, 4), true)).toBe(1);
    expect(candleNight(day(2026, 12, 4), false)).toBeNull();
    expect(candleNight(day(2026, 12, 11), true)).toBe(8);
    expect(candleNight(day(2026, 12, 12), false)).toBe(8);
    expect(candleNight(day(2026, 12, 12), true)).toBeNull();
    expect(candleNight(day(2020, 12, 10), true)).toBe(1); // 25 Kislev 5781 = 11 December 2020
  });
});

describe('using a pack: a title is ONE add_text, a look ONE add_adjustment', () => {
  const R = { num: 30, den: 1 };
  const doc = (): ProjectDocument => {
    const d = createProject({ id: 'prj_use', name: 'use', width: 1080, height: 1920, frameRate: R });
    d.assets.vid = { id: 'vid', kind: 'video', name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 1080, height: 1920, frameRate: R, codec: 'h264', rotation: 0, frameCount: null }, provenance: { origin: 'fixture', importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
    return applyTransaction(d, [{ op: 'add_clip', args: { assetId: 'vid', start: T.ZERO, duration: T.frameTime(150, R) } }], { idSeed: 'u0', actor: 'test' }).doc;
  };
  const one = (d: ProjectDocument, op: OpCall) => { const r = applyTransaction(d, [op], { idSeed: 'u1', actor: 'test' }); expect(validateProject(r.doc)).toEqual([]); return r; };
  it('the title: words with the field written in, the pack\'s text style, size and animation, in one operation', () => {
    // a built-in text style: the fixture pack is not in the registry, so its own style is not either
    const { op, words: w } = packTitleOp({ ...FIXTURE.titles[0]!, presetId: 'clean-white' }, { lang: 'he', fields: { night: '3' }, start: T.ZERO, rate: R, dated: false });
    expect(op.op).toBe('add_text');
    expect(w).toMatchObject({ text: 'נר 3 של חנוכה', usedFallback: false, fields: false });
    const r = one(doc(), op);
    const c = findClip(r.doc, r.results[0]!.output!.clipId as string)!.clip;
    expect(c.type === 'text' && [c.text, c.style.color, c.style.sizeFrac, c.animation?.in, T.frameIndexAt(c.duration, R)]).toEqual(['נר 3 של חנוכה', '#FFFFFF', 0.1, 'rise', 90]);
    expect(packTitleOp(FIXTURE.titles[0]!, { lang: 'en', start: T.ZERO, rate: R, dated: false, motion: 'none' }).op.args).toMatchObject({ text: 'Happy Hanukkah' });
    expect(packTitleOp(FIXTURE.titles[0]!, { lang: 'en', start: T.ZERO, rate: R, dated: false, motion: 'none' }).op.args).not.toHaveProperty('animation');
  });
  it('the look: one adjustment over the whole edit, labelled with its name', () => {
    const r = one(doc(), packLookOp(FIXTURE.looks[0]!, 'he'));
    const c = findClip(r.doc, r.results[0]!.output!.clipId as string)!.clip;
    expect(c.type === 'adjustment' && [c.effects?.map((e) => e.type), c.label]).toEqual([['light.vignette'], 'חמים']);
  });
  it('the summary lists what the pack page needs and says where the content comes from', () => {
    const s = summarizePack(FIXTURE);
    expect(s).toMatchObject({ id: 'pack.test', templateIds: ['tpl.birthday'], fields: ['night'], liveFields: false, captionLookIds: [], textPresetIds: ['test-gold'] });
    expect(s.source).toMatch(/no third-party content/);
  });
});
