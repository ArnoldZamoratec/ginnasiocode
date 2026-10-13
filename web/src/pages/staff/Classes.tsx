import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, get, post, qs } from '../../lib/api.ts';
import { useApi, useAction, useMedia } from '../../lib/hooks.ts';
import { useAuth, useUser } from '../../lib/auth.tsx';
import { Button, Empty, Field, FormError, Load, PageHead, Sheet, Skeleton, Tag, useToast } from '../../components/ui.tsx';
import { Capacity, Intensity } from '../member/Classes.tsx';
import { addDays, dayName, longDate, localDate, shortDate, time, today, weekStart } from '../../lib/format.ts';
import type { MemberListItem, Session } from '../../lib/types.ts';

const ROSTER: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'mute' | 'info' }> = {
  attended: { label: 'Asistió', tone: 'ok' }, booked: { label: 'Reservado', tone: 'info' }, no_show: { label: 'No vino', tone: 'bad' },
  waitlist: { label: 'En espera', tone: 'warn' }, cancelled: { label: 'Canceló', tone: 'mute' },
};

function MemberPicker({ onPick }: { onPick: (m: MemberListItem) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<MemberListItem[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return; }
    const id = setTimeout(() => get<{ items: MemberListItem[] }>(`/members${qs({ q, limit: 6 })}`).then((r) => setItems(r.items)).catch(() => setItems([])), 200);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input className="input" placeholder="Buscar socio por nombre o DNI" value={q} onChange={(e) => setQ(e.target.value)} />
      {items.map((m) => (
        <button key={m.id} className="list-item" style={{ background: 'none', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }} onClick={() => { onPick(m); setQ(''); }}>
          <span className="grow">{m.fullName} <span className="mono faint">{m.dni}</span></span><span className="faint" style={{ fontSize: 12 }}>{m.planName ?? 'Sin plan'}</span>
        </button>
      ))}
    </div>
  );
}

