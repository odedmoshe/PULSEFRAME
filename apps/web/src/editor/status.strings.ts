/** Words of the status bar's capability pip (design review D9): what needs setting up is named, never shown as bare dots. */
export const STATUS_STRINGS = {
  he: {
    need: (n: number) => (n === 1 ? 'יכולת אחת דורשת הכנה' : `${n} יכולות דורשות הכנה`),
    needTitle: (names: string[]) => `דורשות הכנה: ${names.join(', ')}. לחיצה פותחת את ההגדרות.`,
    allTitle: (names: string[]) => `מוכנות: ${names.join(', ')}. לחיצה פותחת את ההגדרות.`,
  },
  en: {
    need: (n: number) => (n === 1 ? '1 capability needs setting up' : `${n} capabilities need setting up`),
    needTitle: (names: string[]) => `Need setting up: ${names.join(', ')}. Press to open Settings.`,
    allTitle: (names: string[]) => `Ready: ${names.join(', ')}. Press to open Settings.`,
  },
} as const;
