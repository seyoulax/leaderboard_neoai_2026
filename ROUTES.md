# Routes

Все фронт-маршруты обслуживает SPA. API живёт под `/api/*`.

## Multi-tenant

Главная `/` — список соревнований. Каждое соревнование живёт под `/competitions/<slug>/...` со своим набором задач/бордов/участников.

## Публичные страницы

| URL | Что |
| --- | --- |
| `/` | Список видимых соревнований |
| `/login` | Email + пароль (session cookie); редирект на `from` или `/` |
| `/register` | Регистрация: email, пароль (≥ 8), displayName, kaggleId (опц.) |
| `/competitions/<slug>` | Редирект на `leaderboard` |
| `/competitions/<slug>/leaderboard` | Общий ЛБ (для `type=native` показывает список задач без entries — заполнятся в SP-3) |
| `/competitions/<slug>/cycle` | Циклическая показ по 15 строк (по прямому URL, без таба в навигации) |
| `/competitions/<slug>/board/<b>` | Лидерборд борда |
| `/competitions/<slug>/task/<t>` | Лидерборд задачи (kaggle) |
| `/competitions/<slug>/native-tasks/<task>` | Публичная страница нативной задачи: markdown-описание + datasets/artifacts с auth-gated скачиванием + zip-бандлы |
| `/competitions/<slug>/results` | Церемония оглашения результатов (live SSE) — олимпиадный reveal по итоговому private-LB |

В правом верхнем углу любой страницы — `UserMenu`: «Войти / Регистрация» для анонимов; имя + «Выйти» (+ ссылка «Админка», если `role='admin'`) — для залогиненных.

## OBS

| URL |
| --- |
| `/obs/competitions/<slug>/overall` |
| `/obs/competitions/<slug>/cycle` |
| `/obs/competitions/<slug>/board/<b>` |
| `/obs/competitions/<slug>/bar/board/<b>` |
| `/obs/competitions/<slug>/task/<t>` |
| `/obs/competitions/<slug>/card` |

## Админ

| URL | Что |
| --- | --- |
| `/admin` | Legacy token-логин (вводит `ADMIN_TOKEN`). Для session-auth используй `/login` админ-аккаунтом — после успеха `UserMenu` подскажет ссылку на админку. |
| `/admin/competitions` | CRUD соревнований: поля `type: kaggle \| native` (radio, нельзя поменять после создания), `visibility: public \| unlisted` (radio + колонка-селект). Для native-соревнований — ссылка `native-tasks →`. |
| `/admin/competitions/<slug>` | Редирект на `tasks` |
| `/admin/competitions/<slug>/tasks` | CRUD kaggle-задач (scoped) |
| `/admin/competitions/<slug>/boards` | CRUD бордов (scoped) |
| `/admin/competitions/<slug>/participants` | JSON paste/upload |
| `/admin/competitions/<slug>/card` | OBS-карточка (scoped) |
| `/admin/competitions/<slug>/native-tasks` | Список нативных задач (только для `type=native`): создание/удаление |
| `/admin/competitions/<slug>/native-tasks/<task>` | Редактор нативной задачи: метаданные + markdown с preview + scoring anchors + загрузка датасетов/артефактов/grader/ground-truth |
| `/admin/competitions/<slug>/results` | Загрузка финального CSV + выбор группы сравнения + старт церемонии + кнопка «Следующий шаг» (SSE-пуш зрителям) + reset |

## Legacy redirects

Поддерживаются временно (1-2 недели после раскатки):

`/leaderboard`, `/cycle`, `/board/<s>`, `/task/<s>`, `/control`, `/admin/tasks`, `/admin/boards`, `/admin/card`, `/obs/{overall,cycle,board/<s>,bar/board/<s>,task/<s>,card}` → редиректят на эквивалент с `competitions/neoai-2026/`.

## Backend API

