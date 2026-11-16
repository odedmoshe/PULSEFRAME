import type { Lang } from '@pulseframe/i18n';
import type { PacingIssue } from '@pulseframe/core';

/** Own strings for the pacing panel (he/en). Numbers are formatted by the caller. */
export interface PacingStrings {
  title: string; strip: string; cutsRow: string; wordsRow: string; clear: string; go: string; empty: string;
  totals: (cutsPerMinute: string, wordsPerMinute: string) => string;
  cell: (from: string, to: string, cuts: number, wps: string) => string;
  issue: (i: PacingIssue, at: string, value: string, limit: string) => string;
  goTo: (at: string) => string;
}

export const pacingStrings: Record<Lang, PacingStrings> = {
  he: {
    title: 'קצב העריכה', strip: 'מפת קצב לאורך ציר הזמן', cutsRow: 'חיתוכים', wordsRow: 'מילים בשנייה', clear: 'לא נמצאו בעיות קצב.', go: 'מעבר', empty: 'אין עדיין תוכן בציר הזמן.',
    totals: (c, w) => `${c} חיתוכים בדקה · ${w} מילים בדקה`,
    cell: (from, to, cuts, wps) => `${from} עד ${to}: ${cuts} חיתוכים, ${wps} מילים בשנייה. מעבר לנקודה`,
    issue: (i, at, v, l) => {
      switch (i.code) {
        case 'static_picture': return `ב-${at} התמונה לא משתנה במשך ${v} שניות (מגבלה: ${l}).`;
        case 'rapid_cuts': return `ב-${at} יש ${v} חיתוכים בחלון אחד (מגבלה: ${l}).`;
        case 'dense_speech': return `ב-${at} הדיבור צפוף: ${v} מילים בשנייה (מגבלה: ${l}).`;
        case 'fast_captions': return `ב-${at} הכתובית מהירה מדי לקריאה: ${v} תווים בשנייה (מגבלה: ${l}).`;
        case 'speech_gap': return `ב-${at} יש הפסקה בדיבור של ${v} שניות (מגבלה: ${l}).`;
      }
    },
    goTo: (at) => `מעבר אל ${at}`,
  },
  en: {
    title: 'Pacing', strip: 'Pacing heat map along the timeline', cutsRow: 'Cuts', wordsRow: 'Words per second', clear: 'No pacing problems found.', go: 'Go', empty: 'Nothing on the timeline yet.',
    totals: (c, w) => `${c} cuts per minute · ${w} words per minute`,
    cell: (from, to, cuts, wps) => `${from} to ${to}: ${cuts} cuts, ${wps} words per second. Go to start`,
    issue: (i, at, v, l) => {
      switch (i.code) {
        case 'static_picture': return `At ${at} the picture does not change for ${v} seconds (limit ${l}).`;
        case 'rapid_cuts': return `At ${at} there are ${v} cuts in one window (limit ${l}).`;
        case 'dense_speech': return `At ${at} the speech is dense: ${v} words per second (limit ${l}).`;
        case 'fast_captions': return `At ${at} a caption is too fast to read: ${v} characters per second (limit ${l}).`;
        case 'speech_gap': return `At ${at} there is a ${v} second pause in the speech (limit ${l}).`;
      }
    },
    goTo: (at) => `Go to ${at}`,
  },
};
