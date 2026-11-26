# Design review of the editor (2026-11-26)

A review with measurements, made because the owner asked to "look at the whole design of the system and see what should be fixed or improved". Nothing in the product was changed. The design system and intent in `UX_REDESIGN.md` stand; this document checks the built editor against them and against what this owner needs (a Hebrew-speaking parent editing family videos on a Windows 11 laptop, not a professional editor). Findings already recorded in `UX_AUDIT.md` are repeated only where they are still visible.

**How it was looked at.** Branch `wt/designrev` at `e86f5cd`, `pnpm build` (16 s wall clock under load 37), then `pnpm shots:review` (new script `packages/evals/src/design-review-shots.ts`; it waited 432–748 s for a slot in the machine queue). Headless Chromium, `deviceScaleFactor: 1`, Hebrew UI, reduced motion. Synthetic media only (ffmpeg `mandelbrot`, `gradients`, `testsrc2`, `cellauto`, `smptehdbars`, a sine tone) with Hebrew file names, and a made-up Hebrew transcript. Projects: an empty 9:16 project; a 9:16 project with one 36 s clip; **the owner's case** (the same 36 s clip, six files in the library, empty T1, FX1 and V2 lanes, eight transcript phrases); a 16:9 project with two clips, a title and music; a 16:9 project with 38 clips on six tracks.
139 screenshots: 1908×876 (the owner's window), 1528×704 (the same laptop at 125 % scaling), 1366×650, light and dark. Full sweep (every mode, each side-panel tab, every rail drawer, dialogs) at 1908 light and 1528 light; the core screens in the other four combinations; a second pass for the effects gallery, the phone dialog, the status centre and a keyboard walk. A script measured, on every shot, the panes and the picture, text clipped by its own box or by its pane, controls under 24 px, contrast of every text run on a solid background, Latin words in the Hebrew UI, wrapped flex rows, dialogs, and focus styles. One sample each; nobody has seen the editor on the owner's real screen.
Shots are not in the repository: `/tmp/claude-0/-home-user-PULSEFRAME/84ecc641-352b-53c1-abc2-950bc66f10c4/scratchpad/designrev/<viewport>-<theme>-<name>.png` with `metrics.json` and `metrics-extra.json` beside them. `pnpm build && pnpm shots:review [dir]` makes them again (`--extra` for the second pass).

---

## 1. Summary: the five changes that would help this owner most

1. **Give the picture the space (work package 1).** In the owner's case at 1908×876 the 9:16 picture is **175×311 px, 3.3 % of the window**, while the timeline takes **357 px (41 % of the height)** for one clip and three empty lanes; at 1528×704 (125 %) the picture is **131×232 px (2.8 %)**. Collapse empty lanes, drop the stage header into one transport bar, start the timeline at the height its non-empty lanes need (≤ 30 % of the window for portrait projects), and fit the film to the timeline width on open. Target: 9:16 picture **≥ 480 px tall at 1908×876, ≥ 360 at 1528×704, ≥ 320 at 1366×650**.
2. **A calm top bar and a labelled timeline toolbar (work package 1).** The top bar holds 15 controls plus 7 mode tabs; the timeline toolbar has 14 controls of which **12 are icons without a word**. Put the everyday actions (split, delete, duplicate, close gaps, remove silences, add text, undo, redo) on the timeline toolbar as icon + word, move the rest to named places (table in §5).
3. **Fix what is cut off or invisible (work package 2).** File names in the media panel are cut by the panel (2 of 6 cards fully visible at 1908×876, none at 1366×650); the inspector's eight object tabs are cut to two or three letters at 1908; the rail's «הגדרות» label falls below the window at 1528×704; the start hub in an empty project is painted under the timeline's ruler; in the light theme the Elements drawer shows white shapes on white tiles (contrast 1:1).
4. **One language on screen (work package 3).** English beside Hebrew in the command palette (22 Latin words on its first page), in the Effects, Transitions and Looks drawers (14–18 per drawer), an English paragraph in the projects dialog, "HE", "fps", "ComfyUI", "SRT/VTT". Say what the status pip «2 להגדרה» means.
5. **A transcript panel that shows the transcript (work package 3).** Two headings «תמלול» / «תמלול 8», a help line broken around the English word "Shift", 16 px phrase cards with wide word gaps: only **two phrases fit at 1908×876 and one at 1528×704**. Target ≥ 4 phrases at 1908×876.

---

## 2. Measurements

### 2.1 Picture, stage and timeline (nothing selected unless said)

| Viewport | Project / mode | Picture px | Share of window area | Picture height / window height | Stage w×h | Timeline h (share) |
|---|---|---|---|---|---|---|
| 1908×876 | 9:16, 1 clip, Edit | 226×402 | 5.4 % | 46 % | 1150×514 | 266 (30 %) |
| 1908×876 | **owner's case, Captions · תמלול** | **175×311** | **3.3 %** | 36 % | 1150×423 | **357 (41 %)** |
| 1908×876 | owner's case, Edit | 192×342 | 3.9 % | 39 % | 1150×454 | 326 (37 %) |
| 1908×876 | owner's case, Sound | 122×216 | 1.6 % | 25 % | 1150×328 | 452 (52 %) |
| 1908×876 | 9:16, Perform | 67×119 | 0.5 % | 14 % | 1150×514 | 266 |
| 1908×876 | 16:9, 2 clips | 622×350 | 13.0 % | 40 % | 1150×462 | 318 (36 %) |
| 1908×876 | 16:9, 38 clips, 6 lanes | 523×294 | 9.2 % | 34 % | 1150×406 | 374 (43 %) |
| 1528×704 | 9:16, 1 clip | 150×266 | 3.7 % | 38 % | 818×368 | 244 (35 %) |
| 1528×704 | **owner's case, Captions** | **131×232** | **2.8 %** | 33 % | 818×334 | 278 (39 %) |
| 1528×704 | owner's case, Sound | 83×148 | 1.1 % | 21 % | 818×250 | 362 (51 %) |
| 1528×704 | 16:9, 2 clips | 473×266 | 11.7 % | 38 % | 818×368 | 244 (35 %) |
| 1528×704 | 16:9, 38 clips | 395×222 | 8.1 % | 32 % | 818×324 | 288 (41 %) |
| 1366×650 | owner's case, Captions | 93×165 | 1.7 % | 25 % | 688×280 | 278 (43 %) |
| 1366×650 | 16:9, 2 clips | 353×199 | 7.9 % | 31 % | 688×314 | 244 (38 %) |
| 1366×650 | 16:9, 38 clips | 275×155 | 4.8 % | 24 % | 688×270 | 288 (44 %) |

Dark theme measured identical sizes. Other panes (all shots): top bar 52 px (48 at ≤ 780 px height), status bar 24, rail 72, media drawer 340 / 292 / 260 px wide at 1908 / 1528 / 1366, inspector **322 px at every width** (the token says 372 / 332 / 304 at these widths: `.app` still uses the legacy `--pf-shell-inspector: 330px`, `ds/shell.css`).
Inside the stage the picture has 112 px of chrome above and below it in the owner's case (stage header ≈ 44, transport ≈ 56, padding): 423 px stage → 311 px picture. In the timeline, 95 px are toolbar (45), beat strip «ניתוח קצב» (22) and ruler (28) before the first lane.
Lanes in the owner's case at 1908: T1 30 (empty), FX1 30 (empty), V2 30 (empty), V1 86, A1 83 (Captions mode) — 90 of 259 lane pixels hold nothing.
Default zoom: a 36 s film shows 0:00–0:18 on the ruler at 1908×876 (same for the 30 s project): half the film is off to the side when the project opens.

### 2.2 Controls per region at 1908×876 (owner's case, nothing selected; counted by script)

| Region | Controls | With a word | Icon only |
|---|---|---|---|
| Top bar | 15 (+ the 7 mode tabs counted inside) | 11 | 4 |
| Rail | 12 | 12 | 0 |
| Media drawer | 33 | 10 | 23 (six selection checkboxes, card buttons) |
| Stage (header + transport) | 12 | 2 | 10 |
| Timeline toolbar | 14 | 2 («זמן», «תיבות») | **12** |
| Track headers | 23 | 1 | 22 |
| Status bar | 1 | 1 | 0 |

With a clip selected (16:9 project): timeline toolbar 24 (12 worded: the ride bar), inspector 31 (13 icon only), stage 22 (8 canvas handles).

### 2.3 Other measurements

- **Clipped text:** apart from screen-reader-only spans, no element's own text overflows its box; but **text cut by its pane**: media file names under the second card row (`span.asset-name` 6–26 px below the drawer's bottom, 1908 light 06), the transcript's third phrase (5 elements at 1908, 7 at 1528, owner's case).
- **Wrapped rows:** media filter chips 2 rows (5 chips) in every shot with media; sound-effect chips 3 rows; element chips 3 rows; perform settings 3 rows; the captions header wraps.
- **Targets under 24 px** (on every editor shot): add-track buttons 24×22 (×4), zoom slider 88×20, «ניתוח קצב» 86×20, status pip 87×20, media-card checkboxes 20×20, inspector keyframe buttons 22×22 and value fields 114×22, canvas handles 12×12 (×8), track rows' clips 18–20 px tall in the 38-clip project at 1528.
- **Contrast:** every visible text run on a solid background in 139 shots was measured with WCAG luminance; none is below 4.5:1 except two measuring artefacts (a label on a gradient button, a transparent timecode cap). Text over pictures and gradients and disabled controls were skipped. The one real failure is a picture: the Elements tiles in light theme (white shape on `#FFFFFF`, 1:1, finding D2).
- **Focus:** a Tab walk of 14 stops shows a 2 px solid ring on every stop, in **two colours**: `#1867A8` (info) on the rail, file input, «הכול» view and card buttons, `#055C4F` (`--pf-focus`) on the rest (dark: `#73C9FF` and `#86F3E3`).
- **Horizontal or vertical page scroll:** none at any viewport (the shell is a fixed grid, as `UX_REDESIGN §4.1` asks).
- **Latin words in the Hebrew UI** (outside numbers, timecodes and key caps): command palette 22 on open, 9 on a query; Effects 14, Transitions 18, Looks 16 drawers; projects dialog 28 (an English paragraph); AI drawer 3 ("ComfyUI", "Ctrl", "AI."); Settings 1 ("English", intended); Captions «ייבוא כתוביות (SRT/VTT)».

