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
| GET | `/api/competitions` | Видимые соревнования (поля: `slug`, `title`, `subtitle`, `type: 'kaggle' \| 'native'`, `visible`, `displayOrder`) |

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
| GET | `/api/competitions/<slug>/leaderboard` |
| GET | `/api/competitions/<slug>/tasks/<t>` |
| GET | `/api/competitions/<slug>/boards` |
| GET | `/api/competitions/<slug>/participants` |
| POST | `/api/competitions/<slug>/refresh` |
| GET | `/api/competitions/<slug>/card` |
| POST | `/api/competitions/<slug>/card` |

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

## Файлы данных

```
data/
  app.db                        # SQLite: users, sessions, competitions, competition_members
  competitions/<slug>/
    tasks.json
    boards.json
    participants.json
    state.json                  # currentParticipantId (для /obs/card)
  private/<slug>/<task>.csv     # выгрузки приватного ЛБ
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
| `ADMIN_BOOTSTRAP_PASSWORD` | (пусто) | Пара к `ADMIN_BOOTSTRAP_EMAIL` |