function SessionSheet({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const user = useUser();
  const q = useApi<Session>(id ? `/classes/sessions/${id}` : null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [cap, setCap] = useState('');
  const toast = useToast();
  const desk = user.role === 'reception' || user.role === 'admin';
  const s = q.data && q.data.id === id ? q.data : undefined;
  const mineToRun = user.role === 'admin' || (user.role === 'trainer' && s?.trainerId === user.id);
  const done = () => { q.reload(); onChanged(); };

  const book = useAction(async (m: MemberListItem) => {
    const r = await post<{ reservation: { status: string }; waitlistPosition: number | null }>(`/classes/sessions/${id}/book`, { memberId: m.id });
    toast(r.reservation.status === 'waitlist' ? `${m.firstName} quedó en espera (#${r.waitlistPosition}).` : `${m.firstName} reservado.`);
    done();
  });
  const mark = useAction(async (rid: number, status: string) => { await post(`/reservations/${rid}/attendance`, { status }); done(); });
  const cancelRes = useAction(async (rid: number) => {
    const r = await post<{ late: boolean; promotedMemberIds: number[] }>(`/reservations/${rid}/cancel`);
    toast(r.promotedMemberIds.length ? 'Reserva cancelada. Se promovió al siguiente de la lista de espera.' : 'Reserva cancelada.');
    done();
  });
  const cancelClass = useAction(async () => {
    const r = await post<{ notified: number }>(`/classes/sessions/${id}/cancel`, { reason });
    toast(`Clase cancelada. Avisamos a ${r.notified} ${r.notified === 1 ? 'socio' : 'socios'}.`);
    setCancelling(false); setReason('');
    done();
  });
  const resize = useAction(async () => {
    const r = await api<{ promotedMemberIds: number[] }>('PATCH', `/classes/sessions/${id}`, { capacity: Number(cap) });
    toast(r.promotedMemberIds.length ? `Cupo actualizado; ${r.promotedMemberIds.length} pasaron de la lista de espera.` : 'Cupo actualizado.');
    setCap('');
    done();
  });
  const err = book.error ?? mark.error ?? cancelRes.error ?? cancelClass.error ?? resize.error;
  const started = s ? new Date(s.startsAt) <= new Date() : false;

  return (
    <Sheet open={id != null} onClose={onClose} wide eyebrow={s ? `${longDate(s.startsAt)} · ${time(s.startsAt)}–${time(s.endsAt)} · ${s.room}` : ''} title={s?.className ?? 'Clase'}
      footer={s && s.status === 'scheduled' && mineToRun && !started && (cancelling
        ? <><Button onClick={() => setCancelling(false)}>Volver</Button><Button variant="danger" busy={cancelClass.busy} disabled={reason.trim().length < 5} onClick={() => cancelClass.run()}>Cancelar clase y avisar</Button></>
        : <Button variant="danger" onClick={() => setCancelling(true)}>Cancelar clase</Button>)}>
      {!s ? <Skeleton lines={5} /> : (
        <>
          {s.status === 'cancelled' && <div className="notice bad">Clase cancelada: {s.cancelReason}</div>}
          {cancelling && <Field label="Motivo (se envía a los inscritos)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Ej.: instructor con descanso médico" /></Field>}
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi"><span className="eyebrow">Ocupados</span><div className="v">{s.booked}<small>/{s.capacity}</small></div></div>
            <div className="kpi"><span className="eyebrow">En espera</span><div className="v">{s.waitlist}</div></div>
            <div className="kpi"><span className="eyebrow">Entrenador</span><div className="d" style={{ fontSize: 14, color: 'var(--fg)' }}>{s.trainerName ?? '—'}</div></div>
          </div>
          {user.role === 'admin' && s.status === 'scheduled' && !started && (
            <div className="row">
              <input className="input num" style={{ width: 110 }} type="number" min={s.booked} placeholder={String(s.capacity)} value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Nuevo cupo" />
              <Button size="sm" busy={resize.busy} disabled={!cap || Number(cap) === s.capacity} onClick={() => resize.run()}>Ajustar cupo</Button>
            </div>
          )}
          {desk && s.status === 'scheduled' && !started && <MemberPicker onPick={(m) => book.run(m)} />}
          <FormError error={err} />
          {(s.roster ?? []).length === 0 ? <Empty glyph="0" title="Sin reservas aún" /> : (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>#</th><th>Socio</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {s.roster!.filter((r) => r.status !== 'cancelled').concat(s.roster!.filter((r) => r.status === 'cancelled')).map((r, i) => (
                    <tr key={r.id} className={r.status === 'cancelled' ? 'voided' : ''}>
                      <td className="mono faint">{i + 1}</td>
                      <td>{desk ? <Link className="linkish" to={`/socios/${r.member_id}`}>{r.full_name}</Link> : r.full_name}
                        {r.promoted_at && <div className="faint" style={{ fontSize: 12 }}>Promovido de la lista de espera</div>}
                        {r.late_cancel ? <div className="warn" style={{ fontSize: 12 }}>Cancelación tardía</div> : null}</td>
                      <td><Tag tone={ROSTER[r.status]?.tone}>{ROSTER[r.status]?.label ?? r.status}</Tag></td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        {['booked', 'attended', 'no_show'].includes(r.status) && (mineToRun || desk) && s.status === 'scheduled' && (
                          r.status === 'attended'
                            ? <Button size="sm" variant="ghost" onClick={() => mark.run(r.id, 'booked')}>Deshacer</Button>
                            : <>
                              <Button size="sm" onClick={() => mark.run(r.id, 'attended')}>Asistió</Button>
                              {started && r.status !== 'no_show' && <Button size="sm" variant="ghost" onClick={() => mark.run(r.id, 'no_show')}>No vino</Button>}
                            </>
                        )}
                        {desk && ['booked', 'waitlist'].includes(r.status) && !started && <Button size="sm" variant="ghost" onClick={() => cancelRes.run(r.id)}>Quitar</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

export function StaffClasses() {
  const user = useUser();
  const { branchId } = useAuth();
  const t = today();
  const [start, setStart] = useState(weekStart(t));
  const [onlyMine, setOnlyMine] = useState(user.role === 'trainer');
  const q = useApi<{ items: Session[] }>(`/classes/sessions${qs({ from: start, to: addDays(start, 6), branchId })}`);
  const [open, setOpen] = useState<number | null>(null);
  const small = useMedia('(max-width: 760px)');
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const items = (q.data?.items ?? []).filter((s) => !onlyMine || s.trainerId === user.id);
  const byDay = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of items) m.set(localDate(s.startsAt), [...(m.get(localDate(s.startsAt)) ?? []), s]);
    return m;
  }, [items]);
  const totals = items.filter((s) => s.status === 'scheduled').reduce((a, s) => ({ cap: a.cap + s.capacity, booked: a.booked + s.booked }), { cap: 0, booked: 0 });

  const slot = (s: Session) => {
    const past = new Date(s.endsAt) < new Date();
    return (
      <button key={s.id} className={`slot ${s.status === 'cancelled' ? 'cancelled' : ''} ${past ? 'past' : ''} ${s.trainerId === user.id ? 'mine' : ''}`} onClick={() => setOpen(s.id)}>
        <span className="time">{time(s.startsAt)}</span>
        <span className="name">{s.className} <Intensity n={s.intensity} /></span>
        <span className="meta">{s.trainerName ?? 'Sin entrenador'} · {s.room}</span>
        <span className="meta num">{s.status === 'cancelled' ? 'Cancelada' : `${s.booked}/${s.capacity}${s.waitlist ? ` · ${s.waitlist} en espera` : ''}`}</span>
        {s.status === 'scheduled' && <Capacity s={s} />}
      </button>
    );
  };

  return (
    <div className="page">
      <PageHead eyebrow={`Semana del ${shortDate(start)} al ${shortDate(addDays(start, 6))}`} title="Clases" actions={<>
        <Button onClick={() => setStart(addDays(start, -7))} aria-label="Semana anterior">←</Button>
        <Button onClick={() => setStart(weekStart(t))} disabled={start === weekStart(t)}>Hoy</Button>
        <Button onClick={() => setStart(addDays(start, 7))} aria-label="Semana siguiente">→</Button>
        {user.role === 'admin' && <Link className="btn" to="/admin/horario">Editar horario</Link>}
      </>} />
      <div className="stack">
        <div className="row wrap between">
          {(user.role === 'trainer' || user.role === 'admin') && (
            <div className="chips">
              <button className="chip" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>Todas</button>
              <button className="chip" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>Solo las mías</button>
            </div>
          )}
          <span className="mono faint" style={{ fontSize: 12 }}>{items.length} clases · ocupación {totals.cap ? Math.round((totals.booked / totals.cap) * 100) : 0}%</span>
        </div>
        <Load q={q} skeleton={<Skeleton block lines={4} />}>
          {() => items.length === 0 ? <Empty glyph="—" title="Sin clases esta semana" /> : small ? (
            <div className="agenda">
              {days.filter((d) => byDay.get(d)?.length).map((d) => (
                <div key={d}>
                  <div className="agenda-day">{d === t ? 'Hoy' : dayName(d)} <span className="mono faint" style={{ fontSize: 12 }}>{shortDate(d)}</span></div>
                  {byDay.get(d)!.map(slot)}
                </div>
              ))}
            </div>
          ) : (
            <div className="week">
              {days.map((d) => (
                <div key={d} className={`day ${d === t ? 'today' : ''}`}>
                  <div className="day-head"><b>{Number(d.slice(8))}</b><span>{dayName(d, true)}</span></div>
                  {(byDay.get(d) ?? []).map(slot)}
                </div>
              ))}
            </div>
          )}
        </Load>
      </div>
      <SessionSheet id={open} onClose={() => setOpen(null)} onChanged={q.reload} />
    </div>
  );
}
