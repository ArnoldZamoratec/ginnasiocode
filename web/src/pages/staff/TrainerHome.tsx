import { useNavigate } from 'react-router-dom';
import { useApi } from '../../lib/hooks.ts';
import { useUser } from '../../lib/auth.tsx';
import { Empty, Kpi, Load, PageHead, Section, Skeleton, Tag } from '../../components/ui.tsx';
import { ago, diffDays, kg, localDate, time, today } from '../../lib/format.ts';
import type { Session } from '../../lib/types.ts';

interface Row { id: number; full_name: string; phone: string | null; last_workout: string | null; workouts_30d: number; routine_name: string | null; last_visit: string | null; last_weight: number | null }

export function TrainerHome() {
  const user = useUser();
  const nav = useNavigate();
  const q = useApi<Row[]>('/trainer/members');
  const t = today();
  const classes = useApi<{ items: Session[] }>(`/classes/sessions?from=${t}&to=${t}`);
  const mine = (classes.data?.items ?? []).filter((s) => s.trainerId === user.id && s.status === 'scheduled');
  const idle = (r: Row) => !r.last_workout || diffDays(localDate(r.last_workout), t) > 10;

  return (
    <div className="page">
      <PageHead eyebrow={`Hola, ${user.name.split(' ')[0]}`} title="Mis socios" />
      <Load q={q} skeleton={<Skeleton block lines={8} />}>
        {(rows) => (
          <div className="stack-lg">
            <div className="kpis">
              <Kpi hero label="Asignados" value={rows.length} />
              <Kpi label="Sin rutina" value={rows.filter((r) => !r.routine_name).length} detail="asígnales una" />
              <Kpi label="Inactivos +10 días" value={rows.filter(idle).length} detail="sin entrenamiento registrado" />
              <Kpi label="Tus clases hoy" value={mine.length} detail={mine.map((s) => time(s.startsAt)).join(' · ') || '—'} />
            </div>
            <Section idx="01" title="Seguimiento" aside="Primero quienes llevan más tiempo sin entrenar">
              {rows.length === 0 ? <Empty glyph="0" title="Sin socios asignados">Recepción asigna socios a cada entrenador desde la ficha del socio.</Empty> : (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th>Socio</th><th>Rutina</th><th>Último entreno</th><th className="n hide-sm">Sesiones 30 d</th><th className="n hide-sm">Peso</th><th className="hide-sm">Última visita</th></tr></thead>
                    <tbody>
                      {[...rows].sort((a, b) => (a.last_workout ?? '').localeCompare(b.last_workout ?? '')).map((r) => (
                        <tr key={r.id} className="link" onClick={() => nav(`/socios/${r.id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/socios/${r.id}`); }}>
                          <td><b>{r.full_name}</b></td>
                          <td>{r.routine_name ?? <Tag tone="warn">Sin rutina</Tag>}</td>
                          <td className={idle(r) ? 'warn' : ''}>{ago(r.last_workout)}</td>
                          <td className="n hide-sm">{r.workouts_30d}</td>
                          <td className="n hide-sm">{kg(r.last_weight)}</td>
                          <td className="hide-sm faint">{ago(r.last_visit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        )}
      </Load>
    </div>
  );
}
