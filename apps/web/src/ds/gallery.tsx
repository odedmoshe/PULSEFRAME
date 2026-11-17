/** Development-only gallery (ds.html): every primitive in every state, Hebrew and English, dark and light. ?lang=he|en&theme=dark|light */
import { Fragment, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, Captions, Clapperboard, Download, Palette, Scissors, Sparkles } from 'lucide-react';
import { IconBeatLock, IconFlashShield, IconMainMagnet, IconPlay, IconRippleDelete, IconTimecode } from '../editor/icons.tsx';
import './tokens.css';
import './uiFonts.ts';
import './primitives.css';
import './gallery.css';
import {
  AnchoredError, Badge, Button, Chip, Dialog, IconButton, JobRow, Kbd, Keys, Menu, ModeBar, ProgressBar, PropertyRow, Ring, ScrubField, Section, Seg, Slider, Switch, Tabs, Tile,
  Tooltip, ToastProvider, ToastView, useToasts, type ButtonVariant,
} from './index.ts';

type Lang = 'he' | 'en';
const T = {
  he: {
    title: 'מערכת העיצוב · דופק', lang: 'שפה', theme: 'ערכת נושא', dark: 'כהה', light: 'בהירה',
    buttons: 'כפתורים', variants: { primary: 'ייצוא', secondary: 'ביטול', ghost: 'הצגה', pulse: 'נעילה לפעימה', 'danger-quiet': 'מחיקה', danger: 'מחיקה סופית' } as Record<ButtonVariant, string>,
    states: ['רגיל', 'ריחוף', 'לחוץ', 'מיקוד', 'לא זמין', 'בעבודה'], reason: 'בחרו קליפ קודם', sizes: 'גדלים 28 · 32 · 40', iconButtons: 'כפתורי אייקון',
    selection: 'בחירה', modes: ['עריכה', 'מראה', 'סאונד', 'כתוביות', 'מסירה'], modeLabel: 'מצבי עבודה', segLabel: 'יחס מסך', seg: ['16:9', '9:16', '1:1'], chips: ['הכול', 'מעברים', 'אפקטים'], badges: ['חדש', 'פעימה', 'עוזר', 'מוכן', 'להגדרה', 'MP4'], switches: ['להנמיך כשמדברים', 'נעילה לפעימה', 'כבוי', 'לא זמין'], keys: 'מקשים', tooltip: 'פיצול בנקודת הסמן', tooltipReason: 'בחרו קליפ קודם',
    fields: 'שדות', scrubFields: 'שדות גרירה', dragNote: 'גררו הצידה, לחצו להקלדה, חצים ±1, Shift ±10, Alt+לחיצה לאיפוס', sliders: 'מחוונים', spatial: 'מרחבי (שמאל לימין)', magnitude: 'עוצמה (לפי כיוון הקריאה)', bipolar: 'דו־כיווני', beatLinked: 'מקושר לפעימה', disabledSl: 'לא זמין',
    properties: 'שורות מאפיינים', props: ['אטימות', 'מיקום X', 'עוצמה', 'זווית'], section: 'טרנספורם', sectionClosed: 'צבע', summary: '· 100% · רגיל', reset: 'איפוס', help: 'עזרה', helpText: 'כשמפעילים נעילה לפעימה, כל שינוי מתיישר לפעימה הקרובה.',
    tabs: 'לשוניות', tabNames: ['קליפ', 'אפקטים', 'קול', 'כתוביות', 'מסירה'], tabsLabel: 'מאפייני הקליפ',
    tiles: 'אריחים', tileNames: ['רגיל', 'מתנגן', 'הוחל', 'מועדף', 'פעימה', 'מתאים', 'יקצר', 'מוחזק', 'טוען', 'לא זמין'], beat: 'פעימה', fits: 'מתאים', shortens: 'יקצר 0.2 ש׳', held: 'תצוגה מוחזקת לבטיחות', unavailable: 'דורש הגדרה', applied: 'הוחל', fav: 'מועדף',
    feedback: 'משוב', toastUndo: 'הקליפ נמחק והרווח נסגר', toastUndoBody: '4 קליפים זזו', undo: 'ביטול', toastReceipt: 'העוזר הוסיף מעבר', toastReceiptBody: 'חיתוך 0:08 · קבלה', toastFix: 'המעבר לא נוסף', toastFixBody: 'אין מספיק חומר בקצה הקליפ', fix: 'קיצור ב־0.25 ש׳ ותיקון', error: 'לא הצלחנו לשמור את השם. בדקו את החיבור ונסו שוב.', retry: 'ניסיון חוזר', live: 'הודעה חיה',
    progress: 'התקדמות', export: 'ייצוא הסרטון', jobs: ['ייצוא 1080×1920', 'כתוביות', 'הסרת רעש', 'שדרוג'], jobStates: ['בעבודה', 'הושלם', 'נכשל', 'להגדרה', 'בתור'],
    overlays: 'חלוניות', openDialog: 'פתיחת חלון', openSheet: 'פתיחת גיליון', openMenu: 'תפריט', dialogTitle: 'מחיקת הפרויקט?', dialogBody: 'המחיקה סופית. אפשר לייצא עותק לפני כן.', confirm: 'מחיקה', cancel: 'ביטול', close: 'סגירה',
    menu: ['חיתוך', 'העתקה', 'הדבקה', 'מחיקה'],
  },
  en: {
    title: 'Design system · Pulse', lang: 'Language', theme: 'Theme', dark: 'Dark', light: 'Light',
    buttons: 'Buttons', variants: { primary: 'Export', secondary: 'Cancel', ghost: 'Show', pulse: 'Lock to beat', 'danger-quiet': 'Delete', danger: 'Delete for good' } as Record<ButtonVariant, string>,
    states: ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled', 'Busy'], reason: 'Select a clip first', sizes: 'Sizes 28 · 32 · 40', iconButtons: 'Icon buttons',
    selection: 'Selection', modes: ['Edit', 'Look', 'Sound', 'Captions', 'Deliver'], modeLabel: 'Work modes', segLabel: 'Aspect', seg: ['16:9', '9:16', '1:1'], chips: ['All', 'Transitions', 'Effects'], badges: ['New', 'Beat', 'Assistant', 'Ready', 'Setup', 'MP4'], switches: ['Duck while speaking', 'Lock to beat', 'Off', 'Unavailable'], keys: 'Key caps', tooltip: 'Split at the playhead', tooltipReason: 'Select a clip first',
    fields: 'Fields', scrubFields: 'Scrub fields', dragNote: 'Drag sideways, click to type, arrows ±1, Shift ±10, Alt+click resets', sliders: 'Sliders', spatial: 'Spatial (always left to right)', magnitude: 'Magnitude (follows reading direction)', bipolar: 'Bipolar', beatLinked: 'Beat-linked', disabledSl: 'Disabled',
    properties: 'Property rows', props: ['Opacity', 'Position X', 'Volume', 'Rotation'], section: 'Transform', sectionClosed: 'Colour', summary: '· 100% · Normal', reset: 'Reset', help: 'Help', helpText: 'With beat lock on, every change snaps to the nearest beat.',
    tabs: 'Tabs', tabNames: ['Clip', 'Effects', 'Sound', 'Captions', 'Deliver'], tabsLabel: 'Clip properties',
    tiles: 'Tiles', tileNames: ['Idle', 'Playing', 'Applied', 'Favourite', 'Beat', 'Fits', 'Shortens', 'Held', 'Loading', 'Unavailable'], beat: 'Beat', fits: 'Fits', shortens: 'Shortens 0.2 s', held: 'Preview held for safety', unavailable: 'Needs setup', applied: 'Applied', fav: 'Favourite',
    feedback: 'Feedback', toastUndo: 'Clip deleted and the gap closed', toastUndoBody: '4 clips moved', undo: 'Undo', toastReceipt: 'The assistant added a transition', toastReceiptBody: 'Cut 0:08 · receipt', toastFix: 'The transition was not added', toastFixBody: 'Not enough footage at the clip edge', fix: 'Shorten by 0.25 s and fix', error: 'We could not save the name. Check the connection and try again.', retry: 'Try again', live: 'Live toast',
    progress: 'Progress', export: 'Exporting the video', jobs: ['Export 1080×1920', 'Captions', 'Noise removal', 'Upscale'], jobStates: ['Running', 'Done', 'Failed', 'Needs setup', 'Queued'],
    overlays: 'Overlays', openDialog: 'Open dialog', openSheet: 'Open sheet', openMenu: 'Menu', dialogTitle: 'Delete the project?', dialogBody: 'Deleting is permanent. You can export a copy first.', confirm: 'Delete', cancel: 'Cancel', close: 'Close',
    menu: ['Cut', 'Copy', 'Paste', 'Delete'],
  },
} as const;