---

## 3. Findings: defects (cut, overlapping, unreadable, broken at 125 %)

Ranked by effect on the owner. "Size": small = CSS only, medium = one component, large = layout. "Risk" names what pins the current look: `audit:a11y` (`a11y-audit.ts`), `audit:testids`, `pnpm shots`, `proof:editor-interactions`, unit tests.

**D1. The start hub of an empty project is painted under the timeline.** 1908 light/dark and 1528 light, `01-empty-project`. The ruler, beat strip and track headers (T1, V1, A1) are drawn over the hub's «אחרונים» rows and «מתחילים מרגע» cards; card captions are cut by the status bar; at 1528 the first recent project row is hidden under the ruler. Cause: `.welcome.pf-hub` is `position: fixed; z-index: 5` (`editor/welcome.css`), the timeline's sticky `.tl-top` is `z-index: 6` (`editor/timeline.css`). Also two drop zones show at once (hub and media drawer), and the hub is dark in the light theme. Change: while the hub is shown, hide the timeline (`.app:has(.pf-hub) > .timeline, … > [data-shell-slot=splitter] { visibility: hidden }`) or raise the hub to `z-index: 8`; hide the media drawer's empty drop zone while the hub has one. Size small. Risk: `pnpm shots` (desktop-he-empty), `audit:a11y` hub pass.

