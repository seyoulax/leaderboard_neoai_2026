# Routes

Все фронт-маршруты обслуживает SPA. API живёт под `/api/*`.

## Multi-tenant

Главная `/` — список соревнований. Каждое соревнование живёт под `/competitions/<slug>/...` со своим набором задач/бордов/участников.

## Публичные страницы

| URL | Что |
| --- | --- |
| `/` | Список видимых соревнований |
| `/competitions/<slug>` | Редирект на `leaderboard` |
| `/competitions/<slug>/leaderboard` | Общий ЛБ |
| `/competitions/<slug>/cycle` | Циклическая показ по 15 строк |
| `/competitions/<slug>/board/<b>` | Лидерборд борда |
| `/competitions/<slug>/task/<t>` | Лидерборд задачи |

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
| `/admin` | Логин |
| `/admin/competitions` | CRUD соревнований |
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
| GET | `/api/competitions` | Видимые соревнования |

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

### Админ (заголовок `x-admin-token`)

| Method | Path | Что |
| --- | --- | --- |
| GET/PUT | `/api/admin/competitions` | Список / replace всего индекса |
| POST | `/api/admin/competitions` | Создать одно (`{competition: {...}}`); создаёт пустую директорию |
| DELETE | `/api/admin/competitions/<slug>` | Soft-delete: директория переименовывается в `<slug>.deleted-<ts>/` |
| GET/PUT | `/api/admin/competitions/<slug>/tasks` | Tasks scoped |
| GET/PUT | `/api/admin/competitions/<slug>/boards` | Boards scoped |
| GET/PUT | `/api/admin/competitions/<slug>/participants` | Participants — bulk replace через JSON |
| GET/PUT/DELETE | `/api/admin/competitions/<slug>/tasks/<t>/private` | Private CSV (поддерживает Kaggle all-submissions и legacy `kaggle_id,raw_score`) |

JSON body limit для админских PUT — **50 MB** (нужно для больших Kaggle all-submissions CSV).

## Файлы данных

```
data/
  competitions.json             # индекс соревнований
  competitions/<slug>/
    tasks.json
    boards.json
    participants.json
    state.json                  # currentParticipantId (для /obs/card)
  private/<slug>/<task>.csv     # выгрузки приватного ЛБ
  _legacy-backup-<ts>/          # snapshot пред-миграционных файлов
```

При первом старте бэка после раскатки multi-tenant: если есть legacy `data/{tasks,boards,participants}.json` — миграция автоматически перенесёт их в `data/competitions/neoai-2026/` и создаст `competitions.json` с одной записью. Snapshot пред-миграционных файлов — в `_legacy-backup-<ISO-ts>/`.

**Mount в docker-compose** — целиком директория `./backend/data:/app/data` (не отдельные файлы), чтобы `fs.rename` работал во время миграции.

## Score anchors (baseline / author)

У каждой задачи 4 опциональных поля скоров: `baselineScorePublic`, `authorScorePublic`, `baselineScorePrivate`, `authorScorePrivate`. Источники (в порядке приоритета):

1. **Auto-extract из Kaggle CSV.** При refresh бэк ищет в leaderboard CSV строки с `Rank=0`, чьё имя команды содержит `baseline` или `author` (case-insensitive), и подставляет их score в соответствующие поля. Для приватного — то же самое в private CSV (через `extractPrivateAnchors`).
2. **Fallback к admin-полям.** Если auto-extract вернул `null` (анкер не найден в CSV), берётся значение из `tasks.json`, заданное в админке.
3. **Если оба null** — задача нормализуется без якорей (по rank=1/last).

## ENV-переменные backend

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `PORT` | `3001` | Порт |
| `REFRESH_MS` | `60000` | Интервал sweep'а всех соревнований |
| `REQUEST_GAP_MS` | `3000` | Пауза между Kaggle-запросами |
| `KAGGLE_CMD` | `kaggle` | Бинарь Kaggle CLI |
| `DATA_DIR` | `./data` | Корень data |
| `ADMIN_TOKEN` | (пусто) | Токен админки |
