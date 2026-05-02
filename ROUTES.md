# Routes

Все фронт-маршруты обслуживает SPA (`react-router-dom`). API живёт под `/api/*` (в проде проксируется системным nginx → backend-контейнер).

`<slug>` ниже — это slug задачи (из `tasks.json`) или борда (из `boards.json`) в зависимости от контекста.

## Публичные страницы (Layout с навигацией)

| URL | Что показывает | Источник данных |
| --- | --- | --- |
| `/` | Общий лидерборд по всем задачам, сумма баллов | `GET /api/leaderboard` |
| `/cycle` | Тот же общий ЛБ, циклически по 15 строк (для табло) | `GET /api/leaderboard` |
| `/board/<slug>` | Лидерборд по подмножеству задач (борд) | `GET /api/leaderboard` + `GET /api/boards` |
| `/task/<slug>` | Лидерборд одной задачи (отсортирован по Kaggle rank) | `GET /api/tasks/<slug>` |
| `/control` | Редирект → `/admin/card` (для старых закладок) | — |

Вкладки слева направо: «Общий ЛБ», «По 15 (цикл)», далее видимые борды (по `order` ASC), далее все задачи.

## Админка (Layout с отдельной навигацией)

Доступ — пароль (`ADMIN_TOKEN` в `backend/.env`). Токен в браузере хранится в `localStorage[neoai_admin_token]`.

| URL | Что делает |
| --- | --- |
| `/admin` | Логин (если не авторизован — редирект сюда отовсюду) |
| `/admin/tasks` | CRUD задач: slug, title, competition, higherIsBetter, baselineScore, authorScore |
| `/admin/boards` | CRUD лидербордов: slug, title, taskSlugs, visible, order |
| `/admin/card` | Выбор активной карточки участника для OBS (бывший `/control`) |

## OBS-оверлеи (без шапки/навигации, для chroma-key)

Каждый — отдельная страница, оптимизированная для захвата в OBS Browser Source.

| URL | Что показывает |
| --- | --- |
| `/obs/overall` | Общий top-15 текстовыми строками |
| `/obs/cycle` | Общий ЛБ — цикл по 15 строк |
| `/obs/board/<slug>` | Текстовые строки top-15 для одного борда |
| `/obs/bar/board/<slug>` | Тот же борд, но «бар»-визуализация с chip'ами по задачам |
| `/obs/task/<slug>` | Top-15 одной задачи |
| `/obs/card` | Карточка текущего активного участника (выбирается в `/admin/card`) |

## Backend API

### Публичные

| Method | Path | Назначение |
| --- | --- | --- |
| GET | `/api/health` | Статус кеша + последние ошибки рефреша |
| GET | `/api/tasks` | Список задач из `tasks.json` |
| GET | `/api/boards` | Список бордов из `boards.json` |
| GET | `/api/leaderboard` | Общий рейтинг (overall + tasks meta) |
| GET | `/api/tasks/<slug>` | Лидерборд одной задачи |
| POST | `/api/refresh` | Принудительный pull с Kaggle |
| GET | `/api/participants` | Список участников + `currentId` |
| GET | `/api/card` | Текущий участник + его свежие kaggle-stats |
| POST | `/api/card` | Установить активного (`{id}` или `{id: null}`) |

### Админские (заголовок `x-admin-token: <ADMIN_TOKEN>`)

Если `ADMIN_TOKEN` пуст на бэке — все вернут `503 admin disabled`.

| Method | Path | Назначение |
| --- | --- | --- |
| GET | `/api/admin/tasks` | Сырой `tasks.json` |
| PUT | `/api/admin/tasks` | Перезаписать `tasks.json` (тело: `{tasks: [...]}`); после успеха вызывает рефреш кеша |
| GET | `/api/admin/boards` | Сырой `boards.json` |
| PUT | `/api/admin/boards` | Перезаписать `boards.json` (тело: `{boards: [...]}`); валидация: уникальный slug, taskSlugs ⊂ tasks |

## Файлы данных (примонтированы в backend-контейнер)

| Контейнерный путь | Хост (prod) | Что |
| --- | --- | --- |
| `/app/data/tasks.json` | `/opt/neoai-lb/backend/data/tasks.json` | Конфиг задач |
| `/app/data/boards.json` | `/opt/neoai-lb/backend/data/boards.json` | Конфиг бордов |
| `/app/data/participants.json` | `/opt/neoai-lb/backend/data/participants.json` | Список участников + их kaggleId/photo/etc. |
| `/root/.kaggle/` | `/root/.kaggle/` | `kaggle.json` + `access_token` для Kaggle CLI |

## ENV-переменные backend

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `PORT` | `3001` | На каком порту слушать |
| `REFRESH_MS` | `60000` | Интервал между обновлениями с Kaggle |
| `REQUEST_GAP_MS` | `3000` | Пауза между задачами внутри одного refresh-цикла |
| `KAGGLE_CMD` | `kaggle` | Имя бинаря kaggle CLI |
| `TASKS_FILE` | `./data/tasks.json` | Путь к tasks |
| `BOARDS_FILE` | `./data/boards.json` | Путь к boards |
| `PARTICIPANTS_FILE` | `./data/participants.json` | Путь к участникам |
| `ADMIN_TOKEN` | (пусто) | Пароль для `/api/admin/*` (пусто = админка отключена) |
