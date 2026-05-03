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

| Method | Path |
| --- | --- |
| GET/PUT | `/api/admin/competitions` |
| POST | `/api/admin/competitions` |
| DELETE | `/api/admin/competitions/<slug>` |
| GET/PUT | `/api/admin/competitions/<slug>/tasks` |
| GET/PUT | `/api/admin/competitions/<slug>/boards` |
| GET/PUT | `/api/admin/competitions/<slug>/participants` |
| GET/PUT/DELETE | `/api/admin/competitions/<slug>/tasks/<t>/private` |

## Файлы данных

```
data/
  competitions.json             # индекс
  competitions/<slug>/
    tasks.json
    boards.json
    participants.json
    state.json                  # currentParticipantId
  private/<slug>/<task>.csv
```

## ENV-переменные backend

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `PORT` | `3001` | Порт |
| `REFRESH_MS` | `60000` | Интервал sweep'а всех соревнований |
| `REQUEST_GAP_MS` | `3000` | Пауза между Kaggle-запросами |
| `KAGGLE_CMD` | `kaggle` | Бинарь Kaggle CLI |
| `DATA_DIR` | `./data` | Корень data |
| `ADMIN_TOKEN` | (пусто) | Токен админки |