**D2. Elements drawer, light theme: the shapes are invisible.** 1908 light `20-rail-elements`, `x-22-elements-3s` (after 3 s): every tile is `#FFFFFF` with the default colour «צבע» white; dark theme shows the arrows. `editor/elementsBrowser.css` `.el-tile` sets `#0b0d11`, but a later light-theme rule wins. Change: give `.el-tile` a fixed dark preview surface in both themes (`background: var(--pf-stage)` with a 2-tone checker), or draw tiles in the chosen colour on its contrasting surface. Target: tile contrast ≥ 3:1 for the default colour in both themes. Small. Risk: `audit:a11y` light pass, `proof:creative` (elements).

**D3. The media panel hides most files and cuts their names.** Owner's case 1908 (`04b`): of 6 files, 2 cards are whole; the next row's names sit under the drawer's bottom; 1366 (`1366-light-04b`): only the top of the first thumbnails, no name. The header stack (title + import, search 40 px, chips in 2 rows, the הכול/לפי תאריך/אירועים/פנינים segmented row) takes ≈ 210 of 423 px. `.pf-bw-scroll` also fades its last 36 px (`mask-image`). Portrait thumbnails are pillarboxed on grey in a 16:9 box; each card carries a «בחירת … לסנכרון וחיתוך» checkbox (multicam pick) and a "HE" badge. Change (`ds/chrome.css`, `editor/MediaLibrary.tsx`, `editor/mediaLibrary.css`): chips in one non-wrapping row (`.pf-bw-chips { flex-wrap: nowrap; overflow-x: auto }` with the end fade from §4.4), the view segmented row folded into a «תצוגה» menu or the chip row, the mask cut to 16 px, the pick checkbox shown only while a multicam pick is open, names on two lines max with `title`. Target at 1908×876: ≥ 4 cards with whole names; at 1528×704: ≥ 2; script check `cutByPane` has no `asset-name`. Medium. Risk: `audit:testids` (`pick-*`, `media-filter-*`), `proof:multicam-ui`, `proof:library`.

**D4. Inspector object tabs are cut to two or three letters.** 1908 light `06-169-edit-clip`: «בסי…», «תנו…», «מהיר…», «ק…», «צ…», «אפקט…», «מס…», «או…»; 8 tabs share 322 px, each 28–51 px wide. §3.5 asks for icon + label, collapsing to icons only at ≤ 1366. Change (`editor/Inspector.tsx`, `editor/inspector.css`): icon over a 12–13 px label in a scrollable strip, or 5 tabs plus «עוד» (קצב, מסכה, אודיו under it), and give the inspector its token width (372 at ≥ 1800). Target: no tab label cut at ≥ 1366 px. Medium. Risk: `audit:testids` (`inspector-tab-*`), `inspector.focus.test.ts`, `proof:editor-interactions`.

