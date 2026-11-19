# UX/UI audit of the editor (2026-11-17, build c09eed4)

Made by an auditing agent that ran the built editor with synthetic media and drove it with a headless browser at 1440×900, 1920×1080 and 1280×720, in Hebrew and English. Screenshots stayed on the build machine (not committed). Nobody but the agent has looked at the screens; the step counts are the agent's own.

## Summary

I audited the current main build (worktree wt/ux-audit, commit c09eed4), served on :8931 with synthetic media only: ffmpeg testsrc2, mandelbrot, smptehdbars, gradients and cellauto clips, a synthesised music bed, and the Hebrew narration sample. I built three projects through the REST API: an empty one, a 29 s 16:9 family-weekend edit (5 clips, title, transcript captions, music, narration, a dissolve and a push transition, a vignette, a warm look, markers) and a 9:16 project with 24 clips. I then drove the UI with Playwright at 1440×900, 1920×1080 and 1280×720 in Hebrew and English, and saved 126 PNGs under /home/user/PULSEFRAME/.artifacts/ux/audit/shots/. Scripts are in /home/user/PULSEFRAME/.artifacts/ux/audit/scripts/ and the task log is in /home/user/PULSEFRAME/.artifacts/ux/audit/tasks.json. I stopped the server afterwards; git status in the worktree is clean, and I wrote nothing in the repository.

Verdict: every core task can be done, and quickly (1–6 clicks each). But the editor feels like an engineering control panel, not a creative tool.

Layout problems:
- The shell is not a fixed viewport. The page itself scrolls, by 31 px at 1440×900. After an export the header grows to 1,624 px wide, which pushes the Export button off-screen. In the 9:16 format view the header grows to about 190 px tall.
- The timeline stacks audio above video, so the main video track is the bottom row and is cut off at 1440×900.
- Track headers scroll away when the timeline scrolls sideways.
- Transitions are never drawn on the timeline.

Tool organisation:
- One video clip's tools sit in a single 4,927 px scroll inside a fixed 330 px column. The Transition section is 3,818 px down.
- "Workspaces" only filter those inspector tabs; the rest of the layout never changes.
- The trend catalogue that should sell the product is offered mostly as plain lists of names: 70 transitions, 40 text styles, 40 caption looks. The visual gallery shows black tiles for 3–4 s, and its text-style previews are about 20 px samples.
- Developer language reaches the owner: ComfyUI environment variables in the AI panel, PF_BACKUP_DIR, docs/INTEGRATIONS.md, BT.709 colour notes on every video card, a "Pause agent" button and revision counters.
- In this build there is no templates drawer, and no upscale, slow-motion or translation tools in the UI. The only AI entry is the ComfyUI setup card.

What already works: text contrast is good (muted text 8.4:1). Focus rings are visible. Reduced motion is respected. The English UI flips the layout correctly, and the basic RTL mirroring is right. Thumbnails and waveforms are real, there are on-canvas handles and a context menu, and effect previews are made from the user's own frame.

Compared with the editors the owner has in mind:
- CapCut desktop: a fixed top bar of asset categories with animated previews, drag-to-apply, a magnetic main track, and a "+" between clips for transitions.
- Premiere: video tracks above audio, sticky track headers, and an export dialog.
- DaVinci Resolve: pages that really change the layout.
- Descript: the transcript is the edit surface.

PULSEFRAME now sits below all four in look and feel, even though its features are comparable.

## Core tasks (steps and clicks as measured)