const params = new URLSearchParams(location.search);
const initialLang: Lang = params.get('lang') === 'en' ? 'en' : 'he';
const initialTheme = params.get('theme') === 'light' ? 'light' : 'dark';

const MODE_ICONS = [<Scissors key="e" size={16} />, <Palette key="l" size={16} />, <AudioLines key="s" size={16} />, <Captions key="c" size={16} />, <Download key="d" size={16} />];
const MODE_TINTS = ['var(--pf-m-edit)', 'var(--pf-m-look)', 'var(--pf-m-sound)', 'var(--pf-m-captions)', 'var(--pf-m-deliver)'];
const HUES = [200, 280, 20, 150, 330, 60, 240, 100, 0, 180];
/** A synthetic still for the gallery only (the product's tiles draw the evaluate + compositor frame, ADR-0005). */
const Scene = ({ hue }: { hue: number }) => (
  <svg className="g-scene" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id={`g${hue}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={`hsl(${hue} 55% 38%)`} /><stop offset="1" stopColor={`hsl(${(hue + 50) % 360} 60% 18%)`} /></linearGradient></defs>
    <rect width="160" height="90" fill={`url(#g${hue})`} /><circle cx="118" cy="30" r="12" fill={`hsl(${hue} 80% 75%)`} opacity=".8" /><path d="M0 90 40 52 76 74 112 46 160 80V90Z" fill={`hsl(${hue} 35% 12%)`} opacity=".8" />
  </svg>
);

const Card = ({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) => <section className={`g-card${wide ? ' wide' : ''}`}><h2>{title}</h2>{children}</section>;

function Gallery() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme);
  const s = T[lang];
  useEffect(() => {
    const h = document.documentElement;
    h.lang = lang; h.dir = lang === 'he' ? 'rtl' : 'ltr'; h.dataset.theme = theme;
    history.replaceState(null, '', `?lang=${lang}&theme=${theme}`);
  }, [lang, theme]);
  const [mode, setMode] = useState('edit');
  const [aspect, setAspect] = useState('16:9');
  const [pressedSeg, setPressedSeg] = useState('9:16');
  const [chip, setChip] = useState(true);
  const [sw, setSw] = useState([true, false]);
  const [vals, setVals] = useState({ a: 100, x: 12.5, db: -9, deg: 0 });
  const [sl, setSl] = useState({ op: 70, x: 30, pan: -40, beat: 50 });
  const [tab, setTab] = useState('clip');
  const [tabC, setTabC] = useState('effects');
  const [dlg, setDlg] = useState(false);
  const [sheet, setSheet] = useState(false);
  const toasts = useToasts();
  const modeIds = ['edit', 'look', 'sound', 'captions', 'deliver'];
  const tabIds = ['clip', 'effects', 'sound', 'captions', 'deliver'];
  const tabIcons = [<Clapperboard key="1" size={16} />, <Sparkles key="2" size={16} />, <AudioLines key="3" size={16} />, <Captions key="4" size={16} />, <Download key="5" size={16} />];
  const tabSpecs = tabIds.map((id, i) => ({ id, label: s.tabNames[i]!, icon: tabIcons[i], count: i === 1 ? 3 : undefined }));
  const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'pulse', 'danger-quiet', 'danger'];
  const tileFlags = [{}, { 'hover-playing': true }, { applied: true }, { favourite: true }, { beat: true }, { fits: true }, { shortens: true }, { held: true }, { loading: true }, { unavailable: true }] as const;

  return (
    <div className="g-page">
      <div className="g-top">
        <h1>{s.title}</h1>
        <Seg label={s.lang} size="sm" value={lang} onChange={(v) => setLang(v as Lang)} options={[{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} />
        <Seg label={s.theme} size="sm" value={theme} onChange={(v) => setTheme(v as 'dark' | 'light')} options={[{ value: 'dark', label: s.dark }, { value: 'light', label: s.light }]} />
      </div>

      <div className="g-grid">
        <Card title={s.buttons} wide>
          <div className="g-matrix">
            <span />{s.states.map((x) => <span key={x}>{x}</span>)}
            {variants.map((v) => (
              <Fragment key={v}>
                <span key={`${v}-n`}>{v}</span>
                <Button key={`${v}-d`} variant={v}>{s.variants[v]}</Button>
                <Button key={`${v}-h`} variant={v} className="is-hover">{s.variants[v]}</Button>
                <Button key={`${v}-p`} variant={v} className="is-pressed">{s.variants[v]}</Button>
                <Button key={`${v}-f`} variant={v} className="is-focus">{s.variants[v]}</Button>
                <Button key={`${v}-x`} variant={v} disabledReason={s.reason}>{s.variants[v]}</Button>
                <Button key={`${v}-b`} variant={v} busy>{s.variants[v]}</Button>
              </Fragment>
            ))}
          </div>
          <h3>{s.sizes}</h3>
          <div className="g-row">
            <Button size="sm" variant="primary">{s.variants.primary}</Button><Button size="md" variant="primary">{s.variants.primary}</Button><Button size="lg" variant="primary" icon={<Download size={16} />}>{s.variants.primary}</Button>
            <Button size="sm" icon={<Scissors size={14} />}>{s.variants.secondary}</Button><Button size="lg" variant="pulse" icon={<IconBeatLock size={16} />}>{s.variants.pulse}</Button>
          </div>
          <h3>{s.iconButtons}</h3>
          <div className="g-row">
            <IconButton label={s.tooltip} keys={['S']} icon={<Scissors size={18} />} />
            <IconButton label={s.tooltip} keys={['S']} size="sm" icon={<Scissors size={16} />} />
            <IconButton label={s.tooltip} icon={<IconPlay size={18} />} pressed />
            <IconButton label={s.tooltip} icon={<IconRippleDelete size={18} />} disabledReason={s.reason} />
            <IconButton label={s.tooltip} icon={<IconMainMagnet size={18} />} pressed />
            <IconButton label={s.tooltip} icon={<IconTimecode size={18} />} />
            <IconButton label={s.tooltip} icon={<IconFlashShield size={18} />} variant="secondary" />
          </div>
        </Card>

        <Card title={s.selection}>
          <h3>{s.modeLabel}</h3>
          <ModeBar label={s.modeLabel} value={mode} onChange={setMode} options={modeIds.map((id, i) => ({ value: id, label: s.modes[i]!, icon: MODE_ICONS[i], tint: MODE_TINTS[i] }))} />
          <ModeBar label={s.modeLabel} iconOnly value={mode} onChange={setMode} options={modeIds.map((id, i) => ({ value: id, label: s.modes[i]!, icon: MODE_ICONS[i], tint: MODE_TINTS[i] }))} />
          <h3>Seg · radio · pressed · block</h3>
          <div className="g-row">
            <Seg label={s.segLabel} value={aspect} onChange={setAspect} options={s.seg.map((v) => ({ value: v, label: <span className="num">{v}</span> }))} />
            <Seg label={s.segLabel} size="sm" semantics="pressed" value={pressedSeg} onChange={setPressedSeg} options={s.seg.map((v, i) => ({ value: v, label: <span className="num">{v}</span>, disabled: i === 2 }))} />
          </div>
          <Seg label={s.segLabel} block value={aspect} onChange={setAspect} options={s.seg.map((v) => ({ value: v, label: <span className="num">{v}</span> }))} />
          <h3>Chip · Badge</h3>
          <div className="g-row">
            <Chip pressed={chip} onClick={() => setChip(!chip)} count={12}>{s.chips[0]}</Chip><Chip count={4}>{s.chips[1]}</Chip><Chip>{s.chips[2]}</Chip>
          </div>
          <div className="g-row">
            <Badge tone="frame">{s.badges[0]}</Badge><Badge tone="pulse" icon={<IconBeatLock size={12} />}>{s.badges[1]}</Badge><Badge tone="agent">{s.badges[2]}</Badge><Badge tone="ok">{s.badges[3]}</Badge>
            <Badge tone="attention">{s.badges[4]}</Badge><Badge tone="hollow" mono>{s.badges[5]}</Badge><Badge>{s.badges[0]}</Badge>
          </div>
        </Card>

        <Card title={`${s.switches[0]} · Switch · Kbd · Tooltip`}>
          <div className="g-stack">
            <Switch checked={sw[0]!} onChange={(v) => setSw([v, sw[1]!])} label={s.switches[0]} />
            <Switch checked={sw[1]!} onChange={(v) => setSw([sw[0]!, v])} label={s.switches[1]} tone="pulse" />
            <Switch checked={false} onChange={() => undefined} label={s.switches[2]} />
            <Switch checked disabled onChange={() => undefined} label={s.switches[3]} />
          </div>
          <h3>{s.keys}</h3>
          <div className="g-row"><Kbd k="S" /><Kbd k="J" /><Kbd k="K" /><Kbd k="L" /><Keys keys={['Ctrl', 'Shift', 'Z']} /><Keys keys={['Shift', '1']} /><Kbd k="Space" /></div>
          <h3>Tooltip</h3>
          <div className="g-row">
            <span className="pf-ds pf-tip g-demo-tip"><span>{s.tooltip}</span><Keys keys={['S']} /></span>
            <span className="pf-ds pf-tip is-reason g-demo-tip"><span>{s.tooltipReason}</span></span>
            <Tooltip label={s.tooltip} keys={['S']}><Button size="sm">{s.states[1]}</Button></Tooltip>
          </div>
        </Card>

        <Card title={s.fields}>
          <h3>{s.scrubFields}</h3>
          <div className="g-row" style={{ inlineSize: 400 }}>
            <div style={{ inlineSize: 92 }}><ScrubField label={s.props[0]} value={vals.a} min={0} max={100} step={1} unit="%" defaultValue={100} onChange={(v) => setVals({ ...vals, a: v })} /></div>
            <div style={{ inlineSize: 92 }}><ScrubField label={s.props[1]} value={vals.x} min={-100} max={100} step={0.5} unit="px" defaultValue={0} onChange={(v) => setVals({ ...vals, x: v })} /></div>
            <div style={{ inlineSize: 92 }}><ScrubField label={s.props[2]} value={vals.db} min={-24} max={12} step={0.5} unit="dB" defaultValue={0} onChange={(v) => setVals({ ...vals, db: v })} /></div>
            <div style={{ inlineSize: 92 }}><ScrubField label={s.props[3]} value={vals.deg} min={-180} max={180} step={1} unit="°" disabled onChange={() => undefined} /></div>
          </div>
          <p style={{ margin: 0, color: 'var(--pf-text-2)', fontSize: 'var(--pf-fs-xs)' }}>{s.dragNote}</p>
          <h3>{s.sliders}</h3>
          <div className="g-stack">
            <span style={{ fontSize: 'var(--pf-fs-xs)', color: 'var(--pf-text-2)' }}>{s.spatial}</span>
            <Slider kind="spatial" label={s.props[1]} value={sl.x} min={0} max={100} onChange={(v) => setSl({ ...sl, x: v })} />
            <span style={{ fontSize: 'var(--pf-fs-xs)', color: 'var(--pf-text-2)' }}>{s.magnitude}</span>
            <Slider kind="magnitude" label={s.props[0]} value={sl.op} min={0} max={100} onChange={(v) => setSl({ ...sl, op: v })} />
            <span style={{ fontSize: 'var(--pf-fs-xs)', color: 'var(--pf-text-2)' }}>{s.bipolar}</span>
            <Slider kind="spatial" bipolar label={s.props[1]} value={sl.pan} min={-100} max={100} onChange={(v) => setSl({ ...sl, pan: v })} />
            <span style={{ fontSize: 'var(--pf-fs-xs)', color: 'var(--pf-text-2)' }}>{s.beatLinked}</span>
            <Slider kind="spatial" label={s.props[1]} value={sl.beat} min={0} max={100} beats={[12.5, 25, 37.5, 50, 62.5, 75, 87.5]} onChange={(v) => setSl({ ...sl, beat: v })} />
            <span style={{ fontSize: 'var(--pf-fs-xs)', color: 'var(--pf-text-2)' }}>{s.disabledSl}</span>
            <Slider kind="magnitude" disabled label={s.props[0]} value={40} min={0} max={100} onChange={() => undefined} />
          </div>
        </Card>

        <Card title={s.properties}>
          <div className="g-inspector">
            <Section title={s.section} help={s.helpText} helpLabel={s.help} onReset={() => undefined} resetLabel={s.reset}>
              <PropertyRow label={s.props[0]} modified keyframe="none" keyframeLabel={s.props[0]} value={<ScrubField label={s.props[0]} value={vals.a} min={0} max={100} step={1} unit="%" defaultValue={100} onChange={(v) => setVals({ ...vals, a: v })} />}>
                <Slider kind="magnitude" label={s.props[0]} value={vals.a} min={0} max={100} onChange={(v) => setVals({ ...vals, a: v })} />
              </PropertyRow>
              <PropertyRow label={s.props[1]} keyframe="animated" value={<ScrubField label={s.props[1]} value={sl.x} min={0} max={100} step={1} onChange={(v) => setSl({ ...sl, x: v })} />}>
                <Slider kind="spatial" label={s.props[1]} value={sl.x} min={0} max={100} onChange={(v) => setSl({ ...sl, x: v })} />
              </PropertyRow>
              <PropertyRow label={s.props[2]} keyframe="at-playhead" modified value={<ScrubField label={s.props[2]} value={vals.db} min={-24} max={12} step={0.5} unit="dB" defaultValue={0} onChange={(v) => setVals({ ...vals, db: v })} />}>
                <Slider kind="magnitude" bipolar label={s.props[2]} value={vals.db} min={-24} max={12} onChange={(v) => setVals({ ...vals, db: v })} />
              </PropertyRow>
              <PropertyRow label={s.props[3]} keyframe="on-beat" value={<span className="num">12°</span>}>
                <Slider kind="spatial" bipolar label={s.props[3]} value={12} min={-180} max={180} beats={[-90, 0, 90]} onChange={() => undefined} />
              </PropertyRow>
            </Section>
            <Section title={s.sectionClosed} defaultOpen={false} summary={s.summary}><span /></Section>
          </div>
        </Card>

        <Card title={s.tabs}>
          <Tabs label={s.tabsLabel} tabs={tabSpecs} value={tab} onChange={setTab} />
          <Tabs label={s.tabsLabel} tabs={tabSpecs.map((t, i) => ({ ...t, disabled: i === 4 }))} value={tabC} onChange={setTabC} collapsed />
        </Card>

        <Card title={s.tiles} wide>
          <div className="g-tiles">
            {tileFlags.map((flags, i) => (
              <Tile key={i} name={s.tileNames[i]!} state={flags} progress={0.45} image={<Scene hue={HUES[i]!} />} beatLabel={s.beat}
                fitNote={'fits' in flags ? s.fits : 'shortens' in flags ? s.shortens : undefined} heldLabel={s.held} reason={s.unavailable} appliedLabel={s.applied} favouriteLabel={s.fav} onActivate={() => undefined} onToggleFavourite={() => undefined} />
            ))}
          </div>
        </Card>

        <Card title={s.feedback}>
          <div className="g-toasts">
            <ToastView staticView t={{ id: 'u', kind: 'undo', title: s.toastUndo, body: s.toastUndoBody, action: s.undo, ttl: 6000 }} />
            <ToastView staticView t={{ id: 'r', kind: 'receipt', title: s.toastReceipt, body: s.toastReceiptBody, action: s.undo, ttl: 0 }} />
            <ToastView staticView t={{ id: 'f', kind: 'fix', title: s.toastFix, body: s.toastFixBody, action: s.fix, ttl: 0 }} />
          </div>
          <AnchoredError fix={s.retry} onFix={() => undefined} onDismiss={() => undefined} dismissLabel={s.close}>{s.error}</AnchoredError>
          <div className="g-row"><Button size="sm" onClick={() => toasts.push({ kind: 'undo', title: s.toastUndo, body: s.toastUndoBody, action: s.undo })}>{s.live}</Button></div>
        </Card>

        <Card title={s.progress}>
          <ProgressBar label={s.export} value={64} />
          <ProgressBar label={s.export} value={100} tone="ok" />
          <ProgressBar label={s.export} value={null} />
          <div className="g-row"><Ring label={s.export} value={64} size={36}>64</Ring><Ring label={s.export} value={28} size={28} /><Ring label={s.export} value={90} size={48}>90</Ring><Ring label={s.export} value={null} size={28} /></div>
          <div className="g-stack">
            <JobRow title={s.jobs[0]!} detail="9:16 · 00:42" state="running" progress={64} stateLabel={s.jobStates[0]!} onCancel={() => undefined} cancelLabel={s.cancel} />
            <JobRow title={s.jobs[1]!} detail="he" state="done" stateLabel={s.jobStates[1]!} />
            <JobRow title={s.jobs[2]!} detail="—" state="failed" stateLabel={s.jobStates[2]!} action={s.retry} />
            <JobRow title={s.jobs[3]!} detail="—" state="needs-setup" stateLabel={s.jobStates[3]!} />
            <JobRow title={s.jobs[3]!} detail="—" state="queued" stateLabel={s.jobStates[4]!} />
          </div>
        </Card>

        <Card title={s.overlays}>
          <div className="g-row">
            <Button onClick={() => setDlg(true)}>{s.openDialog}</Button>
            <Button onClick={() => setSheet(true)}>{s.openSheet}</Button>
            <Menu label={s.openMenu} onSelect={() => undefined}
              items={[{ id: 'cut', label: s.menu[0]!, keys: ['Ctrl', 'X'], icon: <Scissors size={16} /> }, { id: 'copy', label: s.menu[1]!, keys: ['Ctrl', 'C'] }, { id: 'del', label: s.menu[3]!, danger: true, keys: ['Del'] }, { id: 'paste', label: s.menu[2]!, disabled: true, keys: ['Ctrl', 'V'] }]}
              trigger={(p) => <Button {...p}>{s.openMenu}</Button>} />
          </div>
        </Card>
      </div>

      <Dialog open={dlg} onClose={() => setDlg(false)} title={s.dialogTitle} variant="dialog" size="sm" closeLabel={s.close} dismissOnBackdrop={false}
        footer={<><Button variant="secondary" onClick={() => setDlg(false)}>{s.cancel}</Button><Button variant="danger" onClick={() => setDlg(false)}>{s.confirm}</Button></>}>{s.dialogBody}</Dialog>
      <Dialog open={sheet} onClose={() => setSheet(false)} title={s.export} variant="sheet" closeLabel={s.close} footer={<Button variant="primary" onClick={() => setSheet(false)}>{s.variants.primary}</Button>}>
        <div className="g-stack"><ProgressBar label={s.export} value={64} /><Switch checked onChange={() => undefined} label={s.switches[0]} /></div>
      </Dialog>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><ToastProvider closeLabel={initialLang === 'he' ? 'סגירה' : 'Close'}><Gallery /></ToastProvider></StrictMode>);
