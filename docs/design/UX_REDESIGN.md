# PULSEFRAME Studio: final design ("Pulse", דופק)

Design director's verdict and the build-ready system. Written 2026-11-17 from the three directions under `.artifacts/ux/directions/{studio,creator,pulse}`, the audit in `.artifacts/ux/audit` (screenshots plus `tasks.json` step counts), the research notes, and a read of today's `apps/web` (App.tsx, panels.tsx, Timeline.tsx, theme.css, styles.css, fonts.ts, evals proofs and a11y-audit.ts).
Nothing in the repository was edited. This file is the long-form spec; the canvas brief is at the end.

---

## 1. Scores

Scale 1–10. Convenience is measured against the audit's step counts for 10 core tasks. "Risk" is scored inversely: 10 means least risk to existing features and proofs.

| Criterion | Studio | Creator (Pulse Stage) | Pulse | Notes |
|---|---|---|---|---|
| Convenience for core tasks | 8 | 9 | 8.5 | Creator's riding toolbar in the timeline header covers nothing, and its export sheet has the best destination flow. Pulse's command bar is the strongest single shortcut, but its moment card floats over the V2 lane and hides clips at 1280. Studio's edit-point inspector is best for cuts. |
| Visual quality and polish | 8 | 8 | 9 | Pulse has the most finished hierarchy: layered slabs, two lights, Karantina moments (the 64% export). Studio is calm but looks generic. Creator's pulse gradient risks "neon everywhere". |
| Originality | 7 | 7 | 10 | Pulse's Frame/Pulse two-light semantics, gold on-beat diamonds, bars ruler, command bar, receipts and the hatched flash lane are a real identity. The other two share the Pulse Strip but not a system. |
| Hebrew RTL quality | 9 | 8 | 9 | Studio and Pulse isolate every number and unit and set no Hebrew below 13 px. Creator puts the Hebrew name chip at the left (time-start) edge, which reads oddly. |
| Accessibility | 9 | 8 | 8 | Studio measured 2,385 rendered text runs with 0 failures. Pulse's text-3 on surface-4 is 4.47 (it fails; fixed below), its breathing clips animate chrome during playback, and agent violet and caption lilac are nearly the same hue (fixed below). |
| Buildability in this codebase | 8 | 7 | 7 | All three need panels.tsx split up. Studio is closest to today's grid. Pulse adds the most surfaces (prism, palette tiles, copilot). Creator keeps Heebo, so it has no font change. |
| Risk to features and proofs | 7 | 7 | 6 | Creator lists testid homes explicitly. Pulse's agent proposals need an ADR and a new MCP tool, and ripple-by-default changes edit semantics. |
| **Weighted total** (convenience ×2, a11y ×1.5, the rest ×1; max 85) | **68.5** | **67** | **70** | Close. Pulse wins on identity and polish, and its deficits can be fixed by grafts. |

### Audit baseline compared with the final design (counted interactions)

| Task | Audit today | Final design | How |
|---|---|---|---|
| Import and place | 2 clicks + 2 OS steps | 1 drop (auto-placed in an empty project, undoable), or E/+ on a card | first import auto-append; `+`/E append to V1 |
| Trim and split | 5 clicks | 2 (one drag, one S) | grips plus live delta chip; S splits the clip under the playhead on the hovered or selected track (V1 when nothing is selected) |
| Delete clip | 2, leaves a gap | 1 (hover + Del) | ripple on magnetic V1, one op, undo toast; Shift+Del keeps the gap |
| Add transition | 3 clicks + 1 scroll + a `<select>` | 1 drag or 2 clicks (`+` on cut, then tile); Ctrl T = default | chips and `+` on every cut, gallery filtered to the cut |
| Title + style | 4 clicks + typing | T, type on canvas, 1 tile click | playhead moves into the title; style tiles drawn with the user's own words |
| Captions | 5 clicks, manual cues | 1–2 in Captions mode when speech is ready; otherwise an honest setup card | "יצירת כתוביות" |
| Effect + parameter | 6 clicks + 2 scrolls | 2 (drop tile on clip, drag scrub) | inspector opens on the Effects tab with the new effect expanded |
| Music + ducking | 5 clicks + 1 scroll + track numbers | 2 (drop music, flip "להנמיך כשמדברים") | speech source found automatically |
| Format 9:16 | 4 | 1–2 (prism "+ 9:16" creates it and makes it active) | format prism in the stage header |
| Export | 1 click, no dialog | 2 (Export, then Enter on the remembered preset) | the sheet adds presets, preflight and progress; one extra step is a deliberate trade |

---

## 2. Decision

**Winner: Pulse (דופק).** It is the base for tokens, the two-light semantics, the shell, the inspector board, the gallery spread, the command bar, the AI hub, the start hub and the export progress. These parts are grafted from the other directions:

From **Creator**:
- **Riding toolbar in the timeline header row**, centred on the selection. It replaces Pulse's floating moment card, which covered the V2 lane. It keeps Pulse's "2 תיבות" duration chip in gold at its start.
- **Export sheet settings layout**: destination cards (רילס·טיקטוק·שורטס, יוטיוב, וואטסאפ, שמירה במחשב, מותאם אישית), multi-format checkboxes with live thumbnails, the extension as a separate chip, and "ייצוא 2 קבצים".
- **"להחיל על כל N החיתוכים"** footer in the transitions spread, as one transaction.
- The **explicit testid home list**, the starting point for §8.
- **Format prism previews beside a 9:16 viewer** in the text tool, using the spare width.