**D5. At 125 % the rail's last label falls off the window.** 1528×704 `02-916-edit-nosel`, also 1366×650: «הגדרות» shows its icon only, the label is below 704 px (the button starts at y 652). Change (`ds/chrome.css`, `.pf-rail` under `@media (max-height: 780px)`): 20 px icons, 4 px gaps, or move «קיצורים» into the palette and settings. Target: every rail label inside the viewport at 1366×650. Small. Risk: `pnpm shots`.

**D6. The transcript panel shows two headings and two phrases.** Owner's case `04b` (1908, 1528, 1366): «תמלול» (page title) then «תמלול 8» (`TranscriptPanel.tsx` `.pf-cap-head h2`); the hint «לחיצה על מילה מעבירה את הסמן אליה; Shift מרחיב בחירה» breaks with «בחירה» alone on a line; «שמור כפנינה» and «מחיקת המילים שנבחרו» look disabled with no reason shown; phrase cards use 16/24 text, 8/12 padding, words padded 3 px each side, so word gaps are wide and each 5–6-word phrase wraps; the pencil «✎» is a separate bordered button. Two phrases fit at 1908, one at 1528. Change (`editor/captionsPanel.css`, `TranscriptPanel.tsx`): one heading, hint as «לחיצה על מילה: מעבר אליה · Shift+לחיצה: בחירת כמה מילים» with `<kbd>`; `.pf-cap .phrases > li` 14/22 with 6/10 padding, `.pf-cap .word { padding: 0 1px }`, pencil as a 24 px ghost icon at the card's end; disabled buttons with a reason tooltip. Target: ≥ 4 phrases visible at 1908×876, ≥ 2 at 1528×704. Small–medium. Risk: `proof:speech`, `proof:phase6`, `proof:phase12`, `pearls-proof.ui.ts`, `proof:editor-interactions` (test ids `transcript-*`), `audit:a11y`.

**D7. The film's length is said two ways.** 38-clip project `07-busy-timeline`: the top bar and status bar say 0:27, the project panel «אורך 30.0 ש׳» and the transport 00:00:30:00 (the music runs past the last picture). `Header.tsx` and `StatusBar.tsx` use `editEnd(doc)`, the inspector and transport the project length. Change: one figure everywhere, or label the two («תמונה 0:27 · סאונד 0:30»). Small. Risk: none known.

**D8. Timecode wraps under the time at 1366×650.** `1366-light-02`: «/ 00:00:36:00» moves to a second line under the timecode. `.tp-time` wraps. Change (`editor/stage.css`): `flex-wrap: nowrap`, drop the total below 820 px of stage width as §4.5 says. Small. Risk: `pnpm shots`.

**D9. Status pip «2 להגדרה» with two unexplained dots.** Every shot: orange text, two 7 px rings, no tooltip (`title` absent), 87×20 px; it opens Settings, where the two are «האצה גרפית» and «ספק AI מקומי». Change (`StatusBar.tsx`, `ds/chrome.css`): «2 יכולות דורשות הכנה» with a tooltip naming them, no dots (or each dot with its name), 24 px tall. Small. Risk: `audit:testids` (`status-pips`).

**D10. Controls under 24 px** (list in §2.3). Change: `--pf-h-xs` (24) as the floor for `.tl-add`, `.tempo-run`, `.pf-status-pip`, `.mc-pick`, `.pf-kf`, `.pf-prop` fields; canvas handles keep a 12 px drawing inside a 24 px hit area. Small. Risk: `audit:a11y` target checks (they may start passing more), `pnpm shots`.

**D11. Focus ring in two colours.** Tab walk (all three passes): `#1867A8`/`#73C9FF` on rail, file input, view and card buttons; `--pf-focus` elsewhere. Change: every `:focus-visible` outline uses `var(--pf-focus)` (`ds/chrome.css`, `editor/mediaLibrary.css`, `lifeline` view buttons). Small. Risk: `ds/focus.test.ts`, `audit:a11y`.

**D12. Number and unit read unit-first.** Ride bar chip and inspector header «ש׳ 8.0» (1908 `06`): the whole «8.0 ש׳» token is `direction: ltr` (`.num`, the rule in `UX_REDESIGN §3.3`), so the unit lands on the right and is read first in Hebrew. Change: isolate the number only (`<span class="num">8.0</span> ש׳`), amend §3.3. Small (CSS/markup in the components that print durations). Risk: `hebfix.test.ts`, wording tests.

---

## 4. Findings: improvements (proportions, hierarchy, wording)

**I1. The picture is the smallest thing on screen (proportion; proposal in §6 and work package 1).** Measured in §2.1. In Sound mode the picture drops to 1.6 % (1908) and 1.1 % (1528) of the window, in Perform mode to 0.5 % (67×119 px; the pads sit inside the stage). The splitter exists and remembers a height (`Splitter.tsx`, `pf.tl.height.v1`), but the default (`TL_USUAL = clamp(248px, natural, 48dvh)`, `interactions.math.ts`) counts empty lanes and the 22 px beat strip.

