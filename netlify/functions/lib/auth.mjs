// Session cookie berbasis HMAC (tanpa database), plus proteksi password.

import crypto from 'node:crypto';

export const COOKIE_NAME = 'kasku_session';
const TTL_SECONDS = 12 * 60 * 60;

function secret() {
  const value = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  if (!value) {
    throw new Error('SESSION_SECRET atau APP_PASSWORD belum diset');
  }
  return value;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createToken(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + TTL_SECONDS * 1000, sub: 'owner' })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

export function checkPassword(input) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const given = String(input || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function isAuthenticated(request) {
  const cookies = parseCookies(request.headers.get('cookie'));
  return verifyToken(cookies[COOKIE_NAME]);
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`;
}

export function clearedCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Pembatas percobaan login sederhana (per instance).
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function isRateLimited(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function noteFailedAttempt(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { first: Date.now(), count: 1 });
    return;
  }
  entry.count += 1;
}

export function clearAttempts(key) {
  attempts.delete(key);
}
