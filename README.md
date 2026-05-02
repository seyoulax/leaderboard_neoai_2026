# NEOAI Live Leaderboard

React + Express лидерборд для Kaggle-соревнований NEOAI с админкой, конфигурируемыми бордами и OBS-оверлеями.

## Что внутри

- **Backend** (Node 20 + Express) — раз в `REFRESH_MS` тянет публичный лидерборд каждой задачи через Kaggle CLI, нормализует баллы и кеширует.
- **Frontend** (React 18 + Vite) — публичные таблицы, OBS-оверлеи и админка с авторизацией по паролю.
- **CI/CD** — GitHub Actions: push в `main` → сборка двух образов в GHCR → SSH на прод → `docker compose pull && up -d`.

Полный список роутов и API — см. [`ROUTES.md`](./ROUTES.md).

## Логика подсчёта баллов

Для каждой задачи:
- Если в `tasks.json` заданы `baselineScore` и `authorScore` — используется явная нормализация:
  `points = max(0, (score - baseline) / (author - baseline) * 100)`.
  Направление (higher/lower is better) определяется тем, что больше: `author` или `baseline`.
- Иначе — фолбэк: `points = (score - last) / (top - last) * 100`, с учётом `higherIsBetter`.

Общий балл = сумма `points` по всем задачам. Борды (`boards.json`) — суммы по подмножеству задач.

Сравнение со снапшотом предыдущего рефреша подсвечивает строки в зелёный/красный (`▲`/`▼`).

## Структура

```
new_lb/
├── backend/                       # Express + Kaggle CLI
│   ├── data/
│   │   ├── tasks.json             # задачи (slug, title, competition, baseline/author)
│   │   ├── boards.json            # лидерборды (выборки задач)
│   │   └── participants.json      # участники для OBS-карточки
│   └── src/
│       ├── index.js               # HTTP, валидация, admin-эндпоинты, refresh loop
│       ├── kaggle.js              # exec kaggle CLI, парс CSV
│       └── leaderboard.js         # нормализация баллов + сумма
├── frontend/                      # React + Vite SPA
│   └── src/
│       ├── App.jsx                # роуты, публичные/админ-страницы
│       ├── ObsView.jsx            # OBS top-15 строки
│       ├── ObsBar.jsx             # OBS «бар» с per-task chip'ами
│       └── ObsCard.jsx            # OBS-карточка участника
├── docker-compose.yml             # для локальной разработки
├── docker-compose.host.yml        # на хосте, с локальной сборкой образов
├── docker-compose.prod.yml        # на хосте, с pull из GHCR (используется CI)
├── deploy/
│   ├── nginx-site.conf            # хостовый nginx (split: stackmorelayers + neoai-lb)
│   └── stackmorelayers/           # статическая «главная» сайта на /
├── .github/workflows/deploy.yml   # CI/CD
├── ROUTES.md                      # все маршруты и API
└── README.md
```

## Локальная разработка

```bash
# backend
cd backend
cp .env.example .env   # заполни ADMIN_TOKEN, при желании REFRESH_MS
npm install
npm run dev            # http://localhost:3001

# frontend (в другом терминале)
cd frontend
npm install
npm run dev            # http://localhost:5173, проксирует API через VITE_API_BASE
```

Нужен установленный `kaggle` CLI (`pip install kaggle`) и валидные `~/.kaggle/kaggle.json` + `~/.kaggle/access_token` (если ключ в формате `KGAT_...`).

## Деплой

Прод-хост: `81.26.188.109` (`student-dash`), приложение в `/home/student-dash/neoai-lb`. Системный nginx ставит stackmorelayers на `/`, остальное проксирует:
- `/` → статический `/home/student-dash/StackMoreLayers/2026.html`
- `/api/*` → backend-контейнер (`127.0.0.1:3001`)
- всё остальное → frontend-контейнер (`127.0.0.1:8080`)

Конфиг nginx — в [`deploy/nginx-site.conf`](./deploy/nginx-site.conf).

### Через CI

Push в `main` → workflow `.github/workflows/deploy.yml`:
1. Параллельно собирает backend/frontend образы и пушит в `ghcr.io/seyoulax/leaderboard_neoai_2026-{backend,frontend}:latest`.
2. SCP'ит `docker-compose.prod.yml` и `deploy/stackmorelayers/*` на хост.
3. SSH: `docker login ghcr.io && docker compose pull && docker compose up -d`.

GitHub-секреты:
- `SSH_HOST`, `SSH_USER`, `DEPLOY_PATH`, `SSH_KEY` (passphrase-less).

### Вручную (bootstrap или если CI лежит)

```bash
# с локальной сборкой образов на хосте (без GHCR)
rsync -az --exclude node_modules --exclude .env --exclude .git ./ host:/home/student-dash/neoai-lb/
ssh host
cd /home/student-dash/neoai-lb
docker compose -f docker-compose.host.yml up -d --build
```

## Файлы данных на хосте

| Контейнерный путь | Хост (prod) | Что |
| --- | --- | --- |
| `/app/data/tasks.json` | `/home/student-dash/neoai-lb/backend/data/tasks.json` | Задачи |
| `/app/data/boards.json` | `/home/student-dash/neoai-lb/backend/data/boards.json` | Борды |
| `/app/data/participants.json` | `/home/student-dash/neoai-lb/backend/data/participants.json` | Участники |
| `/root/.kaggle/` | `/home/student-dash/.kaggle/` | `kaggle.json` + `access_token` |

`tasks.json`/`boards.json` редактируются через админку (`/admin/tasks`, `/admin/boards`). После сохранения backend кикает рефреш Kaggle.

## Backend ENV

| Переменная | Дефолт | |
| --- | --- | --- |
| `PORT` | `3001` | |
| `REFRESH_MS` | `60000` | Интервал между refresh-циклами |
| `REQUEST_GAP_MS` | `3000` | Пауза между задачами внутри цикла (защита от 429) |
| `KAGGLE_CMD` | `kaggle` | Имя бинаря |
| `TASKS_FILE` / `BOARDS_FILE` / `PARTICIPANTS_FILE` | `./data/*.json` | |
| `ADMIN_TOKEN` | (пусто) | Пароль админки. Пусто → `503 admin disabled`. |

## Тушение / откат

Откатиться на старую версию: на хосте — `docker compose pull` после правки тэга в `docker-compose.prod.yml` на конкретный SHA, либо `docker tag ghcr.io/...:<sha> ...:latest && docker compose up -d`.

Остановить целиком: `cd /home/student-dash/neoai-lb && docker compose -f docker-compose.prod.yml down`.

Если упёрлись в Kaggle 429 — поднять `REFRESH_MS` в `backend/.env`, `docker compose restart backend`. Подробнее про rate-limit — Kaggle режет по rolling-window около часа.
