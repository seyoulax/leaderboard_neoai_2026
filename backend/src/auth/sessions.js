import { parse, serialize } from 'cookie';

export const SESSION_COOKIE = 'session';

export function sessionTtlMs() {
  const days = Number(process.env.SESSION_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 30) * 24 * 60 * 60 * 1000;
}

function isSecureRequest(req) {
  const env = (process.env.COOKIE_SECURE || 'auto').toLowerCase();
  if (env === 'true') return true;
  if (env === 'false') return false;
  if (!req) return false;
  if (req.protocol === 'https') return true;
  const xfp = req.headers?.['x-forwarded-proto'];
  return typeof xfp === 'string' && xfp.split(',')[0].trim() === 'https';
}

export function cookieOptionsFromReq(req) {
  return { secure: isSecureRequest(req) };
}

export function buildSessionCookie(id, { secure }) {
  return serialize(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!secure,
    path: '/',
    maxAge: Math.floor(sessionTtlMs() / 1000),
  });
}

export function buildClearCookie({ secure }) {
  return serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!secure,
    path: '/',
    maxAge: 0,
  });
}

export function getCookieFromReq(req) {
  const header = req?.headers?.cookie;
  if (!header) return null;
  const parsed = parse(header);
  return parsed[SESSION_COOKIE] || null;
}
