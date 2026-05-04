# SP-3: Submissions & Scoring Runner — Design

**Status:** Draft
**Date:** 2026-05-05
**Parent project:** «Своя Kaggle» (4 под-проекта; SP-1 «Identity & Data Model» в main с 2026-05-04, SP-2 «Native Task Admin» завершён 2026-05-05 на ветке `worktree-sp2-native-tasks`, не смержен)
**Roadmap:** `~/.claude/projects/-Users-seyolax-projects-neoai-transa/memory/project_kaggle_platform_roadmap.md`

## Цель и объём

SP-3 закрывает основной flow Kaggle-платформы — **сабмит → скоринг → лидерборд**. После SP-3 нативное соревнование функционально полное: участник заходит, видит задачу, сдаёт CSV-файл с предсказаниями, через несколько секунд видит свой балл и место.

**Что SP-3 даёт пользователю end-to-end:**
- На странице нативной задачи появляется блок «Сдать решение» (логин обязателен): загрузка CSV + кнопка «Submit».
- Сабмит уезжает в фоновую очередь (`status: pending`), API отвечает мгновенно. Worker-loop в том же Node-процессе по очереди забирает pending-задачи, запускает админский `score.py` в `child_process` с timeout/memory-лимитами, парсит метрику, нормализует через якоря из задачи, пишет в `submissions.points`.
- Участник видит «Мои сабмиты» с реал-тайм статусом (poll раз в 2 сек, пока есть active scoring jobs).
- При первом сабмите участник auto-join'ится в `competition_members`. Дальше явная кнопка «Join» появится в SP-4.
- Native-лидерборд (`/api/competitions/<slug>/leaderboard`, добавленный пустым в SP-2) теперь отдаёт **реальные** entries: best `points` каждого юзера на каждой задаче, суммарные `totalPoints` по всем задачам.
- Админ через `/admin/competitions/<slug>/native-tasks/<task>/submissions` видит все сабмиты, может удалить мусорный или ре-скорить (например, после правки `score.py`).

**Что НЕ входит в SP-3:**
- «Selected submissions» (Kaggle-style: участник выбирает 1-2 финальных сабмита, по ним считается private-LB) — SP-4 при необходимости.
- Личный кабинет с агрегированной историей по всем соревнованиям — SP-4.
- Параллельный пул воркеров (SP-3 — один воркер последовательно). Расширение тривиально: миграция SQL'я нет, добавляется второй `setInterval` + advisory-lock на pickNext.
- Полная деприкация `participants.json`: для kaggle-соревнований оставляем как было; native использует `competition_members`. Полное удаление — после SP-4 (когда оставшиеся участники получат настоящие аккаунты).
- Discussions / kernels / комментарии / шеринг кода.
- Валидация CSV-формата сабмита на стороне бэка перед запуском grader'а — `score.py` сам разбирается. Бэк только валидирует размер и расширение.
- Sandbox изоляции уровня Docker-in-Docker / gVisor / Firecracker — `score.py` доверенный (его пишет админ); сабмит — это файл предсказаний, не код. Лимитируем CPU/mem/time через `child_process` опции, этого достаточно.
- Отдельный «reveal private» button или таймер — private-LB просто появляется когда у задачи есть `ground_truth_private` И сабмиты пересчитаны (зеркальное поведение текущего kaggle-flow, где private приходит вместе с загрузкой private CSV админом).

## Архитектурные решения (зафиксированы в брейнсторме)

