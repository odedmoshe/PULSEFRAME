# Reference editor parity, 2026-11-26

Source list: `.artifacts/wave8/reference-feature-list.md` (19 groups and the last "seen in screenshots" line), split into single features.
Method: `docs/CAPABILITIES.md` first, then the code was opened at the cited lines. Nothing was run. Paths are from the repo root.
States: **has** = a control a person can press and a code citation. **has, hidden** = only the command palette, a key, an agent tool/REST op or a deep panel. **partly**, **missing**, **different by decision**. "not checked" = not confirmed in code.
Hebrew labels are quoted as they are in `packages/i18n/src/index.ts` (called `index.ts`) or the `*.strings.ts` file named.

## 1. Projects

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Create a project | **has** | Top bar «פרויקטים», then «פרויקט חדש» | `apps/web/src/editor/ProjectsDialog.tsx:157-173`; `index.ts:196` | Nothing. |
| Name a project | **has** | «שינוי שם הפרויקט» (rename in the top bar) | `index.ts:67`; `InlineRename.tsx` | Nothing. |
| Switch between projects | **has** | «פרויקטים», then «פתיחה» on a row; start hub lists recent projects | `ProjectsDialog.tsx:173`; `Welcome.tsx` header comment | Nothing. |
| Delete a project | **has** | «פרויקטים», then «מחיקה» (typed confirmation) | `index.ts:197`; CAPABILITIES "Project manager (list, create, delete with typed…" | Nothing. |
| Save a project | **has** | Automatic; status «נשמר» / «שומר…» in the top bar | `index.ts:42`; `chrome.strings.ts:5` | No "Save" button, by design (every edit is committed). Named versions with Ctrl+S exist (CAPABILITIES "Editing craft"). |

## 2. Formats and layouts

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| YouTube horizontal preset | **has** | Start hub card «רחב» (1920×1080); export sheet destination «יוטיוב» | `Welcome.tsx:31-33`; `chrome.strings.ts:53`; `exportSheet.strings.ts:11` | Cards are sized, not named by platform in the hub. |
| TikTok vertical preset | **has** | Start hub «אנכי» (1080×1920); export «ריל · טיקטוק · שורטס» | `Welcome.tsx:31`; `exportSheet.strings.ts:11-12` | Nothing. |
| Instagram / Reels preset | **partly** | Same «אנכי» card and «ריל · טיקטוק · שורטס» | same; SPEC lists 4:5 profile | No 4:5 card in the hub; 4:5 only as an output profile (`SPEC.md:1063`). |
| Square preset | **has** | Start hub «ריבוע» (1080×1080) | `Welcome.tsx:32` | Nothing. |
| Custom size | **has** | Deliver panel «פריים הפרויקט», «רוחב», «גובה», «החלה»; export «מותאם אישית» | `index.ts:64`; CAPABILITIES "Project frame size, background and fill can be changed after creation" | Frame rate cannot be changed. |
| Layout: single video | **has** | Default; fit set by «מילוי» (`frame.fit`) | `index.ts:64` | Nothing. |
| Layout: picture-in-picture | **has** | Select 2+ picture clips, Inspector «פריסת תמונות»: «תמונה בתמונה, שמאל למעלה» and 3 more corners, «חלון במרכז» | `LayoutPicker.tsx:33-34`; `packages/core/src/layouts.ts:70-74`; `InspectorObject.tsx:1026` | Needs a multi-selection first; not offered from the start hub. |
| Layout: side by side | **has** | Same picker: «זה לצד זה» | `layouts.ts:62` | Same. |
| Layout: one above the other | **has** | Same picker: «למעלה ולמטה» | `layouts.ts:63` | Same. |

