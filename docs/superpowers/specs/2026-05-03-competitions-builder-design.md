# Competitions Builder — Design

**Status:** Approved
**Date:** 2026-05-03

## Цель

Превратить лидерборд из single-tenant (захардкоженный NEOAI 2026) в мульти-тенант: в админке появляется CRUD соревнований, у каждого свой набор задач/бордов/участников, свои публичные страницы и OBS-оверлеи. Главная `/` — список соревнований, внутри — текущий UX.

Подход — **big-bang refactor**: новые маршруты сразу canonical, старые URL временно редиректят на `neoai-2026` для обратной совместимости OBS-сцен и закладок.

## Модель данных

### Файловая раскладка

```
data/
  competitions.json                       # индекс: список метаданных
  competitions/
    neoai-2026/
      tasks.json
      boards.json
      participants.json
      state.json                          # currentParticipantId (для /obs/card)
    <slug>/
      …
  private/
    <competition-slug>/
      <task-slug>.csv
  _legacy-backup-<timestamp>/             # снапшот пред-миграционных файлов (создаётся при миграции)
```

### Сущность Competition (в `competitions.json`)

```json
{
  "slug": "neoai-2026",
  "title": "NEOAI 2026",
  "subtitle": "Northern Eurasia Olympiad in Artificial Intelligence 2026",
  "order": 0,
  "visible": true
}
```

| Поле | Обяз. | Валидация |
| --- | --- | --- |
| `slug` | ✓ | `^[a-z0-9][a-z0-9-]*$`, 1-64, уникальный, не из deny-list (`admin`, `obs`, `competitions`) |
| `title` | ✓ | 1-200 символов |
| `subtitle` | — | ≤500 символов |
| `order` | — | число, дефолт 0 |
| `visible` | — | bool, дефолт `true`. Скрытые не появляются на `/` и в `/api/competitions`, но доступны по прямой ссылке |

`tasks.json`/`boards.json`/`participants.json` внутри директории соревнования имеют ту же структуру, что и сейчас.

## Миграция (one-time bootstrap)

При старте бэка:

1. Читаем `data/competitions.json`. Если есть — идём дальше, миграция пропускается.
2. Если нет — проверяем легаси-файлы `data/{tasks,boards,participants}.json`.
3. Если легаси есть — выполняем атомарно:
   - Создаём snapshot `data/_legacy-backup-<ISO-ts>/` (cp всех легаси-файлов).
   - `mkdir data/competitions/neoai-2026/`.
   - `mv data/{tasks,boards,participants}.json → data/competitions/neoai-2026/`.
   - Перемещаем `data/private/*.csv` → `data/private/neoai-2026/*.csv`.
   - Записываем `data/competitions.json` через write-temp + rename:
     ```json
     [{"slug":"neoai-2026","title":"NEOAI 2026","subtitle":"Northern Eurasia Olympiad in Artificial Intelligence 2026","order":0,"visible":true}]
     ```
4. Если миграция упала на полпути — логгируем, бэк стартует с пустым индексом, в `/api/health.errors` пишется `migration failed: <reason>`. Восстановление руками из `_legacy-backup-*`.
5. Если ни `competitions.json`, ни легаси нет — стартуем с пустым индексом.

Slug `neoai-2026` захардкожен в миграционном коде (без env-флагов).

## API Surface

