# SP-4: Participant Dashboard & Native LB Polish — Design

**Status:** Draft
**Date:** 2026-05-05
**Parent project:** «Своя Kaggle» (4 под-проекта; SP-1 + SP-2 + SP-3 в main)
**Roadmap:** `~/.claude/projects/-Users-seyolax-projects-neoai-transa/memory/project_kaggle_platform_roadmap.md`

## Цель и объём

SP-4 закрывает финальный набор фич, которые делают платформу самосогласованной — личный кабинет участника, явный flow участия в соревновании, паритет native-лидерборда с kaggle (зелёные/красные стрелки, OBS-оверлеи) и Kaggle-style «selected submissions» для финального ранжирования. После SP-4 все пункты исходного ТЗ закрыты.

**Что SP-4 даёт пользователю end-to-end:**

- **Личный кабинет** `/me` (только для залогиненного):
  - Профиль с возможностью править email, displayName, kaggleId, менять пароль.
  - Список «Мои соревнования» — куда вступал, текущая позиция в каждом.
  - Лента «Мои сабмиты» — все scored сабмиты по всем соревнованиям, сортировка по дате.
- **Явный «Участвовать»** на странице соревнования: до участия — баннер с кнопкой; после — статус «вы участник» + кнопка «Покинуть» в кабинете. Auto-join из SP-3 остаётся (первый сабмит сам добавляет в `competition_members`, кнопка для UX-clarity).
- **Native LB паритет с kaggle**: зелёные/красные стрелки `previousPoints`/`previousTotalPoints` теперь работают и для native (через worker-hook + in-memory snapshot, как в kaggle-pipeline). Существующие OBS-оверлеи (`/obs/competitions/<slug>/overall`, `/obs/competitions/<slug>/cycle`, etc.) автоматически рендерят native — проверить визуально + поправить если есть деги-edge-case'ы.
- **Selected submissions**: участник может пометить до **2 сабмитов** как final per task. Лидерборд тогда учитывает: `private_overall` использует best из selected (если хоть один выбран) — иначе fallback на общий best (как уже работает). Public-LB не меняется (всегда best). Это зеркалит Kaggle code-competition mechanic.

**Что НЕ входит в SP-4:**

- Полная деприкация `x-admin-token` (только pre-deprecation warning в логах). Удаление токена — отдельный «cleanup-релиз» после стабилизации.
- Полная миграция `participants.json` в users + `competition_members`. Файл остаётся для kaggle «ours»-фильтра; деприкация — будущий cleanup-релиз.
- Email-верификация / password-reset через email — пост-MVP.
- OAuth (GitHub/Google login) — пост-MVP.
- Команды (1 user = 1 участник).
- Discussions / kernels / комментарии.
- Rate-limit на profile/password endpoints (полагаемся на existing global limiters; если нужно — отдельный таск).
- Per-competition admin scope (любой `users.role='admin'` админит всё).
- Notification feed («ваш сабмит получил новый score» и т.п.).

## Архитектурные решения

| Решение | Выбор | Почему |
| --- | --- | --- |
| Email change | Принимаем сразу без confirmation | Без email-сервиса MVP не уперлось; переключим на confirmation вместе с password-reset post-MVP |
| Password change | Старый+новый, новый ≥8 символов; все сессии остаются (не выкидываем) | Стандарт; принудительный logout всех сессий — отдельный таск если будет инцидент |
| Deltas для native | In-memory snapshot per competition, обновляется в worker'е после каждого `scored` сабмита | Зеркальная семантика с kaggle refresh-loop'ом; пережиток в БД не нужен |
| Selected submissions | Колонка `selected` уже есть в `submissions` (поставлена в SP-3 schema, не использовалась); max 2 на (user, task), private LB агрегирует best из selected | Schema готова; оптимально для NEOAI flow |
| Join/leave | POST `/competitions/<slug>/join` + DELETE `/competitions/<slug>/members/me` (sub-resource); auto-join из SP-3 не убираем | Идемпотентно, простая семантика |
| Cabinet endpoints | `/api/me/*` namespace под `requireAuth` | Ясная граница «свой контекст», легко добавлять полей |

