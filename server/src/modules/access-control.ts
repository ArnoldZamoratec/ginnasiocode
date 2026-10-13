import { one } from '../db/db.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import type { AuthUser } from '../lib/http.ts';

/**
 * Ámbitos de acceso a la información de un socio:
 *  - basic:    datos de contacto, plan, asistencia → recepción, admin, entrenador asignado, el propio socio
 *  - finance:  pagos y deuda                      → recepción, admin, el propio socio
 *  - training: rutinas, progreso, medidas          → entrenador asignado, admin, el propio socio
 *  - health:   notas de salud                      → entrenador asignado, admin, el propio socio
 */
export type Scope = 'basic' | 'finance' | 'training' | 'health';

export function canAccessMember(user: AuthUser, memberId: number, scope: Scope): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'member') return user.memberId === memberId;
  if (user.role === 'reception') return scope === 'basic' || scope === 'finance';
  if (user.role === 'trainer') {
    if (scope === 'finance') return false;
    const m = one<{ trainer_id: number | null }>('SELECT trainer_id FROM members WHERE id = ?', [memberId]);
    return m?.trainer_id === user.id;
  }
  return false;
}

export function assertMemberAccess(user: AuthUser, memberId: number, scope: Scope): void {
  const exists = one<{ id: number }>('SELECT id FROM members WHERE id = ?', [memberId]);
  if (!exists) throw notFound('El socio');
  if (!canAccessMember(user, memberId, scope)) throw forbidden('No tienes acceso a esta información del socio.');
}