| Решение | Выбор | Почему |
| --- | --- | --- |
| Sync vs async runner | **Async, in-process worker, FIFO** | Express отвечает мгновенно; параллельные сабмиты выстраиваются в очередь, не упираясь в request-slot'ы. Один воркер достаточен под NEOAI scale. |
| Изоляция grader'а | `child_process.spawn` + `timeout` + `prlimit` (если есть) | Админский код доверен, отдельные контейнеры — overkill |
| Sandboxing сабмита | Только размер + расширение | Сабмит = файл предсказаний, не код, attack surface близка к нулю |
| Auto-join | `INSERT OR IGNORE INTO competition_members` при первом сабмите | Натурально вписывается в flow без отдельной кнопки в SP-3 |
| `participants.json` | Не трогаем (kaggle-only legacy) | Чистая миграция блокируется отсутствием email'ов; полная деприкация после SP-4 |
| `submissions` ↔ `scoring_jobs` | Одна таблица `submissions` со status-машиной | YAGNI: 1:1 связь, JOIN не нужен на каждый запрос лидерборда |
| Public/Private split | Два опциональных ground-truth файла (`public` + `private`); воркер запускает grader дважды; ЛБ зеркалит kaggle (4 варианта) | NEOAI без private-LB неполноценен; реализуем тем же контрактом что у kaggle, без отдельного reveal-механизма — private появляется когда админ загрузил private GT |
| Поллинг vs WebSocket | Поллинг (2 сек) пока есть active submissions у юзера | Минус одна транспорт-абстракция; на нашем масштабе HTTP-поллинг безболезненный |

## Schema — миграция `0003_submissions.sql`

```sql
-- ───────────────────────────────────────────────────────────
-- Native tasks: добавляем второй ground-truth (private, опционально).
-- Существующий ground_truth_path по конвенции становится "public" GT.
-- Переименование колонки не делаем (минимальная миграция); семантика
-- закрепляется в репозитории + UI ("public" / "private" слоты).
ALTER TABLE native_tasks ADD COLUMN ground_truth_private_path TEXT;

-- ───────────────────────────────────────────────────────────
-- Submissions: храним по два значения (public + private), оба опциональные
CREATE TABLE submissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER NOT NULL REFERENCES native_tasks(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  sha256            TEXT NOT NULL,
  path              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'scoring', 'scored', 'failed')),
  raw_score_public   REAL,                 -- score.py против public GT (status='scored' only)
  raw_score_private  REAL,                 -- score.py против private GT (если задан и пересчитан)
  points_public      REAL,                 -- normalize(raw_public, baseline_public, author_public)
  points_private     REAL,                 -- normalize(raw_private, baseline_private, author_private)
  attempts          INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,                  -- non-null при status='failed'
  log_excerpt       TEXT,                  -- последние ≤8 KB stdout+stderr (mixed public+private runs)
  duration_ms       INTEGER,
  started_at        TEXT,                  -- момент перехода в 'scoring'
  scored_at         TEXT,                  -- момент перехода в 'scored'/'failed'
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Worker pickNext + stale-recovery: ищет pending в порядке поступления
CREATE INDEX submissions_active
  ON submissions (id)
  WHERE status IN ('pending', 'scoring');

-- Лидерборд per-user-best (public + private отдельно)
CREATE INDEX submissions_task_user_score_public
  ON submissions (task_id, user_id, points_public DESC, id)
  WHERE status = 'scored' AND points_public IS NOT NULL;

CREATE INDEX submissions_task_user_score_private
  ON submissions (task_id, user_id, points_private DESC, id)
  WHERE status = 'scored' AND points_private IS NOT NULL;

-- «Мои сабмиты»
CREATE INDEX submissions_user_recent
  ON submissions (user_id, task_id, created_at DESC);

-- Rate-limit count за последние 24ч
CREATE INDEX submissions_user_task_time
  ON submissions (user_id, task_id, created_at);
```

`competition_members` уже создана в SP-1. SP-3 только начинает её писать.

## State machine submission

```
                                        ┌─ exit=0 + valid score ─→ scored
                                        │
   POST /submissions ──→ pending ──→ scoring ──┼─ exit≠0 / timeout / invalid → failed (final)
                                        │
                                        └─ stale (started_at < now-15min) → pending (retry, attempts++)
```