## 3. Import

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Upload video | **has** | Rail «מדיה», «ייבוא» or drop; start hub drop zone | `chrome.strings.ts:25-27`; `Library.tsx:52-57` | Nothing. |
| Upload audio | **has** | Same | `Welcome.tsx:28` ACCEPT list | Nothing. |
| Upload pictures | **has** | Same (PNG, JPEG, WebP, plus converted BMP/TIFF/AVIF) | CAPABILITIES "Still images: PNG" | No animated WebP, SVG, HEIC. |
| Import by link | **missing** | n/a | CAPABILITIES row 1: "No … URL import"; `REQUIREMENTS.md:96,281` "not started" | A download job with SSRF-safe fetch (R-26.3). |
| Import from a YouTube link | **missing** | n/a | same; `INTEGRATIONS.md:171` lists YouTube as not built | Same, plus a terms-of-service decision. Owner decision. |
| File library inside the project | **has** | Rail «מדיה»: cards with «הוספה לציר», «צפייה במקור», «שינוי שם», «הסרה מהספרייה»; filters «הכול / וידאו / אודיו / תמונות / לא בשימוש» | `chrome.strings.ts:25-32`; CAPABILITIES "Media library as thumbnail cards" | No bins or tags. |

## 4. Timeline

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Full timeline with layers, tracks, clips | **has** | Bottom panel «ציר זמן» | `Timeline.tsx`; CAPABILITIES "Timeline edits" | Nothing. |
| Drag files onto the timeline | **has** | Drag from «מדיה» or from the computer onto a track | `Timeline.tsx:684-707` | Only the first file of a multi-file drop is placed. |
| Drag clips onto it from the library | **has** | Same | `Timeline.tsx:701-707` | Nothing. |
| Move clips left/right | **has** | Drag the clip; Alt+← / Alt+→ per frame | `TimelineDrag.tsx:95`; `commands.ts:364-365` | Nothing. |
| Move clips between tracks | **has, hidden** | No drag; op `move_clip` takes `trackId` (agents, REST) | `packages/core/src/ops.ts:1197-1209`; the drag sends only `start` (`TimelineDrag.tsx:91-95`); CAPABILITIES "No … cross-track drag" | Vertical drag in `TimelineDrag.tsx`. |
| Layers added automatically | **has** | Automatic on «הוספה לציר» and drop (a new track when none is free) | `ops.ts:264-268` `placeTrack` | Nothing. |
| Several layers at once | **has** | «הוספת רצועה»; many video tracks | `index.ts:66` | Nothing. |

## 5. Basic editing

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Trim (shorten) | **has** | Drag a clip edge; «חיתוך התחלה לסמן» `[`, «חיתוך סוף לסמן» `]` | `commands.ts:362-363`; `index.ts:49` | Nothing. |
| Trim (extend) | **has** | Drag the edge outward (limited by the source) | `TimelineDrag.tsx:96` | Nothing. |
| Split | **has** | «פיצול» button in the clip bar, key S | `commands.ts:355`; `index.ts:132` `bar.split` | Nothing. |
| Delete a stretch (range cut) | **partly** | Words in the transcript: «מחיקת המילים שנבחרו»; Q / W ripple trim; no "mark a range and cut" on the timeline | `TranscriptPanel.tsx:192`; `craft/craft.commands.ts` Q/W; op `cut_range` is used only by the transcript and by overwrite (`placement.range.ts:48`) | A range-select control that calls `cut_range`. |
| Clips close up after a delete | **has** | Toggle «מחיקה שסוגרת את הרווח»; Delete ripples when on, Shift+Delete keeps the gap; palette «סגירת רווחים ריקים בציר הזמן» | `timeline.strings.ts:17`; `Timeline.tsx:774`; `commands.ts:356-357,383` | Off by default for each project. |
| Undo / redo | **has** | «ביטול» / «ביצוע מחדש» in the top bar; Ctrl+Z, Ctrl+Shift+Z | `commands.ts:419-420`; `chrome.strings.ts:14` | Nothing. |

## 6. Audio

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Volume per clip | **has** | Inspector «סאונד» then «עוצמה»; drag the volume line on the clip | `index.ts:110,118`; `VolumeLine.tsx` | Nothing. |
| Fade in | **has** | «פייד פנימה (שניות)» | `index.ts:112` | Nothing. |
| Fade out | **has** | «פייד החוצה (שניות)» | `index.ts:112` | Nothing. |
| Separate audio from a video | **has** | Clip Inspector «ניתוק תמונה מקול» | `index.ts:62`; CAPABILITIES "Detach picture from sound" | Audio already sits on its own linked track on import; this unlinks it. |
| Separate audio layers | **has** | «רצועות שמע» (gain, pan, mute per track) | `index.ts:110` | Nothing. |

