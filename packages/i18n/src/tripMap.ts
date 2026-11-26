/**
 * Strings of «מפת טיול» — the trip map (wave 8 tripmap track; core mapContract.ts). Spread into `he` and `en` (index.ts); Hebrew first,
 * plural address, no gendered forms; the English dictionary covers the same keys. Nothing is called checked, right or safe: the looks
 * have not been looked at (tripMap.unseen). The map is feminine («המפה»): the timing line is «התזמון לפי התיבות של» (tripmap-verify C11).
 * Namespaces: `op.*`, `tripMap.*` (the interface; W3 reads them through editor/tripMap/tripMap.strings.ts).
 * Also here: HE_TRIPMAP, the Hebrew of every refusal of the three operations and of the kind's document checks (core MAP_REFUSALS),
 * each with the next step.
 */
const TRIPMAP_HE_BASE = {
  'op.add_trip_map': 'הוספת מפת טיול', 'op.update_trip_map': 'שינוי מפת טיול', 'op.time_trip_map': 'תזמון מפת טיול',
} as const;
const TRIPMAP_EN_BASE: Record<keyof typeof TRIPMAP_HE_BASE, string> = {
  'op.add_trip_map': 'Added a trip map', 'op.update_trip_map': 'Changed a trip map', 'op.time_trip_map': 'Timed a trip map',
};
/** `tripMap.<key>`; {placeholders} are filled by tripMap.strings.ts. Numbers, coordinates and times are drawn in <bdi dir="ltr">. */
export const TRIPMAP_EXTRA = {
  he: {
    'new': 'מפת טיול חדשה', 'title': 'מפת טיול', 'edit': 'עריכת המפה', 'create': 'יצירה', 'save': 'שמירת השינויים', 'cancel': 'ביטול',
    'search': 'לאן נסעתם? הקלידו מקום', 'searchLabel': 'חיפוש מקום', 'notInList': 'לא מצאנו את המקום ברשימה. לחצו עליו במפה',
    'pickOnMap': 'בחרו את המקום על המפה', 'pickHelp': 'חצים: הזזה ב־0.1°, Shift עם חצים: 1°, + ו־−: זום, Enter: הצבה, Escape: ביטול',
    'viewNear': 'ישראל והסביבה', 'viewWorld': 'כל העולם',
    'stops': 'העצירות', 'stop': 'עצירה {n}', 'addStop': 'הוספת עצירה', 'stopName': 'שם העצירה', 'hideName': 'הסתרת השם', 'remove': 'הסרה', 'up': 'למעלה', 'down': 'למטה',
    'mode': 'איך נסעתם', 'mode.road': 'ברכב', 'mode.flight': 'בטיסה', 'mode.boat': 'בשיט',
    'look': 'המראה', 'look.paper': 'נייר', 'look.night': 'לילה',
    'camera': 'המצלמה', 'camera.whole': 'כל המסלול',
    'length': 'אורך', 'seconds': 'שניות',
    'bars': 'לפי התיבות של המוזיקה', 'barsNoMusic': 'אין מוזיקה מנותחת בתחילת המפה', 'barsNoBars': 'במוזיקה שבתחילת המפה לא נמצאו תיבות',
    'timedTo': 'התזמון לפי התיבות של: {name}', 'retime': 'תזמון מחדש', 'snapped': 'ההגעות מעוגלות לפריים הקרוב',
    'labelHidden': 'השם "{name}" לא הוצג: אין לו מקום. הסתירו שם אחר או הגדילו את המפה',
    'unseen': 'המראה של המפות עוד לא נבדק בעין', 'coastsOnly': 'הקווים: קווי חוף ואגמים בלבד, בלי גבולות', 'roadStraight': 'כביש מצויר כקו ישר, לא לפי הדרך',
    'agents': 'שמות העצירות ומיקום מעוגל (כקילומטר) גלויים לסוכנים מחוברים, כמו כל כותרת',
    'listSource': 'רשימת המקומות והקווים: Natural Earth, נחלת הכלל', 'credit': 'נעשה עם Natural Earth (Made with Natural Earth)',
    'timelineLabel': 'מפה: {stops}',
    'notBuilt': 'מפת הטיול עוד לא בנויה בגרסה הזו של העורך',
    'panelLead': 'העצירות, המראה והתזמון של המפה', 'stopsCount': '{n} עצירות',
    'close': 'סגירה', 'searchNone': 'אין התאמה ברשימה', 'pickButton': 'בחירה על המפה', 'stopsEmpty': 'עוד לא הוספתם עצירות. חפשו מקום, או בחרו אותו על המפה',
    'needStops': 'צריך לפחות שתי עצירות כדי ליצור מפה', 'needName': 'לעצירה {n} אין שם. כתבו שם, או הסתירו אותו', 'needShown': 'צריך להשאיר שם גלוי לעצירה אחת לפחות',
    'tooShort': 'אורך המפה קצר מדי ל־{n} עצירות: צריך לפחות {min} שניות', 'lengthFrames': '{frames} פריימים', 'view': 'התצוגה',
    'place': 'הצבה', 'pickCancel': 'ביטול הבחירה', 'crosshairAt': 'מיקום הסמן: קו רוחב {lat}, קו אורך {lon}', 'zoomIn': 'התקרבות', 'zoomOut': 'התרחקות',
    'pickNotDrawn': 'המפה עוד לא מצוירת בגרסה הזו: {why}. אפשר לבחור מקום בחצים, והמיקום מוצג מתחת', 'pickNoClick': 'אי אפשר לבחור בלחיצה כרגע. השתמשו בחצים וב־Enter',
    'timingEven': 'התזמון: הגעות במרווחים שווים', 'working': 'שומרים…', 'staleRetry': 'המסמך השתנה בינתיים וטענו אותו מחדש. בדקו ונסו שוב',
    'panelLook': 'המראה: {look}', 'panelNames': 'שמות: {names}', 'listLoading': 'טוענים את רשימת המקומות…', 'listFailed': 'רשימת המקומות לא נטענה. אפשר לבחור מקום על המפה',
    'hiddenName': 'השם מוסתר', 'legMode': 'איך נסעתם אל {name}', 'viaPoint': 'נקודת מעבר',
  },
  en: {
    'new': 'New trip map', 'title': 'Trip map', 'edit': 'Edit the map', 'create': 'Create', 'save': 'Save changes', 'cancel': 'Cancel',
    'search': 'Where did you go? Type a place', 'searchLabel': 'Search for a place', 'notInList': 'We did not find this place in the list. Click it on the map',
    'pickOnMap': 'Choose the place on the map', 'pickHelp': 'Arrows: move 0.1°, Shift with arrows: 1°, + and −: zoom, Enter: place, Escape: cancel',
    'viewNear': 'Israel and around', 'viewWorld': 'The whole world',
    'stops': 'Stops', 'stop': 'Stop {n}', 'addStop': 'Add a stop', 'stopName': 'Stop name', 'hideName': 'Hide the name', 'remove': 'Remove', 'up': 'Up', 'down': 'Down',
    'mode': 'How you travelled', 'mode.road': 'By car', 'mode.flight': 'By plane', 'mode.boat': 'By boat',
    'look': 'Look', 'look.paper': 'Paper', 'look.night': 'Night',
    'camera': 'Camera', 'camera.whole': 'The whole route',
    'length': 'Length', 'seconds': 'seconds',
    'bars': 'On the bars of the music', 'barsNoMusic': 'No analysed music at the start of the map', 'barsNoBars': 'No bars were found in the music at the start of the map',
    'timedTo': 'Timed to the bars of: {name}', 'retime': 'Time again', 'snapped': 'Arrivals are rounded to the nearest frame',
    'labelHidden': 'The name "{name}" was not shown: there is no room for it. Hide another name or make the map bigger',
    'unseen': 'Nobody has looked at how the maps look yet', 'coastsOnly': 'Lines: coastlines and lakes only, no borders', 'roadStraight': 'A car leg is drawn as a straight line, not along the road',
    'agents': 'Stop names and rounded positions (about a kilometre) are visible to connected agents, like any title',
    'listSource': 'Place list and lines: Natural Earth, public domain', 'credit': 'Made with Natural Earth',
    'timelineLabel': 'Map: {stops}',
    'notBuilt': 'Trip maps are not built in this version of the editor yet',
    'panelLead': 'The map\'s stops, look and timing', 'stopsCount': '{n} stops',
    'close': 'Close', 'searchNone': 'No match in the list', 'pickButton': 'Choose on the map', 'stopsEmpty': 'No stops yet. Search for a place, or choose one on the map',
    'needStops': 'At least two stops are needed to make a map', 'needName': 'Stop {n} has no name. Type one, or hide it', 'needShown': 'Leave the name of at least one stop showing',
    'tooShort': 'The map is too short for {n} stops: it needs at least {min} seconds', 'lengthFrames': '{frames} frames', 'view': 'View',
    'place': 'Place', 'pickCancel': 'Cancel the choice', 'crosshairAt': 'Crosshair: latitude {lat}, longitude {lon}', 'zoomIn': 'Zoom in', 'zoomOut': 'Zoom out',
    'pickNotDrawn': 'The map is not drawn in this version yet: {why}. You can choose a place with the arrows; the position is shown below', 'pickNoClick': 'Clicking to choose is not available now. Use the arrows and Enter',
    'timingEven': 'Timing: arrivals evenly spaced', 'working': 'Saving…', 'staleRetry': 'The project changed meanwhile and was loaded again. Look and try again',
    'panelLook': 'Look: {look}', 'panelNames': 'Names: {names}', 'listLoading': 'Loading the list of places…', 'listFailed': 'The list of places did not load. You can choose a place on the map',
    'hiddenName': 'Name hidden', 'legMode': 'How you travelled to {name}', 'viaPoint': 'Via-point',
  },
} as const;
const prefixed = <T extends Record<string, string>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`tripMap.${k}`, v])) as { [K in keyof T as `tripMap.${K & string}`]: string };
export const TRIPMAP_HE = { ...TRIPMAP_HE_BASE, ...prefixed(TRIPMAP_EXTRA.he) };
export const TRIPMAP_EN: Record<keyof typeof TRIPMAP_HE, string> = { ...TRIPMAP_EN_BASE, ...prefixed(TRIPMAP_EXTRA.en) };