- `pending → scoring`: атомарно через `UPDATE submissions SET status='scoring', started_at=now() WHERE id=? AND status='pending'`. Проверяем `changes > 0` чтобы не было race между воркерами.
- `scoring → scored`: при успехе grader'а. Пишутся `raw_score`, `points`, `log_excerpt`, `duration_ms`, `scored_at`.
- `scoring → failed`: при exit≠0, timeout, не-числовом stdout. Пишется `error_message`, `log_excerpt`, `duration_ms`, `scored_at`.
- Stale recovery: при старте бэка и периодически (каждые 60 сек) `UPDATE submissions SET status='pending', attempts=attempts+1 WHERE status='scoring' AND started_at < datetime('now', '-15 minutes')`. **Cap: 3 attempts** — после третьего фейла `status='failed'` с `error_message='exceeded retry budget'`. (Без кэпа упавший grader зацикливал бы очередь.)

## Worker loop

Файл `backend/src/scoring/worker.js`:

```js
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const TICK_MS = 2000;
const TIMEOUT_MS = Number(process.env.SCORING_TIMEOUT_MS || 60_000);
const MAX_LOG_BYTES = 8192;
const MAX_ATTEMPTS = 3;

export function startWorker(db, { intervalMs = TICK_MS } = {}) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(db); } catch (e) { console.error('[worker] tick error', e); }
    finally { running = false; }
  }, intervalMs);
  return () => clearInterval(timer);
}

async function tick(db) {
  recoverStale(db);
  const sub = pickAndMarkScoring(db);
  if (!sub) return;
  const task = getNativeTaskById(db, sub.task_id);
  if (!task) return markFailed(db, sub.id, { error: 'task missing', log: '', durationMs: 0 });
  if (!task.graderPath || !task.groundTruthPath) {
    return markFailed(db, sub.id, { error: 'grader or public ground_truth not configured', log: '', durationMs: 0 });
  }
  try {
    // 1. Public scoring — обязательный
    const pub = await runGrader({ graderPath: task.graderPath, gtPath: task.groundTruthPath, subPath: sub.path });
    const pointsPublic = computePoints({
      raw: pub.rawScore,
      baseline: task.baselineScorePublic,
      author: task.authorScorePublic,
      higherIsBetter: task.higherIsBetter,
    });

    // 2. Private scoring — только если у задачи есть ground_truth_private_path
    let rawPrivate = null, pointsPrivate = null, privateLog = '', privateDurationMs = 0;
    if (task.groundTruthPrivatePath) {
      try {
        const priv = await runGrader({ graderPath: task.graderPath, gtPath: task.groundTruthPrivatePath, subPath: sub.path });
        rawPrivate = priv.rawScore;
        pointsPrivate = computePoints({
          raw: priv.rawScore,
          baseline: task.baselineScorePrivate,
          author: task.authorScorePrivate,
          higherIsBetter: task.higherIsBetter,
        });
        privateLog = priv.log;
        privateDurationMs = priv.durationMs;
      } catch (e) {
        // private упал — public всё равно засчитываем; private остаётся NULL
        // в log_excerpt пишем оба раздела
        privateLog = `[private failed] ${e.error}\n${e.log || ''}`;
        privateDurationMs = e.durationMs || 0;
      }
    }

    const log = `--- public ---\n${pub.log}\n--- private ---\n${privateLog || '(no private GT configured)'}`.slice(-MAX_LOG_BYTES);
    markScored(db, sub.id, {
      rawScorePublic: pub.rawScore,
      rawScorePrivate: rawPrivate,
      pointsPublic,
      pointsPrivate,
      log,
      durationMs: pub.durationMs + privateDurationMs,
    });
  } catch (e) {
    const finalFail = sub.attempts + 1 >= MAX_ATTEMPTS;
    if (finalFail) markFailed(db, sub.id, e);
    else markFailedRetry(db, sub.id, e);
  }
}

function runGrader({ graderPath, gtPath, subPath }) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn('python3', [graderPath, subPath, gtPath], {
      timeout: TIMEOUT_MS,
      // Лимит на буфер stdout+stderr внутри спавна
      maxBuffer: 16 * 1024 * 1024,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject({ error: err.message, log: stderr.slice(-MAX_LOG_BYTES), durationMs: Math.round(performance.now() - start) }));
    child.on('close', (code, signal) => {
      const durationMs = Math.round(performance.now() - start);
      const log = (stderr + '\n---STDOUT---\n' + stdout).slice(-MAX_LOG_BYTES);
      if (signal === 'SIGTERM') return reject({ error: `timeout after ${TIMEOUT_MS}ms`, log, durationMs });
      if (code !== 0) return reject({ error: `grader exit code ${code}`, log, durationMs });
      const lastNonEmpty = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      const score = Number(lastNonEmpty);
      if (!Number.isFinite(score)) return reject({ error: `invalid score from grader: ${JSON.stringify(lastNonEmpty.slice(0, 200))}`, log, durationMs });
      resolve({ rawScore: score, log, durationMs });
    });
  });
}
```