Все scoped-эндпоинты под `/api/competitions/<slug>/`. Глобальные:

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/health` | `{ updatedAt, isRefreshing, competitions: [{slug, updatedAt, errors}] }` |
| GET | `/api/competitions` | Публичный список (только `visible:true`) |

### Per-competition (публично)

| Method | Path |
| --- | --- |
| GET | `/api/competitions/<slug>` (мета) |
| GET | `/api/competitions/<slug>/leaderboard` |
| GET | `/api/competitions/<slug>/tasks/<task>` |
| GET | `/api/competitions/<slug>/boards` |
| GET | `/api/competitions/<slug>/participants` |
| POST | `/api/competitions/<slug>/refresh` |
| GET | `/api/competitions/<slug>/card` |
| POST | `/api/competitions/<slug>/card` |

### Админ (заголовок `x-admin-token`)

| Method | Path |
| --- | --- |
| GET | `/api/admin/competitions` (все, включая скрытые) |
| PUT | `/api/admin/competitions` (replace индекса; валидация) |
| POST | `/api/admin/competitions` (создать одно: `{slug, title, …}` + создаёт пустую директорию) |
| DELETE | `/api/admin/competitions/<slug>` (убирает из индекса; директорию переименовывает в `<slug>.deleted-<ts>/`) |
| GET/PUT | `/api/admin/competitions/<slug>/tasks` |
| GET/PUT | `/api/admin/competitions/<slug>/boards` |
| GET/PUT | `/api/admin/competitions/<slug>/participants` (PUT принимает `{participants: [...]}` — bulk replace) |
| GET/PUT/DELETE | `/api/admin/competitions/<slug>/tasks/<task>/private` |

### Поведение для несуществующего `<slug>`

`404 { error: "Competition '<slug>' not found" }`.

## Frontend Routes

### Публичные

| URL | Страница |
| --- | --- |
| `/` | `CompetitionsListPage` — карточки видимых соревнований |
| `/competitions/<slug>` | редирект на `/competitions/<slug>/leaderboard` |
| `/competitions/<slug>/leaderboard` | бывший `OverallPage` |
| `/competitions/<slug>/cycle` | бывший `CyclingOverallPage` |
| `/competitions/<slug>/board/<b>` | бывший `BoardPage` |
| `/competitions/<slug>/task/<t>` | бывший `TaskPage` |

### OBS

| URL |
| --- |
| `/obs/competitions/<slug>/overall` |
| `/obs/competitions/<slug>/cycle` |
| `/obs/competitions/<slug>/board/<b>` |
| `/obs/competitions/<slug>/bar/board/<b>` |
| `/obs/competitions/<slug>/task/<t>` |
| `/obs/competitions/<slug>/card` |

### Админ

| URL | Что |
| --- | --- |
| `/admin` | Login |
| `/admin/competitions` | Список + CRUD |
| `/admin/competitions/<slug>` | Редирект на `/admin/competitions/<slug>/tasks` |
| `/admin/competitions/<slug>/tasks` | scoped CRUD задач |
| `/admin/competitions/<slug>/boards` | scoped CRUD бордов |
| `/admin/competitions/<slug>/participants` | **новое** — JSON paste/upload |
| `/admin/competitions/<slug>/card` | scoped выбор активной карточки |

### Layouts

- `RootLayout` — для `/`. Без табов, шапка + карточки.
- `CompetitionLayout` — для `/competitions/<slug>/*`. Текущий `Layout` с табами «Общий ЛБ», «По 15», борды, задачи (всё scoped). Сверху breadcrumb «← все соревнования».
- `AdminCompetitionsLayout` — список соревнований сверху/слева, выбранное → таб-бар (Tasks/Boards/Participants/Card).

### Legacy URL redirects

Старые маршруты редиректят на новые с подставленным `neoai-2026`:

| Старый | Новый |
| --- | --- |
| `/cycle` | `/competitions/neoai-2026/cycle` |
| `/board/<s>` | `/competitions/neoai-2026/board/<s>` |
| `/task/<s>` | `/competitions/neoai-2026/task/<s>` |
| `/control` | `/admin/competitions/neoai-2026/card` |
| `/admin/tasks` | `/admin/competitions/neoai-2026/tasks` |
| `/admin/boards` | `/admin/competitions/neoai-2026/boards` |
| `/admin/card` | `/admin/competitions/neoai-2026/card` |
| `/obs/overall` | `/obs/competitions/neoai-2026/overall` |
| `/obs/cycle` | `/obs/competitions/neoai-2026/cycle` |
| `/obs/board/<s>` | `/obs/competitions/neoai-2026/board/<s>` |
| `/obs/bar/board/<s>` | `/obs/competitions/neoai-2026/bar/board/<s>` |
| `/obs/task/<s>` | `/obs/competitions/neoai-2026/task/<s>` |
| `/obs/card` | `/obs/competitions/neoai-2026/card` |

`/` — это новая `CompetitionsListPage`. Старая закладка `/` показывала NEOAI-overall, теперь покажет список (одним пунктом — NEOAI), один клик — в привычный ЛБ. Это сознательный compromise: ради чистоты `/` как списка миримся с одним лишним кликом для пользователей, у кого `/` забукмаркен.

Если соревнования `neoai-2026` нет в индексе — старый URL ведёт на `/`.

Редиректы — отдельный коммит после стабилизации, который их удаляет (1-2 недели).

## Admin UX

### `/admin/competitions` — список + CRUD

- Таблица: `slug | title | subtitle | order | visible | actions`. Inline-edit как `/admin/tasks` сейчас, кнопка «Save» сохраняет всё через PUT.
- Сверху форма «+ Новое соревнование» с обязательными `slug` + `title` (POST). Валидация slug на клиенте + сервере.
- Удаление — кнопка `🗑` → confirm-modal → DELETE.
- Клик по slug → `/admin/competitions/<slug>/tasks`.

### `/admin/competitions/<slug>` — внутренний таб-бар

- Sticky-сверху: `Tasks · Boards · Participants · Card` + breadcrumb `Соревнования / NEOAI 2026 /`.
- `Tasks`/`Boards`/`Card` — копии текущих экранов, scoped к этому соревнованию.

### `/admin/competitions/<slug>/participants` — новый экран

- Большая `<textarea>` для JSON-paste с примером в плейсхолдере.
- Превью: количество распознанных записей + первые 3 (или ошибка парсинга).
- Кнопка «Заменить участников» → PUT (bulk replace всего массива).
- `<input type="file" accept=".json">` — читает файл, подставляет в textarea.
- Снизу — read-only таблица текущих участников этого соревнования.
- Single-participant edit на MVP не делаем.

## Backend Refresh Logic

### Cache structure

```
{
  isRefreshing: bool,
  competitionsIndex: [...],            // из competitions.json
  byCompetition: Map<slug, {
    updatedAt, tasks, errors,
    overall, byTask,
    privateOverall, privateByTask, privateTaskSlugs,
    oursOverall, oursByTask, oursPrivateOverall, oursPrivateByTask,
    participants, currentParticipantId,
  }>
}
```

### Refresh sweep

```
function refreshAll():
  if cache.isRefreshing: return        // skip-overlap, log "skip: still refreshing"
  cache.isRefreshing = true
  for each competition in competitionsIndex:
    refreshCompetition(competition)    // serial — для Kaggle rate limit
  cache.isRefreshing = false
```

`refreshCompetition` — текущая логика (kaggle pull + private CSV + buildLeaderboards + ours-вариант), `await sleep(REQUEST_GAP_MS)` между задачами как сейчас.

`setInterval(refreshAll, REFRESH_MS)`. Если sweep дольше REFRESH_MS — следующий тик пропускается.

### Точечный refresh

`POST /api/competitions/<slug>/refresh` запускает `refreshCompetition(slug)` (если общий sweep не идёт). Полезно после загрузки private CSV.

### State per-competition

- `participants` (для `findKaggleStats` и private-CSV) → `cache.byCompetition[slug].participants`. Загружается из `data/competitions/<slug>/participants.json` на каждом тике.
- `currentParticipantId` → `cache.byCompetition[slug].currentParticipantId`. Хранится в `data/competitions/<slug>/state.json`, чтобы переживало рестарт.

### Дельты (▲▼)

`annotateWithDeltas` остаётся per-competition: сравнивает `cache.byCompetition[slug]` с предыдущим значением себя же.

## Edge cases

- **Несуществующий `<slug>`** → 404 на бэке, фронт показывает «Соревнование не найдено» + ссылка на `/`.
- **Удаление активного `<slug>`** (на фронте загружен) → 404, редирект на `/`.
- **Пустой индекс** (`[]`) → `/` показывает «Соревнований пока нет»; OBS-роуты — 404; refresh sweep — no-op.
- **Дубликат slug** при POST/PUT → 400 с конкретным сообщением.
- **Slug-конфликт с deny-list** (`admin`, `obs`, `competitions`) → 400.
- **Удаление competition** с активным `currentParticipantId` → state-файл удаляется вместе с директорией.
- **Повторный bootstrap** (есть `competitions.json` + `_legacy-backup-*`) → миграция пропускается, файлы не трогаются.
- **Concurrency PUT participants ↔ refresh** → допустимо. Refresh читает с диска на тике; в худшем случае одна устаревшая итерация.

## Tests

| Файл | Что проверяет |
| --- | --- |
| `migrate.test.js` | Миграция легаси → competitions/, корректность индекса, идемпотентность повторного запуска, snapshot создан |
| `validateCompetitions.test.js` | slug pattern, deny-list, дубликаты, обяз. поля, defaults |
| `leaderboard.test.js` | (без изменений) логика нормализации |
| `routing.test.js` | Backend: `GET /api/competitions/<slug>/leaderboard` → 200; `GET /api/competitions/wrong/leaderboard` → 404; `GET /api/competitions` отдаёт только `visible:true` |

Фронт без тестов (как и сейчас).

## Out of scope (намеренно отложено)

- Per-competition Kaggle credentials (общий `~/.kaggle/`).
- Single-participant edit в админке (только bulk replace).
- Поля competition: `description`, `startDate`/`endDate`, `bannerImage`. Добавляются по запросу.
- Per-competition admin tokens (общий `ADMIN_TOKEN`).
- Удаление legacy redirect-маршрутов автоматически — это отдельный коммит спустя 1-2 недели.

## Deploy notes

- Деплой через `rsync` (как сейчас) — миграция выполнится при первом старте бэка после rollout. На проде убедиться, что есть права на `mv` в `data/`.
- После успешного деплоя — обновить OBS-сцены на новые URL (`/obs/competitions/neoai-2026/...`). Старые URL продолжают работать через редирект.
- В `_legacy-backup-<ts>/` лежит откат — если всё сломалось, можно остановить бэк, вернуть файлы из бэкапа и удалить `competitions.json`.
