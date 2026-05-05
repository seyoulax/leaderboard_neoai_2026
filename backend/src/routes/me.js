import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  findUserById,
  updateUserProfile,
  updateUserPassword,
} from '../db/usersRepo.js';
import { hashPassword, verifyPassword } from '../auth/bcrypt.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userPublic(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    kaggleId: u.kaggleId,
    role: u.role,
    createdAt: u.createdAt,
  };
}

function validateProfilePatch(body) {
  const errors = [];
  const patch = {};
  if ('email' in body) {
    const e = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 254) errors.push('invalid email');
    patch.email = e;
  }
  if ('displayName' in body) {
    const n = String(body.displayName || '').trim();
    if (!n || n.length > 80) errors.push('displayName must be 1–80 chars');
    patch.displayName = n;
  }
  if ('kaggleId' in body) {
    const k = body.kaggleId == null ? null : String(body.kaggleId).trim().toLowerCase();
    if (k && (!/^[a-z0-9-]+$/.test(k) || k.length > 80)) errors.push('invalid kaggleId');
    patch.kaggleId = k || null;
  }
  return { ok: errors.length === 0, errors, patch };
}

export function createMeRouter({ db }) {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    res.json({ user: userPublic(findUserById(db, req.user.id)) });
  });

  router.patch('/', requireAuth, (req, res) => {
    const v = validateProfilePatch(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });
    try {
      const updated = updateUserProfile(db, req.user.id, v.patch);
      res.json({ user: userPublic(updated) });
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) {
        return res.status(400).json({ error: 'email or kaggleId already in use' });
      }
      throw e;
    }
  });

  router.post('/password', requireAuth, async (req, res) => {
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.newPassword || '');
    if (next.length < 8 || next.length > 256) {
      return res.status(400).json({ error: 'newPassword must be 8–256 chars' });
    }
    const u = findUserById(db, req.user.id);
    if (!u || !(await verifyPassword(current, u.passwordHash))) {
      return res.status(400).json({ error: 'invalid current password' });
    }
    const hash = await hashPassword(next);
    updateUserPassword(db, req.user.id, hash);
    res.json({ ok: true });
  });

  return router;
}
