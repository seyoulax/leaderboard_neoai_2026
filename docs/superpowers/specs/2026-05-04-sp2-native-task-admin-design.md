# SP-2: Native Task Admin — Design

**Status:** Draft
**Date:** 2026-05-04
**Parent project:** «Своя Kaggle» (4 под-проекта; SP-1 «Identity & Data Model» поставлен в main 2026-05-04)
**Roadmap:** `~/.claude/projects/-Users-seyolax-projects-neoai-transa/memory/project_kaggle_platform_roadmap.md`

## Цель и объём

SP-2 — авторская часть платформы: админ может опубликовать нативную задачу с описанием, датасетами, стартовым артефактами и приватным скоринг-скриптом; залогиненный участник видит её и качает starter. **Сабмиты ещё не работают** — их обрабатывает SP-3.

Параллельно вводим `competitions.visibility = 'public' | 'unlisted'` (publicly listed + searchable / link-only) и поиск по каталогу — это нужно прямо сейчас, чтобы было куда складывать новые соревнования.

**Что SP-2 даёт пользователю end-to-end:**
- Главная `/` — каталог `public` соревнований + поиск по `title`. Unlisted соревнования открываются только по прямой ссылке.
- Залогиненный админ создаёт `type: native` соревнование, заводит задачу с описанием (markdown), грузит CSV-датасеты, `.ipynb`/`.py` стартовые файлы, `score.py` и ground-truth.
- Любой залогиненный пользователь, открывший страницу задачи (через каталог или по ссылке), видит описание, список файлов, может скачать датасеты + артефакты по одному или zip-бандлом. `score.py` и ground-truth — никогда не отдаются наружу.
- Существующие kaggle-соревнования (`neoai-2026`) продолжают работать через JSON; их тип в БД — `kaggle`, native-кодовый путь их игнорирует.

**Что НЕ входит в SP-2:**
- Сабмиты предсказаний участниками — SP-3.
- Запуск `score.py` против сабмита, scoring-jobs, очередь, лимиты — SP-3.
- Native-лидерборд с реальными очками (страница есть, но без сабмитов она пустая) — SP-3.
- Личный кабинет, «мои задачи», join-flow, кнопка «Участвовать», режим `private` соревнований — SP-4.
- Загрузка датасетов > 500 МБ (большие файлы — chunked upload, отдельный issue).
- Версионирование задач / датасетов («новый релиз данных» как у Kaggle) — YAGNI.
- Команды (1 user = 1 участник).
- Деприкейт `participants.json` (живёт до SP-3, как и было обещано).

## Архитектурные решения (зафиксированы в брейнсторме)

| Решение | Выбор | Почему |
| --- | --- | --- |
| Visibility | `public` (в каталоге+поиск) или `unlisted` (только по ссылке) | Покрывает весь спектр хакатон-сценариев; `private` — отдельная фича через 1 enum-миграцию + 1 endpoint когда понадобится |
| Гейтинг данных | Доступ к файлам — любой залогиненный, который смог открыть страницу задачи | Реальное членство («Join») появляется в SP-3 (auto-join при первом сабмите); для SP-2 это лишний код без ценности |
| Хранение файлов | На диске + path в БД | BLOB в SQLite ломается на больших датасетах; S3 — overkill |
| Файлы датасета | Один файл = одна строка | Простая модель; «скачать всё zip» — server-side stream без отдельной сущности «релиз» |
| Раскладка таблиц файлов | Единая `native_task_files` с `kind: dataset \| artifact` | DRY, разница access-control сейчас нулевая |
| Описание | Markdown в БД, рендер `react-markdown` + `rehype-sanitize` | XSS-safe, единый формат admin↔public |
| Аплоад | `busboy` стрим на диск + sha256 on the fly + atomic rename | Стандартный паттерн; не грузит файл в память |
| `type` после создания | Не меняется (lock) | Смена ломала бы инварианты по задачам/файлам; admin удаляет и пересоздаёт |

## Schema — миграция `0002_native_tasks.sql`