export const HE_TRIPMAP: [RegExp, (m: RegExpExecArray) => string][] = [
  // core MAP_REFUSALS (the three ops and the kind's document checks)
  [/^(\w+): trip maps are not built in this build yet$/, () => 'מפת הטיול עוד לא בנויה בגרסה הזו של העורך. שום דבר לא השתנה; אפשר לעדכן את העורך ולנסות שוב'],
  [/^a trip map has 2 to 12 stops, not (\d+)$/, () => 'במפה יש בין 2 ל־12 עצירות. הוסיפו או הסירו עצירות'],
  [/^stop (\d+) has an empty name or one longer than 40 characters$/, (m) => `לעצירה ${m[1]} אין שם, או שהשם ארוך מ־40 תווים. כתבו שם קצר יותר, או הסתירו את השם`],
  [/^every stop of the map is hidden$/, () => 'כל השמות במפה מוסתרים. הציגו את השם של עצירה אחת לפחות'],
  [/^stop (\d+) is off the map: latitude must lie between -80 and 80, longitude between -180 and 180$/, (m) => `עצירה ${m[1]} מחוץ למפה: קו רוחב בין ‎−80‎ ל־80. בחרו מקום קרוב יותר לקו המשווה`],
  [/^stops (\d+) and (\d+) are at the same place$/, (m) => `עצירות ${m[1]} ו־${m[2]} באותו מקום. הסירו אחת מהן או הזיזו אותה`],
  [/^two stops of the map have the same id$/, () => 'לשתי עצירות יש אותו מזהה. תנו לכל עצירה מזהה משלה, או השאירו את המזהים ריקים'],
  [/^arrival times must be given on every stop or on none, and must increase from stop to stop$/, () => 'זמני ההגעה צריכים להופיע בכל העצירות או באף אחת, ולעלות מעצירה לעצירה. השאירו אותם ריקים כדי לפזר את העצירות באופן שווה'],
  [/^the first stop has no leg into it, so it has no travel mode$/, () => 'לעצירה הראשונה אין דרך שמגיעה אליה, ולכן אין לה דרך נסיעה. בחרו את דרך הנסיעה בעצירה שאליה מגיעים'],
  [/^the map is too short for (\d+) legs: each leg needs at least (\d+) frames \(one second\)$/, () => 'המפה קצרה מדי: לכל קטע דרך צריך לפחות שנייה. האריכו את המפה או הסירו עצירה'],
  [/^no analysed music with bar starts plays at the start of the map$/, () => 'אין מוזיקה מנותחת בתחילת המפה. שימו מוזיקה מנותחת מתחת לתחילת המפה, או השאירו תזמון שווה'],
  [/^no bars were found in the music under the map$/, () => 'במוזיקה שמתחת למפה לא נמצאו תיבות. השאירו תזמון שווה'],
  [/^the music under the map has (\d+) bar starts in the map's time; (\d+) are needed$/, (m) => `במוזיקה שמתחת למפה יש ${m[1]} תיבות בזמן המפה, וצריך ${m[2]}. האריכו את המפה, הסירו עצירה או השאירו תזמון שווה`],
  [/^clip (\S+) is not a trip map$/, () => 'הקליפ הזה אינו מפת טיול. בחרו מפת טיול בציר הזמן'],
];