| Task | Steps | Clicks | Notes |
|---|---|---|---|
| Import a file and put it on the timeline | 4 | 2 | Click 'בחירת קבצים מהמחשב' (choose files), then the OS file dialog (2 OS steps), then the 34×28 '+' on the media card. Importing never places a clip. After the first import the welcome card disappears and the stage is an empty black box with no hint (t1-after-import.png). Dragging a card to the timeline also works (8 draggable cards), but nothing says so. |
| Trim and split | 5 | 5 | Select the clip, drag its edge (the cursor stays 'pointer' and no handle is drawn), click the ruler to move the playhead, select the clip again, click Split (or press S). It works, but the trim edge is undiscoverable (t2-hover-trim-edge.png). |
| Delete a clip | 2 | 2 | Select, then Delete (button, Del key or context menu). It leaves a gap: there is no magnetic main track or ripple-delete default, unlike CapCut (t3-after-delete.png). |
| Add a transition between two clips | 4 | 3 | Select the second clip, scroll the inspector 3,818 px to 'מעבר' (transition), open a select with 70 names, choose one. The result is invisible on the timeline. It was accepted on a clip after a 4.6 s gap. Between two full-length clips it fails with 'לקליפ הקודם נשארו רק 0 פריימים…' (the previous clip has only 0 spare source frames) and offers no fix (17-error-transition-no-handles-1440.png). The gallery path takes 5 clicks plus a scroll. |
| Add a text title and style it | 5 | 4 | Click 'הוספת טקסט' (add text), click the textarea, select all and type, open the 'סגנון טקסט מוכן' (text style) select of 40 names, choose one. There is no visual preview in the dropdown. Afterwards it shows 'בחירת סגנון…' (choose a style) again, so the current style isn't shown. The text is placed at the playhead, and the canvas handles work. |
| Add captions | 4 | 3 | Captions tab, 'כתובית חדשה בסמן הניגון' (new caption at the playhead), type in the cue (3 clicks plus typing per cue). Automatic captions aren't possible because speech recognition isn't configured here; the Speech tab says so honestly. Looks are a dropdown of 40 names. Captions made from a transcript play in the preview but are not drawn as cues on the caption track. |
| Add an effect and change one parameter | 8 | 6 | Select the clip, scroll to 'מראה ואפקטים' (look and effects), open the gallery, wait 3–4 s for tile previews, pick Blur, close, scroll to the parameter, drag the 'רדיוס 0.035' slider. That is 6 clicks and 2 scrolls. The parameter shows a raw number with no unit, under a paragraph about beat modulation. |
| Add music and duck it under speech | 6 | 5 | '+' on the music card, '+' on the narration card, Sound tab, find the music track by its A-number, set 'להנמיך כשיש דיבור ב' (lower when there is speech on) to A3 (2 clicks), plus 1 scroll. The user has to map A1/A2/A3 to content; there is no 'auto-duck under voice' toggle on the music clip. |
| Change format to 9:16 | 4 | 4 | Deliver tab, '+ אנכי 9:16' (add vertical 9:16), then the header format switch (2 clicks) to view it. The header then grows to about 190 px tall because the format badge sentence wraps word by word. The title overflows the vertical frame, and there is no automatic reframing. |
| Export | 2 | 1 | One click on 'ייצוא' (export). There is no dialog: no resolution, quality, filename or preset choice. Progress is a stage word inside the button. It took 87.5 s for 13 s of 1080p on this CPU, with no percentage or ETA. The finished message, the 'download again' link and the flash-check result are added to the header, which then overflows the window sideways and pushes Export off-screen (t10e-master-after-export.png). |

## Problems

### [critical] Header grows sideways and downwards after an export or in a format view, breaking the whole layout
- Where: Header (apps/web/src/editor/panels.tsx Header: export-finished / export-download / flash-pass / format-badge rendered inline)
- Evidence: Measured document scrollWidth: 1440 at rest, 1481 while exporting, 1624 when finished (header 90 px tall, still so back in the master view). In the 9:16 view the format-badge sentence wraps one word per line and the header is about 190 px tall. The app shifts 184–340 px sideways and the Export button and library are clipped. Screenshots: t9-viewing-9x16.png, t10-export-progress.png, t10-export-finished.png, t10e-master-after-export.png.
- Fix idea: Keep the header to one non-wrapping row of fixed slots. Move export status into a dedicated export sheet or toast with a progress ring and a result card. Show the format view as a short chip ('9:16 · 1080×1920') with the explanation in a tooltip.

### [critical] The app is not a fixed viewport: the page scrolls and panels clip at common laptop sizes
- Where: App shell grid (styles.css .app / timeline height)
- Evidence: Document height is 931 px in a 900 px window and 751 in 720. Selecting a clip near the bottom scrolls the whole page and cuts the header (03-clip-selected-1440.png). At 1280×720 the ruler disappears under the toolbar and the V1 track is cut off (03-clip-selected-1280.png). The timeline gets only 245–306 px, with no resize handle.
- Fix idea: Use a 100dvh grid with min-height:0 panes and no body scroll. Add a draggable splitter between viewer and timeline, collapsible side panels, and a compact mode under 800 px of height.

