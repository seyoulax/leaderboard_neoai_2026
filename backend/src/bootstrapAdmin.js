import { hashPassword } from './auth/bcrypt.js';
import { createUser, countAdmins, findUserByEmail, setUserRole } from './db/usersRepo.js';

export async function bootstrapAdmin({ db, email, password }) {
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (!e || !p) return { created: false, reason: 'env not set' };
  if (countAdmins(db) > 0) return { created: false, reason: 'admin already exists' };
  const existing = findUserByEmail(db, e);
  if (existing) {
    setUserRole(db, existing.id, 'admin');
    return { created: false, promoted: true, userId: existing.id };
  }
  const u = createUser(db, {
    email: e,
    passwordHash: await hashPassword(p),
    displayName: 'Admin',
  });
  setUserRole(db, u.id, 'admin');
  return { created: true, userId: u.id };
}