## 7. Canvas

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Centre | **partly** | Position fields «מיקום אופקי» / «מיקום אנכי»; no "centre" button found | `index.ts:89`; `InspectorObject.tsx` (no centre control found; not exhaustively checked) | A one-press centre. |
| Fill | **has** | Inspector fill button (`data-testid="fill-fit"` pair), hint `fillHint` | `InspectorObject.tsx:331-349` | Hebrew tooltip text not quoted here. |
| Fit | **has** | Same pair, `fitHint`; project default «התמונה כולה בתוך הפריים» | `InspectorObject.tsx:348`; `index.ts:64` | Nothing. |
| Automatic centring | **has** | New clips are placed centred by the project fit rule | `index.ts:64` `frame.fit.*` | Nothing. |
| Move a clip inside the frame | **has** | Drag on the picture | `CanvasHandles.tsx` | Nothing. |
| Scale | **has** | Handles; «קנה מידה» | `index.ts:89` | Nothing. |
| Rotate | **has** | Handle; «סיבוב» | `index.ts:89` | Nothing. |

## 8. Layers and effects

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Multi-layer work | **has** | Tracks; adjustment layer over everything (palette `cmd.addAdjustment`) | `commands.ts:390` | Adjustment layer is palette-only to create. |
| Blend modes | **has** | Inspector «מיזוג» / «מצב מיזוג» (17: «הכפלה», «מסך», «שכבת־על», «אור רך» …) | `inspector.strings.ts:32-33`; `index.ts:127` | Nothing. |
| Keyframe animation | **has** | «קיפריימים»; key K adds one | `commands.ts:400`; `KeyStrip.tsx` | Only x, y, scale, rotation, opacity and effect parameters. |
| Add animation points | **has** | K, or «הוספת קיפריים בסמן» | `index.ts:82` | Nothing. |
| Interpolation kind | **has** | Key strip menu «עקומה», curve picker | `CurvePicker.tsx`; `commands.ts:413-415` | Smooth/straight commands have no default key. |
| Motion animation | **has** | Gallery «תנועה» (53 presets); «אנימציית כניסה ויציאה» | `motionPresets.ts`; `index.ts:125` | Whole-clip motion only. |
| Pan moves | **has** | Motion presets «פנורמה שמאלה» / «פנורמה ימינה» | `packages/core/src/motionPresets.ts:137-138` | Nothing. |

## 9. Zoom

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Zoom in | **has** | Motion presets «זום פנימה» (in), «הגדלה» (out); transition «זום» | `motionPresets.ts:85,107`; `effects.ts:274` | Nothing. |
| Zoom out | **has** | «זום החוצה», «כיווץ» | `motionPresets.ts:86,106` | Nothing. |
| Zoom strength | **partly** | Hand keyframes on «קנה מידה»; beat zoom «פעימת זום לפי קצב» has parameters | `effects.ts:137` | Presets have fixed amounts; no strength slider on the preset. |
| Ready-made zoom presets | **has** | Gallery «תנועה» tab | `motionPresets.ts:85-107` | Nothing. |

## 10. Picture fixes

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Brightness | **has** | «מראה»: effect «תיקון צבע» (exposure); «איזון אוטומטי» | CAPABILITIES "Colour match «התאמת צבע»…"; `looks.ts:21` | Software-adapter evidence only (needs a graphics adapter). |
| Contrast | **has** | Same effect, contrast | `looks.ts:21` | Same. |
| Colour adjustments | **has** | Same: temperature, tint, saturation; «מראה צבע מוכן» (40 looks); `.cube` LUT | `index.ts:130`; CAPABILITIES ".cube colour lookup tables" | Not judged on footage. |
| Black and white | **has** | Looks «שחור־לבן רך», «שחור־לבן חד», «נואר» | `packages/core/src/looks.ts:21-23` | Nothing. |
| Visual effects | **has** | Rail «אפקטים» (12 Canvas2D, 19 GPU) | `chrome.strings.ts:22`; CAPABILITIES "Effects gallery" | GPU ones never run on a hardware adapter. |
| General looks | **has** | Rail «מראה» | `chrome.strings.ts:22` | Same. |

