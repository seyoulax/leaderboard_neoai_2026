const COLUMNS = `slug, title, subtitle, type,
  CAST(visible AS INTEGER) AS visible,
  display_order AS displayOrder,
  created_at AS createdAt,
  deleted_at AS deletedAt`;

function rowToCompetition(row) {
  if (!row) return null;
  return { ...row, visible: row.visible === 1 };
}

export function insertCompetition(db, c) {
  db.prepare(
    `INSERT INTO competitions (slug, title, subtitle, type, visible, display_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    c.slug,
    c.title,
    c.subtitle ?? null,
    c.type,
    c.visible === false ? 0 : 1,
    Number.isFinite(c.displayOrder) ? c.displayOrder : 0
  );
  return getCompetition(db, c.slug);
}

export function upsertCompetition(db, c) {
  const existing = db.prepare('SELECT slug FROM competitions WHERE slug = ?').get(c.slug);
  if (existing) {
    db.prepare(
      `UPDATE competitions
       SET title = ?, subtitle = ?, type = ?, visible = ?, display_order = ?, deleted_at = NULL
       WHERE slug = ?`
    ).run(
      c.title,
      c.subtitle ?? null,
      c.type,
      c.visible === false ? 0 : 1,
      Number.isFinite(c.displayOrder) ? c.displayOrder : 0,
      c.slug
    );
  } else {
    insertCompetition(db, c);
  }
  return getCompetition(db, c.slug);
}

export function getCompetition(db, slug) {
  return rowToCompetition(
    db.prepare(`SELECT ${COLUMNS} FROM competitions WHERE slug = ?`).get(slug)
  );
}

export function listActiveCompetitions(db) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM competitions
       WHERE deleted_at IS NULL
       ORDER BY display_order, slug`
    )
    .all()
    .map(rowToCompetition);
}

export function listVisibleCompetitions(db) {
  return listActiveCompetitions(db).filter((c) => c.visible);
}

export function softDeleteCompetition(db, slug) {
  db.prepare('UPDATE competitions SET deleted_at = ? WHERE slug = ?').run(
    new Date().toISOString(),
    slug
  );
}

export function bulkReplaceCompetitions(db, list) {
  const incoming = new Set(list.map((c) => c.slug));
  db.transaction(() => {
    for (const c of list) upsertCompetition(db, c);
    const existing = db
      .prepare('SELECT slug FROM competitions WHERE deleted_at IS NULL')
      .all()
      .map((r) => r.slug);
    for (const slug of existing) {
      if (!incoming.has(slug)) softDeleteCompetition(db, slug);
    }
  })();
  return listActiveCompetitions(db);
}