## Schema — миграция `0004_selected_and_indexes.sql`

В SP-3 schema колонка `submissions.selected` не создавалась (выпала при правке на public/private split). 0004 добавляет её ALTER'ом + индексы для быстрых leaderboard-запросов:

```sql
-- 1. Добавить selected колонку (NOT NULL DEFAULT 0 → существующие строки получают 0)
ALTER TABLE submissions ADD COLUMN selected INTEGER NOT NULL DEFAULT 0
  CHECK (selected IN (0, 1));

-- 2. Индекс для проверки «у пользователя в задаче ≤ 2 selected»
CREATE INDEX submissions_selected
  ON submissions (task_id, user_id, id)
  WHERE selected = 1 AND status = 'scored';

-- 3. Best-из-selected для private leaderboard
CREATE INDEX submissions_selected_score_private
  ON submissions (task_id, user_id, points_private DESC, id)
  WHERE selected = 1 AND status = 'scored' AND points_private IS NOT NULL;
```

`ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 0` в SQLite атомарен и быстр (без переписи таблицы), поэтому миграция безопасна на любом размере БД.

## API

### `/api/me/*` — личный кабинет

| Method | Path | Body / Query | Что |
| --- | --- | --- | --- |
| GET | `/api/me` | — | Профиль текущего юзера: `{ id, email, displayName, kaggleId, role, createdAt }`. То же что `/auth/me` отдаёт сейчас, но с расширением полей. |
| PATCH | `/api/me` | `{ email?, displayName?, kaggleId? }` | Обновляет переданные поля. Валидация как при register. Email и kaggleId — UNIQUE check; коллизия → 400. |
| POST | `/api/me/password` | `{ currentPassword, newPassword }` | Меняет пароль (verify current + bcrypt new + UPDATE). Сессии не инвалидируются. |
| GET | `/api/me/competitions` | — | Список соревнований где user — member: `[{ slug, title, type, joinedAt, totalPoints?, place? }, ...]`. `totalPoints`/`place` — для соревнований где есть scored submissions у юзера, посчитанные тем же `buildNativeLeaderboard` фильтром по userId. Для kaggle — `null` (kaggle-«ours» не индексирует per-user).  |
| GET | `/api/me/submissions` | `?limit=N&offset=N` | Все сабмиты юзера во всех native-задачах, DESC по `created_at`. Default limit=50, max 200. Возвращает плоский массив с `competitionSlug` + `taskSlug` + поля сабмита. |

### Join / leave

| Method | Path | Auth | Что |
| --- | --- | --- | --- |
| POST | `/api/competitions/<slug>/join` | required | INSERT OR IGNORE в `competition_members`. Возвращает `{ joined: true, alreadyMember: bool }`. |
| DELETE | `/api/competitions/<slug>/members/me` | required | DELETE FROM competition_members WHERE …. Сабмиты остаются (исторические данные не трогаем). Возвращает `{ left: true }`. |
| GET | `/api/competitions/<slug>/membership` | optional | `{ isMember: bool, joinedAt: iso?|null }`. Для аноним'a — `{ isMember: false }` без 401. |

### Selected submissions

| Method | Path | Что |
| --- | --- | --- |
| PUT | `/api/competitions/<slug>/native-tasks/<task>/submissions/<id>/select` | Помечает submission как selected (max 2 per user-task). Body опц. `{ selected: bool }`, default true. Если уже 2 selected → 400 «max 2 selected; unselect another first». |

### Existing endpoints — расширения

- `GET /api/competitions/<slug>/leaderboard` (native, расширение из SP-3):
  - `previousPoints`/`previousTotalPoints` теперь заполнены из in-memory snapshot (см. ниже Native deltas).
  - В `privateOverall` — best из **selected** submissions per user. Если selected у юзера нет (на каком-либо task) — fallback на best из всех scored.

## Native deltas — in-memory snapshot

В Node-процессе храним последний снэпшот лидерборда per native competition:

