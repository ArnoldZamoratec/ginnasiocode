import { z } from 'zod';
import type { Request, Response } from 'express';
import { insert, one, run, tx } from '../db/db.ts';
import { route, type AuthUser, type Role, type AccessClaims } from '../lib/http.ts';
import { AppError, unauthorized, unprocessable } from '../lib/errors.ts';
import { DUMMY_HASH, hashPassword, randomToken, sha256, signJwt, verifyPassword } from '../lib/crypto.ts';
import { config } from '../config.ts';
import { clock } from '../lib/clock.ts';
import { audit } from '../lib/audit.ts';

const COOKIE = 'gymos_rt';
const COOKIE_PATH = '/api/auth';
const ROTATION_GRACE_MS = 30_000;

interface UserRow {
  id: number; email: string; password_hash: string; role: Role; full_name: string;
  active: number; branch_id: number | null; member_id: number | null;
}

const USER_SQL = `SELECT u.*, m.id AS member_id FROM users u LEFT JOIN members m ON m.user_id = u.id`;

export const passwordSchema = z.string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Incluye al menos una letra y un número');

function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, role: u.role, name: u.full_name, memberId: u.member_id, branchId: u.branch_id };
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function setRefreshCookie(res: Response, token: string | null): void {
  const attrs = [
    `${COOKIE}=${token ?? ''}`, `Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${token ? config.refreshTokenTtlDays * 86400 : 0}`,
  ];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function issueSession(u: UserRow, res: Response, family = randomToken(12)) {
  const now = clock.now();
  const claims: Omit<AccessClaims, 'iat' | 'exp'> = {
    sub: u.id, role: u.role, name: u.full_name, mid: u.member_id, bid: u.branch_id, typ: 'access',
  };
  const accessToken = signJwt(claims, config.jwtSecret, config.accessTokenTtlSec, now.getTime());
  const refresh = randomToken(32);
  insert('INSERT INTO refresh_tokens (user_id, family, token_hash, expires_at) VALUES (?, ?, ?, ?)', [
    u.id, family, sha256(refresh), new Date(now.getTime() + config.refreshTokenTtlDays * 86_400_000).toISOString(),
  ]);
  setRefreshCookie(res, refresh);
  return { accessToken, expiresIn: config.accessTokenTtlSec, user: publicUser(u) };
}

/** Protección contra fuerza bruta: por cuenta (desde el último acceso exitoso) y por IP. */
function assertNotLocked(email: string, ip: string): void {
  const { windowMinutes, maxFailuresPerAccount, maxFailuresPerIp } = config.login;
  const now = clock.now();
  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const acct = one<{ n: number; first: string | null }>(
    `SELECT COUNT(*) n, MIN(created_at) first FROM login_attempts
     WHERE email = :email AND success = 0 AND created_at > :since
       AND created_at > IFNULL((SELECT MAX(created_at) FROM login_attempts WHERE email = :email AND success = 1), '')`,
    { email, since },
  )!;
  const byIp = one<{ n: number; first: string | null }>(
    'SELECT COUNT(*) n, MIN(created_at) first FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?', [ip, since],
  )!;
  const blocked = acct.n >= maxFailuresPerAccount ? acct : byIp.n >= maxFailuresPerIp ? byIp : null;
  if (blocked) {
    const retryAfterSec = Math.max(1, Math.ceil((new Date(blocked.first!).getTime() + windowMinutes * 60_000 - now.getTime()) / 1000));
    throw new AppError(429, 'TOO_MANY_ATTEMPTS',
      `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(retryAfterSec / 60)} min.`, { retryAfterSec });
  }
}

function recordAttempt(email: string, ip: string, success: boolean): void {
  run('INSERT INTO login_attempts (email, ip, success, created_at) VALUES (?, ?, ?, ?)', [email, ip, success, clock.now().toISOString()]);
}

export function revokeAllSessions(userId: number): void {
  run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [clock.now().toISOString(), userId]);
}

const csrfGuard = (req: Request) => {
  // La cookie es SameSite=Strict; además exigimos un encabezado propio que un formulario externo no puede enviar.
  if (req.headers['x-requested-with'] !== 'gymos') throw new AppError(403, 'CSRF', 'Solicitud no permitida.');
};