```sql
-- ───────────────────────────────────────────────────────────
-- Visibility: расширение существующих competitions
ALTER TABLE competitions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'unlisted'));

UPDATE competitions SET visibility = CASE
  WHEN visible = 1 THEN 'public'
  ELSE 'unlisted'
END;

-- Старая колонка `visible` остаётся read-only до SP-4 cleanup'а: фронт перестаёт
-- её писать, бэк перестаёт её читать в новых code paths. Дроп — в SP-4.

CREATE INDEX competitions_listed
  ON competitions (display_order, slug)
  WHERE deleted_at IS NULL AND visibility = 'public';

-- ───────────────────────────────────────────────────────────
-- Native tasks: одна задача внутри native-соревнования
CREATE TABLE native_tasks (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_slug         TEXT NOT NULL REFERENCES competitions(slug) ON DELETE CASCADE,
  slug                     TEXT NOT NULL,
  title                    TEXT NOT NULL,
  description_md           TEXT NOT NULL DEFAULT '',
  higher_is_better         INTEGER NOT NULL DEFAULT 1 CHECK (higher_is_better IN (0, 1)),
  -- scoring anchors (matches existing kaggle task model)
  baseline_score_public    REAL,
  author_score_public      REAL,
  baseline_score_private   REAL,
  author_score_private     REAL,
  -- единичные файлы — путь прямо в строке
  grader_path              TEXT,
  ground_truth_path        TEXT,
  visible                  INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  display_order            INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at               TEXT,
  UNIQUE (competition_slug, slug)
);
CREATE INDEX native_tasks_active
  ON native_tasks (competition_slug, display_order, slug)
  WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────
-- Files: датасеты + стартовые артефакты в одной таблице
CREATE TABLE native_task_files (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER NOT NULL REFERENCES native_tasks(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('dataset', 'artifact')),
  display_name      TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  sha256            TEXT NOT NULL,
  path              TEXT NOT NULL,                 -- абс. путь в data/native/...
  display_order     INTEGER NOT NULL DEFAULT 0,
  uploaded_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX native_task_files_by_task ON native_task_files (task_id, kind, display_order);
```

## Раскладка файлов на диске

```
data/
  native/
    <comp-slug>/
      <task-slug>/
        dataset/
          <file-id>-<safe-original-name>
          ...
        artifact/
          <file-id>-<safe-original-name>
          ...
        grader.<ext>            # обычно score.py
        ground-truth.<ext>      # обычно .csv
      <task-slug>.deleted-<iso-ts>/    # после soft delete
```

`<safe-original-name>` — оригинальное имя, нормализованное: `[^A-Za-z0-9._-]` → `_`, max 80 байт. Префикс `<file-id>-` гарантирует уникальность путей и читаемость; admin видит «display_name» в UI, на диске — `42-train.csv`. `data/native/` и существующий `data/competitions/` сосуществуют — first-level директорий теперь две (плюс `_legacy-backup-*/`).

## Multipart upload — паттерн

