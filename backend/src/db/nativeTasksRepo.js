const COLS = `id,
  competition_slug AS competitionSlug,
  slug,
  title,
  description_md AS descriptionMd,
  CAST(higher_is_better AS INTEGER) AS higherIsBetterRaw,
  baseline_score_public AS baselineScorePublic,
  author_score_public AS authorScorePublic,
  baseline_score_private AS baselineScorePrivate,
  author_score_private AS authorScorePrivate,
  grader_path AS graderPath,
  ground_truth_path AS groundTruthPath,
  ground_truth_private_path AS groundTruthPrivatePath,
  CAST(visible AS INTEGER) AS visibleRaw,
  display_order AS displayOrder,
  created_at AS createdAt,
  deleted_at AS deletedAt`;

function rowToTask(row) {
  if (!row) return null;
  const t = { ...row, higherIsBetter: row.higherIsBetterRaw === 1, visible: row.visibleRaw === 1 };
  delete t.higherIsBetterRaw;
  delete t.visibleRaw;
  return t;
}

export function insertNativeTask(db, t) {
  const result = db
    .prepare(
      `INSERT INTO native_tasks (
        competition_slug, slug, title, description_md, higher_is_better,
        baseline_score_public, author_score_public,
        baseline_score_private, author_score_private,
        visible, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      t.competitionSlug,
      t.slug,
      t.title,
      t.descriptionMd ?? '',
      t.higherIsBetter === false ? 0 : 1,
      t.baselineScorePublic ?? null,
      t.authorScorePublic ?? null,
      t.baselineScorePrivate ?? null,
      t.authorScorePrivate ?? null,
      t.visible === false ? 0 : 1,
      Number.isFinite(t.displayOrder) ? t.displayOrder : 0
    );
  return getNativeTaskById(db, result.lastInsertRowid);
}

export function getNativeTaskById(db, id) {
  return rowToTask(db.prepare(`SELECT ${COLS} FROM native_tasks WHERE id = ?`).get(id));
}

export function getNativeTask(db, competitionSlug, slug) {
  return rowToTask(
    db
      .prepare(
        `SELECT ${COLS} FROM native_tasks
         WHERE competition_slug = ? AND slug = ? AND deleted_at IS NULL`
      )
      .get(competitionSlug, slug)
  );
}

export function listNativeTasks(db, competitionSlug) {
  return db
    .prepare(
      `SELECT ${COLS} FROM native_tasks
       WHERE competition_slug = ? AND deleted_at IS NULL
       ORDER BY display_order, slug`
    )
    .all(competitionSlug)
    .map(rowToTask);
}

const UPDATABLE = {
  title: 'title',
  descriptionMd: 'description_md',
  higherIsBetter: 'higher_is_better',
  baselineScorePublic: 'baseline_score_public',
  authorScorePublic: 'author_score_public',
  baselineScorePrivate: 'baseline_score_private',
  authorScorePrivate: 'author_score_private',
  graderPath: 'grader_path',
  groundTruthPath: 'ground_truth_path',
  groundTruthPrivatePath: 'ground_truth_private_path',
  visible: 'visible',
  displayOrder: 'display_order',
};

export function updateNativeTask(db, competitionSlug, slug, patch) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(UPDATABLE)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'higherIsBetter' || k === 'visible') v = v === false ? 0 : 1;
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (!sets.length) return getNativeTask(db, competitionSlug, slug);
  vals.push(competitionSlug, slug);
  db.prepare(
    `UPDATE native_tasks SET ${sets.join(', ')}
     WHERE competition_slug = ? AND slug = ? AND deleted_at IS NULL`
  ).run(...vals);
  return getNativeTask(db, competitionSlug, slug);
}

export function softDeleteNativeTask(db, competitionSlug, slug) {
  db.prepare(
    `UPDATE native_tasks SET deleted_at = ?
     WHERE competition_slug = ? AND slug = ? AND deleted_at IS NULL`
  ).run(new Date().toISOString(), competitionSlug, slug);
}