### Глобальные

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/health` | Статус, состояние всех соревнований |
| GET | `/api/competitions` | Видимые соревнования (только `visibility='public' AND visible=1`). Поля: `slug`, `title`, `subtitle`, `type: 'kaggle' \| 'native'`, `visibility: 'public' \| 'unlisted'`, `visible`, `displayOrder`. **Поиск:** `?q=<term>` — case-insensitive LIKE по `title`. |

### Auth

| Method | Path | Что |
| --- | --- | --- |
| POST | `/api/auth/register` | `{email, password, displayName, kaggleId?}` → `{user}` + Set-Cookie session |
| POST | `/api/auth/login` | `{email, password}` → `{user}` + Set-Cookie |
| POST | `/api/auth/logout` | Удаляет сессию + clear cookie |
| GET | `/api/auth/me` | `{user}` или `{user: null}` |

### Per-competition (публично)

| Method | Path |
| --- | --- |
| GET | `/api/competitions/<slug>` |
| GET | `/api/competitions/<slug>/leaderboard` (для `type=native` возвращает `tasks` из `native_tasks` + пустые `overall`/`privateOverall` — заполнятся в SP-3) |
| GET | `/api/competitions/<slug>/tasks/<t>` |
| GET | `/api/competitions/<slug>/boards` |
| GET | `/api/competitions/<slug>/participants` |
| POST | `/api/competitions/<slug>/refresh` |
| GET | `/api/competitions/<slug>/card` |
| POST | `/api/competitions/<slug>/card` |
| GET | `/api/competitions/<slug>/results` (redacted reveal state — never leaks unrevealed rows / kaggleIds) |
| GET | `/api/competitions/<slug>/results/stream` (SSE — `event: state` per stepId, heartbeat `: ping` каждые 25s) |

### Native task endpoints (публично)

Применимы только если `competition.type='native'`.

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/competitions/<slug>/native-tasks` | Список задач (`{slug, title, higherIsBetter}[]`) |
| GET | `/api/competitions/<slug>/native-tasks/<task>` | Описание задачи + scoring anchors + `datasets[]` + `artifacts[]` (без `path`/`grader_path`/`ground_truth_path` — они приватные) |
| GET | `/api/competitions/<slug>/native-tasks/<task>/files/<id>` | **Auth:** требует session cookie. Стримит файл (только `kind in ('dataset','artifact')`; grader/ground-truth недоступны) |
| GET | `/api/competitions/<slug>/native-tasks/<task>/files.zip?kind=dataset\|artifact` | **Auth:** требует session cookie. Стримит ZIP всех файлов указанного kind |

### Админ (session cookie с `role='admin'` ИЛИ заголовок `x-admin-token`)

**Аутентификация.** Принимается либо session-cookie пользователя с `role='admin'` (через `/api/auth/login`), либо legacy `x-admin-token` (равен `ADMIN_TOKEN` в env). Token-fallback оставлен для CI/скриптов, депрекейтнут после SP-4.

| Method | Path | Что |
| --- | --- | --- |
| GET/PUT | `/api/admin/competitions` | Список / replace всего индекса (поля включают `type: 'kaggle' \| 'native'`) |
| POST | `/api/admin/competitions` | Создать одно (`{competition: {slug, title, type?, ...}}`, `type` дефолтит к `kaggle`); создаёт пустую директорию |
| DELETE | `/api/admin/competitions/<slug>` | Soft-delete: директория переименовывается в `<slug>.deleted-<ts>/` |
| GET/PUT | `/api/admin/competitions/<slug>/tasks` | Tasks scoped |
| GET/PUT | `/api/admin/competitions/<slug>/boards` | Boards scoped |
| GET/PUT | `/api/admin/competitions/<slug>/participants` | Participants — bulk replace через JSON |
| GET/PUT/DELETE | `/api/admin/competitions/<slug>/tasks/<t>/private` | Private CSV (поддерживает Kaggle all-submissions и legacy `kaggle_id,raw_score`) |
| GET | `/api/admin/competitions/<slug>/results` | Полное состояние reveal (с rows, kaggleIds — admin-only) |
| PUT | `/api/admin/competitions/<slug>/results/upload` | `{csv: string}` — парсит и сохраняет финальный CSV (`kaggleId, fullName, points, bonus`); 409 если церемония запущена |
| PUT | `/api/admin/competitions/<slug>/results/settings` | `{compareGroupSlug}` — задаёт группу для сравнения «было место №X» |
| POST | `/api/admin/competitions/<slug>/results/start` | Снимает snapshot мест из `groupsResults[<g>].overall` и переводит в фазу `revealing` |
| POST | `/api/admin/competitions/<slug>/results/advance` | `{expectedStepId}` — следующий шаг (409 при mismatch) |
| POST | `/api/admin/competitions/<slug>/results/reset` | Сбрасывает CSV + state файлы (idle) |