```js
// app.js или scoring/worker.js
const nativeSnapshots = new Map(); // slug → { overall, byTask, capturedAt }
```

После каждого `scored` сабмита worker зовёт хук `onScored(competitionSlug)`:

```js
function onScored(db, competitionSlug) {
  const fresh = buildNativeLeaderboard(db, competitionSlug, 'public');
  const previous = nativeSnapshots.get(competitionSlug);
  if (previous) {
    annotateDeltas(fresh, previous);  // дополняет previousPoints / previousTotalPoints полями из previous
  }
  nativeSnapshots.set(competitionSlug, fresh);
}
```

`annotateDeltas` — переиспользует `app.js#annotateWithDeltas` или его эквивалент (логика уже существует для kaggle). Реализация тривиальная: пройти overall+byTask, для каждой строки найти аналог в previous по `participantKey`, проставить `previousPoints`/`previousTotalPoints`.

**Как читает `/leaderboard`:**

- Если `nativeSnapshots.has(slug)` — отдать оттуда (с уже посчитанными deltas).
- Если нет (свежий рестарт, ни одного scored сабмита после старта) — вычислить `buildNativeLeaderboard` on-demand, deltas = `null` (как в SP-3).
- Альтернатива (более правильная): на старте бэка прогнать `onScored` синтетически для каждого native-соревнования один раз, чтобы snapshot был сразу. Принять.

**Лимиты:** snapshot per competition ≈ N юзеров × M задач = ~1000 строк × 100 байт = 100 KB. Для 50 соревнований — 5 MB в памяти. Норм.

## Selected submissions — semantics

`submissions.selected` (0/1) на (user, task) уровне:

- При POST submission — `selected = 0` по дефолту.
- Юзер пометил → проверка count(selected=1, user, task) → если уже ≥ 2 → 400.
- Pre-SP-4 (только public LB) selected ничего не меняет.
- В private LB query (build native leaderboard, variant=private):

```sql
WITH selected_best AS (
  SELECT s.task_id, s.user_id, s.points_private AS points,
         ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.points_private DESC, s.id ASC) AS rn
  FROM submissions s
  WHERE s.status='scored' AND s.points_private IS NOT NULL AND s.selected = 1
    AND s.task_id IN (...)
),
overall_best AS (
  -- то же что в SP-3, но fallback'ом
  SELECT s.task_id, s.user_id, s.points_private AS points,
         ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.points_private DESC, s.id ASC) AS rn
  FROM submissions s
  WHERE s.status='scored' AND s.points_private IS NOT NULL
    AND s.task_id IN (...)
)
-- COALESCE: если у юзера есть selected на этой задаче — берём оттуда, иначе из overall_best
SELECT
  COALESCE(sb.task_id, ob.task_id) AS task_id,
  COALESCE(sb.user_id, ob.user_id) AS user_id,
  COALESCE(sb.points, ob.points) AS points
FROM selected_best sb FULL OUTER JOIN overall_best ob
  ON sb.task_id = ob.task_id AND sb.user_id = ob.user_id
WHERE COALESCE(sb.rn, ob.rn) = 1;
```

> SQLite не поддерживает FULL OUTER JOIN до 3.39 — better-sqlite3 ^11 идёт на 3.45+, ОК. Альтернатива на 3.39<: union LEFT JOIN с обеих сторон.

Public LB не меняется (всегда best независимо от selected).

## Frontend

### Новые страницы

```
frontend/src/me/
  MePage.jsx                    # /me — главная кабинета
  ProfileSection.jsx            # email/displayName/kaggleId edit form
  PasswordSection.jsx           # change password form
  MyCompetitions.jsx            # список «мои соревнования» с place
  MySubmissions.jsx             # лента всех сабмитов (paginated)
  LeaveCompetitionButton.jsx    # с конфирмом
```

### Новые компоненты

```
frontend/src/competition/JoinButton.jsx
  # На странице соревнования и в превью на главной — рендерится:
  # - если не member: «Участвовать»
  # - если member: «Вы участник» + ссылка «Личный кабинет»
  # - если анон: «Войти чтобы участвовать»
```

