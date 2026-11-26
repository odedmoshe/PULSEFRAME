/**
 * The template dialog and the post-apply bar word refusals in the interface language (ADR-0016): the headline of the code,
 * the detail through the editor's common table (translateRefusal) or this track's own (the planner's and the template routes'
 * refusals), and the hint. The samples are the server's sentences (packages/core/src/templatePlan.ts, apps/server/src/templates.ts).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { createProject, planTemplate, TemplateError, type TemplateDef } from '@pulseframe/core';
import { ApiFailure } from '../api.ts';
import { templateHint, templateRefusal } from './templateRefusals.ts';
import { TEMPLATE_STRINGS } from './templates.strings.ts';

/** Latin letters left in a Hebrew sentence, other than names of programs and formats that have no Hebrew word and identifiers isolated left to right (a text's key). */
const latin = (s: string) => s.replace(/ffmpeg|librsvg|SVG/g, '').replace(/\u2066[^\u2069]*\u2069/g, '').match(/[A-Za-z]{2,}/g) ?? [];
const MEASURE_HINT = 'Measure the beat of the music first (מדידת קצב, ללא בינה מלאכותית): POST /api/v1/projects/{id}/assets/{assetId}/analyze with {"kind":"beats"}, or analyze_asset kind=beats.';

describe('template refusals', () => {
  it('in Hebrew: the headline, the detail and the hint are all Hebrew (the reviewer\'s case: needs_analysis with its API hint)', () => {
    const f = templateRefusal('he', new ApiFailure(409, 'needs_analysis', 'the music has no beat analysis yet', {}, MEASURE_HINT));
    expect(f).toEqual({ code: 'needs_analysis', message: 'נדרשת מדידת קצב: למוזיקה עדיין אין מדידת קצב', hint: TEMPLATE_STRINGS.he.needsAnalysis });
  });
  it('in English: the server\'s detail, and a hint for a person instead of the API route', () => {
    const f = templateRefusal('en', new ApiFailure(409, 'needs_analysis', 'the music has no beat analysis yet', {}, MEASURE_HINT));
    expect(f).toEqual({ code: 'needs_analysis', message: 'The music needs its beats measured: the music has no beat analysis yet', hint: TEMPLATE_STRINGS.en.needsAnalysis });
  });
  it('the editor\'s common refusals are worded by translateRefusal, as store.ts does', () => {
    expect(templateRefusal('he', new ApiFailure(409, 'track_locked', 'track trk_1 is locked')).message).toBe('הרצועה נעולה: הרצועה נעולה; יש לבטל את הנעילה כדי לערוך בה');
  });
  it('a blocked template names the blocking warning in Hebrew', () => {
    const e = new ApiFailure(409, 'template_blocked', 'the template cannot apply like this: slot s2 needs 405 frames, the video has 120', { blocking: [{ code: 'slot_too_short', message: 'slot s2 needs 405 frames, the video has 120', details: {} }] },
      'Choose longer media for that slot, another tempo, or fewer slots (see the plan).');
    const f = templateRefusal('he', e);
    expect(f.message).toBe(`התבנית אינה יכולה לחול כך: ${TEMPLATE_STRINGS.he.warning.slot_too_short}`);
    expect(latin(f.hint!)).toEqual([]);
    expect(templateRefusal('en', e).message).toBe('The template cannot apply like this: the template cannot apply like this: slot s2 needs 405 frames, the video has 120');
  });
  it('every refusal of the planner and the template routes that the dialog can meet is worded in Hebrew, hint included', () => {
    const samples: [string, string, string?][] = [
      ['needs_analysis', 'the beat analysis of this music has no bar starts, and this template counts in bars', 'Mark the bar starts with edit_analysis (downbeats), or measure the beat again.'],
      ['needs_analysis', 'fewer than two measured beats lie after the music\'s start', MEASURE_HINT],
      ['invalid_request', 'template tpl.birthday cuts on the beats of music: choose a music file', 'Pass musicAssetId: a sound file whose beats were measured.'],
      ['not_found', 'music asset ast_9 is not in this project'],
      ['invalid_request', 'asset ast_9 is not a sound file', 'Choose a sound-only file as the music.'],
      ['invalid_request', 'choose at least one picture or video', 'Pass media: asset ids of pictures or videos, in order.'],
      ['not_found', 'asset ast_9 is not in this project'],
      ['invalid_request', 'asset ast_9 has no picture', 'Choose pictures or videos for the slots.'],
      ['invalid_request', 'template tpl.quote has no text "sub"', 'Its texts are: title, author.'],
      ['nothing_to_do', 'the music ends before the first slot of this template does', 'Choose longer music, or start it earlier (at).'],
      ['nothing_to_do', 'the slots of this template would be shorter than one frame here', 'Choose another tempo or other music.'],
      ['nothing_to_do', 'every item of this template was edited by hand since the last run; there is nothing to make again'],
      ['invalid_request', 'this plan would need 900 operations; at most 800 fit in one step', 'Use fewer media or a shorter template.'],
      ['invalid_request', 'this plan would record 500 slots; a run holds at most 400'],
      ['needs_capability', 'template tpl.list places graphic elements, which this machine cannot draw: its ffmpeg has no SVG decoder (librsvg)', 'Install an ffmpeg build with librsvg and restart the server, or choose a template without elements.'],
      ['template_blocked', 'the template cannot regenerate like this: slot(s) s1, s3 were edited by hand and are kept where they are, but no longer lie exactly on the range this plan gives them, so the new pictures would leave frames without a picture',
        'Regenerate with the run\'s tempo (half), undo the hand edit that moved or trimmed slot(s) s1, s3, or delete that clip and regenerate with restoreRemoved: true so the template fills the slot again.'],
      // the same refusal with the next steps the server gives for other requests (the run's tempo left out; a restore request; an older run)
      ['template_blocked', 'the template cannot regenerate like this: slot(s) s1, s3 were edited by hand and are kept where they are, but no longer lie exactly on the range this plan gives them, so the new pictures would leave frames without a picture', 'Undo the hand edit that moved or trimmed slot(s) s1, s3, or delete that clip and regenerate with restoreRemoved: true so the template fills the slot again.'],
      ['template_blocked', 'the template cannot regenerate like this: slot(s) s1, s3 were edited by hand and are kept where they are, but no longer lie exactly on the range this plan gives them, so the new pictures would leave frames without a picture', 'Regenerate with the run\'s tempo (double), undo the hand edit that moved or trimmed slot(s) s1, s3, or delete that clip as well and regenerate with restoreRemoved: true again so the template makes it again too.'],
      ['template_blocked', 'the template cannot regenerate like this: slot(s) s1, s3 were edited by hand and are kept where they are, but no longer lie exactly on the range this plan gives them, so the new pictures would leave frames without a picture', 'Undo the hand edit that moved or trimmed slot(s) s1, s3, or delete that clip as well and regenerate with restoreRemoved: true again so the template makes it again too. This run was made before places were recorded, and where it placed its clips cannot be worked out again: the template has changed since (the run is of version 1, the template is version 2 now). So a clip that was only moved counts as edited.'],
      ['nothing_to_do', 'every item of this template was edited or deleted by hand since the last run; there is nothing to make again', 'Regenerate with restoreRemoved: true to make the deleted items again.'],
      ['insufficient_scope', 'this credential may only propose edits, and a template cannot be proposed: it is applied through an internal step that a proposal does not carry', 'Ask the project owner to apply the template, or for a grant in edit mode. plan_template still shows what it would do.'],
      ['not_found', 'template "tpl.nope" does not exist', 'Available: tpl.travel-montage, tpl.birthday (GET /api/v1/templates).'],
      ['not_found', 'template run run_9 not found', 'A template run id is returned by apply (runId).'],
      ['needs_capability', 'template tpl.cutout needs a model', 'Choose one of the available templates (GET /api/v1/templates).'],
    ];
    for (const [code, message, hint] of samples) {
      const f = templateRefusal('he', new ApiFailure(409, code, message, {}, hint));
      if (message !== 'template tpl.cutout needs a model') expect(latin(f.message), message).toEqual([]); // the gated sentence is W1's (translateRefusal)
      if (hint) expect(latin(f.hint ?? ''), hint).toEqual([]);
      // English keeps the server's detail; a hint written for API callers is reworded, the others stay
      const en = templateRefusal('en', new ApiFailure(409, code, message, {}, hint));
      expect(en.message.endsWith(message)).toBe(true);
      if (hint) expect(en.hint, hint).not.toMatch(/\/api\/|POST |Pass |edit_analysis|plan_template|\(at\)|runId|restoreRemoved/);
    }
  });
  it('a kept picture off its slot: the hint offers the steps the server sent, in both languages; a restore request is told to delete that clip as well and press the button again; an older run gets its sentence', () => {
    const he = TEMPLATE_STRINGS.he, en = TEMPLATE_STRINGS.en;
    const undo = 'undo the hand edit that moved or trimmed slot(s) s2';
    const del = 'or delete that clip and regenerate with restoreRemoved: true so the template fills the slot again';
    const delToo = 'or delete that clip as well and regenerate with restoreRemoved: true again so the template makes it again too';
    const older = ' This run was made before places were recorded, and where it placed its clips cannot be worked out again: the template has changed since (the run is of version 1, the template is version 2 now). So a clip that was only moved counts as edited.';
    const heUndo = 'לבטל את העריכה ביד שהזיזה או קיצרה את המשבצות';
    const heDel = `או למחוק את הקליפ וליצור מחדש עם «${he.restoreRemoved}» כדי שהתבנית תמלא את המשבצת שוב`;
    const heDelToo = `או למחוק גם את הקליפ הזה וללחוץ שוב על «${he.restoreRemoved}» כדי שהתבנית תיצור גם אותו מחדש`;
    const enDel = `or delete that clip and regenerate with “${en.restoreRemoved}” so the template fills the slot again`;
    const enDelToo = `or delete that clip as well and press “${en.restoreRemoved}” again so the template makes it again too`;
    const cases: [string, string, string][] = [
      [`Regenerate with the run's tempo (half), ${undo}, ${del}.`, `אפשר ליצור מחדש בקצב של ההחלה (${he.tempoNames.half}), ${heUndo}, ${heDel}.`, `Regenerate with the run's tempo (${en.tempoNames.half}), undo the hand edit that moved or trimmed the slots, ${enDel}.`],
      [`Undo the hand edit that moved or trimmed slot(s) s2, ${del}.`, `אפשר ${heUndo}, ${heDel}.`, `Undo the hand edit that moved or trimmed the slots, ${enDel}.`],
      [`Regenerate with the run's tempo (normal), ${undo}, ${delToo}.`, `אפשר ליצור מחדש בקצב של ההחלה (${he.tempoNames.normal}), ${heUndo}, ${heDelToo}.`, `Regenerate with the run's tempo (${en.tempoNames.normal}), undo the hand edit that moved or trimmed the slots, ${enDelToo}.`],
      [`Undo the hand edit that moved or trimmed slot(s) s2, ${delToo}.`, `אפשר ${heUndo}, ${heDelToo}.`, `Undo the hand edit that moved or trimmed the slots, ${enDelToo}.`],
      [`Undo the hand edit that moved or trimmed slot(s) s2, ${delToo}.${older}`,
        `אפשר ${heUndo}, ${heDelToo}. ההחלה הזו נוצרה בגרסה קודמת שלא רשמה איפה הונח כל קליפ, ואי אפשר לשחזר את זה עכשיו, ולכן קליפ שרק זז נחשב כאן לקליפ שנערך.`,
        `Undo the hand edit that moved or trimmed the slots, ${enDelToo}. This run was made by an earlier version that did not record where it placed each clip, and that cannot be worked out again now, so a clip that was only moved counts as edited here.`],
    ];
    for (const [server, wantHe, wantEn] of cases) {
      expect(templateHint('he', server), server).toBe(wantHe);
      expect(templateHint('en', server), server).toBe(wantEn);
      expect(latin(wantHe), server).toEqual([]);
    }
  });
  it('the bar says how many items that had only been moved are back on their places, in both languages, one and many', () => {
    expect(TEMPLATE_STRINGS.he.movedBack(1)).toBe(' פריט אחד שרק זז ממקומו חזר למקומו בתבנית.');
    expect(TEMPLATE_STRINGS.he.movedBack(3)).toBe(' 3 פריטים שרק זזו ממקומם חזרו למקומם בתבנית.');
    expect(TEMPLATE_STRINGS.en.movedBack(1)).toBe(' 1 item that had only been moved is back on its place in the template.');
    expect(TEMPLATE_STRINGS.en.movedBack(3)).toBe(' 3 items that had only been moved are back on their places in the template.');
    expect(latin(TEMPLATE_STRINGS.he.movedBack(2))).toEqual([]);
  });
  it('the planner\'s built-in-music refusals, provoked for real, are worded in Hebrew with their hints; English hints speak to a person', () => {
    const doc = createProject({ id: 'prj_bm', name: 'BM', width: 1080, height: 1920, frameRate: { num: 30, den: 1 } });
    const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
    doc.assets.img = { id: 'img', kind: 'image', name: 'i.png', contentHash: `sha256:${'6'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 1080, height: 1920, codec: 'png', hasAlpha: false }, provenance: prov };
    doc.assets.snd = { id: 'snd', kind: 'audio', name: 's.wav', contentHash: `sha256:${'4'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
    const w = (en: string) => ({ he: `${en} בעברית`, en });
    const def: TemplateDef = { id: 'tpl.bm', version: 1, name: w('BM'), hint: w('BM'), genre: 'celebration', designedFor: 'tall', tempo: { fallbackBpm: 120 }, music: { need: 'optional', startAt: 'zero' }, slots: Array.from({ length: 10 }, (_, i) => ({ key: `s${i}`, role: w('S'), accept: 'any' as const, span: { bars: 16 } })), slotUse: { mode: 'all', min: 1 }, texts: [], elements: [], sfx: [], adjust: [] };
    const refusal = (input: unknown) => { try { planTemplate(doc, def, input); } catch (e) { if (e instanceof TemplateError) return new ApiFailure(400, e.code, e.message, {}, e.hint); throw e; } throw new Error('not refused'); };
    const cases = [
      refusal({ media: ['img'], musicAssetId: 'snd', builtinMusic: { styleId: 'music.pop' } }),
      refusal({ media: ['img'], builtinMusic: { styleId: 'music.unknown' } }),
      refusal({ media: ['img'], builtinMusic: { styleId: 'music.cinematic' } }),
    ];
    const he = cases.map((e) => templateRefusal('he', e));
    expect(he.map((f) => f.hint)).toEqual(['יש לבחור מקור מוזיקה אחד: קובץ מהספרייה או מוזיקה מובנית.', 'אפשר לבחור אחד מסגנונות המוזיקה המובנית שברשימה.', 'אפשר לבחור קצב כפול או פחות קבצים, או לבחור קובץ מוזיקה מהספרייה.']);
    for (const f of he) expect(latin(f.message), f.message).toEqual([]);
    expect(he[2]!.message).toMatch(/534.*160.*300/);
    for (const e of cases) expect(templateRefusal('en', e).hint).not.toMatch(/\/api\/|musicAssetId|builtinMusic|tempo:/);
  });
  it('an unknown refusal is shown as the server wrote it; an error that is not a refusal shows its message', () => {
    expect(templateRefusal('he', new ApiFailure(500, 'internal', 'something new', {}, 'a new hint'))).toEqual({ code: 'internal', message: 'something new', hint: 'a new hint' });
    expect(templateRefusal('he', new Error('Failed to fetch'))).toEqual({ code: null, message: 'Failed to fetch' });
  });
});

describe('a template saved from a film that is not on this computer (wave 8 owntemplate, C10)', () => {
  it('is worded «לא שמורה במחשב הזה» with its next step, never "does not exist", in both languages', () => {
    const e = new ApiFailure(404, 'not_found', 'the template "tpl.own-0123456789ab" is not saved on this computer; undo still works and every clip stays editable', {}, 'Undo still works and every clip stays editable.');
    const he = templateRefusal('he', e);
    expect(he.message).toContain('התבנית הזו לא שמורה במחשב הזה; ביטול הפעולה עובד וכל קטע נשאר לעריכה');
    expect(he.message).not.toContain('אינה קיימת');
    expect(latin(he.hint!)).toEqual([]);
    expect(templateRefusal('en', e).hint).toBe('Undo still works, and every clip stays editable by hand.');
  });
});