## 11. Transitions

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Fade (dissolve) | **has** | Rail «מעברים»; Inspector «מעבר» / «סוג המעבר»; drag onto a cut | `index.ts:129`; `Timeline.tsx:690-693` | Nothing. |
| Slide | **has** | Same gallery | CAPABILITIES "Look system… 12 transitions" | Slide named in the 45-transition set; name not individually checked. |
| Wipe | **has** | Same gallery | same | Same. |
| More | **has** | 45 transitions plus 18 trend ones, grouped | CAPABILITIES "GPU transitions", "Trend pack" | Not judged on real footage. |

## 12. Stock (outside sources by API key)

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Stock pictures | **different by decision** | n/a | `SPEC.md:282` "Optional stock connectors"; `REQUIREMENTS.md:96` R-07.3 "not started"; `BLOCKERS.md:66` stock sites need the owner's key; no connector exists | Optional and off by default; needs the owner's key and licence record. Owner decision. |
| Stock video | **different by decision** | n/a | same | same |
| Animations | **partly** | Rail «אלמנטים»: 252 own graphics, tab «מובנים» / «מהספרייה» | CAPABILITIES "Graphic elements: 252 original arrows…"; `library.strings.ts:12` | No outside animation source. |
| Music | **partly** | Rail «אודיו», tab «מוזיקה מובנית» and «מהספרייה» | `music.strings.ts:7-8`; `Library.tsx:193` | No outside music source; the local library has never run on the owner's drive. |
| Sound effects | **has** | Rail «אודיו», sound-effects browser (80 built-in) | `SfxBrowser.tsx`; CAPABILITIES "Built-in synthesised sound effects" | No outside source. |

## 13. Text and fonts

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Add text | **has** | «הוספת טקסט», key T | `commands.ts:388`; `index.ts:47` | Nothing. |
| Big title | **has** | «סגנון טקסט מוכן» (50 presets) | `textPresets.ts:22-29`; `index.ts:132` | No preset literally named title / subtitle / kicker. |
| Subtitle line | **partly** | Same presets, or a second text | same | Not a separate role. |
| Kicker | **partly** | Same | same | Same. |
| Edit text | **has** | Inspector «תוכן» | `index.ts:47` | Nothing. |
| Text colours | **has, hidden** | Only through a style preset or `update_text` `style.color`; no free colour control found in `InspectorObject.tsx` | `inspector.model.ts:174-175` | A colour field for titles (captions have «צבע טקסט»). |
| Alignment | **has, hidden** | `style.align` exists (start/center/end); no control found | `packages/core/src/schema.ts:386` | An alignment control. |
| Font weight | **has** | Font picker, «עובי» | `InspectorObject.tsx:856`; `font.strings.ts:17` | Only 400 and 700 listed. |
| Font size | **has** | «גודל» | `InspectorObject.tsx:832-834` | Nothing. |
| Install custom fonts | **missing** | n/a | CAPABILITIES "Font catalog: 5 OFL…"; export refuses a non-bundled font | A font import with licence check. Owner decision. |
| Built-in fonts | **has** | Font picker «גופנים», categories «קטגוריות גופנים» | `FontPicker.tsx`; `font.strings.ts:14` | Nothing. |
| Ready title templates | **has** | «סגנון טקסט מוכן»; rail «תבניות» for whole films | `index.ts:132`; `TemplatesDrawer.tsx` | Nothing. |

## 14. Transcription and captions

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Automatic transcription, local model | **has** | Mode «כתוביות», «זיהוי דיבור אוטומטי»; «התקנת מנוע הדיבור» first | `TranscriptPanel.tsx:88`; `index.ts:99`; CAPABILITIES "Automatic speech recognition" | Needs the engine and model; the install button was never pressed on Windows. |
| Captions in one press | **partly** | «הוספת רצועת כתוביות» after transcribing; «הצגת התמלול ככתוביות» if the track is not linked | `TranscriptPanel.tsx:621`; `captions.strings.ts` `showTranscript` (`makeCaptions` «יצירת כתוביות» is defined but not used) | A single button from audio to captions. |
| Edit captions line by line | **has** | Transcript phrases, «עריכת טקסט» | `index.ts:101` `transcript.edit` | Nothing. |
| Change caption text | **has** | «טקסט הכתובית» in the Inspector | `index.ts:58` | Nothing. |
| Move / re-time captions | **partly** | Word timing «תזמון המילים לפי הקול»; no drag handle for a cue found | `index.ts:99`; not checked in `Timeline.tsx` | Drag or typed cue times: not checked. |
| Ready caption styles | **has** | «סגנון» (7) and «מראה מוכן» (40) | `index.ts:104,132` | Not judged on footage. |

