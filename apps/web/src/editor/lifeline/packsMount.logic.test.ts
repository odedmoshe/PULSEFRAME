/** The mounts of the packs: the day, the birthdays the shelf may suggest for, the exact length for «כאורך הסרטון»; and the mount strings. */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { PACKS, summarizePack, suggestPacks, type ProjectDocument } from '@pulseframe/core';
import { birthdayHints, fitSecondsOf, localGDate } from './packsMount.logic.ts';
import { PACKS_MOUNT_STRINGS } from './packs.mount.strings.ts';

const docWith = (people: Record<string, { id: string; name: string; birthDate: string | null }>): ProjectDocument => ({ people } as unknown as ProjectDocument);

describe('the day and the birthdays', () => {
  it('the local day is the viewer\'s own calendar day', () => {
    expect(localGDate(new Date(2026, 11, 4, 18, 30))).toEqual({ y: 2026, m: 12, d: 4 });
  });
  it('a birthday that has not come yet this year is this year, one that has passed is next year, nearest first; no birth date gives none', () => {
    const doc = docWith({
      a: { id: 'a', name: 'נועה', birthDate: '2021-12-20' }, b: { id: 'b', name: 'דנה', birthDate: '2019-03-02' }, c: { id: 'c', name: 'אורי', birthDate: null }, d: { id: 'd', name: 'גיל', birthDate: '2020-12-04' },
    });
    const hints = birthdayHints(doc, { y: 2026, m: 12, d: 4 });
    expect(hints.map((h) => [h.name, h.on])).toEqual([['גיל', { y: 2026, m: 12, d: 4 }], ['נועה', { y: 2026, m: 12, d: 20 }], ['דנה', { y: 2027, m: 3, d: 2 }]]);
  });
  it('29 February is kept on 28 February in a year without one; no project gives none', () => {
    expect(birthdayHints(docWith({ a: { id: 'a', name: 'x', birthDate: '2020-02-29' } }), { y: 2026, m: 1, d: 10 })[0]!.on).toEqual({ y: 2026, m: 2, d: 28 });
    expect(birthdayHints(null, { y: 2026, m: 1, d: 1 })).toEqual([]);
    expect(birthdayHints({} as ProjectDocument, { y: 2026, m: 1, d: 1 })).toEqual([]);
  });
  it('the Hanukkah pack is suggested on 4 December 2026, the evening Hanukkah 5787 begins', () => {
    const packs = PACKS.map(summarizePack);
    const hanukkah = packs.find((p) => p.id.includes('hanukkah'));
    expect(hanukkah).toBeTruthy();
    const s = suggestPacks(PACKS, { y: 2026, m: 12, d: 4 }, []);
    expect(s.some((x) => x.packId === hanukkah!.id && x.daysAway <= 0)).toBe(true);
  });
});

describe('the exact length of the edit', () => {
  it('whole seconds as n, other lengths as n/d, an empty timeline as null', () => {
    expect(fitSecondsOf(T.rt(12, 1))).toBe('12');
    expect(fitSecondsOf(T.rt(25, 2))).toBe('25/2');
    expect(fitSecondsOf(T.ZERO)).toBeNull();
  });
});

describe('the mount strings', () => {
  it('Hebrew and English have the same keys and marks, Hebrew is Hebrew', () => {
    const he = PACKS_MOUNT_STRINGS.he as Record<string, string>, en = PACKS_MOUNT_STRINGS.en as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
    for (const [k, v] of Object.entries(he)) { expect(/[֐-׿]/.test(v), k).toBe(true); expect((en[k]!.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((v.match(/\{\w+\}/g) ?? []).sort()); }
  });
});
