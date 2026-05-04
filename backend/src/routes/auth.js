import { Router } from 'express';
import { createUser, findUserByEmail } from '../db/usersRepo.js';
import { createSession } from '../db/sessionsRepo.js';
import { hashPassword, verifyPassword } from '../auth/bcrypt.js';
import {
  buildSessionCookie,
  cookieOptionsFromReq,
  sessionTtlMs,
} from '../auth/sessions.js';
import { destroyCurrentSession } from '../auth/middleware.js';
import { makeRateLimiter } from '../auth/rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegisterInput(body) {
  const errors = [];
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const displayName = String(body?.displayName || '').trim();
  const kaggleId = body?.kaggleId == null ? null : String(body.kaggleId).trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) errors.push('invalid email');
  if (password.length < 8 || password.length > 256) errors.push('password must be 8–256 chars');
  if (!displayName || displayName.length > 80) errors.push('displayName must be 1–80 chars');
  if (kaggleId && (!/^[a-z0-9-]+$/.test(kaggleId) || kaggleId.length > 80)) {
    errors.push('invalid kaggleId');
  }
  return { ok: errors.length === 0, errors, email, password, displayName, kaggleId };
}

function userPublic(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    kaggleId: u.kaggleId,
    role: u.role,
  };
}

function setSessionCookie(req, res, sessionId) {
  res.setHeader('Set-Cookie', buildSessionCookie(sessionId, cookieOptionsFromReq(req)));
}

export function createAuthRouter({ db }) {
  const router = Router();
  const loginLimit = makeRateLimiter({ max: 10, windowMs: 60_000 });
  const registerLimit = makeRateLimiter({ max: 10, windowMs: 60_000 });

  router.post('/register', async (req, res) => {
    if (!registerLimit.allow(req.ip || 'anon')) {
      res.status(429).json({ error: 'too many requests' });
      return;
    }
    const v = validateRegisterInput(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.errors.join('; ') });
      return;
    }
    const passwordHash = await hashPassword(v.password);
    let user;
    try {
      user = createUser(db, {
        email: v.email,
        passwordHash,
        displayName: v.displayName,
        kaggleId: v.kaggleId,
      });
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) {
        res.status(400).json({ error: 'email or kaggleId already in use' });
        return;
      }
      throw e;
    }
    const sess = createSession(db, { userId: user.id, ttlMs: sessionTtlMs() });
    setSessionCookie(req, res, sess.id);
    res.json({ user: userPublic(user) });
  });

  router.post('/login', async (req, res) => {
    if (!loginLimit.allow(req.ip || 'anon')) {
      res.status(429).json({ error: 'too many requests' });
      return;
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = findUserByEmail(db, email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    const sess = createSession(db, { userId: user.id, ttlMs: sessionTtlMs() });
    setSessionCookie(req, res, sess.id);
    res.json({ user: userPublic(user) });
  });

  router.post('/logout', (req, res) => {
    destroyCurrentSession(req, res, db);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: userPublic(req.user) });
  });

  return router;
}
