# ADR-0033: «גדלים מול העיניים» — pictures of one person over the years, the face held still

Status: **Accepted (lead, 2026-11-26); built by three workers on the lead's pre-pass, integrated and merged (e87454a).**
`pnpm proof:growing` 22/22 (server half G1–G17, browser half U1–U5) in one run on the integration branch under load; nobody has
watched a growing film, no real photographs, no touch screen, no screen reader. After ADR-0036 the routes read `actsAsOwner`:
the owner's own window, or an agent in open mode; "owner only" below describes guarded mode. The rule that eye marks are never
stored is kept as built (it is re-decided with the people-and-subject track, not here).

## Context
- The owner chooses pictures of one child taken over the years, marks the two eyes on each, and the editor builds a sequence in
  which each picture is turned, sized and moved so that the eyes land on the same two points of the frame: the face stays where
  it is while the child grows. It stands on templates and their regeneration with hand edits (ADR-0016, the family film's run
  record and slots, ADR-0026), on one `evaluate` for preview, still and export (ADR-0005), on the flash rule (ADR-0009) and on
  the life line's capture times.
- Design: `.artifacts/wave8/growing-plan.md`, corrected by `growing-verify.md` (which wins where they differ) and the lead's
  decisions in `.artifacts/wave8/decisions.md`.
- No schema version bump, no new op, no new route, no new MCP tool, no dependency, model or download. The film is the existing
  internal `apply_template` (template id `tpl.growing`), reached through the existing recipe routes and MCP recipe tools.

## Decisions
1. **The eye marks are never stored (verifier C8).** They live in the dialog's React state only (no store field, no browser
   storage, no URL, no message to another window) and travel once, in the body of the owner-only plan/apply/rebuild call. The
   server passes them to the planner and drops them: the run record is rebuilt key by key (`growingRunRecordParams`: the picks,
   their order and the settings, never a coordinate), a planner refusal keeps its fixed sentence and loses its details, and no log
   line, error, event or answer carries them. There is no `eyeMarks` field, no `set_eye_marks`/`remove_eye_marks` op and no new
   privacy axis.
   *Why:* a stored map would be new face-derived data about a child (the schema says "no face data") and would leak through
   surfaces the plan had not covered (whole entity states in the SSE stream to 'full' agents, version diffs, the transaction
   history, backups, archives in modes other than «בלי פרטי משפחה»; C5, C6). And it would protect almost nothing:
   **the clip transforms the feature writes give the eye positions back** (C7). The dialog says so in C7's sentence:
   «מיקום התמונות בסרט נשמר כמו כל עריכה, ואפשר לחשב ממנו היכן היו העיניים. הסימונים עצמם לא נשמרים.» That is said, not hidden.
   *Cost:* marks of pictures not made yet are lost when the dialog closes, so closing asks first («הסימונים של תמונות שעוד לא נוצרו
   יימחקו»). A rebuild works the eyes of an untouched clip back from its transform (`eyesFromTransform` with the run's face size
   and eye line); a picture deleted by hand comes back only when it is marked again («החזרת החלקים שנמחקו»).
   *Checked:* a coordinate planted in every request is absent, after real applies, rebuilds and a restore, from every SQLite table
   (projects, transactions, outbox, entity versions, jobs, named versions), the events, the summary, four archive modes, MCP
   resources, every answer and the server's console (server unit test); and, after a whole sitting in the browser, from
   localStorage, sessionStorage, the URL, the page's console and the owner's project document outside the clips' `transform`
   (proof U5).
2. **Owner's own session only.** Plan, apply, both regenerate routes and the MCP recipe tools answer 403 `owner_required` to
   anything but the owner's own browser session (kind `user` and actor `user:local`), before the body is read; then the edit
   rights. No agent can supply eye points worked out from stills: that would be a face finder by another name. A credential that
   may not see the project gets the same refusal for a known and an unknown run (the rights are checked before the run is looked up).
