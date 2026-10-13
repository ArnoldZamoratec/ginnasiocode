import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../../lib/api.ts';
import { useApi } from '../../lib/hooks.ts';
import { Empty, Load, PageHead, Skeleton } from '../../components/ui.tsx';
import { dateTime, ROLE } from '../../lib/format.ts';

interface Row { id: number; actor_id: number | null; actor_name: string | null; actor_role: string | null; action: string; entity: string; entity_id: number | null; details: Record<string, unknown>; ip: string | null; created_at: string }

const ACTIONS: Record<string, string> = {
  'pii.view': 'Consultó datos personales', 'payment.create': 'Registró pago', 'payment.void': 'Anuló pago', 'membership.sell': 'Vendió plan',
  'membership.change_plan': 'Cambió de plan', 'membership.freeze': 'Congeló plan', 'membership.unfreeze': 'Reactivó plan', 'member.create': 'Registró socio',
  'member.update': 'Editó socio', 'member.assign_trainer': 'Asignó entrenador', 'member.account_created': 'Creó acceso a la app', 'auth.password_changed': 'Cambió su contraseña',
  'auth.refresh_reuse': 'Posible robo de sesión (bloqueada)', 'settings.update': 'Cambió ajustes', 'plan.create': 'Creó plan', 'plan.update': 'Editó plan',
  'staff.create': 'Dio de alta personal', 'staff.update': 'Editó personal', 'class.cancel': 'Canceló clase', 'class.update': 'Ajustó clase',
  'reservation.create': 'Reservó por un socio', 'reservation.cancel': 'Canceló reserva', 'guest_visit.create': 'Registró invitado', 'template.update': 'Editó plantilla de aviso',
  'schedule.create': 'Agregó clase al horario', 'schedule.toggle': 'Activó/desactivó horario', 'branch.create': 'Creó sede', 'branch.update': 'Editó sede',
};
const FILTERS = [['', 'Todo'], ['pii', 'Datos personales'], ['payment', 'Pagos'], ['membership', 'Membresías'], ['auth', 'Seguridad'], ['settings', 'Ajustes']] as const;

function summary(r: Row): string {
  const d = r.details ?? {};
  if (r.action === 'pii.view') return `Campos: ${(d.fields as string[] | undefined)?.map((f) => ({ dni: 'DNI', health_notes: 'salud', birth_date: 'nacimiento' }[f] ?? f)).join(', ')}`;
  if (r.action === 'payment.void') return `Motivo: ${d.reason}`;
  if (r.action === 'membership.freeze') return `${d.days} días · ${d.reason}`;
  if (r.action === 'settings.update') return Object.keys((d.after as object) ?? {}).join(', ');
  return '';
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const q = useApi<Row[]>(`/admin/audit${qs({ action, limit: 300 })}`);
  return (
    <div className="page">
      <PageHead eyebrow="Seguridad" title="Auditoría" />
      <div className="stack-lg">
        <p className="muted">Quién hizo qué y cuándo. Incluye cada consulta a DNI, fecha de nacimiento y notas de salud. Este registro no se puede editar ni borrar.</p>
        <div className="chips">
          {FILTERS.map(([k, l]) => <button key={k} className="chip" aria-pressed={action === k} onClick={() => setAction(k)}>{l}</button>)}
        </div>
        <Load q={q} skeleton={<Skeleton lines={12} />}>
          {(rows) => rows.length === 0 ? <Empty glyph="0" title="Sin registros" /> : (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th className="hide-sm">Sobre</th><th className="hide-sm">Detalle</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{dateTime(r.created_at)}</td>
                      <td>{r.actor_name ?? 'Sistema'}{r.actor_role && <div className="faint" style={{ fontSize: 12 }}>{ROLE[r.actor_role]}</div>}</td>
                      <td className={r.action === 'auth.refresh_reuse' ? 'bad' : ''}>{ACTIONS[r.action] ?? r.action}</td>
                      <td className="hide-sm">{r.entity === 'member' && r.entity_id ? <Link className="linkish" to={`/socios/${r.entity_id}`}>Socio #{r.entity_id}</Link> : r.entity_id ? `${r.entity} #${r.entity_id}` : r.entity}</td>
                      <td className="hide-sm faint" style={{ fontSize: 13 }}>{summary(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Load>
      </div>
    </div>
  );
}