JSON body limit для админских PUT — **50 MB** (нужно для больших Kaggle all-submissions CSV).

### Native task admin endpoints

Только для `competition.type='native'` (для `kaggle` возвращают 400 при попытке создать задачу).

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/admin/competitions/<slug>/native-tasks` | Список (включая deleted=null) |
| POST | `/api/admin/competitions/<slug>/native-tasks` | `{slug, title, descriptionMd?, higherIsBetter?, baseline*/author*?}` |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task>` | Merge-update тех же полей |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>` | Soft-delete (`deleted_at` set) |
| POST | `/api/admin/competitions/<slug>/native-tasks/<task>/files?kind=dataset\|artifact` | **Multipart:** `file` + опциональные form-fields `display_name`/`description`. Sha256 + atomic rename. Лимит: `MAX_DATASET_BYTES`/`MAX_ARTIFACT_BYTES`. |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task>/files/<id>` | JSON: `{displayName?, description?, displayOrder?}` |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/files/<id>` | Удаляет row + файл с диска |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task>/grader` | Multipart `file` → пишется в `<task-dir>/grader<.ext>`, путь в `native_tasks.grader_path`. Лимит: `MAX_GRADER_BYTES` (100 KB по умолчанию). Замена прежнего файла. |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/grader` | Удаляет файл + сбрасывает `grader_path` в null |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth` | То же для `ground_truth_path` (public). Лимит: `MAX_GROUND_TRUTH_BYTES`. |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth` | То же |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth-private` | То же для `ground_truth_private_path` (опц., запускает второй grader-проход для private LB). |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth-private` | Удаляет файл + сбрасывает `ground_truth_private_path` |

### Submissions (native, SP-3)

Все требуют session-cookie auth. Auto-join в `competition_members` при первом успешном POST.

| Method | Path | Что |
| --- | --- | --- |
| POST | `/api/competitions/<slug>/native-tasks/<task>/submissions` | **Multipart:** `file`. Whitelist расширений (`SUBMISSION_ALLOWED_EXTS`), лимит `MAX_SUBMISSION_BYTES`, rate-limit `MAX_SUBMISSIONS_PER_DAY/(user, task, 24h)` → 429. Создаёт row с `status='pending'`. |
| GET | `/api/competitions/<slug>/native-tasks/<task>/submissions/me` | Список своих сабмитов (DESC по created_at). Включает поле `selected: 0|1`. |
| GET | `/api/competitions/<slug>/native-tasks/<task>/submissions/<id>` | Один сабмит. 404 если чужой (admin может смотреть). |
| PUT | `/api/competitions/<slug>/native-tasks/<task>/submissions/<id>/select` | **SP-4.** Body `{selected: bool}`. Помечает сабмит final (max 2 на (user, task) — иначе 400). Только для `status='scored'`. Чужой → 404. |

### Кабинет (SP-4)

Все требуют session-cookie auth.

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/me` | Профиль текущего пользователя (без `passwordHash` — стрипается через `userPublic()`). 401 анону. |
| PATCH | `/api/me` | Partial update `{email?, displayName?, kaggleId?}`. Валидация: email RFC-ish + ≤254 chars; displayName 1-80; kaggleId regex `^[a-z0-9-]+$` или null. UNIQUE collision → 400. |
| POST | `/api/me/password` | `{currentPassword, newPassword}`. Verify old via bcrypt; новый 8-256 chars; неверный current → 400. |
| GET | `/api/me/competitions` | Соревнования где user — member. Для `type='native'` добавляет `totalPoints` + `place` из `buildNativeLeaderboard(slug, 'public')`. Скрывает soft-deleted. |
| GET | `/api/me/submissions[?limit=N&offset=N]` | Плоский список всех сабмитов user'а с `taskSlug, taskTitle, competitionSlug, selected`. Лимит clamp [1, 200], offset ≥ 0. Скрывает сабмиты для soft-deleted задач/соревнований. |