```js
import Busboy from 'busboy';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// в обработчике POST /api/admin/.../files
const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES, files: 1 } });
let aborted = false;
bb.on('file', (name, stream, info) => {
  const tmp = path.join(taskDir, kind, `.tmp-${crypto.randomUUID()}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const sink = fs.createWriteStream(tmp);
  const hash = crypto.createHash('sha256');
  let size = 0;
  stream.on('data', (chunk) => { hash.update(chunk); size += chunk.length; });
  stream.on('limit', () => { aborted = true; sink.destroy(); fs.rm(tmp, () => {}); });
  stream.pipe(sink);
  sink.on('finish', async () => {
    if (aborted) return res.status(413).json({ error: 'file too large' });
    // 1) insert row → берём id для финального имени
    const fileRow = filesRepo.insertPending(db, { taskId, kind, ...info, size, sha256: hash.digest('hex') });
    const finalPath = path.join(taskDir, kind, `${fileRow.id}-${safeName(info.filename)}`);
    try {
      await fs.promises.rename(tmp, finalPath);
      filesRepo.commitPath(db, fileRow.id, finalPath);
      res.json({ file: filesRepo.get(db, fileRow.id) });
    } catch (e) {
      filesRepo.delete(db, fileRow.id);
      fs.rm(tmp, () => {});
      throw e;
    }
  });
});
req.pipe(bb);
```

Ключевые свойства:
- При превышении лимита — `stream.on('limit')` срабатывает, sink уничтожается, `tmp` удаляется до записи строки в БД.
- БД получает строку только после успешного `fs.rename` → нет «битых» строк с несуществующим path.
- При сбое в БД (например, дубль `display_order`) — файл удаляется компенсацией.
- sha256 считается на лету (один проход стрима), для будущей дедупликации между задачами (SP-3+).

## API

### Публичные

| Method | Path | Кому | Что |
| --- | --- | --- | --- |
| GET | `/api/competitions?q=<term>` | анон/любой | Список `public` соревнований (`visibility='public' AND deleted_at IS NULL AND visible=1`). `q` опц., `LIKE %term%` по `title`, case-insensitive. Без пагинации (масштаб ≤200 соревнований). |
| GET | `/api/competitions/<slug>` | анон/любой | Метаданные соревнования. Возвращает 404 для несуществующих, 200 для unlisted (если знаешь slug — видишь). |
| GET | `/api/competitions/<slug>/tasks` | любой | Список задач. Для kaggle — из существующего пути, для native — из `native_tasks WHERE deleted_at IS NULL AND visible=1`. |
| GET | `/api/competitions/<slug>/tasks/<task-slug>` | любой | Описание задачи (markdown), список файлов через две группы `datasets[]` + `artifacts[]`. **`grader_path` и `ground_truth_path` НЕ возвращаются.** |
| GET | `/api/competitions/<slug>/tasks/<task-slug>/files/:fileId` | залогиненный | Streams file via `res.sendFile`. 401 анон, 404 если `kind` не `dataset`/`artifact`. |
| GET | `/api/competitions/<slug>/tasks/<task-slug>/files.zip?kind=<kind>` | залогиненный | Streams zip всех файлов указанного kind через `archiver` (or stream zip). |

### Админ (admin role / x-admin-token fallback)

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/admin/competitions/<slug>/native-tasks` | Список (вкл. soft-deleted? нет, только активные; soft-deleted — отдельный admin endpoint если понадобится) |
| POST | `/api/admin/competitions/<slug>/native-tasks` | `{ slug, title, description_md, higher_is_better, baseline/author scores, visible, display_order }`. Валидация: соревнование должно быть `type=native`, slug уникален. |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task-slug>` | Обновление полей задачи (без файлов). |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task-slug>` | Soft-delete + переименование папки. |
| POST | `/api/admin/competitions/<slug>/native-tasks/<task-slug>/files?kind=<kind>` | Multipart upload одного файла. Body: form-data `file` + form-fields `display_name`, `description`. |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task-slug>/files/:fileId` | Edit metadata (display_name/description/order). НЕ заменяет содержимое — для замены: DELETE + POST. |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task-slug>/files/:fileId` | Удаление файла + строки. |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task-slug>/grader` | Multipart upload `score.py`. Перезаписывает существующий. |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task-slug>/ground-truth` | Multipart upload ground-truth. Перезаписывает. |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task-slug>/grader` | Удалить (опц., если хочется снять). |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task-slug>/ground-truth` | Удалить. |

Также правятся существующие endpoint'ы из SP-1:
- `POST /api/admin/competitions` — принимает `visibility: 'public' | 'unlisted'` (default `public`) и `type: 'kaggle' | 'native'` (default `kaggle`).
- `PUT /api/admin/competitions` (bulk replace) — для каждой записи в body если `type` отличается от существующего на той же `slug`, валидатор возвращает 400. Запрет смены `type` относится и к POST на существующий slug, и к bulk-replace, и к (потенциальному) per-comp PUT.
- `validateCompetitions` валидирует значение `visibility` (whitelist) и **не валидирует `type` напрямую** — type-lock делает репозиторий, поскольку для проверки нужна старая запись.

`GET /api/competitions/<slug>/leaderboard` (SP-1) — расширяется: для `type=native` читает задачи **прямо из БД** (`native_tasks` через repo), без участия cache-loop'a. Кеш в памяти оставляем только для kaggle (где Kaggle CLI медленный). Для native SQLite быстр — каждый запрос делает 1-2 SELECT'а, это дешевле чем поддерживать invalidation. `buildLeaderboards` работает идентично (тот же anchor-нормализатор), просто `entries=[]` пока сабмитов нет (это SP-3). `cache.byCompetition` для native — пустая запись с `updatedAt = null`, фронт рендерит «пока пусто».

