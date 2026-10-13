import { run } from '../db/db.ts';
import type { AuthUser } from './http.ts';

/**
 * Registro inmutable (triggers en BD impiden UPDATE/DELETE).
 * Acciones con prefijo "pii." registran consultas de datos personales: quién vio qué y cuándo.
 */
export function audit(
  actor: Pick<AuthUser, 'id'> | null,
  action: string,
  entity: string,
  entityId: number | null,
  details: Record<string, unknown> = {},
  ip?: string,
): void {
  run(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    [actor?.id ?? null, action, entity, entityId, JSON.stringify(details), ip ?? null],
  );
}