### Membership (SP-4)

| Method | Path | Auth | Что |
| --- | --- | --- | --- |
| POST | `/api/competitions/<slug>/join` | required | `{joined: true, alreadyMember: bool}`. Idempotent (INSERT OR IGNORE). 404 для удалённого/несуществующего соревнования. |
| DELETE | `/api/competitions/<slug>/members/me` | required | `{left: true}`. Idempotent (повторный вызов всё равно 200). |
| GET | `/api/competitions/<slug>/membership` | optional | `{isMember: bool, joinedAt: ISO|null}`. Анону отдаёт `{isMember: false, joinedAt: null}` (не 401). 404 для удалённого/несуществующего. |

### Native leaderboard deltas (SP-4)

`GET /api/competitions/<slug>/leaderboard` для `type='native'` возвращает на каждой строке `previousTotalPoints`, и `tasks[].previousPoints`/`byTask.<slug>.entries[].previousPoints`. Значения вычисляются через in-memory snapshot per competition (`scoring/snapshotCache.js`); snapshot обновляется ТОЛЬКО воркером после каждого scored сабмита через `setOnScoredCallback`. Endpoint только READS из cache (cold-start строит on-demand с deltas=null). После рестарта процесса первая выборка вернёт `previousPoints=null` пока не сработает следующий worker tick — by design.

### Admin submissions

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/admin/competitions/<slug>/native-tasks/<task>/submissions[?status=...]` | Все сабмиты задачи |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/submissions/<id>` | Удаляет row + файл с диска |
| POST | `/api/admin/competitions/<slug>/native-tasks/<task>/submissions/<id>/rescore` | Сбрасывает в pending; воркер пересчитает |
| POST | `/api/admin/competitions/<slug>/native-tasks/<task>/submissions/rescore-all` | Сбрасывает все scored+failed в pending |

### Бонусные баллы

| Method | Path | Что |
| --- | --- | --- |
| PUT | `/api/admin/competitions/<slug>/overall-show-bonus` | Body `{show: bool}` — toggle отображения бонусов на общем LB. Пишется в `state.json:overallShowBonusPoints`. |
| PUT | `/api/admin/competitions/<slug>/members/<userId>/bonus-points` | **Native:** Body `{bonusPoints: number}`. Создаёт row в `competition_members` если отсутствует. |
| GET | `/api/admin/competitions/<slug>/members-bonus` | **Native:** `{members: [{userId, email, displayName, kaggleId, bonusPoints}]}` — все members + бонус. |

Для kaggle бонусы редактируются через существующий `PUT /api/admin/competitions/<slug>/participants` — каждая запись принимает `bonusPoints: number` (опц.).

Per-board toggle (kaggle): каждый объект в `boards.json` имеет поле `showBonusPoints: bool` (default false). Редактируется через `PUT /api/admin/competitions/<slug>/boards`.

`/api/competitions/<slug>/leaderboard` ответ: 
- В корне поле `overallShowBonusPoints: bool` (отражает state).
- Каждая строка в `overall`/`oursOverall`/`privateOverall`/`oursPrivateOverall`/`groupsResults[*]` несёт `bonusPoints: number` (всегда, default 0).
- Когда `overallShowBonusPoints=true`: `totalPoints` уже включает бонус, place пересчитан, deltas (`previousTotalPoints`) тоже включают бонус.

`/api/competitions/<slug>/boards` ответ: каждый board несёт `showBonusPoints: bool`. Per-board сумма + ре-сортировка с бонусом — на стороне фронта (frontend читает `bonusPoints` с overall rows и складывает локально).

### Scoring worker

In-process `setInterval(WORKER_TICK_MS)` забирает следующий `pending` сабмит, спавнит `python3 score.py sub.csv gt.csv` (timeout `SCORING_TIMEOUT_MS`), парсит метрику из последней строки stdout, нормализует через scoring anchors → `points_public` (и опционально `points_private`). Status machine: `pending → scoring → scored | failed`. Stale-recovery (>15 мин в `scoring`) + retry budget (3 attempts).