`computePoints` использует существующий `leaderboard.js#normalizeWithAnchors` напрямую (та же формула что для kaggle): `points = max(0, (raw - baseline) / (author - baseline) * 100)` со знаком от `higher_is_better`. Если у задачи нет якорей для соответствующей пары (например, задан `baseline_score_public` но не `author_score_public`) — `points = raw` без нормализации (admin может позже задать якоря и `POST /rescore-all` пересчитает).

### Когда private появляется

Private-LB активируется в момент когда у `submissions` появляются ненулевые `points_private`. Это происходит после того как админ:

1. Загрузил `ground_truth_private` через `PUT /api/admin/.../ground-truth-private` (новый endpoint, см. ниже).
2. Запустил `POST /rescore-all` чтобы воркер пересчитал все существующие сабмиты с двумя GT.

Сабмиты, поступающие ПОСЛЕ загрузки private GT, скорятся обоими автоматически (воркер всегда читает task fresh).

Это зеркалит текущий kaggle-flow: private появляется ровно тогда, когда у админа готовы данные. Никакого отдельного reveal-флага.

## API

### Public (логин обязателен на write-операциях)

| Method | Path | Auth | Что |
| --- | --- | --- | --- |
| POST | `/api/competitions/<slug>/native-tasks/<task>/submissions` | required | Multipart upload submission CSV (size ≤50 MB по умолчанию). Авто-join'ит в `competition_members`. Rate-limit 50/24h/(user, task). Создаёт submission `status=pending`, возвращает `{submission}`. |
| GET | `/api/competitions/<slug>/native-tasks/<task>/submissions/me` | required | Список своих сабмитов (current user) на этой задаче, отсортированы по `created_at DESC`. |
| GET | `/api/competitions/<slug>/native-tasks/<task>/submissions/<id>` | required | Детали своего сабмита (включая `error_message`/`log_excerpt`). 404 если не свой. Админ может смотреть любой. |
| GET | `/api/competitions/<slug>/leaderboard` | open | (расширяется из SP-2) для native — реальные entries: best `points` per (user, task), `totalPoints` суммой. |

### Admin

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/admin/competitions/<slug>/native-tasks/<task>/submissions` | Все сабмиты задачи; query `?status=pending|scoring|scored|failed` опц. |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/submissions/<id>` | Удаляет (DB row + файл на диске) — для бракованных сабмитов |
| POST | `/api/admin/competitions/<slug>/native-tasks/<task>/submissions/<id>/rescore` | Сбрасывает `status='pending'`, обнуляет `attempts`/`raw_score_*`/`points_*`/`error_message`, воркер на следующем тике подхватит |
| POST | `/api/admin/competitions/<slug>/native-tasks/<task>/rescore-all` | Сбрасывает ВСЕ `status IN ('scored','failed')` сабмиты задачи в `pending` — нужно после обновления `score.py` или загрузки `ground-truth-private` |
| PUT | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth-private` | Multipart upload приватного ground-truth (mirror существующего `/ground-truth` slot из SP-2 для public; путь пишется в `native_tasks.ground_truth_private_path`). |
| DELETE | `/api/admin/competitions/<slug>/native-tasks/<task>/ground-truth-private` | Снять private GT (вернуться к public-only режиму). Существующие `points_private` остаются в БД до следующего `rescore-all`. |

## Раскладка файлов на диске

```
data/
  native/
    <comp-slug>/
      <task-slug>/
        dataset/   …  (SP-2)
        artifact/  …  (SP-2)
        grader.py        (SP-2)
        ground-truth.csv (SP-2)
        submissions/                    ← новое в SP-3
          <submission-id>-<safe-name>
          ...