export const authRoutes = [
  route({
    method: 'post', path: '/auth/login', tag: 'Autenticación', summary: 'Iniciar sesión', auth: 'public',
    description: 'Devuelve un access token (15 min) y fija un refresh token rotativo en cookie httpOnly. Bloquea tras 5 intentos fallidos por cuenta o 20 por IP en 15 min.',
    body: z.object({ email: z.email('Correo inválido').max(120), password: z.string().min(1).max(200) }).strict(),
    handler: async ({ body, ip, res, req }) => {
      csrfGuard(req);
      const email = body.email.trim().toLowerCase();
      assertNotLocked(email, ip);
      const u = one<UserRow>(`${USER_SQL} WHERE u.email = ?`, [email]);
      const ok = await verifyPassword(body.password, u?.password_hash ?? DUMMY_HASH);
      if (!u || !ok || !u.active) {
        recordAttempt(email, ip, false);
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
      }
      recordAttempt(email, ip, true);
      return issueSession(u, res);
    },
  }),
  route({
    method: 'post', path: '/auth/refresh', tag: 'Autenticación', summary: 'Renovar access token (rota el refresh token)', auth: 'public',
    description: 'Si se presenta un refresh token ya usado, se asume robo y se revoca toda la familia de sesiones.',
    handler: ({ req, res }) => {
      csrfGuard(req);
      const token = readCookie(req, COOKIE);
      if (!token) throw unauthorized();
      // La revocación por reutilización debe confirmarse: se devuelve un marcador y se lanza el error
      // fuera de la transacción (lanzarlo dentro haría ROLLBACK y dejaría viva la sesión robada).
      const outcome = tx(() => {
        const row = one<{ id: number; user_id: number; family: string; expires_at: string; revoked_at: string | null; rotated_at: string | null }>(
          'SELECT * FROM refresh_tokens WHERE token_hash = ?', [sha256(token)],
        );
        const now = clock.now().toISOString();
        if (!row) return null;
        // Margen para pestañas que renuevan a la vez: un token rotado hace menos de 30 s sigue sirviendo
        // dentro de la misma familia. Pasado ese margen, o si fue revocado por logout, se asume robo.
        if (row.revoked_at && row.rotated_at && Date.parse(now) - Date.parse(row.rotated_at) <= ROTATION_GRACE_MS) {
          const u = one<UserRow>(`${USER_SQL} WHERE u.id = ?`, [row.user_id]);
          const familyAlive = one('SELECT id FROM refresh_tokens WHERE family = ? AND revoked_at IS NULL', [row.family]);
          if (u?.active && familyAlive) return issueSession(u, res, row.family);
        }
        if (row.revoked_at) {
          run('UPDATE refresh_tokens SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL', [now, row.family]);
          audit({ id: row.user_id }, 'auth.refresh_reuse', 'user', row.user_id, { family: row.family });
          return 'reused' as const;
        }
        if (row.expires_at <= now) return null;
        const u = one<UserRow>(`${USER_SQL} WHERE u.id = ?`, [row.user_id]);
        if (!u?.active) return null;
        run('UPDATE refresh_tokens SET revoked_at = ?, rotated_at = ? WHERE id = ?', [now, now, row.id]);
        return issueSession(u, res, row.family);
      });
      if (outcome && outcome !== 'reused') return outcome;
      setRefreshCookie(res, null);
      throw outcome === 'reused' ? unauthorized('Detectamos un uso inusual de tu sesión. Ingresa nuevamente.') : unauthorized();
    },
  }),
  route({
    method: 'post', path: '/auth/logout', tag: 'Autenticación', summary: 'Cerrar sesión', auth: 'public',
    handler: ({ req, res }) => {
      const token = readCookie(req, COOKIE);
      if (token) {
        const row = one<{ family: string }>('SELECT family FROM refresh_tokens WHERE token_hash = ?', [sha256(token)]);
        if (row) run('UPDATE refresh_tokens SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL', [clock.now().toISOString(), row.family]);
      }
      setRefreshCookie(res, null);
    },
  }),
  route({
    method: 'get', path: '/auth/me', tag: 'Autenticación', summary: 'Usuario actual', auth: 'any',
    handler: ({ user }) => {
      const u = one<UserRow>(`${USER_SQL} WHERE u.id = ?`, [user.id]);
      if (!u?.active) throw unauthorized();
      return publicUser(u);
    },
  }),
  route({
    method: 'post', path: '/auth/change-password', tag: 'Autenticación', summary: 'Cambiar contraseña (cierra otras sesiones)', auth: 'any',
    body: z.object({ current: z.string().min(1).max(200), next: passwordSchema }).strict(),
    handler: async ({ user, body, res, ip }) => {
      const u = one<UserRow>(`${USER_SQL} WHERE u.id = ?`, [user.id])!;
      if (!(await verifyPassword(body.current, u.password_hash))) {
        throw unprocessable('WRONG_PASSWORD', 'La contraseña actual no es correcta.');
      }
      run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.next), user.id]);
      revokeAllSessions(user.id);
      audit(user, 'auth.password_changed', 'user', user.id, {}, ip);
      return issueSession(u, res);
    },
  }),
];

export type { AuthUser };