## Frontend

### Новые/обновлённые страницы

| Маршрут | Что |
| --- | --- |
| `/` (обновлено) | Каталог: список карточек `public` соревнований + input поиска (`?q=…`, debounce 300ms). Unlisted — не показываются. Без пагинации в SP-2. |
| `/competitions/<slug>` (обновлено) | Заголовок + subtitle + список задач (kaggle и native — единый компонент, разница в источнике данных). Для unlisted — на странице бейдж «Только по ссылке». |
| `/competitions/<slug>/tasks/<task-slug>` (новое для native) | Markdown-описание сверху, секции «Данные» и «Стартовый набор» с таблицей файлов (имя, размер, скачать). Кнопки «Скачать все datasets zip» и «Скачать все artifacts zip». 401 на скачивание для анона → редирект на `/login`. |
| `/admin/competitions` (обновлено) | В форме создания — radio `visibility: public/unlisted`, radio `type: kaggle/native`. В списке — бейдж типа и видимости. После создания type залочен (UI скрывает radio при edit). |
| `/admin/competitions/<slug>/native-tasks` (новое) | Список нативных задач + кнопка «Создать». Видна только для соревнований с `type=native`. |
| `/admin/competitions/<slug>/native-tasks/<task-slug>` (новое) | Сплошная страница: метаданные (title/slug/scoring), markdown-редактор описания (textarea + live preview через `react-markdown`), секции файлов с inline-загрузкой (кнопка «+ Добавить датасет/артефакт» открывает модалку upload), отдельный блок «Grader (`score.py`)» и «Ground truth» с upload/replace/delete. |

### Зависимости фронта

- `react-markdown` (~30 КБ) + `rehype-sanitize` (built-in safe schema) — для рендера описания.
- `react-dropzone` — необязательно, можно обойтись `<input type="file">`. Решу при имплементации, для SP-2 простой input достаточен.

## Тесты

Покрываем (через `node:test` + in-memory DB):

- `competitionsRepo`: миграция 0002 — `visible=1` → `visibility='public'`, `visible=0` → `'unlisted'`. Search: `LIKE '%LowerCASE%'`, чувствительность к регистру не должна мешать.
- `nativeTasksRepo`: insert/list/get/update/softDelete; уникальность `(competition_slug, slug)`; soft-deleted не в `listActive`.
- `nativeTaskFilesRepo`: insert/list по kind; sha256 round-trip; cascade delete при softDelete задачи (но файлы на диске НЕ трогаются автоматически, переименование папки — отдельный шаг).
- `multipart upload pipeline`: тест с фейковым busboy-стримом — happy path, превышение лимита, сбой переименования (mock `fs.rename` reject), валидация sha256.
- API integration: register → admin promote → создать native соревнование → создать задачу → upload датасета → анон GET файла → 401 → залогинить участника → 200 + правильный content-length.
- Grader/ground-truth: upload видны только в admin GET, не в public GET; повторный upload — заменяет файл, старый удаляется.
- ZIP endpoint: 0 файлов — 404; ≥1 — стрим валидного zip (можно проверить через `adm-zip` распаковку в тесте).
- Type-lock: PUT /admin/competitions с попыткой сменить type существующего соревнования → 400.

## Раскладка файлов кода

Новое в `backend/src/`:
```
db/migrations/0002_native_tasks.sql
db/nativeTasksRepo.js
db/nativeTaskFilesRepo.js
routes/nativeTasks.js              # admin endpoints
routes/nativeTasksPublic.js        # public GET endpoints + file streaming + zip
upload/multipartFile.js            # busboy pipeline (общий — пригодится в SP-3 для сабмитов)
upload/safeFilename.js             # нормализация имён
```

Изменения в существующих:
- `db/competitionsRepo.js` — `listVisibleCompetitions` фильтрует по `visibility='public' AND visible=1`; новая `searchPublicCompetitions(q)`; `upsertCompetition` падает с понятной ошибкой если `type` отличается от существующего.
- `app.js` — монтируем `routes/nativeTasks.js` + `routes/nativeTasksPublic.js`. `validateCompetitions` учит `visibility`. `GET /api/competitions/<slug>/leaderboard` диспатчит по `competition.type`: для `kaggle` — текущий путь через cache, для `native` — прямой read из `native_tasks` через repo.
- `app.js#refreshCompetition` — без изменений из SP-1 (no-op для не-kaggle). Native не нуждается в refresh-loop'е: данные читаются из БД on-demand.

