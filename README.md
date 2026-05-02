# NEOAI Live Leaderboard

React + Node.js — real-time leaderboard для нескольких Kaggle-соревнований с OBS-overlay'ями.

## Что делает

- Каждые 30 секунд тянет публичный ЛБ каждой задачи через Kaggle CLI.
- Нормализует баллы внутри каждой задачи: `points = (score - last_score) / (top1_score - last_score) * 100`.
- Общий балл команды = сумма нормализованных баллов по всем задачам.
- Frontend поллит backend каждые 30с, рисует и таблицы для админа, и OBS-оверлеи.

---

## Структура

```
new_lb/
├── backend/         # Node.js + Express, забирает данные с Kaggle, отдаёт JSON-API
│   ├── data/tasks.json
│   ├── src/
│   │   ├── index.js        # http-сервер, refresh loop
│   │   ├── kaggle.js       # вызов kaggle CLI, парсинг CSV
│   │   └── leaderboard.js  # нормализация + сборка overall
│   └── .env
└── frontend/        # React + Vite
    ├── public/fonts/Graphik-*.otf
    └── src/
        ├── App.jsx         # роуты + страницы основного фронта
        ├── ObsView.jsx     # правая OBS-панель (top-15)
        ├── ObsBar.jsx      # нижняя ICPC-полоса (top-10, 5×2)
        ├── ObsCycle.jsx    # полноэкранная циклическая страница
        ├── styles.css      # тема основного фронта
        └── obs.css         # тема всех OBS-страниц
```

---

## Настройка

### 1. Kaggle CLI и credentials

Поставь `kaggle` (например, через `nix-shell -p kaggle` или Nix Darwin).

Положи токен:
```bash
mkdir -p ~/.kaggle
# kaggle.json должен содержать {"username":"...","key":"..."}
chmod 600 ~/.kaggle/kaggle.json
```

Один раз на сайте Kaggle прими правила каждого соревнования из `tasks.json` (иначе будет 403).

### 2. Список задач

`backend/data/tasks.json` — массив объектов:

```json
[
  {
    "slug": "task-1",
    "title": "NEOAI Task 1",
    "competition": "neoai-2025-tricy-table-data",
    "higherIsBetter": false
  }
]
```

Поле `higherIsBetter` — fallback на случай, если Kaggle не вернёт rank'и (см. секцию о подсчёте). Обычно используется `true`.

### 3. Зависимости

```bash
cd backend && npm install
cd ../frontend && npm install
```

---

## Локальный запуск (без Docker)

Терминал 1 — backend (порт 3001):
```bash
cd backend
npm run dev
```

Терминал 2 — frontend (порт 5174):
```bash
cd frontend
npm run dev -- --port 5174
```

Открыть админку: http://localhost:5174

---

## Docker

