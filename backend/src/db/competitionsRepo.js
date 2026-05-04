const COLUMNS = `slug, title, subtitle, type, visibility,
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
    `INSERT INTO competitions (slug, title, subtitle, type, visibility, visible, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    c.slug,
    c.title,
    c.subtitle ?? null,
    c.type,
    c.visibility === 'unlisted' ? 'unlisted' : 'public',
    c.visible === false ? 0 : 1,
    Number.isFinite(c.displayOrder) ? c.displayOrder : 0
  );
  return getCompetition(db, c.slug);
}

export function upsertCompetition(db, c) {
  const existing = db.prepare('SELECT type FROM competitions WHERE slug = ?').get(c.slug);
  if (existing && c.type && c.type !== existing.type) {
    throw new Error(`type lock: cannot change competition '${c.slug}' type from ${existing.type} to ${c.type}`);
  }
  if (existing) {
    db.prepare(
      `UPDATE competitions
       SET title = ?, subtitle = ?, visibility = ?, visible = ?, display_order = ?, deleted_at = NULL
       WHERE slug = ?`
    ).run(
      c.title,
      c.subtitle ?? null,
      c.visibility === 'unlisted' ? 'unlisted' : 'public',
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
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM competitions
       WHERE deleted_at IS NULL AND visibility = 'public' AND visible = 1
       ORDER BY display_order, slug`
    )
    .all()
    .map(rowToCompetition);
}

export function searchPublicCompetitions(db, q) {
  const term = String(q ?? '').trim();
  if (!term) return listVisibleCompetitions(db);
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM competitions
       WHERE deleted_at IS NULL AND visibility = 'public' AND visible = 1
         AND title LIKE ? COLLATE NOCASE
       ORDER BY display_order, slug`
    )
    .all(`%${term}%`)
    .map(rowToCompetition);
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
