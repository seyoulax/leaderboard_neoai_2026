const COLUMNS = 'id, email, password_hash AS passwordHash, display_name AS displayName, kaggle_id AS kaggleId, role, created_at AS createdAt';

function normalizeKaggleId(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s || null;
}

function normalizeEmail(v) {
  return String(v).trim().toLowerCase();
}

export function createUser(db, { email, passwordHash, displayName, kaggleId = null }) {
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, kaggle_id)
       VALUES (?, ?, ?, ?)`
    )
    .run(normalizeEmail(email), passwordHash, displayName, normalizeKaggleId(kaggleId));
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
    normalizeKaggleId(kaggleId),
    id
  );
}

export function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

const PROFILE_UPDATABLE = {
  email: 'email',
  displayName: 'display_name',
  kaggleId: 'kaggle_id',
};

export function updateUserProfile(db, id, patch) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(PROFILE_UPDATABLE)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'kaggleId') v = normalizeKaggleId(v);
    if (k === 'email') v = normalizeEmail(v);
    if (k === 'displayName') v = String(v).trim();
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (!sets.length) return findUserById(db, id);
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return findUserById(db, id);
}

export function updateUserPassword(db, id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}
