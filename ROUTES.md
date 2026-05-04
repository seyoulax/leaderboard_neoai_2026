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
| `/competitions/<slug>/leaderboard` | Общий ЛБ |
| `/competitions/<slug>/cycle` | Циклическая показ по 15 строк (по прямому URL, без таба в навигации) |
| `/competitions/<slug>/board/<b>` | Лидерборд борда |
| `/competitions/<slug>/task/<t>` | Лидерборд задачи |

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
| `/admin/competitions` | CRUD соревнований (поле `type: kaggle | native` — radio при создании, колонка в таблице) |
| `/admin/competitions/<slug>` | Редирект на `tasks` |
| `/admin/competitions/<slug>/tasks` | CRUD задач (scoped) |
| `/admin/competitions/<slug>/boards` | CRUD бордов (scoped) |
| `/admin/competitions/<slug>/participants` | JSON paste/upload |
| `/admin/competitions/<slug>/card` | OBS-карточка (scoped) |

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
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth` | То же для `ground_truth_path`. Лимит: `MAX_GROUND_TRUTH_BYTES`. |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth` | То же |

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