**I2. Too many things in the top bar.** 15 controls and 7 mode tabs in one 52 px row at 1908; at 1528 the command field shrinks to «מה עושים? פקודה, …», at 1366 the mode tabs lose their words and the save line loses the format. The mode bar alone is 620 px wide at 1908. Proposal in §5.

**I3. The timeline toolbar is icons only.** 12 of 14 controls without a word (select V, blade C, main magnet, ripple delete, beat snap, link, split, marker, fit, zoom out, slider, zoom in); with a clip selected, the ride bar adds 10 worded actions in the middle. The owner's most used actions (split, delete, duplicate, close gaps, remove silences) are either icon-only, only in the ride bar after a selection, or only in the palette. Proposal in §5.

**I4. Empty lanes and the beat strip take lane space.** Owner's case: T1, FX1, V2 empty, 90 px; the «ניתוח קצב» strip 22 px with nothing analysed. Proposal in §6.

**I5. Default zoom shows half the film.** 0:00–0:18 of 36 s at 1908. Change (`Timeline.tsx`, `TimelineZoom.tsx`): on opening a project whose film is under 3 minutes, zoom to fit (`כל העריכה`) once; remember the viewer's zoom after that. Small–medium. Risk: `proof:editor-interactions` (zoom), `zoom.math.test.ts`.

**I6. Wording and English (work package 3).** Command palette rows show an English alias under each Hebrew command (`.pf-pal-alt`: "Play / pause", "Import from a phone"); Effects, Transitions and Looks drawers list English names beside Hebrew ("Color adjust", "Sepia", "Vignette"); projects dialog paragraph "A file is unreferenced only if no remaining project, including its history…" (already in `UX_AUDIT.md` on 2026-11-17); AI drawer names "ComfyUI"; media card "HE"; "fps"; «ייבוא כתוביות (SRT/VTT)»; export «ייצוא מהיר — מרנדר רק מה שהשתנה»; people sheet opens with a 7-line privacy paragraph mentioning «סוכן מחובר» before «הוספת אדם». Change: in Hebrew hide `.pf-pal-alt` and the English catalogue names (keep both as search aliases); translate the projects paragraph; «עברית» instead of "HE"; «30 פריימים בשנייה» in prose (keep "30 fps" in the status bar as a `.num` token if wanted); «ייבוא קובץ כתוביות»; «ייצוא מהיר: רק מה שהשתנה מאז הייצוא הקודם»; people privacy in two lines with «עוד» for the rest. Small each. Risk: `command-bar-wording.test.ts`, `proof:command-bar`, `people.strings.test.ts`, `audiences-wording.test.ts`.

**I7. Mode switch hides the picture.** Colour mode puts the scopes inside the stage (left third), Perform mode puts the pads inside the stage. Change: scopes and pads in the inspector column or a drawer under the stage that pushes the timeline, not the picture. Medium. Risk: `proof:perform`, `scopes.test.ts`.

**I8. Opening without a project reopens the last one** (`00-start` showed the 38-clip project); the start hub only appears inside an empty project. Already in `UX_AUDIT.md`; still seen.

**I9. Export sheet.** 980×860 in an 876 px window (scrolls); format thumbnails are grey placeholders, the preview was black after 0.5 s (one sample), preflight rows below the fold. Change (`ExportSheet.tsx`): preflight summary line above the primary button; real thumbnails or none. Medium. Risk: `proof:send`, `proof:phase*` export runs.

**I10. Effects drawer without a selection** is 53 text rows each with an active-looking «+» and a hint «בחרו קליפ בציר הזמן כדי להשתמש בספרייה»; the visual gallery opens only after a clip is selected (seen in the second pass, it then shows real previews and honest «דרוש כרטיס מסך» tiles). Change: show the tiles always; «+» disabled with the reason until a clip is selected. Medium. Risk: `proof:creative`, `gallery.pick.test.ts`.

---

## 5. What the owner's reference does differently

Source: the lead's notes `/home/user/PULSEFRAME/.artifacts/wave8/reference-video-report.md` and the one public screenshot (1800×1013, a 16:9 demo project, so 16:9 is compared). Used as evidence of what this owner finds pleasant; no branding, colours, glows, icons or wording are taken from it. Numbers for ours are from the 1908×876 shots (owner's case, or the 16:9 two-clip project where a 16:9 picture is compared).

