import crypto from 'node:crypto';
import {
  findSessionWithUser,
  touchSessionExpiry,
  deleteSession,
} from '../db/sessionsRepo.js';
import {
  getCookieFromReq,
  buildClearCookie,
  cookieOptionsFromReq,
  sessionTtlMs,
} from './sessions.js';

const TOUCH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function loadUser({ db }) {
  return function (req, _res, next) {
    req.user = null;
    req.session = null;
    const id = getCookieFromReq(req);
    if (!id) return next();
    const sess = findSessionWithUser(db, id);
    if (!sess) return next();
    req.user = sess.user;
    req.session = sess;
    if (new Date(sess.expiresAt).getTime() - Date.now() < TOUCH_THRESHOLD_MS) {
      try { touchSessionExpiry(db, id, sessionTtlMs()); } catch {}
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

function safeEqualToken(provided, expected) {
  const a = Buffer.from(provided || '', 'utf8');
  const b = Buffer.from(expected || '', 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function requireAdmin({ adminToken } = {}) {
  return function (req, res, next) {
    if (req.user?.role === 'admin') return next();
    const provided = req.get('x-admin-token') || '';
    if (adminToken && provided && safeEqualToken(provided, adminToken)) {
      console.warn('[admin] x-admin-token fallback used (deprecate after SP-4)');
      return next();
    }
    if (provided) {
      res.status(401).json({ error: 'invalid admin token' });
      return;
    }
    if (req.user) {
      res.status(403).json({ error: 'admin role required' });
      return;
    }
    res.status(401).json({ error: 'authentication required' });
  };
}

export function clearSessionCookie(req, res) {
  const opts = cookieOptionsFromReq(req);
  res.setHeader('Set-Cookie', buildClearCookie(opts));
}

export function destroyCurrentSession(req, res, db) {
  if (req.session) {
    try { deleteSession(db, req.session.id); } catch {}
  }
  clearSessionCookie(req, res);
}
