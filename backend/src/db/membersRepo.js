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
    `SELECT competition_slug AS competitionSlug, user_id AS userId, joined_at AS joinedAt,
            bonus_points AS bonusPoints
     FROM competition_members
     WHERE competition_slug = ? AND user_id = ?`
  ).get(competitionSlug, userId) || null;
}

export function listMembershipsForUser(db, userId) {
  return db.prepare(
    `SELECT competition_slug AS competitionSlug, user_id AS userId, joined_at AS joinedAt,
            bonus_points AS bonusPoints
     FROM competition_members
     WHERE user_id = ?
     ORDER BY joined_at DESC`
  ).all(userId);
}

export function setBonusPoints(db, competitionSlug, userId, bonusPoints) {
  if (typeof bonusPoints !== 'number' || !Number.isFinite(bonusPoints)) {
    throw new Error('bonusPoints must be a finite number');
  }
  // Ensure a row exists (admin can grant bonus before user joins).
  db.prepare(
    `INSERT OR IGNORE INTO competition_members (competition_slug, user_id) VALUES (?, ?)`
  ).run(competitionSlug, userId);
  db.prepare(
    `UPDATE competition_members SET bonus_points = ?
     WHERE competition_slug = ? AND user_id = ?`
  ).run(bonusPoints, competitionSlug, userId);
}

export function getBonusPointsByUserId(db, competitionSlug) {
  const rows = db.prepare(
    `SELECT user_id AS userId, bonus_points AS bonusPoints
     FROM competition_members
     WHERE competition_slug = ?`
  ).all(competitionSlug);
  const map = new Map();
  for (const r of rows) map.set(r.userId, r.bonusPoints);
  return map;
}

export function listMembersWithBonus(db, competitionSlug) {
  return db.prepare(
    `SELECT cm.user_id AS userId, u.email AS email, u.display_name AS displayName,
            u.kaggle_id AS kaggleId, cm.bonus_points AS bonusPoints
     FROM competition_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.competition_slug = ?
     ORDER BY u.display_name COLLATE NOCASE ASC, u.id ASC`
  ).all(competitionSlug);
}