### Изменения существующих

- `frontend/src/UserMenu.jsx` (из SP-1) — добавить ссылку `«Личный кабинет»` для авторизованных.
- `frontend/src/App.jsx` — routes `/me`, `/me/submissions`, `/me/competitions`.
- `frontend/src/competitions/CompetitionPage.jsx` (если такой компонент есть, иначе на странице соревнования) — добавить `<JoinButton />`.
- `frontend/src/native/MySubmissions.jsx` (из SP-3, на странице задачи) — добавить колонку «Selected» с чекбоксом для toggling. Disabled если уже 2 selected И этот не selected.
- Существующий `LeaderboardTable` (kaggle) — должен работать с native без изменений после deltas. Проверить визуально на реальных данных.

### API helpers

В `frontend/src/api.js`:
```js
export const me = {
  get: () => request('/me'),
  update: (patch) => request('/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  changePassword: (body) => request('/me/password', { method: 'POST', body: JSON.stringify(body) }),
  competitions: () => request('/me/competitions'),
  submissions: (params = {}) => request(`/me/submissions${qs(params)}`),
};

export const membership = {
  get: (slug) => request(`/competitions/${slug}/membership`),
  join: (slug) => request(`/competitions/${slug}/join`, { method: 'POST' }),
  leave: (slug) => request(`/competitions/${slug}/members/me`, { method: 'DELETE' }),
};

submissions.toggleSelected = (compSlug, taskSlug, id, selected) =>
  request(`/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}/select`,
    { method: 'PUT', body: JSON.stringify({ selected }) });

function qs(params) {
  const s = new URLSearchParams(params).toString();
  return s ? `?${s}` : '';
}
```

## OBS-оверлеи

Существующие OBS-роуты (`/obs/competitions/<slug>/overall`, `/obs/competitions/<slug>/cycle`, `/obs/competitions/<slug>/board/<b>`, `/obs/competitions/<slug>/bar/board/<b>`, `/obs/competitions/<slug>/task/<t>`, `/obs/competitions/<slug>/card`) тянут данные через `/api/competitions/<slug>/leaderboard` — для native эта ручка теперь возвращает 4-вариант с deltas (после SP-4). Никаких изменений на стороне OBS-компонентов не требуется.

**Smoke-тест (часть Done criteria):** открыть в OBS-браузере любой `/obs/.../overall` для native соревнования — должны рендериться имена, points, и зелёные/красные стрелки при изменениях.

## Раскладка кода

### Backend

```
backend/src/db/migrations/0004_selected_and_indexes.sql        ← новое
backend/src/db/competitionMembersRepo.js                       ← новое (или дополнение существующего)
backend/src/db/usersRepo.js                                    ← +updateUserProfile + updatePassword
backend/src/db/submissionsRepo.js                              ← +setSelected + countSelected
backend/src/scoring/snapshotCache.js                           ← новое — in-memory native snapshots + deltas
backend/src/scoring/worker.js                                  ← hook: после markScored зовём onScored(slug)
backend/src/scoring/nativeLeaderboard.js                       ← extend для variant=private с selected fallback
backend/src/routes/me.js                                       ← новое — /api/me/*
backend/src/routes/membership.js                               ← новое — join/leave/membership
backend/src/routes/submissionsPublic.js                        ← +PUT /:id/select
backend/src/app.js                                             ← mount routes; /leaderboard читает snapshot
backend/tests/sp4_me.test.js
backend/tests/sp4_membership.test.js
backend/tests/sp4_selected.test.js
backend/tests/sp4_deltas.test.js
```

### Frontend

```
frontend/src/me/MePage.jsx + ProfileSection / PasswordSection / MyCompetitions / MySubmissions
frontend/src/competition/JoinButton.jsx
frontend/src/api.js              ← me/membership/select helpers
frontend/src/App.jsx             ← /me routes
frontend/src/UserMenu.jsx        ← link to /me
frontend/src/native/MySubmissions.jsx (из SP-3)   ← колонка "Selected" с чекбоксом
```

