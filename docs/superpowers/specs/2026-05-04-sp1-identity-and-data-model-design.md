# SP-1: Identity & Native-Competitions Data Model — Design

**Status:** Draft
**Date:** 2026-05-04
**Parent project:** «Своя Kaggle» поверх существующего лидерборда (4 под-проекта; этот — первый)

## Цель и объём

SP-1 — фундамент платформы. Закрывает три вещи:
1. Учётки участников (регистрация/вход), сессии, роль админа.
2. Перевод каталога соревнований из JSON-файла в SQLite, с новым полем `type: kaggle | native`.
3. Создание (но не наполнение) таблиц для будущих native-сущностей.

**Что SP-1 даёт пользователю end-to-end:** залогиненный участник заходит на сайт, видит свой email/имя в шапке, может выйти. Админ создаёт новые соревнования (kaggle и native) через админку. Существующие kaggle-соревнования (`neoai-2026`) продолжают работать без изменений: refresh-loop, лидерборды, OBS — всё как было.

**Что НЕ входит в SP-1 (явный non-scope):**
- Создание/редактирование native-задач, описания, датасеты, starter-артефакты — это SP-2.
- Сабмиты, scoring-jobs, исполнение `score.py` — SP-3.
- Native-лидерборд, «мои сабмиты», UI присоединения к соревнованию — SP-4.
- Email-верификация, password reset, OAuth — после MVP.
- UI для админа, управляющий пользователями.
- Миграция `participants.json` в БД (остаётся в JSON для kaggle-фильтра «ours», заменим в SP-3 после того, как participants получат user_id).

## Архитектурные решения (зафиксированы в брейнсторме)

| Решение | Выбор | Почему |
| --- | --- | --- |
| Сосуществование с kaggle | Hybrid (`competitions.type`) | Не ломаем работающий `neoai-2026`, native добавляется рядом |
| Сабмит | Файл предсказаний + admin `score.py` | Без исполнения пользовательского кода — отрезает 80% инфра-сложности |
| БД | SQLite через `better-sqlite3` | Ноль ops, single-file, sync API, переезд на Postgres = неделя если когда-нибудь |
| Auth | Email+пароль, сессия в HTTP-only cookie, админ — `users.role` | Без внешних сервисов, OAuth добавляется позже без миграции схемы |
| Объём миграции | Identity + индекс соревнований в БД, per-comp `tasks.json`/`boards.json`/`state.json`/`private/*.csv` остаются | DB там, где нужны реляции; JSON там, где формат уже работает |

## Schema

Файл `backend/src/db/migrations/0001_init.sql`. Все таблицы создаются разом — это чистый init для новой БД, не накатывается поверх существующей структуры (её просто нет).

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ───────────────────────────────────────────────────────────
-- Schema migrations
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ───────────────────────────────────────────────────────────
-- Competitions: replaces data/competitions.json
CREATE TABLE competitions (
  slug          TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  subtitle      TEXT,
  type          TEXT NOT NULL CHECK (type IN ('kaggle', 'native')),
  visible       INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at    TEXT
);
CREATE INDEX competitions_visible_order
  ON competitions (visible, display_order)
  WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────
