import { Link } from 'react-router-dom';
import { useApi } from '../../lib/hooks.ts';
import { useUser } from '../../lib/auth.tsx';
import { MemberTop } from '../../components/Shell.tsx';
import { Empty, Load, Meter, Section, Skeleton, StateTag, Icon } from '../../components/ui.tsx';
import { addDays, ago, date, diffDays, longDate, money, time, today } from '../../lib/format.ts';
import type { Debt, Membership } from '../../lib/types.ts';

interface Me {
  member: { id: number; firstName: string; lastName: string; trainerName: string | null };
  membership: Membership | null;
  debt: Debt;
  stats: { visitsThisMonth: number; lastVisit: string | null };
  nextClasses: { reservation_id: number; status: string; session_id: number; starts_at: string; class_name: string; room: string; trainer_name: string | null }[];
  unreadNotifications: number;
  today: string;
}

export function PlanCard({ m }: { m: Membership | null }) {
  if (!m) {
    return (
      <Empty glyph="—" title="Sin plan activo">
        Acércate a recepción para elegir un plan. Puedes pagar en efectivo, tarjeta o transferencia.
      </Empty>
    );
  }
  const tone = m.state === 'expired' ? 'bad' : ['expiring', 'expires_today'].includes(m.state) ? 'warn' : '';
  const t = today();
  const used = Math.max(0, Math.min(m.totalDays, diffDays(m.startDate, t) + 1));
  const big = m.state === 'expires_today' ? 'HOY' : m.state === 'expired' ? String(Math.abs(diffDays(m.endDate, t))) : m.state === 'not_started' ? String(diffDays(t, m.startDate)) : String(m.daysLeft ?? 0);
  const label = m.state === 'expires_today' ? 'último día de tu plan'
    : m.state === 'expired' ? `días desde que venció`
    : m.state === 'not_started' ? 'días para que empiece'
    : m.state === 'frozen' ? `días restantes · congelado hasta el ${date(m.frozenUntil)}`
    : (m.daysLeft === 1 ? 'día restante' : 'días restantes');
  return (
    <article className={`plan-card ${tone}`}>
      <div className="top">
        <div className="grow">
          <span className="eyebrow">Tu plan</span>
          <h2 className="display" style={{ fontSize: 34, marginTop: 6 }}>{m.planName}</h2>
        </div>
        <StateTag state={m.state} />
      </div>
      <div className="big">
        <span className={`display ${tone}`}>{big}</span>
        <small>{label}</small>
      </div>
      <div className="foot">
        <Meter value={used} max={m.totalDays} tone={tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : 'ok'} />
        <div className="row between faint mono" style={{ fontSize: 12 }}>
          <span>{date(m.startDate)}</span><span>vence {date(m.endDate)}</span>
        </div>
        {m.state === 'expired' && <p className="muted">Renueva en recepción para volver a entrenar. Tu historial se mantiene.</p>}
        {['expiring', 'expires_today'].includes(m.state) && <p className="muted">Renueva antes del vencimiento para no perder continuidad.</p>}
      </div>
    </article>
  );
}

function Streak({ memberId }: { memberId: number }) {
  const q = useApi<{ days: string[] }>(`/members/${memberId}/visits?limit=120`);
  const t = today();
  const days = Array.from({ length: 28 }, (_, i) => addDays(t, i - 27));
  const set = new Set(q.data?.days ?? []);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="streak" aria-label="Asistencia de las últimas 4 semanas">
        {days.map((d) => <i key={d} className={`${set.has(d) ? 'on' : ''} ${d === t ? 'today' : ''}`} title={`${date(d)}${set.has(d) ? ' · asististe' : ''}`} />)}
      </div>
      <div className="row between faint mono" style={{ fontSize: 11 }}><span>hace 4 semanas</span><span>hoy</span></div>
    </div>
  );
}

export function MemberHome() {
  const user = useUser();
  const q = useApi<Me>('/me');
  return (
    <>
      <MemberTop right={<Link className="btn ghost sm" to="/cuenta" aria-label="Avisos"><Icon name="bell" size={18} />{(q.data?.unreadNotifications ?? 0) > 0 && <b className="mono">{q.data!.unreadNotifications}</b>}</Link>} />
      <main className="m-page">
        <Load q={q} skeleton={<Skeleton block lines={5} />}>
          {(me) => (
            <>
              <div>
                <span className="eyebrow">{longDate(me.today)}</span>
                <h1 className="m-hello" style={{ marginTop: 8 }}>Hola,<br />{me.member.firstName}</h1>
              </div>

              <PlanCard m={me.membership} />

              {me.debt.totalCents > 0 && (
                <div className="notice bad">
                  Tienes un saldo pendiente de <b className="num">{money(me.debt.totalCents)}</b>. Puedes regularizarlo en recepción.
                </div>
              )}

              <Section idx="01" title="Tus próximas clases" aside={<Link to="/clases" className="linkish">Ver horario</Link>}>
                {me.nextClasses.length === 0 ? (
                  <Empty glyph="0" title="Sin reservas" action={<Link to="/clases" className="btn">Reservar una clase</Link>}>
                    Reserva hasta con {7} días de anticipación.
                  </Empty>
                ) : (
                  <div className="list">
                    {me.nextClasses.map((c) => (
                      <Link to="/clases" key={c.reservation_id} className="list-item" style={{ textDecoration: 'none' }}>
                        <div style={{ width: 64 }}>
                          <div className="display" style={{ fontSize: 28 }}>{time(c.starts_at)}</div>
                          <div className="eyebrow" style={{ marginTop: 4 }}>{longDate(c.starts_at).split(' ').slice(0, 2).join(' ')}</div>
                        </div>
                        <div className="grow">
                          <b>{c.class_name}</b>
                          <div className="muted" style={{ fontSize: 13 }}>{c.room}{c.trainer_name ? ` · ${c.trainer_name}` : ''}</div>
                        </div>
                        {c.status === 'waitlist' ? <span className="tag warn">En espera</span> : <span className="tag ok">Reservado</span>}
                      </Link>
                    ))}
                  </div>
                )}
              </Section>

              <Section idx="02" title="Constancia" aside={<span>Última visita: {ago(me.stats.lastVisit)}</span>}>
                <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
                  <span className="display" style={{ fontSize: 80 }}>{me.stats.visitsThisMonth}</span>
                  <span className="eyebrow" style={{ paddingBottom: 8 }}>{me.stats.visitsThisMonth === 1 ? 'visita' : 'visitas'} este mes</span>
                </div>
                <Streak memberId={user.memberId!} />
              </Section>

              {me.member.trainerName && (
                <p className="muted">Tu entrenador: <b style={{ color: 'var(--fg)' }}>{me.member.trainerName}</b> · <Link to="/entreno" className="linkish">Ver tu rutina</Link></p>
              )}
            </>
          )}
        </Load>
      </main>
    </>
  );
}