### Docs

- `new_lb/README.md` — секция cabinet + selected submissions.
- `new_lb/ROUTES.md` — все новые `/api/me/*`, join/leave, select.

## Тесты

- `usersRepo.updateUserProfile`: email/displayName/kaggleId update; UNIQUE-collision.
- `usersRepo.updatePassword`: верифицирует old → пишет new bcrypt; неверный old → throw.
- `competitionMembersRepo`: join idempotent (INSERT IGNORE); leave; isMember; listForUser.
- `submissionsRepo.setSelected(id, true)`: помечает; count >= 2 → throws; unselect → можно снова до 2.
- `nativeLeaderboard.private` с selected: участник с 2 selected (points 70, 80) и одним не-selected (90) — на private LB у него 80, не 90. Если ни одного selected — fallback на 90.
- `snapshotCache.onScored`: первый snapshot → deltas null; второй после изменения → deltas заполнены.
- `routes/me`: `/me` GET, PATCH email/displayName/kaggleId, POST password (happy + wrong old + collision).
- `routes/membership`: POST join → member; повторный POST → alreadyMember=true; DELETE → не member; GET для анона → isMember=false без 401.
- `routes/submissionsPublic.toggleSelected`: PUT валидный → 200; третий select при 2 уже выбранных → 400.
- Integration: register → join native → submit → wait scored → select → check private LB picks selected.
- Existing kaggle leaderboard endpoint регрессия — не сломан.

## ENV-переменные

Никаких новых.

## Migration safety

`0004_selected_and_indexes.sql` — pure additive. Если `submissions.selected` колонка отсутствует (в маловероятном случае что SP-3 её не добавил) — миграция первой строкой делает `ALTER TABLE`. Проверить при имплементации первой задачи.

`participants.json`, `x-admin-token`, legacy redirects — **остаются как есть**. Деприкация — отдельный «cleanup» релиз после SP-4.

## Открытые вопросы

Детали для импл-плана:

- В `/me/competitions` для kaggle-соревнований возвращать ли статичный «вы в списке participants.json»? Беру: для kaggle проверяем `users.kaggle_id` против `participants.json` той comp, и если match → отдаём «вы участник» без totalPoints. Альтернатива: kaggle competitions просто не показываются в `/me/competitions`. Решу при имплементации; склонюсь к простоте (показываем где есть `competition_members` row, kaggle сейчас только если auto-joined через сабмит, что для kaggle невозможно — поэтому просто не показываем).
- Selected при rescore-all (admin сменил `score.py`) — selected флаг **сохраняется** (на этом и смысл selected: участник делает осознанный выбор задолго до раскрытия private). Не сбрасываем при rescore. Документирую это в README/UI tooltip.
- Email change в SP-4 — нужна ли confirmation? Беру: нет, изменяется сразу (NEOAI flow прозрачный, всё под админом). Если завтра захотим — добавляем `email_confirmation_tokens` таблицу + confirmation endpoint.

## Критерии готовности SP-4

- [ ] Миграция 0004 применяется без потерь (на БД с уже зарегистрированными участниками SP-3).
- [ ] `/me` возвращает профиль, PATCH меняет email/displayName/kaggleId с валидацией uniques.
- [ ] `POST /me/password` меняет пароль; пере-логин работает с новым.
- [ ] `/me/submissions` отдаёт мои сабмиты по всем native-задачам.
- [ ] `/me/competitions` отдаёт native-соревнования где я participant с местом.
- [ ] `POST /competitions/<slug>/join` идемпотентен; `DELETE …/members/me` убирает; `GET …/membership` для анонима без 401.
- [ ] `PUT submissions/<id>/select` помечает; третий выбор → 400.
- [ ] Native private LB фильтрует по selected (с fallback на best).
- [ ] Native public LB имеет deltas (зелёные/красные стрелки) после второго scored сабмита.
- [ ] OBS-оверлеи рендерят native-данные визуально как kaggle.
- [ ] Existing kaggle LB байт-в-байт как до SP-4 (regression test).
- [ ] `npm test` зелёный.