| | Reference (one screenshot) | Ours at 1908×876 |
|---|---|---|
| Picture share of the window | 755×425 px of 1800×1013: **17.6 %** of the area, 42 % of the height | 16:9: 622×350, **13.0 %**, 40 %; 9:16 owner's case 3.3 % |
| Top bar | 5 things: export, language, API·MCP, project name menu, «נשמר» | 15 controls + 7 mode tabs + command field |
| Mode tabs | none | 7 (עריכה, מראה, סאונד, כתוביות, מסירה, קטעים קצרים, הופעה) |
| Side panels | one card with 6 tabs (icon over word) and a large upload area; one context card | rail 12 items + media drawer 33 controls + inspector with 2–8 tabs, 3 side tabs in Captions |
| Transport | one bar under the picture: timecode, 5 buttons, «total · size · fps» | stage header (עריכה/מקור, 9:16 chip, +, fullscreen) **and** transport (timecode/total, 6 buttons): 12 controls, 10 icon-only |
| Timeline toolbar | 14 buttons, **all icon + word** (undo, redo, split, delete, duplicate, close gaps, range start, range end, range cut, remove silences, + video, + audio, + text) and zoom | 14 controls, **12 icon only**; worded actions appear only with a selection |
| Track headers | name by kind + number, 2–3 icons each | name + id, 23 controls, 22 icon-only (add-track ×4, beat analysis, per-track toggles) |
| Empty selection shows | project settings (frame size, frame rate) and a keyboard list (7 rows) | project facts (8 rows) and a hint sentence; keyboard list only in the palette («קיצורים») |
| Radius and spacing | cards about 20 px radius, pill buttons, 16–24 px gutters | panels 14 px (`--pf-r-lg`), controls 6–10, 8 px gutters (`--pf-gutter`) |
| Saved state | the word «נשמר» beside the name | «נשמר ✓ 1080×1920 · 0:36» under the name (12–13 px) |

What it does that we do not, in plain words: the picture is the biggest thing; every timeline action says its name; one place holds the transport; there is one row of side tabs; nothing selected shows how to work (keys) rather than facts; radii and gaps are larger, so there is visibly less on screen. What it shows is one screenshot; how it behaves is not known here.

---

## 6. Proposal for the stage/timeline proportion (numbers)

Today at 1908×876 the window gives 792 px to stage + splitter + timeline (876 − 52 top − 24 status − 8 splitter). Owner's case: stage 423 (picture 311 + 112 chrome), timeline 357 (95 header rows + 259 lanes, 90 of them empty).

1. **Collapse empty lanes** (view state only, no op): a lane with no clips draws as a 10 px strip with its name on hover, and opens to its full height while a clip, title or effect is dragged over the timeline or when the owner clicks it. Saves 3 × 20 = 60 px in the owner's case. (`Timeline.tsx` lane rendering, `editor/timeline.css` `.track.is-empty`; `--pf-tl-natural` then counts collapsed lanes.)
2. **Beat strip only when beats exist**: the 22 px «ניתוח קצב» row becomes a button in the toolbar's «עוד» until beats are analysed (`PulseStrip.tsx`). Saves 22 px.
3. **One transport bar** (§7, WP1): stage header controls move into the transport row; chrome 112 → 68 px. Saves 44 px.
4. **Captions mode A1** stays at its normal height (52) unless words are being edited on the lane: saves 31 px.
5. **Default timeline height** (`interactions.math.ts` `TL_USUAL`): `clamp(200px, var(--pf-tl-natural), 30dvh)` for projects taller than wide, `clamp(200px, natural, 38dvh)` otherwise; Sound mode `clamp(248px, natural, 45dvh)` (today 52 %). The splitter keeps working, and its remembered height is stored per orientation (`pf.tl.height.portrait.v1` / `.landscape.v1`) so a height chosen for a wide film does not shrink a portrait one.
6. **Fit the film on open** (I5).

Expected owner's case (computed from the measured parts, to be measured after building):

| Viewport | Timeline today → proposed | Stage | 9:16 picture height today → proposed (target) |
|---|---|---|---|
| 1908×876 | 357 → ≈ 241 (95 − 22 header + 86 V1 + 52 A1 + 3×10) | 551 | 311 → ≈ 483 (≥ 480) |
| 1528×704 | 278 → ≈ 184 (compact lanes 50 + 34) | 440 | 232 → ≈ 380 (≥ 360) |
| 1366×650 | 278 → ≈ 184 | 386 | 165 → ≈ 326 (≥ 320) |

At 1908×876 a 9:16 picture 483 px tall is 272 px wide: 6.7 % of the window instead of 3.3 %, and 55 % of the window height. A larger change, not proposed as the default: for portrait projects let the side panels run to the bottom and the timeline span only the stage column (gains ~300 px more height, loses 670 px of timeline width).

---

## 7. Work packages (parallel, no shared files)

Each package owns its files; a file is in one package only. Acceptance checks are measurable with `pnpm shots:review` (its `metrics.json` / `metrics-extra.json`) unless said.

### WP1 — Calm layout (the owner's reference qualities, with our tokens)

