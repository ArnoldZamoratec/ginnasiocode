import { useMemo, useState } from 'react';
import { post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useAuth } from '../../lib/auth.tsx';
import { MemberTop } from '../../components/Shell.tsx';
import { Button, Empty, FormError, Load, Sheet, Skeleton, Tag, useToast } from '../../components/ui.tsx';
import { addDays, dayName, longDate, localDate, plural, time, today } from '../../lib/format.ts';
import type { Session } from '../../lib/types.ts';

export function Capacity({ s }: { s: Pick<Session, 'capacity' | 'booked'> }) {
  const n = Math.min(s.capacity, 20);
  const on = Math.round((s.booked / s.capacity) * n);
  return <div className={`cap ${s.booked >= s.capacity ? 'full' : ''}`} aria-hidden>{Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}</div>;
}

export function Intensity({ n }: { n: number }) {
  return <span className="mono faint" title={`Intensidad ${n} de 3`} style={{ fontSize: 11, letterSpacing: 2 }}>{'▮'.repeat(n)}{'▯'.repeat(3 - n)}</span>;
}

function spotsText(s: Session): string {
  if (s.status === 'cancelled') return 'Cancelada';
  if (s.spotsLeft > 0) return plural(s.spotsLeft, 'cupo', 'cupos');
  return s.waitlist ? `Llena · ${s.waitlist} en espera` : 'Llena';
}