From **Studio**:
- **Status bar (24 px)**: format and fps, duration, running jobs with mini rings, the flash-check result, capability pips ("2 להגדרה") and notifications. This moves pips and job state out of the top bar, which keeps the top bar to one quiet row at 1280.
- **Edit-point (cut) inspector and the two-up cut loupe in the viewer** while rolling: `,`/`.` roll one frame, Shift+B snaps to the nearest beat, plus handle meters.
- **Handle-aware gallery**: tiles say "מתאים" or "יקצר 0.2 ש׳" before you apply, under the heading "מתאימים לחיתוך הזה".
- **Viewer/timeline splitter** with a grip.
- **A3 sound-effects lane** (Pulse's render omitted it).
- **Property-row grid and scrub field spec** (label | control | value | keyframe, min 30 px).
- **Rendered-DOM contrast discipline**: every screen is checked numerically, as Studio did.
- **Shift+1…5** switch modes.

**Changes to Pulse itself:**
1. **No breathing clips during playback.** During playback only the playhead, the Pulse Strip's current-beat tick and the transport beat chip may animate. This follows the research rule that chrome stays still so footage stays the brightest moving thing. A section's "lit" state is static.
2. **Captions move out of lilac.** Agent violet (#C3A6FF) is reserved for the agent. Caption cues become light pink (#FFC2E0), the same "words" family as titles (#FF8FD0), told apart by lane, icon (CC) and lightness.
3. **text-3 is raised to #959CA8**, which reaches 5.13:1 on surface-4. The control edge is raised to #666D7A (3.34:1).
4. **Song-section labels (פתיחה/בית/פזמון/דרופ) show only when a section analysis exists.** Today the product analyses beats and bars only, so the Pulse Strip shows bars and beats, plus a muted "ניתוח חלקי השיר" action when sections are missing. The strip never shows invented structure.
5. **Agent proposals drawn on the timeline (dashed violet ghosts) are phase 3 and need an ADR plus a propose/dry-run MCP tool.** Until then the Copilot shows the plan card as text and receipts after commit.
6. **Ripple delete and the main-track magnet are explicit toggles, stored per project, on by default for new projects.** Existing projects keep their current behaviour until the owner turns them on. The toggle state shows in the timeline toolbar.

---

## 3. Design system

### 3.1 Files and naming
- New single source: `apps/web/src/ds/tokens.css`, imported first in `main.tsx`.
- `packages/brand/src/tokens.css` keeps the brand constants. It gains these aliases so the 150+ existing `var(--pf-…)` uses keep working:
  - `--pf-bg → var(--pf-canvas)`
  - `--pf-surface → var(--pf-surface-1)`
  - `--pf-surface-raised → var(--pf-surface-3)`
  - `--pf-border → var(--pf-line-strong-solid)`
  - `--pf-text-muted → var(--pf-text-2)`
  - `--pf-accent → var(--pf-frame)`
  - `--pf-accent-2 → var(--pf-info)`
  - `--pf-accent-3 → var(--pf-agent)`
  - `--pf-warn → var(--pf-attention)`
- `--pf-surface-2` exists today as #222733 and is redefined to the new scale step. `theme.cascade.test.ts` must be updated in the lead pre-pass.
- `theme.css` is retired in stages: each worker deletes the rules for the surfaces they rebuild.

### 3.2 Tokens (exact)

```css
/* apps/web/src/ds/tokens.css. Dark is the default regardless of OS; light is an explicit setting. */
:root, :root[data-theme="dark"] {
  color-scheme: dark;
  /* surfaces: lightness steps, one shadow per elevation, no glass over video */
  --pf-canvas:#08090B; --pf-surface-1:#111216; --pf-surface-2:#181A1F; --pf-surface-3:#1F2228; --pf-surface-4:#282B32;
  --pf-stage:#0B0B0C;                       /* hue-free viewer surround, both themes */
  --pf-line:rgba(255,255,255,.075); --pf-line-strong:rgba(255,255,255,.13); --pf-line-strong-solid:#2A2D34;
  --pf-line-control:#666D7A;                /* input/checkbox edges: 3.34:1 on surface-2 */
  /* text */
  --pf-text:#EDEFF3; --pf-text-2:#AEB4BF; --pf-text-3:#959CA8; --pf-text-disabled:#5C626D;
  /* FRAME light = space: selection, focus, playhead, primary action */
  --pf-frame:#45E6D0; --pf-frame-strong:#86F3E3; --pf-frame-ink:#04211D; --pf-frame-soft:rgba(69,230,208,.14); --pf-frame-glow:rgba(69,230,208,.42);
  /* PULSE light = time: beats, bars, sections, beat-locked items, "now" */
  --pf-pulse:#FFC54D; --pf-pulse-hot:#FF9A3D; --pf-pulse-ink:#2A1A00; --pf-pulse-soft:rgba(255,197,77,.13); --pf-pulse-glow:rgba(255,184,64,.5);
  /* the connected agent only */
  --pf-agent:#C3A6FF; --pf-agent-soft:rgba(195,166,255,.14);
  /* status (neutral tones for "needs setup"/"unavailable"; red only for real errors) */
  --pf-ok:#62DB98; --pf-attention:#FF9F5A; --pf-info:#73C9FF; --pf-neutral:#AEB4BF;
  --pf-danger:#FF6B81; --pf-danger-soft:rgba(255,107,129,.12); --pf-danger-fill:#B83039; --pf-on-danger:#FFFFFF;
  --pf-focus:#86F3E3;                       /* 2px ring, 2px offset; 14.2:1 on surface-1 */
  /* clip kinds: stripe + icon + lane; body = color-mix(in oklab, kind 20%, var(--pf-surface-2)); labels sit on --pf-plate */
  --pf-k-video:#8EA3BF; --pf-k-overlay:#7FA8FF; --pf-k-text:#FF8FD0; --pf-k-caption:#FFC2E0;
  --pf-k-voice:#6EDC9A; --pf-k-music:#FFC54D; --pf-k-sfx:#67C7FF; --pf-k-adjust:#D8DCE3;
  --pf-plate:rgba(0,0,0,.62);
  --pf-v1-tint:#16302C;                     /* main-track lane tint */
  /* mode tints, equal OKLCH lightness ~0.84; used only on the active pill underline/icon and the playhead cap */
  --pf-m-edit:#45E6D0; --pf-m-look:#FFA88A; --pf-m-sound:#7EE08A; --pf-m-captions:#C9A8FF; --pf-m-deliver:#73C9FF;
  /* elevation */
  --pf-e1:0 0 0 1px var(--pf-line),0 10px 30px -18px rgba(0,0,0,.8);
  --pf-e2:0 0 0 1px var(--pf-line-strong),0 14px 36px -10px rgba(0,0,0,.7);
  --pf-e3:0 0 0 1px var(--pf-line-strong),0 40px 90px -20px rgba(0,0,0,.85);
  --pf-hilite:inset 0 1px 0 rgba(255,255,255,.045);
  --pf-glow-frame:0 0 0 1.5px var(--pf-frame),0 0 22px -4px var(--pf-frame-glow);
  --pf-glow-pulse:0 0 14px var(--pf-pulse-glow);
  --pf-scrim:rgba(4,5,7,.62);
}
:root[data-theme="light"] {
  color-scheme: light;
  --pf-canvas:#E4E7EC; --pf-surface-1:#F6F7F9; --pf-surface-2:#FFFFFF; --pf-surface-3:#FFFFFF; --pf-surface-4:#ECEEF2;
  --pf-stage:#1C1D1F;                       /* the viewer stays dark; .pf-force-dark re-applies dark tokens inside the stage */
  --pf-line:rgba(16,22,34,.09); --pf-line-strong:rgba(16,22,34,.16); --pf-line-strong-solid:#D3D8DF; --pf-line-control:#878E9B;
  --pf-text:#12151A; --pf-text-2:#4A5260; --pf-text-3:#5F6775; --pf-text-disabled:#9AA1AB;
  --pf-frame:#06705F; --pf-frame-strong:#055C4F; --pf-frame-ink:#FFFFFF; --pf-frame-soft:rgba(10,133,116,.11); --pf-frame-glow:rgba(10,133,116,.30);
  --pf-pulse:#8C5300; --pf-pulse-hot:#9E4708; --pf-pulse-ink:#FFFFFF; --pf-pulse-soft:rgba(214,140,0,.13); --pf-pulse-glow:rgba(214,140,0,.35);
  --pf-agent:#6B45C8; --pf-agent-soft:rgba(107,69,200,.10);
  --pf-ok:#126A3E; --pf-attention:#9A420A; --pf-info:#1867A8; --pf-neutral:#4A5260;
  --pf-danger:#C42343; --pf-danger-soft:rgba(196,35,67,.09); --pf-danger-fill:#B83039; --pf-on-danger:#FFFFFF;
  --pf-focus:#055C4F;
  --pf-k-video:#5B6B82; --pf-k-overlay:#3256B0; --pf-k-text:#A42C70; --pf-k-caption:#8A2F62;
  --pf-k-voice:#16693B; --pf-k-music:#8C5300; --pf-k-sfx:#145F8F; --pf-k-adjust:#6B7280;
  --pf-v1-tint:#DDF1EC;
  --pf-m-edit:#06705F; --pf-m-look:#A0441F; --pf-m-sound:#246A2E; --pf-m-captions:#7346C4; --pf-m-deliver:#1867A8;
  --pf-e1:0 0 0 1px var(--pf-line),0 1px 2px rgba(16,22,34,.06);
  --pf-e2:0 0 0 1px var(--pf-line-strong),0 10px 28px -10px rgba(16,22,34,.22);
  --pf-e3:0 0 0 1px var(--pf-line-strong),0 30px 70px -20px rgba(16,22,34,.35);
  --pf-hilite:inset 0 1px 0 rgba(255,255,255,.7);
  --pf-scrim:rgba(20,24,32,.38);
}
:root {
  /* type */
  --pf-font:'IBM Plex Sans Hebrew','Heebo',system-ui,sans-serif;
  --pf-font-display:'Karantina','IBM Plex Sans Hebrew',sans-serif;   /* only at >= 28px */
  --pf-font-mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace; /* timecode, digits */
  --pf-fs-digits:12px; --pf-lh-digits:16px;   /* mono digits / Latin badges / key caps only */
  --pf-fs-xs:13px; --pf-lh-xs:18px;           /* Hebrew minimum */
  --pf-fs-sm:14px; --pf-lh-sm:20px;           /* body, controls */
  --pf-fs-md:16px; --pf-lh-md:24px;           /* object name, sheet body */
  --pf-fs-lg:20px; --pf-lh-lg:28px;           /* panel titles, 600 */
  --pf-fs-xl:28px; --pf-lh-xl:36px;           /* dialog titles */
  --pf-fs-2xl:40px; --pf-lh-2xl:44px;         /* start-hub hero */
  --pf-fs-3xl:64px; --pf-lh-3xl:64px;         /* Karantina: export %, hero word */
  --pf-fs-timecode:17px;                      /* mono 500, tabular */
  --pf-fw-regular:400; --pf-fw-medium:500; --pf-fw-semibold:600; --pf-fw-bold:700;
  /* spacing, 4px base */
  --pf-sp-1:2px; --pf-sp-2:4px; --pf-sp-3:6px; --pf-sp-4:8px; --pf-sp-5:12px; --pf-sp-6:16px; --pf-sp-7:20px; --pf-sp-8:24px; --pf-sp-9:32px; --pf-sp-10:40px; --pf-sp-11:56px;
  /* radii */
  --pf-r-xs:4px; --pf-r-sm:6px; --pf-r-clip:7px; --pf-r-md:10px; --pf-r-lg:14px; --pf-r-xl:20px; --pf-r-pill:999px;
  /* control heights */
  --pf-h-xs:24px; --pf-h-sm:28px; --pf-h-md:32px; --pf-h-lg:40px; --pf-hit-touch:44px;
  /* motion */
  --pf-dur-press:80ms; --pf-dur-fast:140ms; --pf-dur-base:200ms; --pf-dur-slow:320ms;
  --pf-bpm:120; --pf-dur-beat:calc(60000ms / var(--pf-bpm));   /* set from measured BPM; never from a guess */
  --pf-ease-out:cubic-bezier(.2,.8,.2,1); --pf-ease-in-out:cubic-bezier(.65,0,.35,1);
  --pf-ease-snap:cubic-bezier(.34,1.56,.64,1); --pf-ease-pulse:cubic-bezier(.1,.75,.25,1);
  /* layout (1440x900 reference) */
  --pf-topbar:52px; --pf-statusbar:24px; --pf-rail:72px; --pf-browser:300px; --pf-inspector:332px; --pf-gutter:8px;
  --pf-splitter:8px; --pf-tl-h:clamp(248px,38dvh,560px); --pf-track-head:156px;
  --pf-lane-pulse:22px; --pf-lane-ruler:24px; --pf-lane-flash:4px; --pf-lane-t:30px; --pf-lane-c:28px; --pf-lane-v2:30px;
  --pf-lane-v1:64px; --pf-lane-a1:40px; --pf-lane-a2:40px; --pf-lane-a3:26px;
}
@media (min-width:1800px){:root{--pf-browser:348px;--pf-inspector:372px;--pf-lane-v1:86px;--pf-lane-a1:52px;--pf-lane-a2:52px}}
@media (min-width:2300px){:root{--pf-topbar:60px;--pf-rail:84px;--pf-browser:440px;--pf-inspector:430px;--pf-lane-v1:118px;--pf-lane-a1:72px;--pf-lane-a2:72px;--pf-lane-a3:36px}}
@media (max-width:1366px){:root{--pf-browser:268px;--pf-inspector:304px;--pf-track-head:128px}}
@media (max-height:780px){:root{--pf-topbar:48px;--pf-lane-t:24px;--pf-lane-c:24px;--pf-lane-v2:26px;--pf-lane-v1:50px;--pf-lane-a1:34px;--pf-lane-a2:34px;--pf-lane-a3:22px}}
@media (prefers-reduced-motion:reduce){:root{--pf-dur-press:1ms;--pf-dur-fast:1ms;--pf-dur-base:120ms;--pf-dur-slow:120ms;--pf-ease-snap:linear}}
@media (forced-colors:active){/* rings become Highlight outlines; kind stripes keep icons; no information by colour alone */}
.num,.tc{font-family:var(--pf-font-mono);font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}
:lang(he){letter-spacing:0;text-transform:none}
:lang(en){font-size:.97em}
```

**Contrast**, computed for this file with WCAG relative luminance (dark values on canvas / s1 / s2 / s3 / s4):

| Token | canvas | s1 | s2 | s3 | s4 |
|---|---|---|---|---|---|
| text | 17.3 | 16.3 | 15.1 | 13.8 | 12.3 |
| text-2 | 9.6 | 9.0 | 8.4 | 7.7 | 6.8 |
| text-3 (new) | 7.2 | 6.8 | 6.3 | 5.8 | 5.1 |
| frame | 12.8 | 12.0 | 11.2 | 10.2 | 9.1 |
| pulse | 12.7 | 11.9 | 11.1 | 10.1 | 9.0 |
| agent | 9.7 | 9.1 | 8.5 | 7.8 | 6.9 |
| danger | 7.3 | 6.8 | 6.4 | 5.8 | 5.2 |
| caption | 13.3 | 12.5 | 11.6 | 10.7 | 9.5 |

Other dark pairs:
- frame-ink on frame: 10.9.
- pulse-ink on pulse: 10.7.
- white on danger-fill: 6.0.
- Mode tints on s2: 8.7–11.2.

Light pairs:
- text-3: 4.6 on canvas, 5.3 on s1.
- frame: 4.85 on canvas.
- pulse: 5.05 on canvas.
- agent: 5.1 on canvas.
- danger: 4.6 on canvas.
- caption: 6.4 on canvas.
- white on frame: 6.0.
- focus: 6.4 on canvas.

Kind colours in light theme are stripes and fills only, never body text.

### 3.3 Typography and fonts (offline, licensed)
- **UI:** IBM Plex Sans Hebrew 400/500/600/700 (Hebrew and Latin subsets).
- **Timecode and numbers:** IBM Plex Mono 400/500.
- **Display (≥28 px only):** Karantina 400/700.
- **Packages:** `@fontsource/ibm-plex-sans-hebrew@5.3.0`, `@fontsource/ibm-plex-mono@5.3.0` and `@fontsource/karantina@5.3.0`, all **OFL-1.1** (checked on the registry). Pin them exactly, as the existing `@fontsource/*@5.3.0` are pinned. Vite bundles the woff2 files into `dist`, so the app needs no network. Ship the OFL text in the third-party notices.
- **Import them from a new `apps/web/src/ds/uiFonts.ts`, NOT from `fonts.ts`.** `fonts.ts` must list exactly the FONT_CATALOG files and is checked at start-up. UI fonts are not canvas fonts, and the canvas/export fonts (Heebo, Rubik, Assistant, Frank Ruhl Libre, Secular One) stay untouched and deterministic.
- **Fallback:** Heebo is already bundled, so a font failure degrades gracefully. Preload only Hebrew 400/600 of Plex Sans.

**Rules:**
- No Hebrew below 13 px; 12 px is only for mono digits, Latin badges and key caps.
- No letter-spacing, uppercase or synthetic italic on Hebrew.
- Panel titles 20/600; section heads 14/600; body 14/400; dense labels 13/500.
- Every number+unit is one `.num` token ("0.5 ש׳", "−9 dB", "1080×1920", "120 BPM"). Hebrew units come from whole-sentence i18n templates.
- File names are shown without the extension, with a mono format badge (MP4, M4A) beside them.

### 3.4 Iconography
- **lucide-react@1.73.0** (ISC), already pinned. Use stroke width 1.75 at 18/20 px and 1.5 at 24 px, `aria-hidden` when decorative.
- PULSEFRAME glyphs in `apps/web/src/editor/icons.tsx` on the same 24 grid: pulse-line logo, beat-lock (padlock with a tick), main-magnet, cut-plus, on-beat diamond, flash-shield, agent-node, format-prism, ripple-delete, keyframe (hollow/half/full/gold).
- Never emoji. Icon-only buttons carry `aria-label` and a tooltip with a key cap.

### 3.5 Components (primitives in `apps/web/src/ds/`)

**Buttons and selection controls**
- **Button**
  - Variants:
    - primary: frame gradient #45E6D0→#86F3E3 over a solid frame colour, so contrast tools read the solid colour; frame-ink text;
    - secondary: surface-3;
    - ghost;
    - pulse: gold;
    - danger-quiet: neutral at rest, rose on hover;
    - danger fill: confirm dialogs only.
  - Sizes 28/32/40, plus icon buttons at 32/28.
  - States: default, hover, pressed, focus (2 px ring at 2 px offset), disabled (neutral grey with a reason tooltip, "בחרו קליפ קודם"), and busy (inline ring, keeps focus).
- **Seg** (segmented: sm/md/block, radio or pressed semantics), including the **ModeBar** with tinted icons.
- **Chip** (filter/toggle with a mono count), **Badge** (frame/pulse/agent/ok/attention/hollow), **Switch** (frame or pulse; mirrors in RTL), **Kbd** (both glyphs: S ד, J ח, K ל, L ך), **Tooltip** (140 ms, key caps, reason when disabled).

**Fields**
- **ScrubField**: LTR mono value plus unit. Drag sideways, click to type, arrows ±1, Shift ±10, Alt-click resets. An accent dot after the label marks a modified value.
- **Slider**: spatial and time sliders are `dir=ltr` and bipolar with a centre tick. Magnitude sliders (opacity, volume, intensity) fill from the reading direction. Beat-linked sliders show gold notches at beat lengths.
- **PropertyRow**: grid `76px | 1fr | 62px | 22px` (label | control | value | keyframe), min 30 px (24 at compact height). The keyframe states are hollow, half, full teal at the playhead, and gold on a beat.
- **Section**: collapsible; a closed section shows a value summary ("· 100% · רגיל"), with reset and a "?" help popover.

**Panels and inspector parts**
- **Tabs**: icon plus label, accent underline, count bubble, roving tabindex, `role=tablist`. Labels collapse to icons at ≤1366 px and keep `aria-label`.
- **Panel/Slab**: radius 14, `--pf-hilite`, e1. **DrawerBody** with a bottom fade mask.

**Feedback and overlays**
- **Toast** (undo with a timer bar, receipt, fix). **AnchoredError** (plain Hebrew, a fix button, dismissed by the next good commit). **ProgressBar / Ring / JobRow**.
- **Sheet/Dialog**: modal, focus-trapped, Esc, returns focus. **Menu** (shortcuts on the end side, destructive last and separated). **Popover**.

**Tiles**
- **Tile** for the gallery, text styles, media and AI. States: idle, hover-playing (progress line, star appears), applied (frame ring + check), favourite, beat ("פעימה" gold glyph), fits / "יקצר 0.2 ש׳", held-for-safety (still frame + shield, "תצוגה מוחזקת לבטיחות"), loading (blurred poster shimmer, never black, static under reduced motion), unavailable (dashed, reason).
- Every tile image comes from the shared evaluate+compositor path (ADR-0005). There are no CSS fakes.

---

## 4. Screens and panels

### 4.1 Shell (all widths ≥1101)

`position:fixed; inset:0`, a 100dvh grid, `min-height:0` on every pane; the document never scrolls.

```
areas: "top  top     top   top"
       "rail browser stage inspector"
       "rail split   split split"
       "rail tl      tl    tl"
       "rail status  status status"
rows:  var(--pf-topbar) minmax(0,1fr) var(--pf-splitter) var(--pf-tl-h) var(--pf-statusbar)
cols:  var(--pf-rail) var(--pf-browser) minmax(0,1fr) var(--pf-inspector)
```

- **RTL:** rail on the right, browser next to it, stage in the centre, inspector on the left. In English everything mirrors.
- **Splitter:** a 4×32 grip, drag or arrow keys, `role=separator` with `aria-valuenow`. The height is remembered per viewer in localStorage, wrapped in try/catch.
- **Responsive widths:**
  - At ≤1100 px the tablet layout applies (§4.13).
  - A gallery/catalogue "spread" widens the browser to `minmax(560px,1fr)` and collapses the inspector to a 48 px tab strip.
  - The AI page sets the browser to 560 and the inspector to the 380 px Copilot.

### 4.2 Top bar (one row, fixed slots, never wraps)

From the start edge:

**Identity and mode**
1. Logo (pulse line).
2. Project-name button with a chevron (`data-testid=projects-open`). It also shows `project-name`.
3. Save line: "נשמר ✓" plus the format and duration as `.num`. The old revision counter becomes this indicator and keeps `data-testid=revision`.
4. **ModeBar**: עריכה · מראה · סאונד · כתוביות · מסירה (`workspace-switch`, kept as a radiogroup), with tinted icons. At ≤1366 the labels collapse to icons.

**Command bar** (centre, flexible, min 220 px, max 520 px)
- Placeholder: "מה עושים? פקודה, אפקט, מעבר — או בקשה לעוזר", plus Ctrl K.
- A 1 px edge gradient from frame to pulse.
- Opening it renders the palette dialog anchored under it (`palette-dialog`, `palette-input`, `palette-option`).

**End-side actions**
1. Presence: the owner avatar, plus an agent avatar with a violet ring and a status dot (replaces "Pause agent"). Its menu holds "השהיית העוזר" and "ביטול כל השינויים שלו".
2. Undo and redo (`undo`). The tooltip names the op ("ביטול: מחיקת קליפ").
3. Language (`lang-toggle`).
4. Primary **ייצוא** (`export`).

Export progress is never shown inline. While a background export runs, a 28 px ring chip ("64%") appears left of Export, and clicking it reopens the sheet.

**States**
- Offline: the save line says "לא מחובר · השינויים ממתינים", shown in neutral.
- Save failed: an anchored error under the save line with "ניסיון חוזר".

### 4.3 Rail (72 px, full height, start edge)

- Categories, each an icon over a 13 px label:
  - **Assets:** מדיה, אודיו, טקסט, כתוביות.
  - **Catalogue:** אפקטים, מעברים, מראה, אלמנטים, תבניות.
  - **Tools:** כלי AI (a violet dot while a job runs).
  - **Pinned at the bottom:** קיצורים, הגדרות.
- The active item gets a raised slab and a 3 px frame bar on its outer edge. Alt+1…0 select categories.
- `gallery-open` moves to the אפקטים rail button (alias kept). `role=tablist` with `aria-orientation=vertical`.

### 4.4 Browser drawer (300 px; content follows the rail)

- **Header:** a 20/600 title with a mono count, one primary action (ייבוא / טקסט חדש / יצירת כתוביות), search, and filter chips with counts that fade at the overflow edge.
- **Media:**
  - 2 columns of 16:9 cards (3 at ≥2300).
  - Each card: thumbnail, mono duration badge, format badge, used ✓, and the name without extension.
  - Analysis glyphs: faces, language, BPM, shots.
  - On hover: scrub, a `+` (append to V1; keeps the `add-` testids) and a ⋯ menu (view/notes/delete; keeps the `view-` testid). There is no trash icon on the card.
  - An analysing card shows a progress ring.
  - **Empty:** a dashed drop zone, "גררו לכאן סרטונים, תמונות ושירים או הדביקו מהלוח", with `file-input` behind the button.
  - **Missing file:** red hatch, "הקובץ לא נמצא · איתור מחדש".
- **Audio:** music and sound effects (`sfx-row`, `sfx-play`, `sfx-search` kept), with BPM and a beat comb per row and a preview play button.
- **Text:** 40 style tiles rendered with the selected title's words (or "סוף שבוע" by default) over the darkened current frame, with the current style checked. Tabs: סגנונות 40, אנימציות 16, כותרות מוכנות.
- **Captions:** 40 looks rendered on the real cue text (`caption-look` testid on the tile group).
- **Effects / Transitions / Looks:**
  - Opening one switches to the **spread**.
  - Header: a "התצוגה המקדימה בחיתוך: A ← B 0:08" chip.
  - Sections: "מתאימים לחיתוך הזה (לפי החומר העודף והקצב)", then "השתמשת לאחרונה", then "כל המעברים 69".
  - Filters: הכול 69, מועדפים, בסיסי, ניגוב, החלקה, מצלמה, טשטוש, עיוות, גליץ׳, אור, מסכה, נייר, מושן גרפיקה, "נעילה לפעימה" (pulse chip).
  - Footer: "להחיל על כל N החיתוכים" plus "ערבוב".
  - The effects budget gauge reads "הבזקים בשנייה 2/3".
- **Elements, Templates:** tile grids; template tiles show the skeleton of their slots.
- **AI:** see §4.11.
- **States:**
  - Loading: skeleton tiles from the frozen frame.
  - Catalogue unavailable: a dashed card with the reason.
  - Search with no results: "לא מצאנו 'X' · נסו 'זום' או 'רך'", with a link to ask the agent.

### 4.5 Stage (flexible, #0B0B0C surround, `.pf-force-dark` in light theme)

**Header row**
- עריכה/מקור (Program/Source; `source-viewer`).
- **Format prism:** mini live previews 16:9 · 9:16 · 1:1, a gold dot on a diverged variant, and `+` (`format-switch` on the group, `format-badge` on the active chip).
- Safe-area toggle, fit, preview quality.
- At ≤820 px of stage width the header keeps the prism chips only.

**Viewer**
- A container-query frame: `width:min(100cqw, 100cqh*AR)`.
- `canvas[data-testid=preview]` is kept as-is, with CanvasHandles (8 handles plus a rotation knob for text and transform).
- Safe area: dashed lines, plus hatched platform-UI zones in 9:16.
- Previews are labelled "ריחוף · לב נפתח · לא נשמר" (frame pill, top centre).

**Transport** (LTR-isolated), 52 px:
- Timecode now / total (`timecode`, 17 px mono).
- Step, play (`play`, 44 px round, frame), step, loop (`loop`).
- The beat chip "4.1 · פזמון" (bar.beat, gold dot) shows only when beats are analysed.
- Volume, fullscreen.
- Below 820 px the total and the outer buttons drop; below 520 px only play remains.

**Modes inside the stage**
- **Cut loupe:** while rolling a cut, or with a cut selected and L held, the viewer shows a two-up: the outgoing last frame and the incoming first frame with timecodes, handle meters, and "גלגול +3 פריימים · נצמד לפעימה 17".
- **Compare wipe** (AI before/after): a physical divider that is never mirrored (`ai-compare-slider`).
- **Preview notices** (`effect-unavailable`, `decode-budget-notice`, `audio-fx-unavailable` kept): a bottom-start card in plain Hebrew, never over the centre of the image.

**Empty state:** the Welcome overlay is replaced by the start hub; inside a project with no clips the stage says "גררו לכאן את הקליפ הראשון · או לחצו E".

### 4.6 Inspector (332 px; selection-driven)

**Header:** thumbnail, name (16/600, `dir=auto`), and meta ("וידאו · 4.0 ש׳ · רצועה ראשית"), plus a ⋯ menu.

**Tab sets per object** (one category per screen; help behind "?"):

| Selection | Tabs |
|---|---|
| Video/image clip | בסיסי · תנועה · מהירות · צבע · אפקטים (count) · מסכה · אודיו |
| Cut (edit point) | חיתוך: roll ±frame, snap to beat, handle meter per side, six favourite transitions drawn from this cut, J/L audio offset |
| Transition | מעבר: frozen preview on the cut, length (beat notches), "נעילה לפעימה" with "הפעימה בפריים 421 (0:14.03)", velocity ליניארי/האצה/האטה/רך, replace, remove, missing-handles fix card |
| Title | טקסט · סגנון · אנימציה · מיקום · אפקטים |
| Caption cue / track | כתובית · מראה · תזמון |
| Music clip | אודיו · קצב (measured BPM, beats/bars, "ניתוח חלקי השיר") · אפקטים |
| Voice clip | אודיו · ניקוי קול · תמלול |
| Adjustment layer | אפקטים · צבע · טווח |
| Multi-select | the shared tabs only, plus a footer "החלה גם על N קליפים" |
| Nothing selected | פרויקט: format, fps, duration, loudness target, flash check |

**Content rules**
- Every tab has an "על הפעימה" row in the pulse style (for example "זום בכל פעימה · עומק 8% · כל 2 פעימות") when beats exist; it is hidden otherwise.
- **Basic:** size, position X/Y, rotation, opacity; frame fill as 4 icon buttons (התאמה, מילוי, על הדמות, היפוך); blend; a keyframe curve drawer.
- **Speed:** 0.25× to 4× chips; curve tiles גיבור/קליע/מונטאז׳/קפיצות/כניסה מהירה/יציאה מהירה on a beat grid; a "האטה על הפעימה" toggle; keep-pitch, reverse, freeze; "הילוך איטי חלק" with an AI status pill. Test ids `clip-speed` and `beat-fieldset` are kept.
- **Colour:** the 40-look grid on the user's frame, intensity, the manual block (exposure, temperature, tint, saturation), and colour match "להתאים לקליפ אחר".
- **Effects:** a reorderable stack (handle, eye, beat tag, chevron, ⋯), "+ אפקט מהספרייה" (`effect-add`), "שכבת התאמה" (`effect-row`, `effect-param`).
- **Audio:** volume dB, fades, "להנמיך כשמדברים" (auto-duck: switch, depth dB, speed, drawn envelope), voice cleanup "רץ במחשב שלך", loudness to −14 LUFS.
- **Footer:** "החלה גם על N קליפים" and a quiet delete icon.
- **Test ids:** `inspector-tab-clip` stays on בסיסי. The old ids `inspector-tab-{speech,captions,sound,review,deliver,recipes,all}` move with their content: speech and captions to Captions mode; sound to Sound mode; review and deliver to Deliver mode; recipes to the palette and the Templates rail. Each keeps its id on the new tab or panel button that opens that content (see §8).

**States**
- Empty selection: the project tab.
- Clip with missing media: a red hatch header and "איתור מחדש".
- Unavailable feature: a dashed card with the reason and alternatives ("מסך ירוק", "מסכה").
- Loading analysis: a skeleton row with a ring.
- Error: an anchored error under the control that caused it.

### 4.7 Timeline (spans browser to inspector)

**Toolbar** (44 px):
- Start side: tools בחירה V / חיתוך C, "מגנט ראשי" (frame), "הצמדה לפעימות" (pulse; `snap-beats`), קישור, split, marker.
- Centre: the **ride bar** (Creator graft), `role=toolbar`. It starts with the gold "2 תיבות" chip, then פיצול S, מהירות, אנימציה, אפקט, מעבר, קול, החלפה, שכפול and מחיקה (danger-quiet), then ⋯.
  - It is centred on the selection and clamped to the toolbar.
  - At ≤1366 it is icons only. With nothing selected it is empty.
- End side: the זמן/תיבות ruler toggle, zoom slider (`TimelineZoom`), and "כל העריכה" (Shift Z).

**Body** (`direction:ltr`, horizontal scroll inside):
- **Sticky track headers on the left** (156 px):
  - colour bar, kind icon, Hebrew name (13/500), mono id (V1);
  - hover/focus reveals 26 px mute/lock/eye (`track-lock`, `track-target`);
  - the V1 header carries the magnet glyph;
  - the A2 header shows "♩ 120".
- **Rows, top to bottom:**
  - **Pulse Strip (22):** bars (numbered notches), beat ticks whose density follows zoom, the current beat lit under the playhead, and section bands only when analysed. Click = seek to that bar.
  - **Ruler (24):** mono, markers as coloured flags (`ruler`, `user-marker`, `beat-marker`).
  - **Flash lane (4):** amber hatch where the analyser found risk; hover explains.
  - **T1 text, C1 captions (cue text drawn upright, `cue-text`), V2 overlay/adjustment (hatched).**
  - **V1 main:** tallest, `--pf-v1-tint`, magnet.
  - **A1 voice:** waveform plus transcript word chips (`transcript-word`, RTL words placed on LTR time).
  - **A2 music:** waveform, beat comb, duck envelope with draggable points (`volume-line-key`) and the label "−9 dB · הנמכה מתחת לקול".
  - **A3 sound effects.**

**Clips**
- Kind stripe (2 px), a body mixed 20% with the kind colour, a filmstrip from real frames, a label plate at the clip's time-start (`dir=auto`), and badges (effects count, 1.5×, AI ×2, beat).
- Selected: a 2 px frame ring with glow, 10 px grips (`ew-resize`), and keyframe diamonds on the bottom edge.

**Cuts**
- A transition chip centred on the cut, with a hatched duration band; beat-locked chips have a gold ring.
- `+` on hover for cuts with no transition.
- A gold on-beat diamond on cuts that land on a beat.
- Amber chip plus a fix card when handles are missing.

**Playhead:** a 2 px frame line with a timecode cap. Its cap takes the current mode tint.

**States**
- Empty: a drop-zone lane, "גררו לכאן את הקליפ הראשון / לחצו E".
- Beats not analysed: the Pulse Strip shows "ניתוח קצב" in neutral, with no fake grid.
- Very long projects: an overview strip appears above the Pulse Strip at zoom-out.
- Missing media: a red hatch clip.

### 4.8 Status bar (24 px, Studio graft)

- Start side: "1920×1080 · 30 fps", duration, and the job rows ("שיפור חדות 2× · 64%" with a mini ring; click opens the job).
- End side: capability pips ("2 להגדרה", which opens מרכז המצב), the last flash check ("נבדק להבהובים ✓", `flash-pass`), and notifications.
- At ≤780 px of height it collapses into the top bar's ring chip and pips.

### 4.9 Modes (real layouts, Shift+1…5)

- **עריכה:** as above.
- **מראה:**
  - Browser shows the looks grid.
  - Stage shows a larger viewer.
  - Inspector is pinned to the צבע tab.
  - A docked scopes panel (luma waveform, vectorscope with a skin line) sits between the stage and the inspector at ≥1800; below that, scopes are a popover (`Scopes.tsx`).
- **סאונד:**
  - The timeline grows to 52% and the audio lanes get taller.
  - Inspector shows a mixer per track: fader, mute/solo, the LUFS meter, and auto-duck cards.
  - Browser shows the sound library.
  - `volume-level` and `sound-duck-source` are kept; the duck source becomes the automatically detected voice track, overridable in a select.
- **כתוביות:**
  - Browser is the transcript-first panel (`transcript-panel`), with words editable and clicking a word seeking.
  - Inspector shows caption looks and karaoke.
  - The timeline shows C1 and A1 enlarged.
  - The speech engine's state is honest: מוכן / הכנה חד־פעמית with its size / לא זמין and why. `narration-run` lives here.
- **מסירה:**
  - Browser holds formats and variants (the prism, large).
  - Stage previews the selected variant with platform zones.
  - Inspector holds preflight checks (flash, −14 LUFS, title outside the safe area) and recent exports (`deliver-panel`).
  - Review and recipes items move here and to the palette.

### 4.10 Command palette (Ctrl K or a click on the command bar)

- **Scope chips:** הכול · פקודות · מקטלוג (count) · מדיה · עוזר.
- **Results:**
  - Catalogue tiles (from the selected cut or frame) that apply to the selection. Space previews on the viewer, labelled "לא נשמר".
  - Command rows with match highlights, key caps, and a "מתכון" badge for recipes.
  - The last row: "לבקש מהעוזר: …" (Tab), which shows a plan before any change.
- Rescues wrong-layout typing ("דפךןא" → פיצול), understands Hebrew and English synonyms, and shows recents first.
- **Footer:** ↑↓ ניווט · Enter החלה · Space תצוגה על המסך · Esc סגירה.
- **States:** no results ("נסו מילה אחרת · או לשאול את העוזר"); agent not connected (the row is greyed with "העוזר לא מחובר · איך לחבר").

### 4.11 AI hub and Copilot

**AI hub** (browser 560 px):
- Header: "5 מוכנים · 2 דורשים הגדרה · 1 לא זמין · הכול רץ במחשב שלך; הסרטון לא נשלח החוצה".
- Jobs strip: running jobs with ring, ETA (only if measured), and ביטול.
- Tool cards: icon, name, one-line purpose, and a status pill:
  - מוכן במחשב הזה (frame);
  - רץ % (agent violet);
  - הכנה חד־פעמית · 1.4 GB · רק באישורכם (outlined neutral);
  - לא זמין כאן · למה? (dashed).
- `ai-tool` and `ai-open-run` are kept. A run opens AiRunSheet: a one-frame preview with the compare wipe, then commit as a durable job.

**Copilot** (inspector column 380 px):
- Tabs: שיחה · קבלות (count).
- Toggle: הדרכה / ביצוע.
- **Plan card:** checkable steps, "החלת 3 השינויים" as one transaction.
- **Receipts:** what was done, jump chips to time, "החזרה" (per-actor undo), and refusal receipts with a fix.
- **Phase 3 (needs an ADR):** dashed violet proposals on the timeline and a ghost playhead.

**Provenance:** an on-clip pill reads "AI ×2"; its card says what, where it ran, duration, "נבדק לפני שנשמר", "המקור נשמר", and offers compare / חזרה למקור.

### 4.12 Export sheet (1080×720 modal, a real dialog)

**Settings**
- Destination cards (Creator): רילס·טיקטוק·שורטס 1080×1920, יוטיוב, וואטסאפ, שמירה במחשב, מותאם אישית.
- Format checkboxes with live thumbnails (9:16 אנכי, 16:9 מקור, 1:1 ריבוע).
- Resolution 720p/1080p/4K (4K is disabled with its reason, "המקור הוא 1080p"), quality חסכוני/מאוזן/גבוה, frame rate, captions בתוך הסרטון / קובץ נפרד / בלי.
- File name with the extension as a separate mono chip; the folder.
- Preflight rows with one-click fixes (flash check, −14 LUFS, title outside 9:16 → "התאמה לאזור הבטוח").
- A preview column (360 px) with platform zones.
- Facts: length, estimated size (only from a measured bitrate model), estimated time (only from measured history; omitted otherwise).
- Primary: "ייצוא 2 קבצים".

**Progress (Pulse):** Karantina "64%", the stage name, "557 / 870" frames, ETA, a stage list (הכנה ובדיקת קבצים → רינדור פריימים → קידוד שמע → בדיקת הבהובים → שמירה בהורדות), "המשך עריכה ברקע" and "ביטול הייצוא" (`export-cancel`).

**Done:** file cards with play and "הצגה בתיקייה" (`export-download`), "בדיקת הבהובים: עבר" (`flash-pass`), "הקובץ נבדק ✓", and "גם 9:16". No confetti.

**Failed:** plain-Hebrew cause, a fix, and "ניסיון חוזר". The partial file is never presented as done.

### 4.13 Tablet (≤1100 px; 834×1194 portrait)

- **Top bar** (56): back, name, undo/redo, format chip, Export.
- **Stage:** a full-width 16:9 viewer and the transport (40–44 px buttons).
- **Tool strip** (76): the selected-clip chip, then פיצול, מהירות, עוצמה, מעבר, אפקטים, צבע, אנימציה, שכפול, מחיקה, each 44 px or larger.
- **Timeline:** 16 s visible, 56 px id-only headers, an 84 px V1, 18 px trim grips.
- A bottom tab bar replaces the rail.
- Browser and inspector open as bottom sheets (grabber, 560 px, 48 px option buttons). Sheets cover the timeline only, never the preview.

### 4.14 Start hub (no project open)

- Hero "מה יוצרים **היום?**" in Karantina, with the gold word.
- A drop zone with "בחירת קבצים" (`file-input`).
- Format cards אנכי 9:16 / ריבוע 1:1 / רחב 16:9.
- "מתחילים מרגע" picture cards (יום הולדת, חופשה, ריל על הקצב, מדברים למצלמה, יום בפארק), each showing its clip skeleton and labelled "שלד שנבנה מהכללים של העורך, לא מודל AI".
- Recent projects with thumbnail, date, duration and formats (`project-row`), with delete behind ⋯ and a confirm dialog that says what happens to the files (`project-delete-confirm`).
- A sample project card.
- **States:** first run (no recents) gives the sample project the most space; when the server is unreachable, an honest card with "ניסיון חוזר".

### 4.15 Dialogs, toasts and errors

- **Toasts:** start-bottom, max 3. Kinds: undo ("הקליפ נמחק והרווח נסגר · 4 קליפים זזו · ביטול Ctrl Z", with a timer), receipt (agent violet edge), fix ("המעבר לא נוסף · קיצור חצי שנייה ותיקון · מעבר חופף").
- **The ErrorBar is replaced by AnchoredError** next to the control that caused the error. The global banner remains only for connection loss.
- **Confirm dialogs** use the red fill only for irreversible deletion.

### 4.16 RTL rules (all screens)
- **Chrome mirrors.** These stay LTR in every language: the timeline axis, ruler, Pulse Strip, transport, timecodes, scrub fields, spatial sliders (X, Y, rotation, pan), the speed graph, the loupe and the compare wipe.
- **Magnitude sliders** and progress bars fill from the reading direction. Switches mirror.
- **Track headers** sit on the left (the time origin) in both languages.
- **Mixed tokens** are wrapped in `.num`/`.tc`/`<bdi>`. User text uses `dir=auto`. File names truncate with the ellipsis on the end side of their own direction.
- **Clip label plates** sit at the clip's time-start (left), and Hebrew text inside them is `dir=rtl`.

---

## 5. Interactions

- **Selection opens the right properties.** Click a clip, cut, transition chip, cue or title to get its tab set and the ride bar. Selecting a title or cue outside the playhead moves the playhead inside, with a quiet note "הסמן עבר לתוך הכותרת כדי שתראו אותה". That move is a view action, never an op. Esc clears; Tab enters the ride bar and arrows move within it.
- **Hover-then-key.** Del, S, F, T and Ctrl T act on the hovered clip or cut when nothing is selected. Selection still wins.
- **Delete:** Del is a ripple delete on magnetic V1 (one op, one undo, a toast naming how many clips moved). Shift+Del keeps the gap. "סגירת כל הרווחים" is one transaction.
- **Trim:**
  - Grips with ew-resize and a live chip "+0:00.12 · 3 פריימים".
  - Snapping to beats, bars, markers, cuts and the playhead uses `--pf-ease-snap`. A frame tether runs through all lanes with the gold chip "+1 פעימה · תיבה 9". Alt suspends snapping.
  - `,` `.` roll one frame and Shift rolls five. Rolling a cut opens the cut loupe.
- **Drag to apply:**
  - Tile → clip (dashed target and the tip "שחררו כדי להחיל ״דליפת אור״ על ״ילדים רוקדים״").
  - Tile → cut (a glowing drop chip and "שחררו כדי להחיל ״מעבר רך״ על החיתוך 0:08 · 0.5 ש׳ · נעול לפעימה").
  - Media → V1 (ripple ghost).
  - Hover previews on the viewer, labelled "לא נשמר". Nothing commits until drop, click or Enter.
  - Each apply is one registered op through `Store.commit`.
- **Transitions:**
  - `+` on a cut opens the spread filtered to that cut. Dragging a chip's edge changes the length with beat notches.
  - When handles are missing, tiles already say "יקצר 0.2 ש׳". At apply time an anchored card offers "קיצור ב־0.25 ש׳ ותיקון" or "מעבר חופף", using the server's own hint. Nothing is applied silently.
- **Keyboard** (bound to `KeyboardEvent.code`; key caps show both glyphs):

  | Action | Keys |
  |---|---|
  | Play | Space |
  | Shuttle | J/K/L |
  | Frame step | ← → |
  | Split | S |
  | Ripple delete | Del |
  | Marker | M |
  | Beat snap | N |
  | Select / blade tool | V / C |
  | Add effect | F |
  | Add title | T |
  | Add default transition | Ctrl T |
  | Append to V1 | E |
  | Fit timeline | Shift Z |
  | Switch modes | Shift+1…5 |
  | Library categories | Alt+1…0 |
  | Palette | Ctrl K |
  | Undo / redo | Ctrl Z / Ctrl Shift Z |

- **Undo feedback:** every committed op from UI, REST or MCP produces a short toast with ביטול. Agent and AI ops produce receipts with per-actor revert.
- **Import:** the first import into an empty project is auto-appended (one op, undoable, with the toast "הוספנו את הקליפים לציר · ביטול").
- **Motion:**
  - Durations: hover 140 ms, tab 200 ms, sheet 320 ms.
  - Snap uses the snap ease at 120 ms.
  - During playback only the playhead, the current beat tick and the beat chip animate, and the beat tick pulses at `--pf-dur-beat`.
  - Under reduced motion everything becomes fades or static highlights. Under reduced transparency, no blur.

---

## 6. Innovations: ship order

**Wave A (first redesign release; no new ops needed)**
1. The two-light semantic system (Frame = space, Pulse = time, violet = agent) and the new tokens and fonts.
2. Pulse Strip with bars and beats (sections only when analysed), the זמן/תיבות ruler toggle, gold on-beat cut diamonds, and beat-locked chips.
3. Transition chips and `+` on every cut, and drag-to-cut with drop tips.
4. The ride bar, plus selection always opening the right tab set; the 7-tab one-screen inspector.
5. Galleries drawn from the user's own frames via the evaluate path: frozen mid-transition frames, a cache keyed by cut + item + frame, throttled, hover-to-play on the tile and the viewer, held-for-safety previews.
6. Command bar and palette with catalogue tiles, wrong-layout rescue and Space-to-preview.
7. Status bar with jobs and the flash check; honest AI status pills.
8. Export sheet with presets, preflight, progress and the done card.

**Wave B (needs registered ops or transactions, each through Store.commit with i18n wording and refusals)**
1. Ripple delete and the magnetic V1 (a per-project toggle).
2. Auto-place on first import.
3. "להנמיך כשמדברים" as a clip-level switch derived from speech ranges.
4. Auto-trim to create transition handles.
5. Apply to all cuts.
6. Roll with beat snap, and the cut loupe.
7. Format prism live previews.
8. Start-hub moments (from existing recipes, labelled rule-based).

**Wave C (needs an ADR)**
1. Agent proposals drawn on the timeline (propose/dry-run MCP tool).
2. Agent ghost playhead.
3. Section analysis for song parts.
4. Energy overview strip.

---

## 7. Accessibility

- **Contrast:**
  - Every text role is ≥4.5:1 in both themes (table in §3.2); large text ≥3:1; control edges ≥3:1; focus ring ≥3:1 against adjacent colours.
  - Text over video always sits on `--pf-plate`.
  - A rendered-DOM contrast check (like the directions' `contrast-audit.mjs`) joins the a11y audit.
- **Keyboard:**
  - Every action is reachable without a pointer.
  - Roving tabindex in tab lists, the rail, the ride bar and tile grids (arrow keys plus Home/End).
  - Timeline clips are focusable. Arrow keys move between clips on a track, Alt+↑/↓ between tracks, Enter opens properties, and Shift+F10 opens the context menu.
  - Focus is visible everywhere (2 px `--pf-focus` at 2 px offset).
- **Screen reader:**
  - Landmarks: banner (top bar), navigation (rail), main (stage), complementary (browser, inspector), region "ציר זמן".
  - The playhead's position by bar and beat is announced in a polite live region ("תיבה 5, פעימה 3") while stepping, never during playback.
  - Toasts, jobs and preflight results use `role=status`; errors use `role=alert` only when they block.
  - Dialogs (export, palette, confirm, sheets) trap focus and return it.
- **Language and direction:** `<html lang dir>` follows the app language. Mixed tokens are isolated. Hebrew is never italic or tracked.
- **Targets:** controls are ≥24 px on desktop (most 28–32) and ≥44 px on tablet. Track controls are 26 px with tooltips.
- **Not by colour alone:** clip kinds carry icon, lane and name; beat lock carries a padlock glyph; diverged formats carry a dot plus a tooltip; flash risk carries a hatch plus text.
- **Motion and safety:** no chrome motion during playback. `prefers-reduced-motion` and `prefers-reduced-transparency` are honoured. Strobe and flash previews are held.
- **Forced colors:** rings map to Highlight, selection to outlines, and hatches remain visible.
- **The a11y audit must report 0 findings in Hebrew and English** for every new state: the spread, palette, export settings/progress/done, AI hub with run sheet, Copilot, tablet sheets, and the start hub.

---

## 8. Test-id policy

**Rule:** no id is deleted. Each existing id stays on the element that performs the same action in the new design. Where the element no longer exists, the id moves to the control that now opens that content. Proof files are updated only by the lead in the integration pass.

| Today | New home |
|---|---|
| preview, play, timecode, ruler, loop, shuttle, undo, export, lang-toggle, projects-open, project-name, revision, workspace-switch, format-switch, palette-*, cue-text, transcript-word, transcript-panel, track-lock, track-target, user-marker, beat-marker, volume-line-key, volume-level, canvas-handles, source-viewer, source-scrub, sfx-*, element-tile, gallery-tile, effect-row, effect-param, beat-fieldset, clip-speed, ai-tool, ai-open-run, ai-compare-slider, narration-run, grant-token, file-input, project-row, projects-dialog, project-delete-confirm, export-cancel, effect-unavailable, effect-gallery, gallery-panel-* | unchanged, same role |
| gallery-open | rail אפקטים button (and the ride bar's אפקט) |
| effect-add | Effects-tab "+ אפקט מהספרייה" and the gallery's apply action |
| inspector-tab-clip | the בסיסי tab |
| inspector-tab-sound / -captions / -speech / -deliver / -review / -recipes / -all | the ModeBar item or inspector tab that now hosts that content: sound → סאונד mode, captions and speech → כתוביות mode, deliver and review → מסירה mode, recipes → the Templates rail item, all → the palette "כל הכלים" |
| format-badge | the active prism chip |
| export-download, flash-pass | the export done card (flash-pass also in the status bar) |
| deliver-panel | the מסירה mode panel |
| view-*/add-* on media cards | the hover `+` and the ⋯ menu item |
| transition select, text-preset select, caption-look select, sound-duck-source | the tile groups (radiogroups) and the auto-duck card; the proofs' helpers switch from `selectOption` to clicking the tile with `data-value` |

---

## 9. Quick wins (small, low-risk; first PR after the feature wave merges)

1. Fix the header: one non-wrapping row; the format select becomes a short chip; export status leaves the header.
2. Make the shell a fixed 100dvh grid with `min-height:0` panes and a splitter, so the page stops scrolling.
3. Reorder lanes: T1, C1, V2, V1 (tall, tinted), A1, A2, A3.
4. Make track headers sticky on the left with `position:sticky`.
5. Make disabled destructive buttons neutral grey, with a reason tooltip.
6. Remove uppercase and letter-spacing from `.library h2` / `.inspector h2`; set the Hebrew minimum to 13 px.
7. Draw a transition chip and a `+` on every cut (render only, using the existing set-transition op).
8. Show clip edge grips with ew-resize and a live duration chip.
9. Inspector: selection always resets to the object's first tab; closed sections show summaries; help moves behind "?".
10. Wrap number+unit pairs in `.num` and isolate file names.
11. Replace the sticky ErrorBar with an anchored message that dismisses on the next successful commit.
12. Hide developer language: BT.709 notes, the revision counter and "Pause agent" become the presence menu and the "נשמר" indicator.

---

## 10. Implementation plan (after the current feature wave merges)

### 10.0 Preconditions
- All feature worktrees are merged; `pnpm check` is green on main.
- Baseline screenshots at 1440×900 and 1920×1080 of the 12 audit states are stored under `.artifacts/ux/baseline/`.
- The owner has signed off the open questions (§12), especially the UI font change.

### 10.1 Lead pre-pass (single agent, serial; nobody else edits while it runs)
1. **Tokens:**
   - Create `apps/web/src/ds/tokens.css` (§3.2) and import it first in `main.tsx`.
   - Add the legacy aliases to `packages/brand/src/tokens.css`.
   - Update `theme.cascade.test.ts`.
   - Add `scripts/contrast-tokens.mjs` (or a Vitest test) that computes every text/surface pair in both themes and fails below 4.5.
2. **Fonts:**
   - Pin `@fontsource/ibm-plex-sans-hebrew@5.3.0`, `@fontsource/ibm-plex-mono@5.3.0` and `@fontsource/karantina@5.3.0` in `apps/web/package.json`.
   - Create `apps/web/src/ds/uiFonts.ts`. Do not touch `fonts.ts` or FONT_CATALOG.
   - Add the OFL-1.1 notices.
   - Verify with the network blocked: `pnpm build && pnpm start`, then `document.fonts.check('600 14px "IBM Plex Sans Hebrew"', 'שלום')` returns true.
3. **Primitives** in `apps/web/src/ds/`:
   - Files: Button, IconButton, Seg, ModeBar, Chip, Badge, Switch, Kbd, Tooltip, ScrubField, Slider, PropertyRow, Section, Tabs (roving), Tile, Toast + toast queue, AnchoredError, Sheet/Dialog (focus trap), Menu, ProgressBar/Ring/JobRow.
   - Styles in `ds/primitives.css`.
   - Unit tests for keyboard behaviour (Tabs, ScrubField, Seg) and RTL slider direction.
4. **Icons:** extend `editor/icons.tsx` and `icons.css` with the PULSEFRAME glyphs (§3.4) on the lucide grid.
5. **Mechanical split** of `editor/panels.tsx` into `Header.tsx`, `Library.tsx`, `Transport.tsx`, `Inspector.tsx`, `ErrorBar.tsx`, with no behaviour change. Proofs must stay green after the split.
6. **Shell:**
   - `App.tsx` Shell gets the new grid areas, placeholder mounts for `Rail`, `StatusBar` and the splitter, and `ds/shell.css`.
   - The `.app` grid rules move out of `theme.css` and `styles.css`.
7. **CSS ownership:** split shared rules out of `interactions.css` and `styles.css` into per-owner files: `timeline.css` (W2), `stage.css` (W3).
8. **Strings:**
   - Reserve i18n key namespaces in `packages/i18n` (`ui.top.*`, `ui.rail.*`, `ui.tl.*`, `ui.insp.*`, `ui.gal.*`, `ui.ai.*`, `ui.export.*`, `ui.hub.*`) with Hebrew and English placeholders.
   - From here on, workers add strings only in their own `*.strings.ts` files, the pattern already used (`gallery.strings.ts`).
9. **Test-id inventory:** `packages/evals/src/testid-inventory.ts` lists every `data-testid` used by the proofs and asserts that each exists in the built DOM for its scenario. Run it at baseline.
10. **Gate:** `pnpm check` green, the a11y audit at 0 findings, and screenshots at 1440 and 1920 show no visual regression beyond tokens and fonts.

### 10.2 Workers (parallel; non-overlapping files; they never edit `packages/evals/*`, `store.ts`, `packages/core`, `ds/*` or `App.tsx`; ops they need are requested from the lead)

**W1 · Chrome, navigation and start**
- **Files:**
  - `editor/Header.tsx`, `editor/Rail.tsx` (new), `editor/StatusBar.tsx` (new);
  - `editor/Library.tsx`, `editor/MediaLibrary.tsx`, `editor/mediaLibrary.css`, `editor/media.strings.ts`, `editor/mediaThumb.ts`;
  - `editor/ElementsBrowser.tsx`, `editor/elementsBrowser.css`, `editor/SfxBrowser.tsx`, `editor/sfxBrowser.css`, `editor/sfx.strings.ts`;
  - `editor/CommandPalette.tsx`, `editor/command-palette.css`, `editor/palette.search.ts`, `editor/commands.ts`;
  - `editor/Welcome.tsx`, `editor/welcome.css`, `editor/ProjectsDialog.tsx`, `editor/AccessPanel.tsx`, `editor/ActivityDialog.tsx`;
  - `ds/chrome.css` (new).
- **Task:**
  - Top bar (§4.2) with fixed slots, ModeBar, command bar, presence and the Export ring chip.
  - Rail (§4.3).
  - Browser drawer for Media, Audio and Elements (§4.4), with media cards and the drop zone.
  - Status bar (§4.8).
  - Palette (§4.10) with catalogue tiles fed from W4's gallery-pick API (read-only import).
  - Start hub (§4.14).
- **Done when:**
  - At 1280, 1440, 1920 and 2560 the header is one row and `scrollWidth === innerWidth`.
  - Screenshots at 1440 and 1920 match the canvas artboards Main and Start.
  - Palette rescue tests pass (Hebrew/English, wrong layout).
  - The kept test ids from §8 resolve.
  - The a11y audit reports 0 findings in Hebrew and English.
  - Existing proofs (owner-ui, phase11, editor-interactions) are green.

**W2 · Timeline**
- **Files:**
  - `editor/Timeline.tsx`, `editor/TimelineDrag.tsx`, `editor/TimelineMarquee.tsx`, `editor/TimelineZoom.tsx`, `editor/timelineZoom.css`;
  - `editor/VolumeLine.tsx`, `editor/PulseStrip.tsx` (new), `editor/RideBar.tsx` (new), `editor/CutChip.tsx` (new), `editor/timeline.css` (new, from the pre-pass split);
  - `editor/interactions.math.ts`, `editor/placement.ts`;
  - `src/ClipVisuals.tsx`, `src/clip-visuals.css`, `src/clipVisuals.math.ts`, `src/clipVisuals.cache.ts`.
- **Task:** everything in §4.7: lane order, sticky headers, Pulse Strip (bars and beats; sections only from data), flash lane, clip anatomy, grips plus delta chip, beat-magnet tether, cut chips, `+` and on-beat diamonds, the ride bar, drop targets, keyboard navigation of clips, the splitter, and the empty and unanalysed states.
- **Done when:**
  - Screenshots at 1440 and 1920 show V1 fully visible with all 7 lanes.
  - A trim drag shows the chip.
  - A tile dragged onto a cut shows the drop tip.
  - Snap tests (`interactions.math.test.ts`) are extended for beat and bar snapping.
  - editor-interactions-proof, trend-transitions-proof, phase7 and speed-proof are green.
  - The a11y audit reports 0 findings, including clip focus order.
  - No frame-time regression in the soak (the Pulse Strip only redraws on zoom and scroll, and the beat tick is CSS).

**W3 · Stage and inspector**
- **Files:**
  - `editor/Transport.tsx`, `editor/Inspector.tsx`, `editor/Section.tsx`, `editor/sections.css`, `editor/sections.strings.ts`;
  - `editor/LookPanel.tsx`, `editor/SoundPanel.tsx`, `editor/AudioFxBlock.tsx`, `editor/audioFx.css`;
  - `editor/SpeedCurves.tsx`, `editor/speedCurves.css`, `editor/TextAnimationField.tsx`;
  - `editor/CanvasHandles.tsx`, `editor/interactions.css`, `editor/Scopes.tsx`, `editor/SourceViewer.tsx`, `editor/LayoutPicker.tsx`, `editor/layoutPicker.css`;
  - `editor/FormatPrism.tsx` (new), `editor/CutLoupe.tsx` (new), `editor/stage.css` (new);
  - the ColourMatch and Tracking panels mounted inside the inspector, after they merge.
- **Task:**
  - Stage header with the prism, the viewer frame, the transport with the beat chip, the cut loupe and safe zones (§4.5).
  - Inspector tab sets per object, with PropertyRow and ScrubField, the "על הפעימה" row, closed-section summaries and the footer (§4.6).
  - The Look and Sound mode layouts (§4.9).
- **Done when:**
  - Every clip tab fits one screen at 1440×900 with no inner scroll beyond 1 viewport (checked in a screenshot of each of the 7 tabs at 1440 and 1920).
  - Selection always opens the object's first tab.
  - The text-select move-into-title rule works.
  - CanvasHandles stay inside the viewer.
  - Proofs green: gpu, colourmatch, voicefx-ui, speed, pitch, trend-text, trend-light, adjust, overlays.
  - The a11y audit reports 0 findings (sliders have names, values and units; tabs use roving focus).

**W4 · Catalogue, AI, captions and delivery**
- **Files:**
  - `editor/EffectGallery.tsx` (becomes the spread), `editor/effectGallery.css`, `editor/gallery.pick.ts`, `editor/gallery.strings.ts`;
  - `editor/AiTools.tsx`, `editor/aiTools.css`, `editor/aiTools.strings.ts`, `editor/AiRunSheet.tsx`, `editor/AiCompare.tsx`, `editor/Copilot.tsx` (new);
  - `editor/TranscriptPanel.tsx`, `editor/RecipesPanel.tsx`, `editor/PacingPanel.tsx`, `editor/pacingPanel.css`, `editor/AnalysisPanel.tsx`;
  - `editor/DeliverPanel.tsx`, `editor/ExportSheet.tsx` (new), `editor/TextStyles.tsx` (new), `editor/CaptionLooks.tsx` (new).
- **Task:**
  - The spread for transitions, effects, looks, text styles and caption looks (§4.4), with frozen frames from the evaluate path, cache and throttle, the handle-aware "מתאים / יקצר" labels, held-for-safety and apply-to-all.
  - AI hub and Copilot (text plan and receipts only) (§4.11).
  - Captions mode panel, Deliver mode and the Export sheet (§4.12).
- **Done when:**
  - No tile is ever black (a screenshot check after 0 s and after 10 s).
  - Hover preview shows "לא נשמר" and commits nothing (the store revision is unchanged).
  - The export sheet is a real dialog that passes the a11y dialog checks.
  - export-cancel, flash-pass and export-download proofs are green.
  - The proofs pass: ai-ui, ai-frames, templates, trend-transitions, trend-text, browser-export, speech and voice.
  - Screenshots at 1440 and 1920 match the Gallery, AI, Export and Captions artboards.

### 10.3 Lead integration pass
- Apply the test-id migrations listed in §8 to the proofs, in one commit with the UI change.
- Remove dead `theme.css` and `styles.css` rules.
- Run `pnpm check`, all `pnpm proof:*` that do not need ComfyUI, `pnpm audit:a11y` (0 findings), the contrast test, and the testid inventory.
- Capture screenshots at 1280, 1440, 1920, 2560 and 834 into `.artifacts/ux/after/`, with a before/after board for the owner.
- Update `docs/PROGRESS.md`, `docs/CAPABILITIES.md` and `docs/REQUIREMENTS.md` truthfully.

---

## 11. Claude Design canvas brief (12 artboards; format in `design-canvas-format.md`)

**Global rules for the canvas**
- Google Fonts link: IBM Plex Sans Hebrew 400/500/600/700, IBM Plex Mono 400/500, Karantina 400/700.
- Tokens are inlined from §3.2.
- Footage is drawn as inline SVG scenes (lake jump, birthday cake, park picnic, salon dance, sunset); no images.
- One `data-props` tweak per board: `theme` (dark/light). Main also takes a `density` tweak.
- Rows: **Editor** (1–4), **Catalogue and text** (5–7), **Modes and delivery** (8–10), **System and devices** (11–12).

| # | File | Frame | Must show |
|---|---|---|---|
| 1 | `Main.dc.html` | 1440×900, page | Edit mode, the "קפיצה לאגם" clip selected. All of: one-row top bar (logo, name, "נשמר", ModeBar, command bar, presence, undo, Export), rail with מדיה active, media drawer (cards with badges, used ✓, hover `+` on one), stage with prism (9:16 diverged dot), viewer with caption, transport with the beat chip "4.1 · פזמון", inspector בסיסי tab (PropertyRows, keyframe states, "על הפעימה" row, footer "החלה גם על 5 קליפים"), timeline with ride bar ("2 תיבות" chip), Pulse Strip (bars and beats), flash lane hatch, 7 lanes in the right order, cut chips, a `+`, on-beat diamonds, beat-locked gold chip, music duck envelope "−9 dB", word chips on voice, status bar with a job ring and "נבדק להבהובים ✓". |
| 2 | `Editor1920-CutSelected.dc.html` | 1920×1080 | A cut selected. Viewer becomes the two-up cut loupe with timecodes and handle meters. Inspector shows the cut tab (roll ±frame, snap to beat, handle meters, six favourite transitions from this cut). Trim tether with "+1 פעימה · תיבה 9". Undo toast "הקליפ נמחק והרווח נסגר · 4 קליפים זזו". |
| 3 | `Editor1280-Compact.dc.html` | 1280×720 | Compact density. Icon-only ModeBar and ride bar with tooltips, inspector tab icons, status bar collapsed into the top-bar ring chip. Proves no wrap and no scroll. |
| 4 | `Editor-Light.dc.html` | 1440×900 | The same as Main in the light theme, with the stage kept dark and gold turned to dark amber. |
| 5 | `Gallery-Transitions.dc.html` | 1440×900 | The transitions spread: header chip "A ← B 0:08", sections מתאימים לחיתוך הזה / השתמשת לאחרונה / כל המעברים 69, tiles frozen mid-transition from the two clips (heart, star, iris, wipe, light leak, zoom), states: hover-playing, applied "בחיתוך ✓", "יקצר 0.2 ש׳", held-for-safety, loading skeleton, unavailable. Viewer preview labelled "לא נשמר". A tile being dragged onto a cut with its drop tip. Footer "להחיל על כל 4 החיתוכים". |
| 6 | `Text-Tool.dc.html` | 1440×900 | Title selected; playhead moved inside with its note. On-canvas edit with 8 handles, rotation knob, floating text bar. 9:16 viewer with prism previews in the spare width. Style tiles rendered with "סוף שבוע בגליל" in real faces, current one checked. Inspector טקסט tab. |
| 7 | `Inspector-Board.dc.html` | 1920×1080 | Seven panels side by side: בסיסי, מהירות (curve tiles and graph with beat grid), צבע (looks grid), אפקטים (stack), מעבר (beat lock "הפעימה בפריים 421", velocity, missing-handles fix card), אודיו (auto-duck, cleanup, BPM), טקסט. A caption under each saying what it replaces from the audit. |
| 8 | `Mode-Sound.dc.html` | 1440×900 | Sound mode: taller audio lanes, mixer inspector with faders and the LUFS meter, auto-duck card with the envelope, sound library drawer with a beat comb, and the "−14 LUFS · יישור" fix. |
| 9 | `Mode-Captions.dc.html` | 1440×900 | Captions mode: transcript-first panel with an editable word and the current word highlighted, caption looks drawn on the real cue, karaoke option, honest speech-engine state (one variant "הכנה חד־פעמית · 1.4 GB · רק באישורכם"). |
| 10 | `Export-Sheet.dc.html` | 1440×900, three frames stacked or a state tweak | Settings (destination cards, format checkboxes with thumbnails, 4K disabled with its reason, captions mode, file name with mp4 chip, preflight with one-click fixes), Progress (Karantina 64%, "557 / 870", stage list, "המשך עריכה ברקע"), Done (file cards, show in folder, "בדיקת הבהובים: עבר", "גם 9:16"). |
| 11 | `AI-Hub-Copilot.dc.html` | 1440×900 | AI hub with cards in every status (ready, running with ETA, needs setup with size, unavailable with why), jobs strip, Copilot plan card (text only) and receipts tab with "החזרה" and a refusal receipt with a fix, on-clip provenance pill "AI ×2". |
| 12 | `System-and-Devices.dc.html` | 2400×1600 | The design-system sheet (colour tokens in both themes with contrast numbers, type scale in Plex/Karantina/Mono, buttons in 5 states, Seg, chips, badges, switches, key caps, ScrubField states, slider kinds LTR vs mirrored, PropertyRow, tabs, tiles in all states, toasts, anchored error, progress, keyframe diamonds, clip anatomy, cut chip states), plus the tablet 834×1194 (tool strip, touch timeline, bottom sheet for speed) and the start hub at 1440 as framed inserts. |

Notes on the canvas:
- `title1` row headings: "עורך", "קטלוג וטקסט", "מצבים ומסירה", "מערכת ומכשירים".
- A sticky on Main lists the step counts against the audit (§1).

---

## 12. Open questions for the owner
1. UI font: switch the interface from Heebo to IBM Plex Sans Hebrew, with Karantina only for big moments? (Canvas and export fonts are unchanged.)
2. Should ripple delete and the main-track magnet default to on for existing projects, or only for new ones?
3. Is gold (Pulse) for beats and violet only for the agent acceptable, given that music clips are also gold-tinted?
4. Should the export button go straight to the last-used preset (1 click) with the sheet behind a chevron, or always open the sheet (2 clicks; the recommendation)?
5. Song-section labels need a section analysis that does not exist yet. Should it be built in wave C, or should the strip show only bars and beats permanently?
6. Agent proposals drawn on the timeline need an ADR and a new MCP tool. Should that go on the roadmap now?
7. Is light theme a priority, or dark only for the first release (light kept token-complete but less polished)?