3. **The freeze-handle rule, one helper.** A held video frame (and a still) never runs out of picture after its end, so a dissolve
   out of it needs no spare source. `spareAfter(prev, asset, rate)` (`packages/core/src/speed.ts`) answers `null` for an image or a
   freeze, and it is the one rule at every site that asks: `transitionSource` and the velocity limit (`ops.ts`), the `replace_media`
   check, `templatePlan.ts handleBefore`, and through those the editor's ride bar and cut chip and preflight's `transition_freeze`.
4. **`add_clip { freeze: true }` instead of a new op (C3).** A held frame is an ordinary media clip with `freeze: true`: a video
   file, a picture track, a duration, never linked sound; `sourceIn` is the picture held (`sourceTimeOfFrame(asset, frame)`). The
   "reads past the end" check is skipped for it. Old logs never carry `freeze` and replay identically.
5. **Click order decides the eyes (C10).** The first point goes to the frame's left target, the second to the right. The swap
   suggestion (`suggestEyeOrder`) swaps only when the line from the first click to the second points left; «החליפו» (S) swaps the
   two points of the picture being marked, and the paused live preview shows that picture, so the result is seen at once.
   Marks are in the coordinates of the picture as shown (EXIF orientation applied; C4).
6. **Holds and the flash gap.** Every hold is a whole number of project frames, at least `flashGapFrames(fps)` (11 at 30 fps: at
   most three changes a second, ADR-0009 decision 3); the default is one second (round(fps) frames). A shorter hold is refused with
   its wording, never raised. Cuts are `start + i·hold` (integer frames, nothing accumulated). Dissolves only spread a change; the
   only flash report is the check after export (no preflight flash warning in this build), and «למה?» says so.
7. **The live preview is the first minute (C13).** From the second marked picture on, the dialog plans on a copy of the document
   (the real `planGrowing` and one internal `apply_template`) and plays it with the same Player, labelled «תצוגה מקדימה — עוד לא
   נוצר»; «צרו» works from two pictures. Nothing is stored before «צרו». Node's and Chromium's plans of the same inputs were compared
   number by number (G17: Node 22.23.4 against HeadlessChrome 153, largest difference 0 in one sample, tolerance 1e-6).
8. **Rebuild keeps places.** Hand edits are kept exactly, a picture only moved in time goes back, a picture deleted by hand stays
   out and is named. On a rebuild every listed picture keeps its slot: one not made again leaves its slot empty, so a clip kept by
   hand after it stays on its slot and nothing lands on it (integration). The run record lists every pick in show order.
9. **Entry.** The card «גדלים מול העיניים» on the start hub of an empty project: it chooses the files, and the dialog opens on them
   once they are in (the family film's precedent). The bar after the film offers undo, rebuild, «החזרת החלקים שנמחקו» and «למה?».
10. **Owner approval (C9).** Nothing new is stored, only transforms the owner could set by hand: one line in the owner review list,
    not blocking.

## Not built in version 1
- Beat mode and music (a fixed hold only).
- The Hebrew-date caption and the people-sheet entry (date and age captions only where the fields have words).
- The blurred backdrop (colour fill, with the «בלי פינות ריקות» face-size suggestion, closed form).
- Automatic eye detection (no model; the points are placed by hand).
- An entry for a project that already holds pictures (the card is on the empty project's hub only).

## Not known
- How it looks: nobody has watched a growing film.
- Real photographs: only synthetic drawn faces were used (magenta eye squares at known places); how precisely a person clicks eyes
  on a real child's photo, HEIC files, and EXIF orientation in PNG/WebP (not verified; the dialog's limits say so) are unknown.
- A touch screen: marking was driven by mouse and keyboard only.
- A screen reader, the Hebrew read by a person, the speed on the owner's laptop.

## After the merge (lead, 2026-11-26)
- The picture-model track's wire `apps/web/src/editor/growing/eyes.client.ts` («הציעו עיניים») lives in the same folder: the
  folder's scan test admits its ONE fetch, to this server's own `/api/v1`, same-origin and no-store; nothing else in the folder may
  reach the network or storage.
- Open: a project that already holds pictures has no way into growing (the card is on the empty project's hub only) — a small
  follow-up; after the dialog opened from the card closes, focus has nowhere to return (the family film card behaves the same);
  in 2 of 6 browser attempts the first Enter on the card opened no file chooser and the second did (unexplained).