-- Users: новая сущность
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  kaggle_id     TEXT,                   -- lowercased; для hybrid-привязки к kaggle-лидерборду
  role          TEXT NOT NULL DEFAULT 'participant'
                  CHECK (role IN ('participant', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX users_email_unique ON users (email COLLATE NOCASE);
CREATE UNIQUE INDEX users_kaggle_unique ON users (kaggle_id) WHERE kaggle_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────
-- Sessions: cookie session id → user
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,           -- 32 random bytes, base64url
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- ───────────────────────────────────────────────────────────
-- Competition members: join users ↔ competitions
-- В SP-1 таблица создаётся пустой; начинает наполняться в SP-3 (join native competition).
-- Для kaggle-соревнований "ours"-фильтр пока продолжает читать participants.json
-- (участники там без user-аккаунтов). Деприкейт participants.json — отдельный шаг в SP-3.
CREATE TABLE competition_members (
  competition_slug TEXT NOT NULL REFERENCES competitions(slug) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (competition_slug, user_id)
);
CREATE INDEX competition_members_user ON competition_members (user_id);
```

**Что специально не делаем в SP-1:** не создаём `native_tasks` / `datasets` / `submissions` / `scoring_jobs`. Они появятся в миграциях `0002_*.sql` / `0003_*.sql` в SP-2/SP-3 — каждая со своим бампом версии. Это держит SP-1 минимальным.

## Миграционный flow на первом старте

`src/db/index.js` при первом импорте:

1. Открывает `path.join(DATA_DIR, 'app.db')` (создаёт если нет).
2. Включает `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`.
3. Читает `schema_migrations`. Применяет недостающие `0001_init.sql`, `0002_*.sql` и т.д. в транзакции.
4. После применения `0001_init` — если в БД нет ни одной строки в `competitions` И на диске лежит `data/competitions.json`, запускает **one-shot data migration** (отдельный шаг, отдельный коммит в БД):
   - Читает `competitions.json`, валидирует через существующий `validateCompetitions`.
   - Вставляет каждую запись в `competitions` с `type='kaggle'` (legacy всегда был kaggle).
   - Снапшотит `competitions.json` → `data/_legacy-backup-<ISO-ts>/competitions.json` (как сейчас делает текущая legacy-миграция).
   - Удаляет оригинальный `competitions.json` чтобы не было double-truth.
5. Если `ADMIN_BOOTSTRAP_EMAIL` и `ADMIN_BOOTSTRAP_PASSWORD` заданы в env И в `users` нет ни одного `role='admin'` — создаёт админа. Идемпотентно.

`competitions/<slug>/tasks.json`, `boards.json`, `state.json`, `private/<slug>/<task>.csv` **не трогаются**: kaggle-refresh продолжает читать их как раньше. Native-соревнования просто не имеют этих файлов.

## Auth

### Хеширование

`bcryptjs` (чисто-JS, без нативных бинарников — проще для Docker-сборки), cost=10. Если позже захотим argon2id — миграция через rehash-on-login.

### Сессия

- Cookie: `session=<id>`, `HttpOnly`, `SameSite=Lax`, `Secure` в проде (за nginx по `req.protocol`/`x-forwarded-proto`), `Path=/`, `Max-Age=2592000` (30 дней).
- Session ID: `crypto.randomBytes(32).toString('base64url')`.
- TTL: 30 дней; на каждом authenticated запросе sliding-обновление `expires_at` (если до истечения < 7 дней — продлеваем).
- Cleanup: `DELETE FROM sessions WHERE expires_at < now()` запускается раз в час из таймера + один раз на старте.

### Эндпоинты

| Method | Path | Body | Ответ |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `{ email, password, displayName, kaggleId? }` | `{ user: { id, email, displayName, kaggleId, role } }` + Set-Cookie |
| POST | `/api/auth/login` | `{ email, password }` | то же что register |
| POST | `/api/auth/logout` | — | `{ ok: true }`, удаляет сессию |
| GET | `/api/auth/me` | — | `{ user: ... }` или `{ user: null }` |

Валидация: email — простой regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, 5–254 символов; password — 8–256 символов; displayName — 1–80 после `.trim()`; kaggleId — опционально, `[a-z0-9-]+`, ≤80, lowercased на запись.

Rate-limit: in-memory token-bucket, 10 попыток на IP в минуту на `/api/auth/login` и `/api/auth/register`. Без отдельной либы (10 строк своих).

### Middleware

- `loadUser(req, res, next)` — читает cookie, грузит сессию + юзера, кладёт в `req.user`. Подключается на все API.
- `requireAuth` — 401 если `!req.user`.
- `requireAdmin` — заменяет текущий `requireAdmin` в `app.js`. Принимает **либо** валидную admin-сессию (`req.user?.role === 'admin'`), **либо** legacy `x-admin-token` header (для CI/скриптов). Логирует когда сработал token-fallback. Депрекейт `x-admin-token` — отдельным таском после SP-4.

## API изменения существующих эндпоинтов

`/api/admin/competitions*` — теперь читают и пишут `competitions` таблицу вместо `competitions.json`:

- `GET /api/admin/competitions` — `SELECT * FROM competitions WHERE deleted_at IS NULL ORDER BY display_order, slug`
- `PUT /api/admin/competitions` — bulk replace через транзакцию: для каждой записи в body — UPSERT; записи которых нет в body — soft delete (`deleted_at = now()`). Ответ — список как из GET.
- `POST /api/admin/competitions` — INSERT. Если slug уже есть (включая soft-deleted — отдельная коллизия) → 400.
- `DELETE /api/admin/competitions/<slug>` — `UPDATE competitions SET deleted_at = now()`. Соответствующая директория `data/competitions/<slug>/` (если есть) переименовывается в `<slug>.deleted-<ts>/` как сейчас.

Все ответы получают новое поле `type`. Public `GET /api/competitions` возвращает только `WHERE deleted_at IS NULL AND visible = 1`.

`refreshAll` / `refreshCompetition` — изменения:

- `cache.competitionsIndex` теперь грузится из БД через `competitionsRepo.listActive()`, не из `loadCompetitions(COMPETITIONS_FILE)`.
- В `refreshCompetition(slug)` добавляется ранний `if (comp.type !== 'kaggle') return;` — native-соревнования просто не дёргают Kaggle CLI. SP-3 добавит свой путь рефреша для native.

## Frontend изменения

Минимальные, но видимые пользователю:

- **`/login`** — новая страница: email + password. Существующая `/admin` (token-логин) переезжает сюда же — поле «admin token» остаётся как «advanced» fallback для CI/скриптов, дефолт — email/password.
- **`/register`** — новая страница: email + password + displayName + опц. kaggleId. После успеха — автоматический редирект туда, откуда пришёл (или на `/`).
- **Шапка** — на залогиненном: `displayName` + меню (logout). На анониме: ссылки `Войти` / `Регистрация`.
- **API-клиент (`api.js`)** — все запросы получают `credentials: 'include'`. Существующий `x-admin-token` header остаётся для legacy-flow, но новые админ-страницы переходят на сессию.
- **Админ-форма соревнования** — новое поле `type` (radio: Kaggle / Native), default `kaggle`. Отображение `type` в списке соревнований. Создавать native пока бессмысленно (нет задач), но поле должно работать end-to-end чтобы SP-2 мог сразу строиться.

Никаких новых страниц «личный кабинет / мои сабмиты» — это SP-4.

## Раскладка файлов

Новое в `backend/src/`:

```
backend/src/
  db/
    index.js                       # экспорт singleton better-sqlite3 + runMigrations()
    migrations/
      0001_init.sql
    competitionsRepo.js
    usersRepo.js
    sessionsRepo.js
    membersRepo.js                 # пустой shell, заполнится в SP-3
  auth/
    bcrypt.js                      # hash/verify wrappers
    sessions.js                    # createSession, deleteSession, touchExpiry
    middleware.js                  # loadUser, requireAuth, requireAdmin
    rateLimit.js                   # 10-line token bucket
  routes/
    auth.js                        # register/login/logout/me
  bootstrapAdmin.js                # создание админа из env
```

Изменения в существующих:

- `src/app.js` — `loadCompetitions(COMPETITIONS_FILE)` → `competitionsRepo.listActive()`. Все `/api/admin/competitions*` хэндлеры переписываются на репозиторий. Подключается `loadUser` middleware и `routes/auth`. `requireAdmin` заменяется новой версией.
- `src/index.js` — на старте: открыть БД, прогнать миграции, запустить one-shot competitions-json migration, прогнать `bootstrapAdmin()`. Затем существующая legacy-миграция (она про `tasks.json` мульти-тенант, не про БД) и `refreshAll`.
- `src/competitions.js` — `loadCompetitions` / `saveCompetitions` остаются (для one-shot data migration), но в hot-path не используются.
- `package.json` — `+better-sqlite3 ^11`, `+bcryptjs ^2`, `+cookie ^0.6` (или ручной парс). `cors`-конфиг — `credentials: true` + явный `origin`.

## ENV-переменные (новые)

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `DB_FILE` | `./data/app.db` | путь к SQLite |
| `SESSION_TTL_DAYS` | `30` | TTL cookie/сессии |
| `COOKIE_SECURE` | `auto` | `true`/`false`/`auto` (определяет по `req.protocol`) |
| `ADMIN_BOOTSTRAP_EMAIL` | пусто | если задано вместе с password — создаёт админа на старте если ни одного нет |
| `ADMIN_BOOTSTRAP_PASSWORD` | пусто | то же |

Существующие (`ADMIN_TOKEN`, `REFRESH_MS`, ...) сохраняют поведение.

## Тесты

`node:test` (как сейчас). Используем `new Database(':memory:')` + `runMigrations` для каждого тест-кейса (свежая БД на тест).

Покрываем:
- `usersRepo`: insert + unique email + lookup; case-insensitive email; kaggle_id уникальность.
- `sessionsRepo`: create / get-with-user / delete / cleanup expired.
- `bcrypt`: hash → verify happy + verify-fail.
- `auth/middleware`: anon → `req.user === null`; valid cookie → юзер; expired cookie → null + cookie cleared.
- `routes/auth`: full flow register → me → logout → me.
- `competitionsRepo`: list active игнорирует soft-deleted; UPSERT; soft delete.
- `dataMigration/competitionsJsonToDb`: импорт реального `competitions.json`-фикстура (с `neoai-2026`); идемпотентность (второй запуск ничего не делает).
- `requireAdmin`: admin-сессия → ok; participant-сессия → 403; valid `x-admin-token` без сессии → ok; невалидный обоих → 401.

Интеграционно (через `supertest` или ручной `app.listen` + fetch — выберется в impl plan): полный flow register → admin promote (через прямой UPDATE в тестовой БД) → создать соревнование через API → увидеть в `/api/competitions`.

## Открытые вопросы

Ничего, что блокирует написание плана. Ниже — детали, которые удобнее зафиксировать в плане/коде, чем в спеке:
- Выбор между `bcryptjs` и нативным `bcrypt` — `bcryptjs` если в Dockerfile нет build-toolchain, иначе оба валидны. Импл-план зафиксирует.
- Конкретный wire-format ошибок (`{ error: '...' }` vs `{ error: { code, message } }`) — берём текущий формат `{ error: '...' }` для консистентности.
- Подключать ли `cookie-parser` или парсить заголовок `Cookie` руками — детализируется в импл-плане; склонюсь к `cookie` (только парсер) без `cookie-parser`.

## Критерии готовности SP-1

- [ ] Свежий деплой создаёт `data/app.db`, применяет миграции, бэкапит и переносит `competitions.json` в БД.
- [ ] Существующий kaggle-refresh продолжает работать без визуальных изменений на публичных и OBS-страницах.
- [ ] `POST /api/auth/register` → cookie + me работает.
- [ ] Залогиненный пользователь видит свой displayName в шапке, может выйти.
- [ ] Админ-сессия пускает в `/admin/competitions`, может создать соревнование с `type=native`.
- [ ] Старый `x-admin-token` продолжает работать (проверено CI-смоук-тестом).
- [ ] Тесты `npm test` зелёные.
