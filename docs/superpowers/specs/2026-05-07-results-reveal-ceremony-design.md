# Results-reveal ceremony — design

Status: approved (Danis, 2026-05-07)

## Goal

Add an olympiad-style ceremony page per competition. Admin uploads a final
leaderboard CSV (sum across all days, private), then reveals places one by one
from the new "Results" admin page. Public viewers watch the reveal live on
`/competitions/<slug>/results` via SSE.

## Routes

| URL | Auth | Purpose |
| --- | --- | --- |
| `/competitions/<slug>/results` | public | Live ceremony view (SSE-driven) |
| `/admin/competitions/<slug>/results` | admin | Upload CSV, configure, drive reveal |
| `/obs/competitions/<slug>/results` | public | Same view, OBS-friendly (transparent body, no nav) — phase 2, optional |

API:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/competitions/<slug>/results` | public | Current redacted reveal state (only revealed fields) |
| GET | `/api/competitions/<slug>/results/stream` | public | SSE — pushes redacted state on every change |
| GET | `/api/admin/competitions/<slug>/results` | admin | Full reveal state (raw CSV rows, snapshot, settings) |
| PUT | `/api/admin/competitions/<slug>/results/upload` | admin | Multipart `file` (CSV) → parses + stores raw |
| PUT | `/api/admin/competitions/<slug>/results/settings` | admin | `{compareGroupSlug: string}` — only valid before `started` |
| POST | `/api/admin/competitions/<slug>/results/start` | admin | Lock settings, snapshot public-LB places, transition `uploaded → revealing` |
| POST | `/api/admin/competitions/<slug>/results/advance` | admin | One step forward in the state machine; idempotent if same `expectedStepId` (passed by client) |
| POST | `/api/admin/competitions/<slug>/results/reset` | admin | Reset to `idle` (deletes csv, state) |

## Data files

Per competition, under `data/competitions/<slug>/`:

```
results-final.csv          # raw uploaded CSV (atomic write via tmp+rename)
results-reveal.json        # canonical reveal state
```

### CSV format

Required columns (header row, case-insensitive matching):

```
kaggleId,fullName,points,bonus
heriqis777,Иванов Иван Иванович,87.4,5
...
```

- `kaggleId`: lowercased on parse; matched against `groupsResults[<g>].overall[].kaggleId`.
- `fullName`: any string (Russian/Latin); used both for top-8 letter reveal and as the listed name everywhere.
- `points`: float; the "итоговый балл" displayed after summing days.
- `bonus`: float; shown separately as "+N бонус".
- Sort: file may or may not be pre-sorted; on parse we sort by `points + bonus` desc (and persist the sorted form).

Parser is permissive: trims, accepts both `,` and `;` as separator (auto-detect via first line), accepts `nick`/`nickname`/`kaggle_id` as aliases for `kaggleId`, and `score`/`points_total` as aliases for `points`. Empty rows skipped. On any malformed row → 400 with line number.

### `results-reveal.json` schema

```json
{
  "version": 1,
  "phase": "idle | uploaded | revealing | finished",
  "compareGroupSlug": "philippines",
  "rows": [
    {
      "rank": 12,
      "kaggleId": "tristanzz",
      "fullName": "Тристан Зет",
      "points": 71.5,
      "bonus": 0,
      "publicPlaceInGroup": 9
    }
  ],
  "skipPlan": {
    "outsiders": [12, 10],
    "skipped": [11, 9]
  },
  "cursor": {
    "stage": "idle | outsiders | batch_skipped | drum_roll | top8 | finished",
    "outsidersIdx": -1,
    "top8Rank": 9,
    "top8Step": "place | dpublic | bonus | points | name | done"
  },
  "createdAt": "2026-05-07T10:30:00.000Z",
  "startedAt": null,
  "updatedAt": "2026-05-07T10:32:11.000Z",
  "stepId": 0
}
```

- `rows` is the parsed CSV, sorted desc by `points + bonus`. `rank` = 1-based position.
- `publicPlaceInGroup` is computed once at `start` from `groupsResults[compareGroupSlug].overall` (cached per-competition LB) — the place the participant held in that group's public LB before ceremony. `null` if not present.
- `skipPlan` is computed at `start`:
  - `N = rows.length`
  - if `N <= 8`: `outsiders=[]`, `skipped=[]`, ceremony jumps straight to `drum_roll → top8` starting at `min(8, N)`.
  - else: from `N` down to `9`, take every-other (`N, N-2, …`) → `outsiders`; the rest → `skipped`.
- `stepId` increments on every state mutation; client passes `expectedStepId` on advance for idempotency / out-of-order protection.

## State machine

```
idle ──upload──▶ uploaded ──start──▶ revealing(stage=outsiders, outsidersIdx=0)
                                              │  advance × |outsiders|
                                              ▼
                                     revealing(stage=batch_skipped)
                                              │  advance
                                              ▼
                                     revealing(stage=drum_roll)
                                              │  advance
                                              ▼
                                     revealing(stage=top8, top8Rank=min(8,N), top8Step=place)
                                              │  advance × 5 per rank, then ──▶ next rank
                                              ▼
                                     revealing(top8Rank=1, top8Step=done) ──advance──▶ finished