**Type-lock.** `PUT /api/admin/competitions` (bulk replace) выбрасывает 400 при попытке сменить `type` существующего соревнования. `POST /api/admin/competitions` принимает `{competition: {..., visibility: 'public'\|'unlisted'}}`.

## Файлы данных

```
data/
  app.db                        # SQLite: users, sessions, competitions, competition_members, native_tasks, native_task_files
  competitions/<slug>/
    tasks.json
    boards.json
    participants.json
    state.json                  # currentParticipantId (для /obs/card)
  private/<slug>/<task>.csv     # выгрузки приватного ЛБ (kaggle)
  native/<comp-slug>/<task-slug>/
    dataset/<file-id>-<safe-name>      # датасеты
    artifact/<file-id>-<safe-name>     # стартовые артефакты
    grader.<ext>                       # admin-uploaded score.py (приватный)
    ground_truth.<ext>                 # ground-truth для скоринга (приватный)
  _legacy-backup-<ts>/          # snapshot пред-миграционных файлов
```

При первом старте: (1) legacy `data/{tasks,boards,participants}.json` (если есть) переносятся в `data/competitions/neoai-2026/`; (2) `data/competitions.json` (если есть) переносится в таблицу `competitions` с `type='kaggle'` и удаляется (бэкап в `_legacy-backup-<ISO-ts>/`). Источник правды для индекса соревнований — `app.db`. `tasks.json` / `boards.json` / `participants.json` / private CSV остаются на диске под каждым `<slug>/`. Native-соревнования не имеют этих файлов и не идут в Kaggle-refresh.

**Mount в docker-compose** — целиком директория `./backend/data:/app/data` (не отдельные файлы), чтобы `fs.rename` работал во время миграции.

## Score anchors (baseline / author)

У каждой задачи 4 опциональных поля скоров в `tasks.json`: `baselineScorePublic`, `authorScorePublic`, `baselineScorePrivate`, `authorScorePrivate`. Задаются вручную в админке `/admin/competitions/<slug>/tasks`.

Если оба заполнены и различаются — задача нормализуется по якорям (см. `normalizeWithAnchors`). Иначе — по rank=1/last.

Pseudo-rows в Kaggle leaderboard CSV (Rank=0 с именем команды, содержащим `baseline`/`author`) **отбрасываются** при парсинге, чтобы не попадали в участников. Их скор для нормализации не используется.

## ENV-переменные backend

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `PORT` | `3001` | Порт |
| `REFRESH_MS` | `60000` | Интервал sweep'а всех соревнований |
| `REQUEST_GAP_MS` | `3000` | Пауза между Kaggle-запросами |
| `KAGGLE_CMD` | `kaggle` | Бинарь Kaggle CLI |
| `DATA_DIR` | `./data` | Корень data |
| `ADMIN_TOKEN` | (пусто) | Legacy shared token; fallback к session-cookie auth (`x-admin-token` header). Депрекейтнут после SP-4. |
| `DB_FILE` | `./data/app.db` | Путь к SQLite (identity, индекс соревнований) |
| `SESSION_TTL_DAYS` | `30` | TTL session cookie |
| `COOKIE_SECURE` | `auto` | `true` / `false` / `auto` (по `req.protocol` + `x-forwarded-proto`) |
| `ADMIN_BOOTSTRAP_EMAIL` | (пусто) | При первом старте создаст админа если ни одного нет (идемпотентно). Если юзер с таким email уже есть — повышает его до admin. |
| `NATIVE_DATA_DIR` | `./data/native` | Корень для файлов native задач |
| `MAX_DATASET_BYTES` | `524288000` | Лимит upload датасета (~500 MB) |
| `MAX_ARTIFACT_BYTES` | `26214400` | Лимит artifact (~25 MB) |
| `MAX_GRADER_BYTES` | `102400` | Лимит `score.py` (100 KB) |
| `MAX_GROUND_TRUTH_BYTES` | `524288000` | Лимит ground-truth |
| `ADMIN_BOOTSTRAP_PASSWORD` | (пусто) | Пара к `ADMIN_BOOTSTRAP_EMAIL` |
