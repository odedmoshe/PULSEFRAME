/**
 * Words of the timeline's range marks and range cut and of the playhead drag (wave 8D P5). Hebrew first, plural forms, no gendered
 * forms; English beside it. Every refusal says why and what to do next. A track's name is isolated (U+2068 … U+2069), so «A1» stays
 * «A1» inside a Hebrew sentence.
 */
export const RANGE_STRINGS = {
  he: {
    in: 'התחלה', out: 'סוף',
    cmdIn: 'סימון התחלת טווח', cmdOut: 'סימון סוף טווח', cmdCut: 'חיתוך הטווח', cmdClear: 'ניקוי סימוני הטווח',
    flagIn: (tc: string) => `התחלת הטווח ${tc}. גררו כדי להזיז`, flagOut: (tc: string) => `סוף הטווח ${tc}. גררו כדי להזיז`,
    tint: (a: string, b: string) => `טווח מסומן ${a}–${b}`,
    cut: (len: string) => `הטווח נחתך: ${len} הוסרו מכל הרצועות`,
    needBoth: 'אין טווח לחתוך: סמנו התחלה (I) וסוף (O) בציר הזמן',
    pastEnd: 'אין חומר בטווח המסומן: הזיזו את סימון ההתחלה לפני סוף הסרט',
    locked: (names: string) => `הרצועה נעולה (\u2068${names}\u2069), ולכן אי אפשר לחתוך את הטווח בלי לשבש את הסנכרון: בטלו את הנעילה ונסו שוב`,
    noProject: 'אין פרויקט פתוח: פתחו פרויקט ואז סמנו טווח',
    seconds: (s: string) => (s === '1' ? 'שנייה אחת' : `${s} שניות`),
    playheadGrab: 'גררו כדי להזיז את סמן המיקום',
  },
  en: {
    in: 'In', out: 'Out',
    cmdIn: 'Mark range start', cmdOut: 'Mark range end', cmdCut: 'Cut the range', cmdClear: 'Clear the range marks',
    flagIn: (tc: string) => `Range start ${tc}. Drag to move`, flagOut: (tc: string) => `Range end ${tc}. Drag to move`,
    tint: (a: string, b: string) => `Marked range ${a}–${b}`,
    cut: (len: string) => `Range cut: ${len} removed from every track`,
    needBoth: 'No range to cut: mark a start (I) and an end (O) on the timeline',
    pastEnd: 'The marked range holds no material: move the start mark before the end of the film',
    locked: (names: string) => `A track is locked (\u2068${names}\u2069), so the range cannot be cut without breaking sync: unlock it and try again`,
    noProject: 'No project is open: open one, then mark a range',
    seconds: (s: string) => (s === '1' ? '1 second' : `${s} seconds`),
    playheadGrab: 'Drag to move the playhead',
  },
} as const;
export type RangeStrings = (typeof RANGE_STRINGS)['he'];