```

Top-8 per-rank step order: `place → dpublic → bonus → points → name → done`. After `done`, advance moves to next lower rank's `place` (or to `finished` after rank=1).

If `N < 8`, top-8 stage starts at `top8Rank = N` and goes down to 1 with the same step sequence.

`reset` from any phase returns to `idle` and removes both files.

## Public redaction

The public endpoint and SSE stream return a **redacted** view derived from canonical state:

- For phases `idle` / `uploaded`: just `{phase}` (no rows leaked). Page shows "Скоро…".
- For `revealing`:
  - `revealedRows` — all rows that have been fully revealed (an outsider after its tick, or a top-8 entry after `done`). Each row exposes `{rank, fullName, points, bonus, publicPlaceInGroup}`.
  - `skippedBatchShown: bool` — once `batch_skipped` past, returns the list of skipped rows (full info).
  - `currentTop8`: when `stage=top8` and `top8Step != done`, returns a partial row for the currently-revealing rank with only the fields disclosed by the cursor. Specifically:
    - `place` step → `{rank}`
    - `dpublic` → `{rank, publicPlaceInGroup, dPlace}`
    - `bonus` → also `{bonus}`
    - `points` → also `{points}`
    - `name` → also `{fullName}` plus a flag `nameAnimating: true` so frontend animates.
  - `drumRoll: bool` — true while `stage=drum_roll`.
- For `finished`: full leaderboard, sorted asc by rank, with the comparison group's title.

Server never sends `kaggleId` to the public side (no need; comparison was server-side). Anonymous viewers should see exactly what's on screen, nothing more.

## SSE protocol

`GET /api/competitions/<slug>/results/stream` returns `text/event-stream`. On connection: emits a `state` event with the current redacted state. On every state change emits another `state` event. Heartbeat `: ping\n\n` every 25s to keep proxies alive. `Last-Event-ID` is honored — if client reconnects with id `>= currentStepId`, server sends only a heartbeat then the next change.

Client uses native `EventSource`. On error, `EventSource` auto-reconnects.

## Backend module layout

New files:

- `backend/src/results.js` — pure logic: CSV parse, state machine reducers (`reduceAdvance`, `reduceStart`), redaction, snapshot-place calculator. No I/O. Fully unit-testable.
- `backend/src/routes/results.js` — Express router; mounted at `/api/competitions/:slug/results` and `/api/admin/competitions/:slug/results`. Owns disk I/O (load/save `results-reveal.json`, save uploaded CSV) and the SSE hub.
- `backend/src/resultsStore.js` — disk persistence + in-memory SSE subscriber registry per slug. `loadState(slug)`, `saveState(slug, state)` (atomic via tmp+rename), `subscribe(slug, fn)`, `publish(slug, state)`.

Wired into `app.js` next to existing admin/public route mounts. The advance path acquires a per-slug async mutex (simple `Promise` chain) to prevent concurrent races between two admin tabs.

## Frontend layout

New files:

- `frontend/src/competition/ResultsRevealPage.jsx` — public page. Subscribes via `useResultsStream(slug)` hook; renders one of: empty, outsiders ledger, drum-roll splash, top-8 stage. Uses CSS for animations (typewriter, pulse, fade).
- `frontend/src/competition/useResultsStream.js` — opens `EventSource`, holds `state` in `useState`, returns `{state, error}`. Closes on unmount.
- `frontend/src/admin/AdminResultsPage.jsx` — full control panel: upload form (file + drag/drop), settings form (compareGroupSlug select populated from `/api/competitions/<slug>/leaderboard` `groupsMeta`), preview of parsed rows, "Start ceremony" button, then the reveal control (large "Next" button, current cursor display, "Reset" button with confirm modal).

Routes added to `App.jsx`:
- `<Route path="/competitions/:slug/results" element={<ResultsRevealPage/>} />`
- `<Route path="/admin/competitions/:slug/results" element={<AdminResultsPage/>} />`

Navigation: in the public competition nav, add a "Результаты" tab (visible always, even before reveal — page just shows "Скоро"). In the admin nav for the competition, add "Results".

### Top-8 name animation

When `currentTop8.fullName` arrives with `nameAnimating=true`, frontend stores the full string and animates it character-by-character (120ms tick) using a local `useEffect` + interval. After all chars shown, calls `/advance` is NOT auto-called — admin still has to click "Next" to lock in `done` and move on. (Admin sees the animation finish before they click; matches "letter-by-letter" preference + admin-controlled pacing.)

### Outsiders ledger

Visible during `outsiders` and `batch_skipped` and beyond. Reverse chronological list (newest at top), card per row showing: `№<rank>`, ФИО, баллы, бонус, ΔPublic vs `compareGroupSlug` (`+5` / `−2` / `—` if unknown). When `batch_skipped` ticks over, all skipped rows fade in at once below a "и ещё" header.

### Drum roll

Full-bleed overlay: text "Кто же пройдёт в сборную?" + 🥁🤔. Pulse animation. Stays until admin clicks Next → transitions to top-8 stage.

### Top-8 cards

One large card on screen for the currently-revealing rank. Skeleton with placeholders that fill in as steps progress. After `done`, card shrinks and joins the outsiders ledger; new placeholder appears for the next rank. At rank 1 + done → confetti CSS animation + the full final standings table fades in below.

## Edge cases

- **Re-upload**: if `phase=uploaded`, admin can re-upload, replaces CSV. If `phase=revealing` or `finished`, upload returns 409.
- **Compare group is empty / not selected**: settings PUT requires `compareGroupSlug` to be a valid slug from `groupsResults`. Empty groups → still allowed (all `publicPlaceInGroup` will be null, ΔPublic shown as "—").
- **Participant in CSV not in group**: `publicPlaceInGroup` = null; ΔPublic = "—".
- **CSV has duplicate kaggleId**: hard error (400) with line numbers.
- **N=0**: upload rejected.
- **N=1..8**: skip outsiders + batch_skipped + skipPlan; go straight from `start` to `drum_roll`.
- **Server restart during ceremony**: on boot, `results.js` does nothing special; state lives on disk. On first SSE connection, current state is replayed. In-flight EventSource connections drop, browsers auto-reconnect.
- **Two admin tabs**: per-slug async mutex serializes advances. `expectedStepId` mismatch → 409 (client refetches).
- **Soft-deleted competition**: results endpoints return 404 like other comp endpoints.

## Out of scope (phase 2 / never)

- OBS overlay route — leave for follow-up if needed; the public page is already iframe-friendly.
- Audio / drum-roll sound (Danis: "только текст").
- Admin undo (Danis: "не нужно").
- Multiple groups per ceremony (only one at a time; admin reuploads to switch).
- Persisting reveal state to SQLite (kept on disk per project pattern).
- I18n — page strings are Russian, matching the rest of the admin UI.

## Testing

- **Unit tests** (`backend/tests/results.test.js`): CSV parser (happy + malformed), `reduceStart` (snapshot calculation, skipPlan generation for N=5/8/9/30), `reduceAdvance` step-by-step transitions, redaction layer (no leaks of unrevealed data).
- **Integration test** (`backend/tests/results.routes.test.js`): full flow upload → settings → start → advance × M → finished, asserting public GET vs admin GET divergence.
- No frontend tests (project has none today; honor the convention).