```

При `DELETE` сабмита файл удаляется с диска вместе со строкой. Soft-delete для сабмитов не нужен — это обычные пользовательские артефакты, не кураторский контент.

## Native leaderboard query

Запрос симметричен для public и private, отличается только колонкой `points_*`:

```sql
-- best submission per (user, task) — пример для public
WITH best AS (
  SELECT
    s.task_id,
    s.user_id,
    s.points_public AS points,
    s.raw_score_public AS raw_score,
    s.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY s.task_id, s.user_id
      ORDER BY s.points_public DESC, s.id ASC
    ) AS rn
  FROM submissions s
  WHERE s.status = 'scored'
    AND s.points_public IS NOT NULL
    AND s.task_id IN (<native task ids of competition>)
)
SELECT b.task_id, b.user_id, b.points, b.raw_score, b.created_at,
       u.display_name, u.kaggle_id
FROM best b
JOIN users u ON u.id = b.user_id
WHERE b.rn = 1;
```

Для private — заменить `points_public` → `points_private`, `raw_score_public` → `raw_score_private` в трёх местах. Если ни у одной строки нет `points_private` — private-LB пустой (фронт не показывает таб).

В Node результат группируется по user'у, считается `totalPoints` суммой, сортируется по `totalPoints DESC`. Per-task entries возвращаются как `{slug, entries: [...]}` в той же форме что отдаёт `buildLeaderboards` для kaggle.

### Response shape — 4 варианта (зеркалит текущий kaggle)

`GET /api/competitions/<slug>/leaderboard` для native собирает четыре независимых лидерборда и возвращает в той же структуре что и kaggle:

```js
{
  updatedAt: "<iso>",
  tasks: [...],
  overall: [...],            // public, все участники
  byTask: { <slug>: { entries: [...] } },
  privateOverall: [...],     // private, все (пусто пока нет points_private)
  privateByTask: { <slug>: { entries: [...] } },
  privateTaskSlugs: [...],   // slugs у которых есть private данные
  oursOverall: [...],        // public, фильтр "ours"
  oursByTask: { <slug>: { entries: [...] } },
  oursPrivateOverall: [...], // private, "ours"
  oursPrivateByTask: { <slug>: { entries: [...] } },
  errors: [],
}
```

**Что значит «ours» для native:** все, кто в `competition_members`. Поскольку для native единственный способ попасть в этот список — самому сделать сабмит (auto-join), `oursOverall` совпадает с `overall` для native в SP-3. Различие может появиться позже (SP-4) если введём «приглашённых заранее» участников. Сейчас просто отдаём одни и те же данные в обоих ключах — фронт-компонент один и не знает что они равны, переключатель «ours/all» работает как обычно.

Поля `previousPoints`/`previousTotalPoints` (зелёные/красные стрелки) — не реализуем в SP-3, оставляем `null`. Дельта-снапшоттинг можно добавить в SP-4 если визуально потребуется.

### Backward compat: kaggle leaderboard

`GET /api/competitions/<slug>/leaderboard` для `competition.type='kaggle'` — **полностью без изменений**. Refresh-loop читает Kaggle CLI, `participants.json` фильтрует «ours», существующие `data/private/<slug>/<task>.csv` дают private-вариант. Никакой код в `kaggle.js`/`leaderboard.js` для kaggle path не правится в SP-3.

## Frontend

### Новые компоненты

```
frontend/src/native/
  SubmitForm.jsx          # форма загрузки + кнопка Submit
  MySubmissions.jsx       # таблица своих сабмитов с реал-тайм статусом
  NativeLeaderboard.jsx   # таблица лидерборда (можно использовать существующий LeaderboardTable если есть)
