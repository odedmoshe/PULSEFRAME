/**
 * The built-in pages of «קליפ מקוד» (wave 8 motioncode; lead pre-pass): five small pages for general use, written for this editor,
 * original, with no library; a sixth (card-3d, integration decision 8) loads the pinned three.js served locally and draws with WebGL. Each draws from its frame number only, takes typed values (PF.fields) and sets text with textContent or
 * Canvas/SVG text only, and names catalogue fonts only (templates.test.ts checks all of this). Built-in pages are trusted code of
 * this build: their sha256 is fixed here at load, and a stored clip records it (provenance.made.pageSha256 / templateId).
 * Nobody has looked at them: the proof renders them with Hebrew and English values and the integrator looks at the pictures.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MadeField, MadeTemplateInfo } from '@pulseframe/core';

const dir = import.meta.dirname;
const text = (key: string, he: string, en: string, def: string, maxLength = 60): MadeField => ({ key, kind: 'text', label: { he, en }, default: def, maxLength });
const colour = (key: string, he: string, en: string, def: string): MadeField => ({ key, kind: 'colour', label: { he, en }, default: def });
const number = (key: string, he: string, en: string, def: number, min: number, max: number): MadeField => ({ key, kind: 'number', label: { he, en }, default: String(def), min, max });

interface Def { id: string; version: number; file: string; name: { he: string; en: string }; seconds: number; fields: MadeField[]; en: Record<string, string> }
const DEFS: readonly Def[] = [
  { id: 'rising-title', version: 1, file: 'rising-title.html', name: { he: 'כותרת עולה', en: 'Rising title' }, seconds: 4,
    fields: [text('title', 'כותרת', 'Title', 'טיול לגליל 2026'), text('subtitle', 'שורה שנייה', 'Second line', 'פרק ראשון'), colour('colour', 'צבע', 'Colour', '#ffffff')],
    en: { title: 'Summer in the North 2026', subtitle: 'Part one' } },
  { id: 'lower-third', version: 1, file: 'lower-third.html', name: { he: 'שורת שם', en: 'Lower third' }, seconds: 5,
    fields: [text('name', 'שם', 'Name', 'נועה כהן', 40), text('role', 'תפקיד או תיאור', 'Role or description', 'מדריכת טיולים', 50), colour('colour', 'צבע הכתב', 'Text colour', '#ffffff'), colour('accent', 'צבע הפס', 'Bar colour', '#f5b400')],
    en: { name: 'Noa Cohen', role: 'Tour guide' } },
  { id: 'counter', version: 1, file: 'counter.html', name: { he: 'מונה', en: 'Counter' }, seconds: 4,
    fields: [number('from', 'מ־', 'From', 0, -1_000_000_000, 1_000_000_000), number('to', 'עד', 'To', 1000, -1_000_000_000, 1_000_000_000), text('label', 'כיתוב', 'Label', 'צופים בחודש הראשון'), colour('colour', 'צבע', 'Colour', '#ffffff')],
    en: { label: 'viewers in the first month' } },
  { id: 'intro-plate', version: 2, file: 'intro-plate.html', name: { he: 'לוח פתיחה', en: 'Intro plate' }, seconds: 3,
    fields: [text('title', 'כותרת', 'Title', 'המדריך המלא לצילום בטלפון'), colour('background', 'צבע הרקע', 'Background', '#1d2a44'), colour('colour', 'צבע הכתב', 'Text colour', '#ffffff')],
    en: { title: 'The complete guide to phone filming' } },
  { id: 'end-card', version: 1, file: 'end-card.html', name: { he: 'כרטיס סיום', en: 'End card' }, seconds: 5,
    fields: [text('thanks', 'שורת תודה', 'Thank-you line', 'תודה שצפיתם'), text('action', 'כפתור', 'Button', 'הירשמו לערוץ', 30), colour('colour', 'צבע הכפתור', 'Button colour', '#e53935'), colour('textColour', 'צבע הכתב', 'Text colour', '#ffffff')],
    en: { thanks: 'Thanks for watching', action: 'Subscribe' } },
  // integration decision 8: one built-in page that uses three.js (WebGL; the determinism check of a WebGL page warns, never fails)
  { id: 'card-3d', version: 1, file: 'card-3d.html', name: { he: 'כרטיס בתלת־ממד', en: '3D title card' }, seconds: 4,
    fields: [text('title', 'כותרת', 'Title', 'פרק 3: איך מתחילים', 40), text('subtitle', 'שורה שנייה', 'Second line', 'מדריך קצר למתחילים', 50), colour('background', 'צבע הכרטיס', 'Card colour', '#1d2a44'), colour('colour', 'צבע הכתב', 'Text colour', '#ffffff')],
    en: { title: 'Chapter 3: Getting started', subtitle: 'A short guide for beginners' } },
];

/** The catalogue, read once (GET /api/v1/made/templates; the render job takes a page by templateId from here). */
export const MADE_TEMPLATES: readonly MadeTemplateInfo[] = DEFS.map((d) => {
  const page = fs.readFileSync(path.join(dir, d.file), 'utf8');
  const he = Object.fromEntries(d.fields.map((f) => [f.key, f.default]));
  return { id: d.id, version: d.version, name: d.name, fields: d.fields, seconds: d.seconds, pageSha256: `sha256:${createHash('sha256').update(page, 'utf8').digest('hex')}`, page, samples: { he, en: { ...he, ...d.en } } };
});
export const madeTemplate = (id: string): MadeTemplateInfo | undefined => MADE_TEMPLATES.find((t) => t.id === id);
