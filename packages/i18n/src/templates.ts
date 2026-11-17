/**
 * Interface strings of the templates and adjustment layers track (ADR-0016), spread into `he` and `en` (index.ts). Hebrew first;
 * the English dictionary must cover the same keys. Namespaces of this track: `template.*` and `adjust.*`, plus the operation
 * names (`op.*`, op-wording.test.ts), the track kind label `track.adjustment`, two palette commands and three error codes.
 */
export const TEMPLATES_HE = {
  'op.add_adjustment': 'הוספת שכבת התאמה', 'op.replace_clip_media': 'החלפת מדיה בקליפ', 'op.apply_template': 'החלת תבנית',
  'track.adjustment': 'התאמה',
  'cmd.openTemplates': 'פתיחת התבניות', 'cmd.addAdjustment': 'שכבת התאמה על כל העריכה',
  'error.code.template_blocked': 'התבנית אינה יכולה לחול כך', 'error.code.needs_capability': 'חסרה יכולת במחשב הזה', 'error.code.needs_analysis': 'נדרשת מדידת קצב',
  // templates that need a model this build does not have (templateContract.ts MODEL_GATED_TEMPLATES): shown unavailable, never run
  'template.unavailable.video-segmentation': 'דורשת מודל שמפריד את הדמות מהרקע בכל פריים, והוא אינו מותקן במחשב הזה. תבנית לעולם אינה מורידה מודלים.',
  'template.unavailable.depth-estimation': 'דורשת מודל שמעריך עומק (כמה רחוקה כל נקודה מהמצלמה), והוא אינו מותקן במחשב הזה. תבנית לעולם אינה מורידה מודלים.',
} as const;
export const TEMPLATES_EN: Record<keyof typeof TEMPLATES_HE, string> = {
  'op.add_adjustment': 'Added adjustment layer', 'op.replace_clip_media': 'Replaced clip media', 'op.apply_template': 'Applied template',
  'track.adjustment': 'Adjustment',
  'cmd.openTemplates': 'Open templates', 'cmd.addAdjustment': 'Adjustment layer over the whole edit',
  'error.code.template_blocked': 'The template cannot apply like this', 'error.code.needs_capability': 'This machine lacks a needed capability', 'error.code.needs_analysis': 'The music needs its beats measured',
  'template.unavailable.video-segmentation': 'Needs a model that separates the person from the background in every frame, which is not installed on this machine. A template never downloads models.',
  'template.unavailable.depth-estimation': 'Needs a model that estimates depth (how far each point is from the camera), which is not installed on this machine. A template never downloads models.',
};