export function MemberClasses() {
  const { settings, branchId } = useAuth();
  const t = today();
  const [day, setDay] = useState(t);
  const window = settings?.booking_window_days ?? 7;
  const q = useApi<{ items: Session[] }>(`/classes/sessions?from=${t}&to=${addDays(t, window)}${branchId ? `&branchId=${branchId}` : ''}`);
  const [open, setOpen] = useState<Session | null>(null);
  const toast = useToast();

  const days = Array.from({ length: window }, (_, i) => addDays(t, i));
  const byDay = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of q.data?.items ?? []) m.set(localDate(s.startsAt), [...(m.get(localDate(s.startsAt)) ?? []), s]);
    return m;
  }, [q.data]);
  const mine = (q.data?.items ?? []).filter((s) => s.myReservation && ['booked', 'waitlist'].includes(s.myReservation.status) && new Date(s.startsAt) > new Date());

  const act = useAction(async (s: Session, kind: 'book' | 'cancel') => {
    if (kind === 'book') {
      const r = await post<{ reservation: { status: string }; waitlistPosition: number | null }>(`/classes/sessions/${s.id}/book`);
      toast(r.reservation.status === 'waitlist' ? `Estás en lista de espera (puesto ${r.waitlistPosition}). Te avisamos si se libera un cupo.` : `Reservado: ${s.className} a las ${time(s.startsAt)}.`);
    } else {
      const r = await post<{ late: boolean }>(`/reservations/${s.myReservation!.id}/cancel`);
      toast(r.late ? 'Reserva cancelada (fuera de plazo).' : 'Reserva cancelada. Tu cupo pasó al siguiente en espera.');
    }
    setOpen(null);
    await q.reload();
  });

  const list = byDay.get(day) ?? [];
  const minHours = settings?.cancel_min_hours ?? 2;

  return (
    <>
      <MemberTop title="Clases" />
      <main className="m-page">
        {mine.length > 0 && (
          <section className="stack">
            <span className="eyebrow">Tus reservas</span>
            <div className="list">
              {mine.map((s) => (
                <button key={s.id} className="list-item" style={{ background: 'none', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(s)}>
                  <span className="display" style={{ fontSize: 26, width: 64 }}>{time(s.startsAt)}</span>
                  <span className="grow"><b>{s.className}</b><br /><span className="muted" style={{ fontSize: 13 }}>{dayName(localDate(s.startsAt))} · {s.room}</span></span>
                  {s.myReservation!.status === 'waitlist' ? <Tag tone="warn">Espera #{s.myReservation!.waitlistPosition}</Tag> : <Tag tone="ok">Reservado</Tag>}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="chips" role="tablist" aria-label="Día" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 4 }}>
          {days.map((d) => (
            <button key={d} className="chip" role="tab" aria-pressed={d === day} aria-selected={d === day} onClick={() => setDay(d)} style={{ display: 'grid', justifyItems: 'center', minWidth: 54, padding: '8px 6px' }}>
              <b>{d === t ? 'HOY' : dayName(d, true).toUpperCase()}</b>
              <span className="display" style={{ fontSize: 24 }}>{Number(d.slice(8))}</span>
            </button>
          ))}
        </div>

        <Load q={q} skeleton={<Skeleton lines={6} />}>
          {() => list.length === 0 ? (
            <Empty glyph="—" title="Sin clases este día">Prueba otro día de la semana.</Empty>
          ) : (
            <div className="agenda">
              <div className="agenda-day">{longDate(day)}</div>
              {list.map((s) => {
                const past = new Date(s.startsAt) <= new Date();
                const r = s.myReservation && ['booked', 'waitlist', 'attended'].includes(s.myReservation.status) ? s.myReservation : null;
                return (
                  <button key={s.id} className={`slot ${r ? 'mine' : ''} ${s.status === 'cancelled' ? 'cancelled' : ''} ${past ? 'past' : ''}`} onClick={() => setOpen(s)} disabled={past && !r}>
                    <span className="display" style={{ fontSize: 26 }}>{time(s.startsAt)}</span>
                    <span style={{ display: 'grid', gap: 3 }}>
                      <span className="name">{s.className} <Intensity n={s.intensity} /></span>
                      <span className="meta">{s.room}{s.trainerName ? ` · ${s.trainerName}` : ''}</span>
                      <Capacity s={s} />
                    </span>
                    <span className="right" style={{ fontSize: 12.5 }}>
                      {r ? (r.status === 'waitlist' ? <Tag tone="warn">#{r.waitlistPosition}</Tag> : <Tag tone="ok">{r.status === 'attended' ? 'Asististe' : 'Tuyo'}</Tag>)
                        : <span className={s.spotsLeft === 0 ? 'warn' : 'muted'}>{spotsText(s)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Load>
      </main>

      <Sheet open={!!open} onClose={() => { setOpen(null); act.setError(null); }} eyebrow={open ? `${longDate(open.startsAt)} · ${time(open.startsAt)}–${time(open.endsAt)}` : ''} title={open?.className}
        footer={open && (() => {
          const r = open.myReservation && ['booked', 'waitlist'].includes(open.myReservation.status) ? open.myReservation : null;
          if (open.status === 'cancelled') return null;
          if (r) return <Button variant="danger" busy={act.busy} onClick={() => act.run(open, 'cancel')}>{r.status === 'waitlist' ? 'Salir de la lista' : 'Cancelar reserva'}</Button>;
          return <Button variant="primary" size="lg" block busy={act.busy} onClick={() => act.run(open, 'book')}>{open.spotsLeft > 0 ? 'Reservar cupo' : 'Unirme a la lista de espera'}</Button>;
        })()}>
        {open && (
          <>
            <dl className="kv">
              <dt>Sala</dt><dd>{open.room} · {open.branchName}</dd>
              <dt>Entrenador</dt><dd>{open.trainerName ?? 'Por confirmar'}</dd>
              <dt>Cupos</dt><dd className="num">{open.booked} de {open.capacity} ocupados{open.waitlist ? ` · ${open.waitlist} en espera` : ''}</dd>
              <dt>Intensidad</dt><dd><Intensity n={open.intensity} /></dd>
            </dl>
            {open.status === 'cancelled' && <div className="notice bad">Clase cancelada{open.cancelReason ? `: ${open.cancelReason}` : ''}.</div>}
            {open.myReservation?.status === 'waitlist' && <div className="notice">Estás en el puesto <b>{open.myReservation.waitlistPosition}</b> de la lista de espera. Si se libera un cupo te reservamos automáticamente y te avisamos.</div>}
            {open.status !== 'cancelled' && <p className="muted" style={{ fontSize: 13.5 }}>Puedes cancelar sin problema hasta {minHours} h antes del inicio. Después, pide la cancelación en recepción.</p>}
            <FormError error={act.error} />
          </>
        )}
      </Sheet>
    </>
  );
}