### [critical] Timeline track order is upside down: audio above video, main video track at the bottom edge
- Where: Timeline (apps/web/src/editor/Timeline.tsx)
- Evidence: Rows from top to bottom: A3, A2, A1, captions, T1, V1. V1 holds the main story and is the last, half-visible row at 1440×900. Screenshots: 02-main-pro-1440.png, 02-main-pro-1920.png, 05-busy-timeline-fit-1440.png.
- Fix idea: Put overlays, text and captions above, a taller highlighted main video track in the middle (CapCut's main track), and audio below, with clear lane colours by kind.

### [critical] Transitions are invisible on the timeline, accepted where they make no sense, and refused with no remedy
- Where: Timeline (no transition rendering; grep for 'transition' in Timeline.tsx and clip-visuals.css finds nothing), LookPanel transition section, ErrorBar
- Evidence: The dissolve and push on the main project show nothing at the cuts (02-main-pro-1920.png). A transition was accepted on a clip that follows a 4.6 s gap (t4-after-transition.png). Between two full-length clips the UI shows 'מחוץ לטווח המותר : לקליפ הקודם נשארו רק 0 פריימים…' (out of range: the previous clip has only 0 spare source frames) with no action, although the server sends a hint (17-error-transition-no-handles-1440.png).
- Fix idea: Draw a transition chip on each cut, show a '+' between adjacent clips to add one (as CapCut does), and let the user drag the chip to change its length. When handles are missing, offer 'trim 0.5 s automatically' or an overlap mode in place.

### [high] One clip's inspector is a single 4,900 px scroll in a 330 px column
- Where: Inspector clip panel (panels.tsx Inspector, Sections: speed, speed ramp, speed curves, freeze, reverse, transform, keyframes, trim, entrance and exit, look and effects, colour look, blend, mask, transition, analysis)
- Evidence: The inspector's scrollHeight is 4,927 px for a video clip, and the Transition section starts at scrollTop 3,818. Many sections carry 3–5 lines of explanation (03-clip-inspector-strip-1440.png, t4-transition-section.png). Selecting a clip doesn't switch to the Clip tab: with Sound active, the user still sees track faders (14-english-clip-1440.png).
- Fix idea: Use a contextual property bar with icon categories (Basic, Animation, Speed, Adjust, Effects, Mask, Audio), one category visible at a time. Move help text into tooltips or a '?' popover. Always open the selected object's properties on selection.

### [high] Workspaces are only inspector-tab filters, not real workspaces
- Where: Header workspace select and panels.tsx WORKSPACE_TABS
- Evidence: Every workspace keeps the same three columns and timeline. Color shows the histogram, waveform and vectorscope stacked in the 330 px column, with no wheels or curves (04-workspace-color-1440.png). Motion, Captions, Sound, Deliver and Custom differ only in their tab sets (04-workspaces-inspector-sheet-1440.png). The workspace control is an unlabelled 83 px select.
- Fix idea: Turn workspaces into page-level layouts (Edit, Color, Audio, Captions/Text, Deliver), like Resolve's pages, with a visible segmented switcher. Each layout gets its own large canvas: colour wheels with scopes beside a large viewer; a mixer with meters; a transcript-first caption page as in Descript.

### [high] The creative catalogue is mostly lists of names; the visual gallery is slow and its previews unreadable
- Where: LookPanel transition-type select, text-preset select, CaptionControls caption-look select, EffectGallery.tsx, ElementsBrowser.tsx
- Evidence: There are 70 transitions, 40 text styles and 40 caption looks in plain selects (t4-transition-section.png, t5-after-text-style.png, 08-tabs-sheet-1440.png). Gallery tiles stay black for 3–4 s (06-gallery-default-1440.png, 06-gallery-text-styles-1440.png). Rendered text styles are about 20 px 'אבג Abc' samples (06-gallery-text-styles-after10s-1440.png). Hovering a tile only adds a border (06-gallery-transition-hover-1440.png). Elements are plain arrows (09-library-elements-1440.png).
- Fix idea: Add a persistent asset browser with a category bar (Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Templates). Use large animated thumbnails that play on hover, with the user's own frame and the user's own title text. Support drag-to-apply onto clips and cuts, plus favourites, trending and recently used. Keep the dropdowns only as a compact fallback.

### [high] Import leaves the user at a dead end: nothing is placed and the stage goes black
- Where: Welcome.tsx and Library import (store.importFiles without place)
- Evidence: After choosing a file, the welcome card vanishes, the preview is black and the timeline is empty. The user has to find the small '+' on the card (t1-after-import.png).
- Fix idea: On the first import into an empty project, append to the main track automatically (with undo). Otherwise show a 'drag here or click + to add to the timeline' hint on the timeline and pulse the '+' on new cards.

### [high] Export has no dialog, no presets and no real progress
- Where: Header export button and DeliverPanel
- Evidence: A single click exports immediately. Progress is a stage word inside the button, and 87.5 s passed for 13 s with no percentage or ETA. The result is three inline header items (t10-export-progress.png, t10e-master-after-export.png).
- Fix idea: Add an export sheet with a large preview, social presets (TikTok, Reels, Shorts, YouTube, WhatsApp), resolution and quality, filename, all-formats batch, and a progress bar with ETA. Finish with a result card offering play, show in folder and export again.

### [high] Track headers scroll out of view with the timeline
- Where: styles.css .track-head {position:absolute; left:-76px}
- Evidence: Selecting kids-dancing auto-scrolled the timeline to 15–30 s, and the A/T/V headers with their lock, mute and hide controls disappeared (17-error-transition-no-handles-1440.png).
- Fix idea: Make the header column sticky (position:sticky; inset-inline-start:0) in its own layer, and redesign it with names, colour and hover-revealed controls.

### [high] Trimming and gap handling lack modern affordances
- Where: Timeline clip edges (TimelineDrag.tsx), delete command
- Evidence: The cursor at the clip edge measures as 'pointer'; there is no visible trim handle (t2-hover-trim-edge.png). Delete leaves gaps (t3-after-delete.png). The busy project shows tiny unreadable clips (05-busy-timeline-fit-1440.png).
- Fix idea: Show an ew-resize cursor and visible edge grips on hover and selection, with a live duration tooltip during the drag. Add a magnetic main track (on by default for this owner), ripple delete, and a 'close all gaps' action.

### [high] Developer and engineering language is shown to the owner
- Where: AiTools.tsx (ComfyUI env vars), ProjectsDialog backup/storage, SoundPanel narration setup, media cards (colour-encoding notes), header 'Pause agent' and revision, Speech tab badges
- Evidence: The AI panel tells the user to restart with PF_COMFYUI_URL=http://127.0.0.1:8188 (10-ai-tools-1440.png). The backup section mentions PF_BACKUP_DIR, and the storage rule is untranslated English (13-projects-dialog-1440.png). Narration setup refers to docs/INTEGRATIONS.md (11-sound-sfx-1440.png). Every video card carries 'הערות על הקובץ (1)' (notes about this file) about BT.709/BT.601 (18-asset-notice-open-1440.png). The header shows 'השהה סוכן' (pause agent) and 'גרסה 28' (version 28) (02-main-pro-1920.png). Speech shows 'תזמון משפט בלבד' (sentence timing only) badges (19-speech-tab-narration-1440.png).
- Fix idea: Move setup, storage, backup and agent governance into a Settings / Advanced area. Present AI tools as a hub of cards that each say plainly 'needs setup' and link to a guided setup. Show colour-encoding notes only when they change the picture. Turn the agent control into a presence avatar.

### [medium] RTL: spatial sliders run opposite to the canvas
- Where: Inspector transform and effect sliders (input[type=range] inherit dir=rtl)
- Evidence: Measured: the horizontal-position, rotation and mask-X ranges have direction rtl with max at the left, so dragging left moves the picture right on the unmirrored canvas (03-clip-inspector-strip-1440.png). Volume and pan are mirrored too, while the timeline, timecode and transport run left to right.
- Fix idea: Set dir='ltr' on sliders bound to space or time (x, y, rotation, pan, time). Keep the labels right to left. Document which controls mirror and which don't.

### [medium] Bidi and truncation defects
- Where: Header format switch, ProjectsDialog storage table, ErrorBar
- Evidence: The format switch shows '…0×1080) (Master) מקור': the resolution is truncated from the wrong end (02-main-pro-1440.png). Storage reads '22 29.7 · קבצים MB' and '0 0 · קבצים B' (13-projects-dialog-1440.png). The error-bar colon floats on its own between the headline and the detail (17-error-transition-no-handles-1440.png).
- Fix idea: Wrap mixed runs in <bdi> and Unicode isolates, format numbers and units with Intl as one isolated string, use short chips such as '16:9 · 1920×1080', and lay out the error as a toast with a title row and a body row.

### [medium] Error banner is technical, sticky and shifts the layout
- Where: ErrorBar (panels.tsx)
- Evidence: The full-width red banner pushes the layout down 40 px and stays through later unrelated actions (21-clip-right-click-1440.png). The text talks about 'unused source frames'. There is no recovery action.
- Fix idea: Show an inline toast anchored to the target, in plain Hebrew ('אין מספיק וידאו בסוף הקליפ הקודם' – not enough video at the end of the previous clip), with a one-click fix and auto-dismiss on the next successful edit.

### [medium] Captions: transcript captions not drawn on the timeline; Hebrew cue labels in synthetic italic
- Where: Timeline caption track, caption cue rendering
- Evidence: The C1 caption row is empty while captions play in the preview (02-main-pro-1920.png vs 07b-preview-title-captions-1440.png). The manual cue label 'כתובית חדשה' is drawn slanted (t6-after-caption-add.png).
- Fix idea: Draw every cue (generated or manual) as an editable block with inline text editing. Never apply font-style:italic to Hebrew. Use colour or a caption icon to mark the caption lane instead.

### [medium] Typography is small and uses Latin conventions on Hebrew
- Where: theme.css / styles.css h2, timeline labels
- Evidence: Section headings are 11 px, uppercase and letter-spaced (0.99 px) Hebrew (computed on .inspector > h2 and .library > h2). Ruler and track names are 11 px monospace, and most metadata is 12 px. There is no display face; everything is Heebo, giving little hierarchy (02-main-pro-1440.png).
- Fix idea: Use a Hebrew type scale (13/14/16/20/28) with no letter-spacing on Hebrew, and a display weight for panel titles. Keep Heebo or Rubik for UI and use proportional digits except in timecode.

### [medium] Many interactive controls are smaller than 24 px
- Where: Track header, library cards, timeline toolbar
- Evidence: 46 visible controls are under 24 px: track rename, target, lock and mute at 17×18; rename pencils at 22×18; zoom ± at 28×20; add-track chips at 37×20; the snap checkbox at 13×13. Hovering the lock shows no tooltip (16-hover-focus-sheet-1440.png).
- Fix idea: Make controls at least 28–32 px, add immediate custom tooltips with shortcuts, and group track controls into a hover-revealed cluster.

### [medium] Library cards and column are cluttered
- Where: MediaLibrary.tsx / Library aside
- Evidence: Each card has a rename pencil, a notes disclosure, a colour select, and red delete, view and add buttons, while file names truncate to 'birthday-cake…'. The same column also holds text, 252 elements and the AI tools, for a total scroll of 1,917 px (02-main-pro-1440.png, 09-library-elements-1440.png).
- Fix idea: Use a clean thumbnail grid with duration and type badges, actions on hover or in a context menu, and a name tooltip. Split Media, Text, Elements and AI into tabs of the asset browser.

### [medium] Editing text doesn't show the text, and style state isn't shown
- Where: Selection behaviour; text-preset select
- Evidence: Selecting the title leaves the playhead at 0, outside the clip, so the preview doesn't show it (07-text-selected-1440.png). After a style is applied, the select shows 'בחירת סגנון…' (choose a style) again (t5-after-text-style.png).
- Fix idea: When a text or caption clip is selected and the playhead is outside it, move the playhead inside the clip (or show a pinned preview). Keep the current style highlighted in the visual style grid.

### [medium] Ducking requires mapping track numbers
- Where: SoundPanel sound-duck-source
- Evidence: Each track card has a 'להנמיך כשיש דיבור ב' (lower when there is speech on) select offering 'A1, A3' (t8-after-duck.png).
- Fix idea: Put an 'Auto-duck under voice' switch on the music clip that finds speech tracks by transcript or name, with a depth slider in dB and the result drawn as a volume envelope on the clip.

### [medium] Toolbar text collides; disabled Delete reads as a live danger button
- Where: Timeline toolbar (timeline-actions)
- Evidence: At 1440 the hint 'בחרו קליפ כדי לפצל…' (select a clip to split…) is clipped behind the buttons (02-main-pro-1440.png). The disabled Delete keeps its red text at a measured 2.19:1, unlike the other disabled buttons.
- Fix idea: Drop the sentence hint and use icon buttons with tooltips. Render disabled destructive buttons in neutral grey.

### [medium] 9:16 conversion keeps landscape framing and overflows titles
- Where: Format views / variants
- Evidence: 16:9 clips are letterboxed in 9:16 (05-busy-timeline-fit-1440.png). The title spills past the 9:16 frame edges (t9-viewing-9x16.png).
- Fix idea: When creating a vertical format, offer 'fill and centre on the subject' (using the existing tracking data where available). Auto-fit text to the safe area and show the safe-area overlay by default.

### [medium] Empty state and project management feel unfinished
- Where: Welcome.tsx, ProjectsDialog.tsx
- Evidence: The welcome card is small inside the preview while empty panels, 252 arrows and empty lanes stay visible (01-welcome-empty-1440.png). Project rows show only 'גרסה N' (version N), with no thumbnail, date or duration. Red Delete sits next to Open, and the name field is an unstyled grey box (13-projects-dialog-1440.png). Opening without a project silently reopens the last one.
- Fix idea: Add a full-screen start hub: new project by aspect ratio (9:16, 1:1, 16:9), recent projects with thumbnails and dates, templates, a sample project and a big drop zone. Delete belongs behind a menu with confirmation.

### [medium] Visual identity is generic and flat
- Where: theme.css tokens across all screens
- Evidence: Every panel uses the same near-black (rgb 11–27) with thin borders, and teal appears only on primary buttons and sliders. There are no surface elevations, no motion, and no brand moments (02-main-pro-1920.png, 14-english-main-1920.png).
- Fix idea: Define a layered surface scale (canvas, panel, raised, overlay), a signature accent gradient used sparingly (selection, playhead, primary CTA), soft 150–200 ms transitions on panel and tab changes, and a branded loading and export moment.

### [low] Expected feature surfaces are missing in this build
- Where: Library / AI panel
- Evidence: In main c09eed4 there is no templates drawer, and no upscale, slow-motion or translation tools in the UI. The AI section lists only the ComfyUI provider (10-ai-tools-1440.png). The command palette search for 'מעבר' (transition) returns only navigation commands (12-command-palette-search-1440.png).
- Fix idea: Reserve places for them in the redesign: an AI hub card grid and a Templates tab in the asset browser. Make the command palette able to apply catalogue items ('add dissolve', 'yellow pop title').

### [low] Hover feedback is minimal
- Where: EffectGallery tiles, track controls, disabled buttons
- Evidence: Gallery hover is a border only. Disabled Split gives no reason on hover. Track icons have no instant tooltip (06-gallery-transition-hover-1440.png, 16-hover-focus-sheet-1440.png).
- Fix idea: Play animated previews on hover, explain disabled states in tooltips ('בחרו קליפ קודם' – select a clip first), and show instant tooltips with shortcut hints.

## What already works

- Text contrast is good throughout: muted text measures 8.4:1, ruler and track names 7.9:1, primary buttons 10.2:1.
- Keyboard and screen-reader basics are solid: a clear 2 px cyan focus ring on clips, tabs and buttons, tabs with roving tabindex, the first timeline clip reachable by Tab, a shortcut editor, and prefers-reduced-motion respected.
- RTL fundamentals are right: the header and side panels mirror, the timeline, timecode and transport stay left-to-right, play and frame-step icons are not mirrored while undo and redo are, and Hebrew text such as 'יאללה!' renders correctly in clip labels and captions. The English toggle relayouts instantly and correctly.
- Timeline clips have real filmstrip thumbnails and waveforms, volume lines, markers, a right-click context menu with shortcuts, and on-canvas transform handles with a rotation knob.
- Effect, look and transition gallery previews are rendered from the user's own current frame through the same compositor as export: a strong, original basis for a CapCut-class browser once it is fast and animated.
- Missing engines are reported honestly (speech, narration, ComfyUI) instead of fake buttons. The export completed successfully and reported a photosensitivity (flash) check.
- Core tasks take few clicks (1–6 each), and every edit is undoable. The welcome card's three steps and keyboard hints are clear.
- The catalogue is already broad (69 transitions, 53 effects, 40 colour looks, 40 text styles, 40 caption looks, 80 sound effects, 252 elements): the problem is presentation, not content.