```bash
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend API: http://localhost:3001/api

---

## Роуты frontend

### Основной фронт (с шапкой и навигацией)

| URL | Описание |
|---|---|
| `/` | Общий ЛБ — все участники, все задачи в одной таблице. |
| `/cycle` | Та же таблица, но окно из 15 строк, переключается каждые 20с (1-15 → 16-30 → …). |
| `/group/1` `/group/2` `/group/3` | ЛБ тура (1 тур = задачи 1-3, 2 тур = 4-6, 3 тур = 7-9). Баллы суммируются только по задачам тура. |
| `/task/:slug` | ЛБ конкретной задачи (`task-1`, …, `task-8`). Колонки: Kaggle Rank, Raw Score, NEOAI Points. |

### OBS-оверлеи (без шапки/навигации, прозрачный фон)

Размер OBS browser source — **1920×1080**.

#### Правая панель (top-15, вертикальный список)

| URL | Описание |
|---|---|
| `/obs/overall` | Общий зачёт. |
| `/obs/group/1` `/obs/group/2` `/obs/group/3` | Топ-15 в туре. Контекст-плашка «1 ТУР» / «2 ТУР» / «3 ТУР». |
| `/obs/task/:slug` | Топ-15 по задаче. В колонке «Баллы» — сырой Kaggle score. |

#### Нижняя ICPC-полоса (top-10, 5 столбцов × 2 ряда)

| URL | Описание |
|---|---|
| `/obs/bar/group/1` `/obs/bar/group/2` `/obs/bar/group/3` | Полоса 140px у нижнего края. Слева — фиолетовая плашка с днём, справа — 10 ячеек. |

#### Полноэкранный циклический ЛБ

| URL | Описание |
|---|---|
| `/obs/cycle` | На весь экран 1920×1080: NEOAI-шапка + таблица из 15 строк со всеми колонками задач. Каждые 20с следующая пачка. |

### Подсветка «новый в топе»

Для `/obs/overall|group|task` и `/obs/bar/group/*`: при появлении нового участника в видимом топе строка/ячейка подсвечивается фиолетовым на **5 секунд** + акцентная полоска (слева для панели, сверху для бара).

---

## Backend API (порт 3001)

| Метод | URL | Что |
|---|---|---|
| `GET` | `/api/health` | Статус, время последнего refresh, ошибки. |
| `GET` | `/api/tasks` | Список задач из `tasks.json`. |
| `GET` | `/api/leaderboard` | Полный пакет: `tasks`, `overall` (с per-task points для каждой команды), `updatedAt`. |
| `GET` | `/api/tasks/:slug` | ЛБ одной задачи (Kaggle rank, raw score, NEOAI points). |
| `POST` | `/api/refresh` | Принудительно обновить кэш из Kaggle. |

Принудительный refresh:
```bash
curl -X POST http://localhost:3001/api/refresh
```

---

## Как считаются баллы

### Внутри одной задачи

1. С Kaggle забирается публичный ЛБ. У каждой строки `rank` и `score` (сырой по метрике задачи).
2. Оставляем только строки с `rank > 0` (отсекает baseline).
3. Якоря — **по rank**, не по score:
   - `top_score` = score у строки с `rank = 1` (победитель).
   - `last_score` = score у строки с максимальным rank.
4. Формула:
   ```
   points = (score - last_score) / (top_score - last_score) * 100
   ```
   - Победитель ⇒ 100.
   - Последний ⇒ 0.
   - Все остальные — линейная интерполяция по сырому score.
5. Если `top_score == last_score` — у всех 100.

**Важно:** направление метрики (`higherIsBetter`) в этой ветке **не используется** — Kaggle сам ранжирует, у победителя rank=1 при любой метрике. `higherIsBetter` в `tasks.json` — это fallback, если Kaggle вдруг вернёт строки без rank'ов. На практике почти не срабатывает.

### Итоговые ЛБ

- **Общий рейтинг**: для каждой команды суммируются `points` по всем задачам. Нет команды в задаче — её вклад там 0.
- **Тур** (1/2/3): то же, но только по задачам тура. Считается на фронте поверх `overall`.

### Ключ участника

`participantKey` = первый ник из `teamMemberUserNames` Kaggle (ник лидера команды). Если ника нет — `team-<teamId>` или имя команды. По нему склеиваются строки одной команды между задачами.

---

## Интервалы и константы

| Что | Где | Значение |
|---|---|---|
| Backend → Kaggle | `backend/.env` `REFRESH_MS` | 30 000 мс |
| Frontend → backend | `frontend/src/{App,ObsView,ObsBar,ObsCycle}.jsx` `REFRESH_MS` | 30 000 мс |
| Циклическая пагинация | `CyclingOverallPage` / `ObsCycle` `PAGE_MS` | 20 000 мс |
| Подсветка «новый в топе» | `ObsView` / `ObsBar` `HIGHLIGHT_MS` | 5 000 мс |
| Top-N для OBS-панели | `ObsView` `TOP_N` | 15 |
| Top-N для OBS-бара | `ObsBar` `TOP_N` | 10 |

⚠️ **Kaggle rate-limit:** ~30 запросов/мин на аккаунт. При 8 задачах × 30с = 16 запросов/мин — вмещается. Если уменьшать интервал ниже 20с при ≥8 задачах — будет упираться в лимит и прилетит 429.

---

## Группы (туры)

Жёстко заданы в `frontend/src/App.jsx`:

```js
const GROUPS = {
  '1': { title: '1 тур', slugs: ['task-1', 'task-2', 'task-3'] },
  '2': { title: '2 тур', slugs: ['task-4', 'task-5', 'task-6'] },
  '3': { title: '3 тур', slugs: ['task-7', 'task-8', 'task-9'] },
};
```

Если в `tasks.json` нет какой-то задачи — она просто не попадает в выборку, без падений.

---

## OBS Browser Source — настройка

Для каждой нужной страницы в OBS:

1. **Sources → +** → **Browser**.
2. **URL:** соответствующий URL из таблицы выше (например `http://localhost:5174/obs/bar/group/1`).
3. **Width:** 1920, **Height:** 1080.
4. **Custom CSS:** оставь пустым — фон уже прозрачный.
5. **Refresh browser when scene becomes active** — на свой вкус, не обязательно.

Поверх можно подложить любую сцену — оверлей без фона.
