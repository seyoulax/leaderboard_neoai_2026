# Results-reveal ceremony — implementation plan

Spec: `docs/superpowers/specs/2026-05-07-results-reveal-ceremony-design.md`

Branch: `worktree-results-reveal` (created via EnterWorktree).

## Phase 1 — Backend pure logic + tests (TDD)

1. **Create `backend/src/results.js`** with pure exports:
   - `parseResultsCsv(text) → {rows, errors}` — sort desc by `points+bonus`.
   - `computeSkipPlan(N) → {outsiders: number[], skipped: number[]}`.
   - `computePublicPlaces(rows, groupOverall) → rows[]` — adds `publicPlaceInGroup`.
   - `reduceStart(state, {compareGroupSlug, groupOverall}) → state`.
   - `reduceAdvance(state) → state` — drives the cursor; throws `{code:'NOOP'}` if at `finished`.
   - `redact(state) → publicState`.
   - `initialState() → state` (`phase: 'idle'`).
2. **Tests `backend/tests/results.test.js`**: cover all of the above. ~25 cases:
   - CSV parsing: header aliases, separator detection, malformed → error with line, duplicate kaggleId, empty rows skipped, BOM stripped.
   - skipPlan for N ∈ {0, 1, 5, 8, 9, 10, 11, 30}.
   - reduceStart with N<=8 (jumps to drum_roll), N>8.
   - reduceAdvance walks the full state machine for N=10 (2 outsiders, 1 skipped batch, drum, 8 top-8 ranks × 5 steps + done × 8) and N=4 (no outsiders, drum, 4 top-8 × 5).
   - redact never exposes unrevealed fields (kaggleId never, fullName/points/bonus only at the right step).
3. **Run tests** → green.

## Phase 2 — Backend persistence + routes + SSE

4. **Create `backend/src/resultsStore.js`**:
   - `loadState(slug)`, `saveState(slug, state)` (atomic tmp+rename per project pattern), `loadCsv(slug)`, `saveCsvText(slug, text)`, `removeAll(slug)`.
   - SSE hub: `subscribe(slug, fn)` (returns unsub), `publish(slug, state)`. `publish` fans out to subscribers; ignores throws.
   - Per-slug async mutex via `mutex.run(slug, fn)`.
5. **Create `backend/src/routes/results.js`** Express router:
   - Public: `GET /api/competitions/:slug/results` → `redact(loadState)`.
   - Public: `GET /api/competitions/:slug/results/stream` → SSE; on subscribe send current redacted state.
   - Admin (gated by existing `requireAdmin` middleware in app.js — find pattern):
     - `PUT .../upload` (multipart — reuse multer/busboy already used in native task uploads; check existing pattern).
     - `PUT .../settings` (`{compareGroupSlug}`).
     - `POST .../start` — pulls `groupsResults[g].overall` from `cache.byCompetition.get(slug)`; rejects 409 if not yet refreshed.
     - `POST .../advance` (`{expectedStepId}`).
     - `POST .../reset`.
6. **Wire into `backend/src/app.js`**: import + mount router; export hook so routes can read `cache.byCompetition`.
7. **Tests `backend/tests/results.routes.test.js`**: full happy-path + redaction sanity + SSE smoke (one subscribe, one advance, expect event).
8. **Run tests** → green.

## Phase 3 — Frontend hook + public page

9. **Add API helpers** to `frontend/src/api.js`: `getResults`, `uploadResults`, `setResultsSettings`, `startResults`, `advanceResults`, `resetResults`. Pass through `import.meta.env.VITE_API_BASE`.
10. **Create `frontend/src/competition/useResultsStream.js`** — `EventSource`-based hook. Cleanup on unmount.
11. **Create `frontend/src/competition/ResultsRevealPage.jsx`** — full UI:
    - phases idle/uploaded → "Скоро" placeholder.
    - revealing → outsiders ledger (reverse-chrono cards) + current top-8 card (when applicable) + drum-roll overlay (when stage=drum_roll).
    - finished → confetti + final table.
12. **Create CSS** (extend `frontend/src/styles.css`): typewriter/pulse/fade animations, large top-8 card layout, ledger card layout.
13. **Add route to `frontend/src/App.jsx`**: `/competitions/:slug/results` and a nav link (find existing nav component).

## Phase 4 — Frontend admin page

14. **Create `frontend/src/admin/AdminResultsPage.jsx`**:
    - State: load `/api/admin/.../results` on mount.
    - Upload form: file input + "Загрузить" button. Shows parsed preview table (rank, kaggleId, fullName, points, bonus).
    - Settings: `<select>` of `groupsMeta` from `/api/competitions/:slug/leaderboard`. "Сохранить" button. Disabled when phase != uploaded.
    - Start: big "Начать церемонию" button, disabled until uploaded + settings set.
    - Reveal: big "Следующий шаг ▶" button + cursor display ("Стадия: outsiders / Раскрыто: 12, 10 / Следующий: 8") + "Reset" with confirm.
15. **Add route + admin nav** in `App.jsx` and the per-competition admin nav.

## Phase 5 — Manual smoke + polish

16. **Run `npm test` in backend** — all green (existing 223 + new ~30).
17. **Manual smoke** with prod-pulled data:
    - `cd backend && npm run dev` + `cd frontend && npm run dev`.
    - As admin: upload a synthetic CSV (10 rows from `participants.json` ids), set `compareGroupSlug=philippines`, start, advance through full ceremony.
    - In second window (anon): watch `/competitions/neoai-2026/results` SSE updates.
    - Verify redaction: open DevTools Network, inspect `state` events — no `kaggleId`, no unrevealed fields.
18. **Update `ROUTES.md`** with the new public/admin/api routes.
19. **Commit** in one focused commit per phase, push branch, leave PR creation to user (per project convention).

## Decisions taken without further asking

- **CSV parser**: write small parser inline (split lines, split by detected sep, trim, skip empty). Avoid pulling new deps. `csv-parse` is already a dep but the format here is trivial.
- **SSE**: native, no library. Client uses `EventSource`.
- **Mutex**: tiny inline implementation (chained promise per slug). No `async-mutex` dep.
- **Naming animation**: 120ms per char, no skip — matches "максимум драмы" intent. Frontend-only; backend just sends fullName + flag.
- **Confetti**: pure CSS (no library) — falling spans with random `transform`. Cheap and dependency-free.
- **Top-8 cards** that already revealed → join outsiders ledger; ledger sort = by rank descending top-of-list (latest reveal at top).
- **Auth** for admin routes follows existing pattern (`x-admin-token` header OR session cookie with `role='admin'`); check current middleware in `app.js` and reuse.
- **CSV file name** is fixed: `results-final.csv`. Reupload overwrites.
- **`startedAt`** is set on first `start`, cleared on `reset`.
- **OBS overlay** route — skip in this PR. The public page should already work in OBS browser source out of the box.