**Files:** `ds/shell.css`, `ds/tokens.css` (layout and radius tokens only), `editor/Header.tsx`, `ds/topbar.css` (the `.pf-top*` rules moved out of `ds/chrome.css`), `editor/StageHeader.tsx`, `editor/Transport.tsx`, `editor/stage.css`, `editor/Timeline.tsx` (toolbar and lane collapse), `editor/RideBar.tsx`, `editor/timeline.css`, `editor/PulseStrip.tsx`, `editor/Splitter.tsx`, `editor/interactions.math.ts`, `editor/InspectorProject.tsx`, `editor/timeline.strings.ts`, `editor/chrome.strings.ts`.

What changes:
- **Picture as the largest thing:** §6 items 1–6.
- **One transport bar:** under the picture, LTR-isolated: start side timecode / total; centre: to start, frame back, play (44 px), frame forward, to end, loop; end side: «1080×1920 · 0:36», the format chip (9:16, opens the prism), fullscreen. The Edit/Source toggle («עריכה / מקור») shows only while a source clip is open (it is the only state where it does anything). The stage header row is removed; its «+» (new format) moves into the format chip's menu; safe-area toggle into the same menu.
- **Labelled timeline toolbar** (one row, icon + word, 32 px, `--pf-h-md`): «ביטול», «חזרה» | «פיצול» (S), «מחיקה» (Del), «שכפול», «סגירת רווחים», «הסרת שתיקות» | «תחילת טווח» (I), «סוף טווח» (O), «חיתוך טווח» (X) | «+ טקסט» | zoom (−, slider, +, «הכול»). At ≤ 1366 the three range buttons and «שכפול» go into «עוד ▾» first, then the words drop from undo/redo. Dependencies: close gaps and silence removal exist (command `edit.closeGaps`, the silence panel); range marks and range cut on the timeline do **not** exist yet (reference report §"Against this editor"): those three buttons need a new op and its proof before they are shown; until then they are not drawn (no button that does nothing).
- **Fewer things in the top bar** — every control keeps a named home:

| Control today (top bar) | Where it goes | Reached by |
|---|---|---|
| Logo, project name menu, rename | stays | — |
| Save line «נשמר ✓ 1080×1920 · 0:36» | stays as a **saved mark** «נשמר ✓» beside the name; format and length move to the transport's end side | — |
| 7 mode tabs | one «מצב: עריכה ▾» button (icon + word) opening the 7 modes with their Shift+1…7 keys | 1 click more; Shift+1…7 unchanged; palette «מצב …» |
| Command field (480 px) | stays, 320 px max, «חיפוש פקודה» + Ctrl K | — |
| Owner avatar, agent avatar and its menu (pause, undo agent) | status bar end: «העוזר: מוכן / מושהה» with the same menu | 1 click as today |
| Undo, redo | timeline toolbar start, with words | Ctrl Z / Ctrl Shift Z unchanged |
| Language «EN» | Settings «שפת הממשק» (already there) and palette «English / עברית» | 2 clicks instead of 1 |
| Export state ring | stays left of Export | — |
| Export | stays | — |

