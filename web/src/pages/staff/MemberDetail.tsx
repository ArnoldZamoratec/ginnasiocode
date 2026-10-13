import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, download, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useUser } from '../../lib/auth.tsx';
import { Button, Empty, ErrorState, FormError, Load, PageHead, Section, Sheet, Skeleton, StateTag, Tag, Icon, useToast } from '../../components/ui.tsx';
import { PlanCard } from '../member/Home.tsx';
import { ChangePlanSheet, FreezeSheet, PaySheet, SellSheet, VoidSheet } from '../../components/MembershipActions.tsx';
import { ExerciseProgressPanel, MeasurementsPanel, WorkoutHistory } from '../../components/Progress.tsx';
import { RoutineEditor } from './Routines.tsx';
import { RoutineDays } from '../member/Training.tsx';
import { date, dateTime, DENY, METHOD, money, time, today } from '../../lib/format.ts';
import type { Membership, MemberDetail, Payment, Routine, Staff } from '../../lib/types.ts';

type Tab = 'plan' | 'pagos' | 'visitas' | 'entreno';

function Memberships({ memberId, reload }: { memberId: number; reload: number }) {
  const q = useApi<{ items: Membership[] }>(`/members/${memberId}/memberships`);
  useEffect(() => { q.reload(); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Load q={q} skeleton={<Skeleton lines={4} />}>
      {(d) => d.items.length === 0 ? <Empty glyph="0" title="Sin historial de planes" /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Plan</th><th>Periodo</th><th>Estado</th><th className="n">Monto</th><th className="n">Pagado</th><th className="n">Saldo</th></tr></thead>
            <tbody>
              {d.items.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.planName}</b>{m.creditCents > 0 && <div className="faint" style={{ fontSize: 12 }}>Crédito aplicado {money(m.creditCents)}</div>}
                    {m.freezes.map((f) => <div key={f.id} className="faint" style={{ fontSize: 12 }}>Congelado {date(f.start_date)}–{date(f.end_date)} · {f.reason}</div>)}</td>
                  <td className="num">{date(m.startDate)} → {date(m.endDate)}</td>
                  <td><StateTag state={m.state} /></td>
                  <td className="n">{money(m.amountDueCents)}</td>
                  <td className="n">{money(m.paidCents)}</td>
                  <td className={`n ${m.balanceCents ? 'bad' : 'faint'}`}>{m.balanceCents ? money(m.balanceCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Load>
  );
}

function Payments({ memberId, onChange, reload }: { memberId: number; onChange: () => void; reload: number }) {
  const user = useUser();
  const q = useApi<{ items: Payment[] }>(`/members/${memberId}/payments`);
  useEffect(() => { q.reload(); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const toast = useToast();
  const canVoid = (p: Payment) => p.status === 'valid' && (user.role === 'admin' || (user.role === 'reception' && p.received_by === user.id && date(p.paid_at) === date(today())));
  return (
    <>
    <Load q={q}>
      {(d) => d.items.length === 0 ? <Empty glyph="0" title="Sin pagos" /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Comprobante</th><th>Fecha</th><th>Concepto</th><th className="hide-sm">Método</th><th className="n">Monto</th><th /></tr></thead>
            <tbody>
              {d.items.map((p) => (
                <tr key={p.id} className={p.status === 'voided' ? 'voided' : ''}>
                  <td className="mono">{p.receipt_number}</td>
                  <td className="num">{dateTime(p.paid_at)}</td>
                  <td>{p.concept}{p.status === 'voided' && <div className="bad" style={{ fontSize: 12 }}>Anulado por {p.voided_by_name}: {p.void_reason}</div>}</td>
                  <td className="hide-sm">{METHOD[p.method]}</td>
                  <td className="n amt">{money(p.amount_cents)}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => download(`/payments/${p.id}/receipt.pdf`, `${p.receipt_number}.pdf`).catch((e) => toast(e.message, 'bad'))} aria-label="Descargar PDF"><Icon name="download" size={16} /></button>
                    {canVoid(p) && <button className="btn ghost sm" onClick={() => setVoiding(p)}>Anular</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Load>
    <VoidSheet payment={voiding} onClose={() => setVoiding(null)} onDone={() => { q.reload(); onChange(); }} />
    </>
  );
}

function Visits({ memberId }: { memberId: number }) {
  const q = useApi<{ items: { id: number; checked_in_at: string; result: string; reason: string | null; method: string; branch_name: string }[] }>(`/members/${memberId}/visits?limit=60`);
  return (
    <Load q={q}>
      {(d) => d.items.length === 0 ? <Empty glyph="0" title="Sin visitas registradas" /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Fecha</th><th>Hora</th><th>Sede</th><th>Resultado</th></tr></thead>
            <tbody>
              {d.items.map((v) => (
                <tr key={v.id}>
                  <td>{date(v.checked_in_at)}</td><td className="mono">{time(v.checked_in_at)}</td><td>{v.branch_name}</td>
                  <td>{v.result === 'granted' ? <Tag tone="ok">Ingresó · {v.method.toUpperCase()}</Tag> : <Tag tone="bad">{DENY[v.reason ?? ''] ?? 'Denegado'}</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Load>
  );
}

function Training({ memberId }: { memberId: number }) {
  const routines = useApi<Routine[]>(`/members/${memberId}/routines`);
  const templates = useApi<Routine[]>('/routines/templates');
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const toast = useToast();
  const assign = useAction(async (templateId: number) => {
    await post(`/routines/${templateId}/assign`, { memberId });
    toast('Plantilla asignada. Puedes ajustarla para este socio.');
    routines.reload();
  });
  const archive = useAction(async (r: Routine) => { await api('PATCH', `/routines/${r.id}`, { active: false }); routines.reload(); });
  const active = routines.data?.find((r) => r.active);
  return (
    <div className="stack-lg">
      <Section idx="A" title="Rutina actual" aside={<div className="row">
        {active && <Button size="sm" onClick={() => setEditing(active)}>Editar</Button>}
        <Button size="sm" variant={active ? undefined : 'primary'} onClick={() => setEditing('new')}><Icon name="plus" size={14} />Nueva rutina</Button>
      </div>}>
        <Load q={routines}>
          {() => active ? (
            <div className="stack">
              <div className="row between wrap"><div><b style={{ fontSize: 18 }}>{active.name}</b>{active.goal && <p className="muted">{active.goal}</p>}</div>
                <Button size="sm" variant="ghost" busy={archive.busy} onClick={() => archive.run(active)}>Archivar</Button></div>
              <RoutineDays r={active} day={day ?? active.days[0]} onDay={setDay} />
            </div>
          ) : (
            <div className="stack">
              <Empty glyph="—" title="Sin rutina asignada">Crea una desde cero o parte de una plantilla.</Empty>
              {(templates.data ?? []).length > 0 && (
                <div className="list">
                  {templates.data!.map((t) => (
                    <div key={t.id} className="list-item">
                      <span className="grow"><b>{t.name}</b><br /><span className="faint" style={{ fontSize: 12.5 }}>{t.days.length} días · {t.items.length} ejercicios{t.goal ? ` · ${t.goal}` : ''}</span></span>
                      <Button size="sm" busy={assign.busy} onClick={() => assign.run(t.id)}>Asignar</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Load>
      </Section>
      <Section idx="B" title="Progreso por ejercicio"><ExerciseProgressPanel memberId={memberId} /></Section>
      <MeasurementsPanel memberId={memberId} />
      <Section idx="D" title="Sesiones"><WorkoutHistory memberId={memberId} /></Section>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nueva rutina' : 'Editar rutina'} wide>
        {editing && <RoutineEditor memberId={memberId} routine={editing === 'new' ? null : editing} onSaved={() => { setEditing(null); routines.reload(); toast('Rutina guardada.'); }} />}
      </Sheet>
    </div>
  );
}

function Profile({ d, reload }: { d: MemberDetail; reload: () => void }) {
  const user = useUser();
  const m = d.member;
  const desk = user.role === 'reception' || user.role === 'admin';
  const trainers = useApi<Staff[]>(desk ? '/admin/staff?role=trainer' : null);
  const [health, setHealth] = useState<string | null>(null);
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const toast = useToast();
  const saveHealth = useAction(async () => { await api('PATCH', `/members/${m.id}`, { healthNotes: health || null }); setHealth(null); reload(); toast('Notas de salud actualizadas.'); });
  const setTrainer = useAction(async (trainerId: number | null) => { await api('PUT', `/members/${m.id}/trainer`, { trainerId }); reload(); toast('Entrenador actualizado.'); });
  const account = useAction(async () => { const r = await post<{ temporaryPassword: string }>(`/members/${m.id}/account`); setTempPwd(r.temporaryPassword); reload(); });
  return (
    <div className="stack">
      <dl className="kv">
        <dt>DNI</dt><dd className="mono">{m.dni}{m.dniMasked && <span className="faint"> · restringido</span>}</dd>
        <dt>Teléfono</dt><dd>{m.phone ? <a href={`tel:${m.phone.replace(/\s/g, '')}`}>{m.phone}</a> : '—'}</dd>
        <dt>Correo</dt><dd style={{ wordBreak: 'break-all' }}>{m.email ?? '—'}</dd>
        <dt>Nacimiento</dt><dd>{m.birthDate ? date(m.birthDate) : '—'}</dd>
        <dt>Emergencia</dt><dd>{m.emergencyContact ?? '—'}</dd>
        <dt>Socio desde</dt><dd>{date(m.createdAt)}</dd>
        <dt>Visitas 30 d</dt><dd className="num">{d.stats.visitsLast30}</dd>
        <dt>Entrenador</dt>
        <dd>{desk ? (
          <select className="select" style={{ minHeight: 34 }} value={m.trainerId ?? ''} disabled={setTrainer.busy} onChange={(e) => setTrainer.run(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Sin asignar</option>
            {(trainers.data ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        ) : m.trainerName ?? '—'}</dd>
        <dt>App</dt><dd>{m.hasAccount ? <Tag tone="ok">Con acceso</Tag> : desk ? <Button size="sm" busy={account.busy} disabled={!m.email} title={m.email ? '' : 'Registra un correo primero'} onClick={() => account.run()}>Crear acceso</Button> : 'Sin acceso'}</dd>
      </dl>
      {tempPwd && <div className="notice ok">Contraseña temporal (se muestra una sola vez): <b className="mono">{tempPwd}</b></div>}
      <FormError error={account.error ?? setTrainer.error} />
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Salud</span>
        {m.healthRestricted ? (
          <p className="faint" style={{ fontSize: 13.5 }}>Información de salud visible solo para su entrenador y administración.</p>
        ) : health !== null ? (
          <>
            <textarea className="input" value={health} onChange={(e) => setHealth(e.target.value)} autoFocus />
            <div className="row"><Button size="sm" variant="primary" busy={saveHealth.busy} onClick={() => saveHealth.run()}>Guardar</Button><Button size="sm" onClick={() => setHealth(null)}>Cancelar</Button></div>
          </>
        ) : (
          <div className={m.healthNotes ? 'notice' : ''} style={{ fontSize: 14 }}>
            {m.healthNotes ?? <span className="faint">Sin observaciones.</span>}{' '}
            <button className="linkish" onClick={() => setHealth(m.healthNotes ?? '')}>Editar</button>
          </div>
        )}
        {!m.healthRestricted && <p className="faint" style={{ fontSize: 11.5 }}>Cada consulta de estos datos queda registrada.</p>}
      </div>
    </div>
  );
}

export function MemberDetailPage() {
  const { id } = useParams();
  const user = useUser();
  const memberId = Number(id);
  const q = useApi<MemberDetail>(`/members/${memberId}`);
  const [params, setParams] = useSearchParams();
  const desk = user.role === 'reception' || user.role === 'admin';
  const coach = user.role === 'trainer' || user.role === 'admin';
  const [tab, setTab] = useState<Tab>(user.role === 'trainer' ? 'entreno' : 'plan');
  const [sheet, setSheet] = useState<null | 'sell' | 'renew' | 'change' | 'freeze' | 'pay'>(null);
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const refresh = () => { q.reload(); setTick((t) => t + 1); };

  // Acciones directas desde check-in: ?accion=vender|renovar|cobrar
  useEffect(() => {
    const a = params.get('accion');
    if (!a || !q.data || !desk) return;
    const m = q.data.membership;
    if (a === 'cobrar' && q.data.debt?.totalCents) setSheet('pay');
    else if (a === 'renovar' && m?.status === 'active') setSheet('renew');
    else if (a === 'vender' || a === 'renovar') setSheet(m && m.status === 'active' && m.planActive && ['expired', 'expiring', 'expires_today'].includes(m.state) ? 'renew' : 'sell');
    params.delete('accion');
    setParams(params, { replace: true });
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const endFreeze = useAction(async (m: Membership, fid: number) => {
    const r = await post<Membership>(`/memberships/${m.id}/freezes/${fid}/end`);
    toast(`Reactivado. Nuevo vencimiento: ${date(r.endDate)}.`);
    refresh();
  });

  if (q.error && !q.data) return <div className="page"><ErrorState error={q.error} retry={q.reload} /><p style={{ marginTop: 16 }}><Link to="/socios" className="linkish">Volver a socios</Link></p></div>;
  if (!q.data) return <div className="page"><Skeleton block lines={8} /></div>;
  const d = q.data;
  const m = d.membership;
  const activeFreeze = m?.freezes.find((f) => f.end_date >= today());
  const tabs: [Tab, string][] = [['plan', 'Plan y membresías'], ...(desk ? [['pagos', 'Pagos'] as [Tab, string]] : []), ['visitas', 'Visitas'], ...(coach ? [['entreno', 'Entrenamiento'] as [Tab, string]] : [])];

  return (
    <div className="page">
      <PageHead eyebrow={<><Link to={user.role === 'trainer' ? '/entrenador' : '/socios'} className="linkish">Socios</Link> · {d.member.dni}</>} title={d.member.fullName}
        actions={desk && <>
          {d.debt && d.debt.totalCents > 0 && <Button onClick={() => setSheet('pay')}>Cobrar {money(d.debt.totalCents)}</Button>}
          {m && m.status === 'active' && m.planActive && <Button variant="primary" onClick={() => setSheet('renew')}>Renovar</Button>}
          <Button variant={m && m.status === 'active' ? undefined : 'primary'} onClick={() => setSheet('sell')}>Vender plan</Button>
        </>} />
      <div className="cols">
        <div className="span-4"><Section idx="01" title="Ficha"><Profile d={d} reload={q.reload} /></Section></div>
        <div className="span-8 stack-lg">
          <Section idx="02" title="Membresía">
            <PlanCard m={m} />
            {d.debt && d.debt.totalCents > 0 && <div className="notice bad">Saldo pendiente <b className="num">{money(d.debt.totalCents)}</b>: {d.debt.items.map((i) => `${i.plan} (${money(i.balanceCents)})`).join(', ')}.</div>}
            {desk && m && m.status === 'active' && m.endDate >= today() && (
              <div className="row wrap">
                <Button size="sm" onClick={() => setSheet('change')}>Cambiar de plan</Button>
                {activeFreeze
                  ? <Button size="sm" busy={endFreeze.busy} onClick={() => endFreeze.run(m, activeFreeze.id)}>Reactivar ahora (congelado hasta {date(activeFreeze.end_date)})</Button>
                  : <Button size="sm" onClick={() => setSheet('freeze')} disabled={m.freezeDaysAllowed - m.freezeDaysUsed <= 0}>Congelar ({m.freezeDaysAllowed - m.freezeDaysUsed} d disponibles)</Button>}
              </div>
            )}
            <FormError error={endFreeze.error} />
          </Section>
          <div className="tabs" role="tablist">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === 'plan' && <Memberships memberId={memberId} reload={tick} />}
          {tab === 'pagos' && desk && <Payments memberId={memberId} reload={tick} onChange={refresh} />}
          {tab === 'visitas' && <Visits memberId={memberId} />}
          {tab === 'entreno' && coach && <Training memberId={memberId} />}
        </div>
      </div>
      {desk && (
        <>
          <SellSheet open={sheet === 'sell'} onClose={() => setSheet(null)} memberId={memberId} renewFrom={null} onDone={refresh} />
          <SellSheet open={sheet === 'renew'} onClose={() => setSheet(null)} memberId={memberId} renewFrom={m} onDone={refresh} />
          {m && <ChangePlanSheet open={sheet === 'change'} onClose={() => setSheet(null)} m={m} onDone={refresh} />}
          {m && <FreezeSheet open={sheet === 'freeze'} onClose={() => setSheet(null)} m={m} onDone={refresh} />}
          <PaySheet open={sheet === 'pay'} onClose={() => setSheet(null)} memberId={memberId} debt={d.debt} onDone={refresh} />
        </>
      )}
    </div>
  );
}

