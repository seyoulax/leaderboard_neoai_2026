import crypto from 'node:crypto';

function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

function plusMsIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

export function createSession(db, { userId, ttlMs }) {
  const id = newSessionId();
  const expiresAt = plusMsIso(ttlMs);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    id,
    userId,
    expiresAt
  );
  return { id, userId, expiresAt };
}

export function findSessionWithUser(db, id) {
  const row = db
    .prepare(
      `SELECT s.id AS sessionId, s.expires_at AS expiresAt,
              u.id, u.email, u.display_name AS displayName, u.kaggle_id AS kaggleId, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(id, nowIso());
  if (!row) return null;
  return {
    id: row.sessionId,
    expiresAt: row.expiresAt,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      kaggleId: row.kaggleId,
      role: row.role,
    },
  };
}

export function deleteSession(db, id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function deleteAllUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function cleanupExpired(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}

export function touchSessionExpiry(db, id, ttlMs) {
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(plusMsIso(ttlMs), id);
}