## 15. Translation

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Translate captions | **has** | Rail «כלי AI», tab «כתוביות» | `AiTools.tsx:424`; `aiTools.strings.ts:58` | Needs the local translation model; quality unread. |
| Hebrew to English | **has** | Same tool `local.text.translate-he-en` | CAPABILITIES "Caption translation Hebrew ↔ English" | Same. |
| Switch target language | **has** | The English-to-Hebrew tool | same | Only he↔en. |
| Remake captions in the new language | **has** | Re-run; result is a linked language format; «בדיקת תרגום», «סמן כנבדק» | `index.ts:166-167` | Owner-only review mark. |
| Several languages | **missing** | n/a | CAPABILITIES "Larger model waits for a GPU" | Any pair other than he↔en. |

## 16. Narration

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Text to speech | **has** | Sound tab «קריינות מטקסט», «יצירת קריינות במיקום הסמן» | `SoundPanel.tsx:239`; `index.ts:99` | Needs the voice model; nobody has listened. |
| AI voices | **partly** | One built-in voice | `index.ts:99` `narration.hint` | No voice choice. |
| Cartesia as provider | **different by decision** | n/a | No provider named in code; outside providers are optional (`SPEC.md:548`, `BLOCKERS.md` B-9 owner's key) | Owner decision. |
| Library voices | **missing** | n/a | CAPABILITIES "voice list with previews … not built" | A voice list. |
| Custom voices | **has** | «לדבר בקול מתוך הקלטה (שכפול קול)» with the consent box | `index.ts:99` `narration.ref.*`; CAPABILITIES "Reference voice" | Owner session only; agents refused. |

## 17. Sound

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Sound effects on the timeline | **has** | Rail «אודיו», effects browser, add at the playhead | `SfxBrowser.tsx` | Nothing. |
| Background music | **has** | «מוזיקה מובנית»; «התאמה לאורך» | `music.strings.ts`; `index.ts:71` `sound.fit` | Nobody has listened. |
| Manage audio layers | **has** | «רצועות שמע», «אפקטי קול», «ניקוי קול» | `index.ts:110`; CAPABILITIES rows "Sound effects on audio clips", "Voice cleanup" | Voice cleanup proof fails 9/11. |

## 18. AI agent

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Every action also an MCP tool | **has** | Access panel shows the endpoint and makes tokens | `AccessPanel.tsx:61,74`; CAPABILITIES "Tools generated from the op registry" | Nothing. |
| An agent edits by itself | **has** | Grants Observe / Propose / Edit / Autopilot | CAPABILITIES "Agent grants" | Management of grants is in the access panel only. |
| Connect Claude, Grok, GPT, Codex | **partly** | Any MCP client with a token | CAPABILITIES "Only the official SDK client has been tried" | No third-party host tried; no OAuth. |
| Shows a work plan before acting | **partly** | Propose mode: before/after stills in «הצעות» | `index.ts:95-96`; Copilot «תוכנית» is empty (`aiHub.strings.ts:36`) | A step plan from the editor's own assistant. |
| User approves before it runs | **has** | «הצעות»: «אישור» / «דחייה» | `index.ts:95` | Nothing. |
| Live status of actions | **has** | «פעילות»; «הסוכן כאן»; top bar agent menu «מוכן ומחכה» | `Header.tsx:194-200`; `index.ts:51,90` | Nothing. |
| See the commands the agent runs | **has** | «היסטוריית הפרויקט» filter «פעולות סוכנים»; Copilot «קבלות» with «החזרה» | `index.ts:69`; `aiHub.strings.ts:38-39` | Nothing. |
| Make reels from a natural-language request | **partly** | In the editor: «קטעים קצרים» (rules, no language model); a connected external agent can | `shorts.strings.ts`; CAPABILITIES "Natural-language Director … not built" | Needs B-9 (owner's model and limits). Owner decision. |
| Automatic horizontal to vertical | **partly** | «הוספת פורמט» «אנכי 9:16» (linked format, contain/cover) | `stage.strings.ts:4`; CAPABILITIES "Linked output formats" | No subject-following reframe (B-4, needs a model). |
| Remove silences (by AI) | **has** | «חיפוש שקטים», then «הסרת השקטים» (level measurement, not AI) | `TranscriptPanel.tsx:515`; `index.ts:108-109` | Not AI; real recordings untested. |
| Cut by a text command | **partly** | Ctrl+K command bar: 36 intents, e.g. split, delete, fades | `commandBarContract.ts:38-41`; CAPABILITIES "Hebrew command bar" | Free-form requests need the language assistant (setup state only). |
| Agent tab inside the editor | **partly** | Rail «כלי AI», Copilot tab «עוזר» | `aiHub.strings.ts:33-37` | Chat says «העוזר לא מחובר». |

## 19. Export

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Export | **has** | «ייצוא», Ctrl+E | `commands.ts:425`; `exportSheet.strings.ts:4` | Nothing. |
| Choose resolution | **partly** | «רזולוציה»: «מלא», «חצי», «רבע», 4K | `exportSheet.strings.ts:13-14` | Sizes are relative to the project, not 720p / 1080p. |
| Choose quality | **has** | «איכות»: «חסכוני», «מאוזן», «גבוה» | `exportSheet.strings.ts:15` | Nothing. |
| Choose fps | **missing** | n/a | CAPABILITIES "Frame rate … cannot be changed"; no fps field in `ExportSheet.tsx` | An fps choice (project rate is fixed). |
| Vertical reel 1080×1920 | **has** | «ריל · טיקטוק · שורטס» | `exportSheet.strings.ts:11-12` | Nothing. |
| Saved on the local computer | **has** | «שמירה במחשב»; «נשמר בהורדות של הדפדפן» | `exportSheet.strings.ts:11,19` | Nothing. |

## 20. Settings

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Hebrew / English | **has** | «שפת הממשק» (EN toggle) | `index.ts:41`; `commands.ts:429` | Nothing. |
| Dark mode | **has** | «הגדרות», «ערכת נושא»: «כהה» / «בהירה» | `SettingsDialog.tsx:40-41`; `chrome.strings.ts:36` | Nothing. |
| API keys kept locally | **partly** | Only the assistant key file (mode 0600), no provider chosen; «העוזר השפתי» in settings | CAPABILITIES "Language assistant inside the editor … setup state only" | No key form for any outside provider. |
| Several AI providers | **partly** | «ספק AI מקומי» status; ComfyUI and local tools | `chrome.strings.ts:38`; CAPABILITIES "Optional AI providers" | No outside provider. |

## 21. Mobile and remote

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Work in a phone browser | **missing** | n/a | CAPABILITIES "tablet/mobile layouts … not built" | A touch layout. |
| Upload from the phone | **has** | «מהטלפון» in the start hub; «ייבוא מהטלפון», QR | `Welcome.tsx:27`; `phoneDrop.strings.ts:8`; `commands.ts:424` | Home Wi-Fi only; not verified on a real phone. |
| Transcribe from the phone | **different by decision** | n/a | Phone door is upload only: `docs/adr/0023-phone-drop-and-import-queue.md`, `docs/adr/0035-phone-pickup.md` item 2 | Owner's own session only. |
| Export from the phone | **different by decision** | planned «לטלפון ב־QR» | `docs/adr/0035-phone-pickup.md:3` "Decided … not built"; one finished file only | Not built. |
| Phone through Cloudflare Tunnel | **missing** | n/a | `docs/adr/0002-local-access-control.md:7` loopback only; ADR-0035 item 6 home network only; no ADR names a tunnel | A decision on remote access. Owner decision. |

## 22. Seen in screenshots

| Feature | State here | Where the owner finds it | Evidence | What is missing |
|---|---|---|---|---|
| Drag the playhead | **partly** | Click on the ruler seeks; drag-scrub not found | `Timeline.tsx:807` (pointer down only) | Drag after pointer down: not checked. |
| Draggable range flags | **missing** | Source viewer has «נקודת התחלה» / «נקודת סיום» only | `index.ts:56`; no range on the timeline | Timeline in/out range. |
| Worded toolbar | **has** | Clip bar «פיצול», «מחיקה», «שכפול», «העתקה», «הדבקה», «גזירה» | `index.ts:132` `bar.*` | Nothing. |
| Keyframe chips, pictured easing | **has** | Key strip dots by curve shape | `KeyStrip.tsx:137` | Nothing. |
| Blend modes in plain words | **has** | «הכפלה», «מסך», «אור רך» … | `inspector.strings.ts:33` | Nothing. |
| Waveform inside video clips | **partly** | Waveforms on clips via ClipVisuals; inside video clips not checked | `Timeline.tsx:446`; CAPABILITIES "Filmstrip thumbnails and waveforms" | Not checked. |
| 9:16 guide lines on a 16:9 picture | **partly** | «אזור בטוח» per format; add «אנכי 9:16» | `stage.strings.ts:8`; `index.ts:138` | A guide drawn on the master. |
| Preview volume | **missing** | n/a | No volume in `Transport.tsx` (searched) | A master preview volume. |
| Fullscreen | **has** | «מסך מלא» on the stage header | `StageHeader.tsx:51` | Nothing. |
| Preview-quality menu | **partly** | Settings «התמונה בזמן ניגון»: «חלק» / «חד יותר» | `chrome.strings.ts:37` | Not in the transport row. |
| «מאגר» stock tab with topic chips | **missing** | n/a | The word «מאגר» is not in the code; nearest is tab «מהספרייה» (`library.strings.ts:12`) | A stock tab (see group 12). |

## Missing or hidden, by size of work

**Small (a button or a label for something that exists)**
- Move a clip to another track: pass `trackId` from a vertical drag. `TimelineDrag.tsx`, `Timeline.tsx`.
- Delete a marked stretch: a button for `cut_range`. `Timeline.tsx`, `commands.ts`.
- Text colour and alignment controls for titles (`update_text` already takes them). `InspectorObject.tsx`, `inspector.strings.ts`.
- «Centre» button beside fit and fill. `InspectorObject.tsx`.
- A one-press «יצירת כתוביות» (the string exists unused). `TranscriptPanel.tsx`, `captions.strings.ts`.
- Add-adjustment-layer and close-gaps as buttons. `commands.ts`, `Timeline.tsx`.
- Preview-quality choice in the transport row. `Transport.tsx`, `SettingsDialog.tsx`.
- Resolution labels «720p / 1080p». `exportSheet.strings.ts`.

**Medium (a new panel or op)**
- Preview master volume. `Transport.tsx`, `engine` audio.
- Timeline in/out range flags. `Timeline.tsx`, new state.
- Drag-scrub of the playhead. `Timeline.tsx`.
- Guide lines for 9:16 on the master. `StageHeader.tsx`.
- Zoom preset strength. `motionPresets.ts`, gallery.
- Voice list for narration. `SoundPanel.tsx`, voice ops.
- Custom font import with licence check. new op, `FontPicker.tsx`, server.
- fps choice at export (needs project-rate change). `ExportSheet.tsx`, `ops.ts`.

**Large (a new subsystem or an owner decision)**
- Import by link and from YouTube (R-26.3; terms of service). server import job.
- Outside stock and music sources by API key. providers, key store, licence records.
- In-editor assistant and natural-language reels (B-9). `commandBar/`, providers.
- Cloudflare Tunnel or any remote door (ADR-0002 change).
- Phone browser layout. `apps/web`.
- Export from the phone, «לטלפון ב־QR» (ADR-0035). server door.
- More translation languages (GPU model). providers.
- Subject-following reframe (B-4).

## Things this editor has that the list does not mention

- Multicam with live angle switching (CAPABILITIES "Multicam live switching").
- Perform mode «הופעה» with beat-quantised takes.
- Motion tracking, privacy blur regions, picture stabilisation «ייצוב תמונה».
- Colour match «התאמת צבע», scopes (histogram, waveform, vectorscope).
- Adjustment layers and rule-based templates (travel montage and others).
- Family film, «ספרו מה היה», «פנינים» marked ranges, life line.
- Music that fits the film «התאמה לאורך», beat and bar analysis.
- Time effects, overlays, 19 GPU effects, `.cube` LUTs.
- Flash-safety checks on every export; «מתאים לשליחה» size-fit export.
- Linked output formats with per-format overrides.
- Named versions (Ctrl+S) and full project history with undo per actor.
- Find in footage «חיפוש בצילומים»; sharpest frame «הפריים הכי חד».
- Hebrew command bar (Ctrl+K), 36 intents.
- Backup, portable project archive, local content library with licence duties.