- **Toolbar items that leave the visible row** and where they go: select tool V and blade C (keys unchanged; the blade also in «עוד»), main magnet and ripple delete (Settings «התנהגות ציר הזמן» and «עוד», state shown as a small word on V1's header «מגנט»), beat snap (shown only after beats are analysed), link, marker (M; «עוד»), «זמן/תיבות» ruler toggle (shown only after beats are analysed), add-track buttons (in «+ טקסט ▾» menu: טקסט, וידאו, סאונד, התאמה).
- **Keyboard list in the empty inspector**: under the project facts, «קיצורי מקלדת» with the 8 most used keys from the command registry (`commands.ts` `chordLabel`: Space, S, Del, Ctrl Z, I/O, ←/→, Ctrl K, Shift 1…7) and «כל הקיצורים» opening the palette's list.
- **Radius and spacing:** panels `--pf-r-xl` (20) instead of `--pf-r-lg` (14); `--pf-gutter` 8 → 12; toolbar buttons pill (`--pf-r-pill`); no new colours, glows or icons beyond `lucide-react` and `editor/icons.tsx`.

What an advanced user loses and how to get it back: one click more for modes and language; tool, magnet, ripple, link, marker and ruler toggles are no longer one click away (keys unchanged, «עוד» menu, palette). A Settings switch «סרגל כלים מלא» (stored per browser, try/catch) restores today's full timeline toolbar row next to the labelled one.

Acceptance checks:
- 9:16 owner's case picture height ≥ 480 / 360 / 320 px at 1908×876 / 1528×704 / 1366×650 (`metrics.picture.h`), in Edit and Captions modes; 16:9 two-clip picture ≥ 15 % of the window area at 1908×876.
- Timeline height ≤ 30 % of the window for a 9:16 project with one clip, nothing selected.
- Top bar: ≤ 9 controls (`metrics-extra regions.top.controls`), no wrap, at all three viewports.
- Timeline toolbar: ≥ 80 % of visible controls with a word at 1908 (`regions.timelineBar`).
- Every control removed from the top bar or toolbar has its test id in its new home (`pnpm audit:testids` passes), and every listed action is reachable by key and by the palette (a script presses each key and reads the resulting op).
- Ruler on open shows the whole film for films under 3 minutes.
- Risk to re-record after comparing: `pnpm shots`, `proof:editor-interactions` (splitter heights, toolbar ids `tl-magnet`, `tl-ripple`, `snap-beats`, `tl-split`), `interactions.math.test.ts`, `proof:command-bar` (`open-palette`), `proof:perform` (`workspace-perform`), `proof:lifeline-ui`, `a11y-audit.ts`.

### WP2 — Things cut off or invisible

**Files:** `editor/welcome.css`, `editor/Welcome.tsx`, `editor/elementsBrowser.css`, `editor/ElementsBrowser.tsx`, `editor/MediaLibrary.tsx`, `editor/mediaLibrary.css`, `ds/drawer.css` (the `.pf-bw-*` and `.pf-rail*` rules moved out of `ds/chrome.css`), `editor/Rail.tsx`, `editor/Inspector.tsx`, `editor/inspector.css`.
**Lead pre-step before the packages start (no visual change):** move the `.pf-top*` rules of `ds/chrome.css` to `ds/topbar.css` (WP1), the `.pf-bw-*` and `.pf-rail*` rules to `ds/drawer.css` (WP2) and the `.pf-status*` rules to `ds/status.css` (WP3), imported where `chrome.css` is today; then no two packages edit the same file.
Covers D1, D2, D3, D4, D5, D10 (media pick and drawer controls).
Acceptance: empty-project shot has no timeline element above the hub (`elementFromPoint` at the hub's recent rows returns the hub) at 1908 and 1528; Elements tiles contrast ≥ 3:1 light and dark; `cutByPane` contains no `asset-name`, ≥ 4 whole cards at 1908×876 and ≥ 2 at 1528×704; no inspector tab label cut (scrollWidth ≤ clientWidth) at ≥ 1366; every rail label's bottom ≤ viewport bottom at 1366×650; drawer chips in one row (`wrapped` has no `pf-bw-chips`).

### WP3 — Wording, language and status

**Files:** `editor/TranscriptPanel.tsx`, `editor/captionsPanel.css`, `editor/StatusBar.tsx`, `ds/status.css` (the `.pf-status*` rules moved out of `ds/chrome.css`), `editor/CommandPalette.tsx`, `editor/command-palette.css`, `editor/Library.tsx` (catalogue rows), `editor/ProjectsDialog.tsx`, `editor/lifeline/people.strings.ts`, `editor/ExportSheet.tsx`, the matching `*.strings.ts` files except `timeline.strings.ts` and `chrome.strings.ts` (WP1).
Covers D6, D7, D9, I6, I9.
Acceptance: Latin words in the Hebrew UI only in `.num`/`kbd`, the language switch and user file names (`metrics.latin` empty elsewhere) on the palette, catalogue drawers and projects dialog; one transcript heading; ≥ 4 phrases visible at 1908×876; the status pip has a tooltip naming each item and no unlabelled dot; one film length in top bar, status bar and inspector.

### WP4 — Small CSS rules that cut across

**Files:** `ds/primitives.css`, `ds/focus.ts`, `editor/icons.css`, `editor/timelineZoom.css`, `editor/keyframes.css`, `editor/CanvasHandles.tsx` (hit area only), the `.num` rule in `ds/tokens.css` is **not** touched here (WP1 owns that file) — D12 is done in the components that print durations through a shared helper in `ds/util.tsx`.
Covers D8 (if WP1 has not removed the wrap), D10 (inspector fields, keyframe buttons, zoom slider, canvas handles), D11, D12.
Acceptance: `metrics.small` empty for buttons and inputs on every shot (canvas handles: hit area ≥ 24 px measured on `.ch-handle`); every focus outline colour equals `--pf-focus` in a 14-stop Tab walk, light and dark; no duration rendered with its unit inside an LTR-isolated run (script reads `.num` text: digits only).

---

## 8. What could not be opened or photographed

- **The phone code (QR):** the dialog opens and says honestly that this computer is not on a home network (the container has no LAN address), so «phone-drop-start» stays disabled; the QR plate was not seen.
- **The start hub without a project:** opening the editor without `&project=` reopened the last project; the hub was photographed only inside an empty project (D1).
- **Templates "drawer" and "people sheet"** were photographed (rail Templates drawer, palette «אנשים»); the template apply dialog was not opened.
- **The effects gallery** opens only with a clip selected; photographed in the second pass at 1908 light/dark and 1528 light.
- **The owner's real screen:** the 1908×876 viewport stands in for it; Windows font rendering (Segoe UI fallback, ClearType) and the browser's own zoom were not reproduced.
- **Speech engine, AI providers, GPU:** absent here; their panels show honest setup states, which is what the owner would see on a machine without them.
