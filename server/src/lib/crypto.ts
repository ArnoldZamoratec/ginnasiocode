import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// scrypt (memoria-dura) con parámetros recomendados por OWASP: N=2^17, r=8, p=1.
// En pruebas se reduce N para que la suite sea rápida; el costo viaja dentro del hash.
const isTest = process.argv.some((a) => a.includes('--test')) || process.env.NODE_ENV === 'test';
const N = isTest ? 1 << 12 : 1 << 17, R = 8, P = 1, KEYLEN = 32, MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return timingSafeEqual(key, expected);
}

/** Hash fijo para comparar en tiempo constante cuando el usuario no existe (evita enumeración por tiempo). */
export const DUMMY_HASH = 'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---- JWT HS256 mínimo (solo lo que usamos: firma, exp, iat) ----
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...payload, iat, exp: iat + ttlSec })}`;
  return `${body}.${hmac(secret, body)}`;
}

export function verifyJwt<T>(token: string, secret: string, nowMs = Date.now()): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  if (!safeEqual(sig, hmac(secret, `${h}.${p}`))) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
    return payload as T;
  } catch {
    return null;
  }
}
