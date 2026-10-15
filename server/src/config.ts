import { randomBytes } from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.argv.some((a) => a.includes('--test'));

function secret(name: string): string {
  const v = process.env[name];
  if (v && v.length >= 32) return v;
  if (isProd) throw new Error(`${name} debe definirse (mínimo 32 caracteres) en producción`);
  // En desarrollo se genera uno por proceso: reiniciar el servidor invalida sesiones, lo cual es aceptable.
  return process.env[`${name}_DEV`] ?? randomBytes(32).toString('hex');
}

export const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 3001),
  dbPath: process.env.DB_PATH ?? 'data/gymos.db',
  jwtSecret: secret('JWT_SECRET'),
  passSecret: secret('PASS_SECRET'),
  accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 15 * 60),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  // Saltos de proxy de confianza para req.ip (p. ej. "1" detrás del balanceador de Render).
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY ?? '') ? Number(process.env.TRUST_PROXY) : (process.env.TRUST_PROXY || 'loopback'),
  mail: {
    transport: (process.env.MAIL_TRANSPORT ?? 'log') as 'log' | 'smtp',
    from: process.env.MAIL_FROM ?? 'GymOS <no-responder@gymos.local>',
    smtpUrl: process.env.SMTP_URL ?? '',
  },
  login: {
    maxFailuresPerAccount: 5,
    maxFailuresPerIp: 20,
    windowMinutes: 15,
  },
};