```

### Изменения

- `frontend/src/native/NativeTaskPage.jsx` (из SP-2) — добавляются секции «Сдать решение» (только если `user`), «Мои сабмиты» (только если есть свои), и «Лидерборд» (любому видна, с переключателем `Public | Private` если private данные есть).
- `frontend/src/api.js` — `submissions.create(comp, task, formData)`, `submissions.listMine(comp, task)`, `submissions.get(comp, task, id)`. Лидерборд уже существует (`competitions.getLeaderboard`).
- `frontend/src/admin/AdminNativeTaskEdit.jsx` — (a) **новый слот «Ground truth (private)»** — mirror существующего public-слота из SP-2; загрузка/удаление; (b) отдельная секция «Сабмиты» со списком всех + кнопка «Rescore all» (вызывается в т.ч. после загрузки private GT).
- Native использует **существующий** компонент таблицы лидерборда (тот же, что для kaggle). Контракт ответа `/leaderboard` идентичен — переключатель `Public | Private` уже реализован в текущем UI и просто заработает.

### Polling

`MySubmissions` при наличии хоть одного сабмита со `status IN ('pending', 'scoring')` запускает `setInterval(refetch, 2000)`. Когда все перешли в финальные статусы — `clearInterval`. На размонтирование компонента — тоже clear. Не используем WebSocket (один лишний канал, контекст SSE/WS в Express).

### UX status indicator

- `pending` — серый бейдж «В очереди», placeholder для score.
- `scoring` — синий со спиннером «Считается…».
- `scored` — зелёный с числом points (и raw_score маленьким текстом рядом).
- `failed` — красный с `error_message` (truncated). Hover/expand показывает `log_excerpt`.

## Ограничения и валидации

- Размер сабмита: `MAX_SUBMISSION_BYTES` (default 52428800 = 50 MB).
- Расширение: только `.csv`/`.tsv`/`.json` whitelist (мы не парсим, это просто guard от `.exe`-загрузок). Конфигурируется через `SUBMISSION_ALLOWED_EXTS` (CSV-список).
- Rate limit: `MAX_SUBMISSIONS_PER_DAY` (default 50). Считается по `submissions WHERE user_id = ? AND task_id = ? AND created_at > now() - 24h`.
- Scoring timeout: `SCORING_TIMEOUT_MS` (default 60000 = 60s). После — SIGTERM + retry.
- Worker tick: `WORKER_TICK_MS` (default 2000). Понижение до 500ms бесполезно — pickAndMarkScoring и так атомарная.
- Stale threshold: 15 минут (hardcoded; если `score.py` действительно работает 15+ мин — задача дизайнится не для такой инфры).

## Раскладка кода

### Backend

```
backend/src/db/migrations/0003_submissions.sql                  ← новое
backend/src/db/submissionsRepo.js                                ← новое
backend/src/db/membersRepo.js                                    ← наполнение пустого shell из SP-1
backend/src/scoring/worker.js                                    ← worker loop + runGrader
backend/src/scoring/normalize.js                                 ← computePoints (обёртка над leaderboard.js#normalizeWithAnchors)
backend/src/routes/submissionsAdmin.js                           ← admin endpoints
backend/src/routes/submissionsPublic.js                          ← public endpoints (POST + own-list + own-get)
backend/src/index.js                                             ← startWorker(db) после migrations
backend/src/app.js                                               ← mount routers, leaderboard dispatch native теперь читает submissions
backend/.env.example                                             ← +SCORING_TIMEOUT_MS, MAX_SUBMISSION_BYTES, MAX_SUBMISSIONS_PER_DAY, SUBMISSION_ALLOWED_EXTS, WORKER_TICK_MS
backend/tests/sp3_db.test.js
backend/tests/sp3_worker.test.js                                 ← включая фейковый score.py фикстура
backend/tests/sp3_api.test.js
backend/tests/fixtures/score-ok.py                               ← всегда печатает 0.85
backend/tests/fixtures/score-error.py                            ← exit code 1
backend/tests/fixtures/score-timeout.py                          ← time.sleep(120)
backend/tests/fixtures/score-bad.py                              ← печатает 'not a number'
```

### Frontend

```
frontend/src/native/SubmitForm.jsx                               ← новое
frontend/src/native/MySubmissions.jsx                            ← новое
frontend/src/native/NativeLeaderboard.jsx                        ← новое
frontend/src/native/NativeTaskPage.jsx                           ← extend (3 новые секции)
frontend/src/api.js                                              ← submissions.* + nativeLeaderboard.get
frontend/src/admin/AdminNativeTaskEdit.jsx                       ← +вкладка «Сабмиты» с rescore-all
```

## Тесты

Покрываем (`node:test` + in-memory DB + фикстуры grader-скриптов):

- `submissionsRepo`: insert / list-by-user / list-by-task / status transitions через `markScoring`/`markScored`/`markFailed`/`markFailedRetry`; `pickAndMarkScoring` атомарность (2 параллельных вызова → один получает submission, второй null); `recoverStale` сбрасывает 'scoring' старше threshold.
- `runGrader`: happy path (`score-ok.py` → 0.85); exit≠0 (`score-error.py`); timeout (`score-timeout.py` под `TIMEOUT_MS=200`); невалидный stdout (`score-bad.py`).
- Worker tick (public-only): задача без `ground_truth_private_path` — воркер запускает grader один раз, `points_public` заполнен, `points_private=NULL`.
- Worker tick (public+private): задача с обоими GT — воркер запускает grader дважды, оба `points_*` заполнены через свои якоря (тест на анкоры 0.5→0.9 и 0.4→0.85, точная арифметика).
- Worker tick (private grader fails): public успешен, private падает → status='scored', `points_public` есть, `points_private=NULL`, `log_excerpt` содержит `[private failed]`.
- Retry budget: insert submission с attempts=2, форсим failure (public падает) → status='failed' финальный (не 'pending').
- Auto-join: первый POST /submissions создаёт `competition_members` row; второй POST → INSERT IGNORE, дубля нет.
- Rate limit: 51-й сабмит за 24h → 429.
- Submission ownership: `GET .../submissions/<id>` для чужого id → 404. Админ → 200.
- Admin DELETE: удаляет row + file на диске.
- Admin POST /rescore: обнуляет `attempts`/`raw_score_*`/`points_*`/`error_message`, воркер пересчитывает.
- Admin PUT ground-truth-private + POST rescore-all: после загрузки private GT и pересчёта все сабмиты получают `points_private`.
- Admin DELETE ground-truth-private: `task.ground_truth_private_path` зануляется; новые сабмиты скорятся только public; старые `points_private` сохраняются до следующего rescore-all.
- Native leaderboard public: 2 юзера × 2 задачи, 3 сабмита у первого, 1 у второго → правильный best per task + totalPoints sum + сортировка.
- Native leaderboard private: при наличии `points_private` собирается отдельный 4-вариант, идентичный по форме kaggle response (overall/byTask/privateOverall/privateByTask + ours-зеркала).
- Existing kaggle leaderboard `neoai-2026` не сломан (regression test через bootstrap fixture).

## Зависимости

Никаких новых npm-зависимостей. `child_process` и `crypto` встроены. Multipart-аплоад использует существующий `busboy` pipeline из SP-2. Worker — чистый JS на встроенных таймерах.

## ENV-переменные (новые)

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `SCORING_TIMEOUT_MS` | `60000` | hard timeout grader'а |
| `WORKER_TICK_MS` | `2000` | период tick'а воркера |
| `MAX_SUBMISSION_BYTES` | `52428800` (50 MB) | лимит на сабмит |
| `MAX_SUBMISSIONS_PER_DAY` | `50` | rate-limit на (user, task) |
| `SUBMISSION_ALLOWED_EXTS` | `csv,tsv,json` | whitelist расширений |
| `PYTHON_BIN` | `python3` | команда для запуска grader'а (Docker-image имеет `python3`) |

## Migration safety

`0003_submissions.sql` — pure additive (новые таблицы, новые индексы). На существующей БД с SP-1 + SP-2 не может что-либо сломать.

Воркер стартует ПОСЛЕ накатывания всех миграций, перед `app.listen` (или сразу после, разница незаметна). При первом старте — пустой `submissions` → `pickAndMarkScoring` возвращает null → воркер просто крутится.

Rollback: воркер снимается через `clearInterval`, новые сабмиты не идут (фронт не показывает форму, бэк endpoint'ы 404). Существующие сабмиты остаются в БД до следующего форвард-деплоя. Безопасно.

## Открытые вопросы

Ничего не блокирует план. Детали для импл-стадии:
- Точная команда для memory-cap'a grader'а: `prlimit --as=<bytes> python3 …` (Linux only). На macOS dev-машине prlimit нет — фолбэк на чистый timeout без memory cap. Импл-план зафиксирует.
- API ответа на 429: возвращать `{ error: 'rate limit', resetAt: '<iso>' }` или просто 429 + текст. Беру первое (frontend может показать «попробуй через 4 часа»).
- Содержимое `log_excerpt` — последние 8 KB смешанных stderr+stdout, или только stderr? Беру смешанные (debug-friendlier), с разделителем `--STDOUT--`.

## Критерии готовности SP-3

- [ ] Миграция 0003 применяется на БД с SP-1+SP-2 без потерь (ALTER + новые таблицы).
- [ ] `POST /api/competitions/<slug>/native-tasks/<task>/submissions` принимает файл, создаёт `pending` submission + auto-join.
- [ ] Worker (запущенный в `index.js`) подхватывает pending, вызывает `python3 score.py sub.csv gt.csv` против public GT, парсит число из последней строки stdout, нормализует через `*_public` якоря, пишет `points_public`.
- [ ] Если у задачи задан `ground_truth_private_path` — воркер запускает grader дважды, заполняет также `raw_score_private`+`points_private`.
- [ ] Падение private-grader'а не валит сабмит: public-результат сохраняется, private остаётся NULL, лог фиксирует причину.
- [ ] `GET /submissions/me` отдаёт сабмиты с актуальным статусом, `raw_score_public` и `points_public` (private — если есть).
- [ ] `GET /api/competitions/<slug>/leaderboard` для native теперь содержит реальные `entries` в 4 вариантах (`overall`/`privateOverall`/`oursOverall`/`oursPrivateOverall`), форма ответа идентична kaggle-варианту.
- [ ] Существующий kaggle `/leaderboard` для `neoai-2026` отвечает байт-в-байт как до SP-3 (regression).
- [ ] Timeout / exit≠0 / невалидный stdout → `failed` с понятным `error_message`.
- [ ] Stale-recovery срабатывает (вставить scoring submission с старым `started_at`, дождаться tick'a, увидеть `pending`).
- [ ] Retry budget: 3 неудачи подряд → `failed` финально (не зацикливается).
- [ ] Rate-limit 50/24h возвращает 429.
- [ ] Admin может удалить, пере-скорить один сабмит, пере-скорить всю задачу.
- [ ] Admin grader-PUT и ground-truth-private-PUT работают (mirror SP-2 GT slot).
- [ ] `npm test` зелёный.
