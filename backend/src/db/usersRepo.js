const COLUMNS = 'id, email, password_hash AS passwordHash, display_name AS displayName, kaggle_id AS kaggleId, role, created_at AS createdAt';

export function createUser(db, { email, passwordHash, displayName, kaggleId = null }) {
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, kaggle_id)
       VALUES (?, ?, ?, ?)`
    )
    .run(email, passwordHash, displayName, kaggleId ? String(kaggleId).toLowerCase() : null);
  return findUserById(db, result.lastInsertRowid);
}

export function findUserById(db, id) {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) || null;
}

export function findUserByEmail(db, email) {
  return db
    .prepare(`SELECT ${COLUMNS} FROM users WHERE email = ? COLLATE NOCASE`)
    .get(email) || null;
}

export function setUserRole(db, id, role) {
  if (role !== 'participant' && role !== 'admin') throw new Error(`bad role: ${role}`);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

export function updateKaggleId(db, id, kaggleId) {
  db.prepare('UPDATE users SET kaggle_id = ? WHERE id = ?').run(
    kaggleId ? String(kaggleId).toLowerCase() : null,
    id
  );
}

export function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}
