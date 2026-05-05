export function joinCompetition(db, competitionSlug, userId) {
  const result = db.prepare(
    `INSERT OR IGNORE INTO competition_members (competition_slug, user_id) VALUES (?, ?)`
  ).run(competitionSlug, userId);
  return { alreadyMember: result.changes === 0 };
}

export function leaveCompetition(db, competitionSlug, userId) {
  return db.prepare(
    `DELETE FROM competition_members WHERE competition_slug = ? AND user_id = ?`
  ).run(competitionSlug, userId).changes;
}

export function isMember(db, competitionSlug, userId) {
  const row = db.prepare(
    `SELECT 1 FROM competition_members WHERE competition_slug = ? AND user_id = ?`
  ).get(competitionSlug, userId);
  return !!row;
}

export function getMembership(db, competitionSlug, userId) {
  return db.prepare(
    `SELECT competition_slug AS competitionSlug, user_id AS userId, joined_at AS joinedAt
     FROM competition_members
     WHERE competition_slug = ? AND user_id = ?`
  ).get(competitionSlug, userId) || null;
}

export function listMembershipsForUser(db, userId) {
  return db.prepare(
    `SELECT competition_slug AS competitionSlug, user_id AS userId, joined_at AS joinedAt
     FROM competition_members
     WHERE user_id = ?
     ORDER BY joined_at DESC`
  ).all(userId);
}
