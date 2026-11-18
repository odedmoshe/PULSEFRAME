# ADR-0021: The life line — capture dates, the Hebrew calendar, events, live title fields and people

Status: **Accepted — built and verified (see PROGRESS)** (2026-11-18) for wave 1. Built by three workers on
shared contracts plus an owner-approved people step, each reviewed and repaired, merged.
Dates are checked by measurement and against one published calendar, not by a Hebrew speaker; the wording is
on the owner's review list.

## Context
- A family editor needs "when was this", "which event", and titles that fill themselves with a date or a
  child's age. Assets had no capture time.
- Every picture comes from `evaluate` (ADR-0005); every edit is a registered op (ADR-0004); capture dates are
  wall-clock calendar data, not timeline time, so ADR-0003 is untouched.
- The plan (`.artifacts/life-line-plan.md`) came back from its verifier as "needs changes"; its Verifier and
  Corrected notes win over its body. The lead's wave-5 decisions and the owner's approval of people
  (2026-11-17) apply.

## Decision
1. **Capture time per asset** (`Asset.capture`, optional): a wall-clock string, an offset or null, a source
   (container, exif, filename, manual) and `circa`. It is read from the ORIGINAL file before conform
   (`apps/server/src/captureMeta.ts`): Apple creation date, EXIF DateTimeOriginal with offset, container time
converted once to the home zone, file-name patterns marked approximate.
   A date from a messaging-app file name is `circa` whatever its source. Known limits stated: cameras that
write local time as UTC; Android writing the end of the recording. GPS is not read or stored.
   iPhone HEIC photos stay undated in wave 1 (converted at import). Ops: `set_asset_capture`,
`shift_asset_captures`, internal `attach_asset_capture`; the render path does integer arithmetic and never
calls `Intl` or `Date`.
2. **The Hebrew calendar is our own integer arithmetic** (`hebrewCalendar.ts`; no GPL dependency). Epoch
   constant −1373427 (the plan's −1373428 was one day off everywhere). Zero mismatches against ICU
   over 1900–2100, and published dates checked against one published calendar. Holiday names and the Israeli
schedule table await the owner's review.
3. **Events by time gap** (`cluster_events`, `add_event`, `update_event`, `remove_event`): a new event where
   the gap exceeds a limit (default 240 min); a run over 5000 files is cut into consecutive events. Only what
   a person typed is stored:
   a name is derived at read time (`eventDisplayName`), so a corrected table never makes replay diverge. After
sunset is an explicit per-event switch with a both-days hint; there is no automatic sunset calculation.
   Israeli windows apply only when the clock is provably Israel's; otherwise nothing after 14:00 is certain.
4. **Live fields** in titles (`TextClip.fields`; `{date}`, `{hebrewDate}`, `{year}`, `{hebrewYear}`,
   `{event}`, and for people `{name:…}`, `{age:…}`) are resolved inside `evaluate`, so preview, stills and
   export agree by construction.
   A title anchors to the topmost DATED picture under it; an undated clip never shows another clip's date. A
field without data draws nothing and is a preflight blocker that stops an export of moving picture (stills and
wav exempt).
   «קבע כטקסט רגיל» is a transaction of literal ops built by `freezeOps`, not an op with its own derivation.
The date stamp can take its text from the capture date (`source`, `clock`, `dateOrder`).
5. **People** (owner-approved on stated conditions): names, optional birth dates and a word choice per person,
   inside the project file, local only. An agent without the `people` scope (off by default) receives ids and
   names only;
   every surface it reaches is computed from a document without birth dates and word choices
(`peoplePrivacy.ts`, surface list `peopleSurfaces.ts`: project read, archive, summary, proposals,
browser-export snapshot).
   A film whose titles show an age is refused to it. The archive option «בלי פרטי משפחה» freezes those fields
to plain text and leaves people out. Age wording (`ageWords.ts`) is table-tested and unreviewed.
6. **Schema:** optional fields only; `createProject` writes `events: {}`. Capture and event shapes are checked
   in `validateProject` (`life_capture`, `life_event_shape`).

## Consequences / what is not promised
- Honest limit: a resolved age shown in a title is visible to an agent like to any viewer, so an editing agent
  could infer a birth date from it.
- The calendar's month spellings, holiday table and age forms are unreviewed Hebrew. A second published
  calendar was not read.
- Wave 2: GPS and place names, HEIC dates, a library above projects.

## Verified / not verified
- `pnpm proof:lifeline` 17/17 (one run, after 14/14 earlier; two checks were corrected), `pnpm
  proof:lifeline-ui` 27 checks on its first run (eight faults in the proof rewritten), accessibility 0
  findings over 60 states, unit tests 3056 at that checkpoint (PROGRESS 19b, 19c).
- Not verified: real phone clips and their dates, the clock stamp on real footage, any Hebrew reading by a
  person.
