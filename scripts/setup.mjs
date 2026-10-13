// Crea server/.env con secretos aleatorios si no existe. Idempotente.
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const path = new URL('../server/.env', import.meta.url);
if (existsSync(path)) {
  console.log('server/.env ya existe; no se modifica.');
} else {
  const s = () => randomBytes(32).toString('hex');
  writeFileSync(path, [
    '# Generado por scripts/setup.mjs. No subir a control de versiones.',
    `JWT_SECRET=${s()}`,
    `PASS_SECRET=${s()}`,
    'DB_PATH=data/gymos.db',
    'PORT=3001',
    '# MAIL_TRANSPORT=smtp',
    '# SMTP_URL=smtps://usuario:clave@smtp.ejemplo.com:465',
    '# MAIL_FROM=GymOS <no-responder@tu-gimnasio.pe>',
    '',
  ].join('\n'));
  console.log('server/.env creado con secretos nuevos.');
}