Сервер хранит markdown raw, без серверной санитизации — фронт санитизирует при рендере (`rehype-sanitize`). Standard pattern: store-as-is, sanitize-on-render. Никаких `<script>` в БД не страшно, потому что они никогда не попадают в DOM.

Frontend:
```
src/auth/CompetitionsListPage.jsx      # + search input (модификация SP-1)
src/native/NativeTaskPage.jsx          # public страница задачи
src/native/NativeTaskFiles.jsx         # таблица файлов + zip-кнопки
src/native/MarkdownView.jsx            # обёртка react-markdown + sanitize
src/admin/AdminNativeTasksList.jsx
src/admin/AdminNativeTaskEdit.jsx
src/admin/MarkdownEditor.jsx           # textarea + live preview
```

## Зависимости

Backend:
- `+ busboy ^1.6` — multipart streaming.
- `+ archiver ^7` — zip stream (или `yazl` ~5 КБ если archiver окажется тяжёлым; решу в impl plan).

Frontend:
- `+ react-markdown ^9`
- `+ rehype-sanitize ^6`

## ENV-переменные (новые)

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `NATIVE_DATA_DIR` | `./data/native` | Где хранить native-файлы |
| `MAX_DATASET_BYTES` | `524288000` (500 MB) | Лимит на один датасет |
| `MAX_ARTIFACT_BYTES` | `26214400` (25 MB) | Лимит на один артефакт |
| `MAX_GRADER_BYTES` | `102400` (100 KB) | Лимит на `score.py` |
| `MAX_GROUND_TRUTH_BYTES` | `524288000` (500 MB) | Лимит на ground-truth |

## Migration safety

Миграция 0002 — additive (ALTER + CREATE). На существующей БД из SP-1:
1. `ALTER TABLE competitions ADD COLUMN visibility ...` — мгновенно, default 'public'.
2. `UPDATE competitions SET visibility = ...` — пробегает по всем строкам один раз, на сотнях записей мгновенно.
3. `CREATE TABLE native_tasks` / `native_task_files` — новые, никакого риска.
4. Обратная миграция (откат): `DROP TABLE native_tasks; DROP TABLE native_task_files; ALTER TABLE competitions DROP COLUMN visibility;` — описывается в комменте, но не автоматизируется (SP-2 only forward-migrates).

В случае rollback продакшена на SP-1 после деплоя SP-2:
- `competitions.visibility` будет проигнорирован старой кодовой базой (он не в её модели). Никакой сломанной семантики.
- Native-таблицы остаются с данными, к которым старый код не лезет.
- Файлы в `data/native/` лежат как есть.

Это даёт безопасный rollback по принципу «миграция только вперёд, обратная — через cleanup-скрипт».

## Открытые вопросы

Все детали ниже — для импл-плана, не блокеры спеки:
- `archiver` vs `yazl` — выбор библиотеки zip-стрима (обе работают, archiver удобнее, yazl легче).
- Лимит «количество файлов на задачу» — пока без лимита; добавить если в проде упрёмся.
- Дубли `display_name` внутри одного `kind` — пока разрешены (admin видит, может переименовать).
- API для перестановки `display_order` файлов — отдельный PATCH endpoint или часть PUT (выберу при имплементации).

## Критерии готовности SP-2

- [ ] Миграция 0002 применяется на БД с SP-1 без потери данных, переносит `visible` → `visibility`.
- [ ] `GET /api/competitions?q=…` отдаёт public + ищет по title.
- [ ] Unlisted соревнования открываются только по прямой ссылке.
- [ ] Админ создаёт native соревнование с native задачей через UI.
- [ ] Админ грузит датасет 100 МБ (или больше до лимита) — успешно, без OOM.
- [ ] Залогиненный участник скачивает датасеты, артефакты, zip-бандл.
- [ ] Grader и ground-truth скачиваются ТОЛЬКО админом, public path возвращает 404.
- [ ] Soft-delete задачи переименовывает папку на диске.
- [ ] Существующий kaggle-flow `neoai-2026` не затронут.
- [ ] `npm test` зелёный.
