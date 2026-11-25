/**
 * Words of the send components (wave 7, track send), Hebrew first. Worker C adds what the components need; the shared, decided
 * wording (tile name, «לא אומת», «מעבר לקטע», finding names, limiter, match) lives in packages/i18n/src/send.ts (`send.*`).
 * Numbers and sizes are shown in <bdi dir="ltr" class="num">. Nothing says a file is fine or what an app will do with it.
 */
export const SEND_STRINGS = {
  he: {
    fitted: (w: number, h: number, mb: string) => `התמונה תוקטן ל־${w}×${h} כדי להיכנס ל־${mb} מ״ב`,
    keeps: (w: number, h: number) => `התמונה נשארת ${w}×${h}`,
    fitLine: (got: string, target: string, attempt: number) => `${got} מתוך ${target} מ״ב · ניסיון ${attempt}`,
    quiet: 'לא נמצאו: תמונה שחורה, תמונה קפואה, שקט ארוך, קול חתוך',
    reduction: (db: string) => `המגביל מוריד ${db} dB`,
  },
  en: {
    fitted: (w: number, h: number, mb: string) => `The picture will be made ${w}×${h} to fit in ${mb} MB`,
    keeps: (w: number, h: number) => `The picture stays ${w}×${h}`,
    fitLine: (got: string, target: string, attempt: number) => `${got} of ${target} MB · attempt ${attempt}`,
    quiet: 'Not found: black picture, frozen picture, long silence, clipped sound',
    reduction: (db: string) => `The limiter takes off ${db} dB`,
  },
} as const;
