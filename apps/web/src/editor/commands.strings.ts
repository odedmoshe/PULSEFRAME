/**
 * Words of the commands that have no entry in the shared dictionary yet (packages/i18n): the cut's keys, delete keeping the
 * gap, and the toasts the delete commands show. The palette and the shortcuts list read them through `Command.text`.
 */
export const COMMAND_STRINGS = {
  he: {
    deleteKeepGap: 'מחיקה והשארת הרווח',
    cutRollEarlier5: 'גלגול החיתוך: 5 פריימים מוקדם יותר',
    cutRollLater5: 'גלגול החיתוך: 5 פריימים מאוחר יותר',
    cutToBeat: 'הזזת החיתוך לפעימה הקרובה',
    exportOpen: 'ייצוא…',
    deleted: (n: number) => (n === 1 ? 'הקליפ נמחק' : `${n} קליפים נמחקו`),
    rippled: (n: number) => (n === 0 ? 'הרווח נסגר' : n === 1 ? 'הרווח נסגר · קליפ אחד זז אחורה' : `הרווח נסגר · ${n} קליפים זזו אחורה`),
  },
  en: {
    deleteKeepGap: 'Delete and keep the gap',
    cutRollEarlier5: 'Roll the cut five frames earlier',
    cutRollLater5: 'Roll the cut five frames later',
    cutToBeat: 'Move the cut to the nearest beat',
    exportOpen: 'Export…',
    deleted: (n: number) => (n === 1 ? 'Clip deleted' : `${n} clips deleted`),
    rippled: (n: number) => (n === 0 ? 'Gap closed' : n === 1 ? 'Gap closed · 1 clip moved earlier' : `Gap closed · ${n} clips moved earlier`),
  },
} as const;
