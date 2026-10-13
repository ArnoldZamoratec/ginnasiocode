import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { post, qs } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useUser } from '../../lib/auth.tsx';
import { Button, Empty, Field, FormError, Load, PageHead, Sheet, Skeleton, StateTag, Icon } from '../../components/ui.tsx';
import { ago, date, money } from '../../lib/format.ts';
import type { MemberListItem, Staff } from '../../lib/types.ts';

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'Todos' }, { key: 'active', label: 'Activos' }, { key: 'expiring', label: 'Por vencer' },
  { key: 'expires_today', label: 'Vencen hoy' }, { key: 'expired', label: 'Vencidos' }, { key: 'frozen', label: 'Congelados' },
  { key: 'none', label: 'Sin plan' }, { key: 'debt', label: 'Con deuda' },
];

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const trainers = useApi<Staff[]>(open ? '/admin/staff?role=trainer' : null);
  const empty = { dni: '', firstName: '', lastName: '', phone: '', email: '', birthDate: '', emergencyContact: '', healthNotes: '', trainerId: '', createAccount: true };
  const [f, setF] = useState(empty);
  const [created, setCreated] = useState<{ id: number; name: string; password: string | null } | null>(null);
  const save = useAction(async () => {
    const r = await post<{ member: { id: number; fullName: string }; temporaryPassword: string | null }>('/members', {
      dni: f.dni, firstName: f.firstName, lastName: f.lastName, phone: f.phone || null, email: f.email || null,
      birthDate: f.birthDate || null, emergencyContact: f.emergencyContact || null, healthNotes: f.healthNotes || null,
      trainerId: f.trainerId ? Number(f.trainerId) : null, createAccount: !!f.email && f.createAccount,
    });
    setCreated({ id: r.member.id, name: r.member.fullName, password: r.temporaryPassword });
    setF(empty);
  });
  const errs = save.error?.fields ?? {};
  const close = () => { setCreated(null); save.setError(null); onClose(); };

  if (created) {
    return (
      <Sheet open={open} onClose={close} eyebrow="Socio registrado" title={created.name}
        footer={<><Button onClick={() => nav(`/socios/${created.id}`)}>Ver ficha</Button><Button variant="primary" onClick={() => nav(`/socios/${created.id}?accion=vender`)}>Vender plan</Button></>}>
        {created.password ? (
          <div className="stack">
            <p>Se creó su acceso a la app. Entrégale esta contraseña temporal; <b>solo se muestra una vez</b>.</p>
            <div className="display mono" style={{ fontSize: 34, padding: '14px 16px', border: '1px solid var(--line-2)', letterSpacing: '.04em' }}>{created.password}</div>
            <p className="muted" style={{ fontSize: 13 }}>Podrá cambiarla desde Cuenta › Contraseña.</p>
          </div>
        ) : <p className="muted">Sin acceso a la app (no se registró correo). Puedes crearlo después desde su ficha.</p>}
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={close} eyebrow="Recepción" title="Alta rápida" wide
      footer={<><Button onClick={close}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={!f.dni || !f.firstName || !f.lastName} onClick={() => save.run()}>Registrar socio</Button></>}>
      <form className="form-grid" onSubmit={(e: FormEvent) => { e.preventDefault(); save.run(); }}>
        <Field label="DNI / CE" error={errs.dni}><input className="input" value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value.toUpperCase() })} autoFocus inputMode="text" /></Field>
        <Field label="Teléfono" error={errs.phone}><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Nombres" error={errs.firstName}><input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
        <Field label="Apellidos" error={errs.lastName}><input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
        <Field label="Correo" error={errs.email} hint="Necesario para que use la app."><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Fecha de nacimiento"><input className="input" type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} /></Field>
        <Field label="Contacto de emergencia" className="full"><input className="input" value={f.emergencyContact} onChange={(e) => setF({ ...f, emergencyContact: e.target.value })} placeholder="Nombre y teléfono" /></Field>
        <Field label="Notas de salud" className="full" hint="Solo las ven su entrenador y administración."><textarea className="input" value={f.healthNotes} onChange={(e) => setF({ ...f, healthNotes: e.target.value })} placeholder="Lesiones, condiciones o indicaciones médicas" /></Field>
        <Field label="Entrenador asignado">
          <select className="select" value={f.trainerId} onChange={(e) => setF({ ...f, trainerId: e.target.value })}>
            <option value="">Sin asignar</option>
            {(trainers.data ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        </Field>
        <label className="check" style={{ alignSelf: 'end', minHeight: 42 }}>
          <input type="checkbox" checked={f.createAccount} disabled={!f.email} onChange={(e) => setF({ ...f, createAccount: e.target.checked })} />
          Crear acceso a la app
        </label>
      </form>
      <FormError error={save.error} />
    </Sheet>
  );
}

export function MembersPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const status = params.get('estado') ?? '';
  useEffect(() => { const id = setTimeout(() => setDebounced(q), 220); return () => clearTimeout(id); }, [q]);
  const list = useApi<{ items: MemberListItem[]; total: number; counts: Record<string, number> }>(`/members${qs({ q: debounced, status, limit: 200 })}`);
  const nav = useNavigate();
  const adding = params.get('nuevo') === '1';
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const total = Object.entries(list.data?.counts ?? {}).filter(([k]) => k !== 'debt').reduce((s, [, v]) => s + v, 0);

  return (
    <div className="page">
      <PageHead eyebrow={user.role === 'trainer' ? 'Tus socios asignados' : 'Base de socios'} title="Socios"
        actions={user.role !== 'trainer' && <Button variant="primary" onClick={() => setParam('nuevo', '1')}><Icon name="plus" size={16} />Alta rápida</Button>} />
      <div className="stack-lg">
        <div className="stack">
          <input className="input" type="search" placeholder="Buscar por nombre, DNI, correo o teléfono" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar socios" />
          <div className="chips">
            {FILTERS.map((f) => (
              <button key={f.key} className="chip" aria-pressed={status === f.key} onClick={() => setParam('estado', f.key || null)}>
                {f.label} <b>{f.key ? (list.data?.counts[f.key] ?? 0) : total}</b>
              </button>
            ))}
          </div>
        </div>
        <Load q={list} skeleton={<Skeleton lines={10} />}>
          {(d) => d.items.length === 0 ? (
            <Empty glyph="?" title={debounced ? 'Sin resultados' : 'Nadie en este filtro'}
              action={debounced && user.role !== 'trainer' ? <Button onClick={() => setParam('nuevo', '1')}>Registrar “{debounced}”</Button> : undefined}>
              {debounced ? 'Revisa la ortografía o busca por DNI.' : 'Prueba con otro estado.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>Socio</th><th className="hide-sm">DNI</th><th>Estado</th><th className="hide-sm">Plan</th><th className="hide-sm">Vence</th><th className="n">Deuda</th><th className="hide-sm">Última visita</th></tr>
                </thead>
                <tbody>
                  {d.items.map((m) => (
                    <tr key={m.id} className="link" onClick={() => nav(`/socios/${m.id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/socios/${m.id}`); }}>
                      <td><b>{m.fullName}</b>{m.trainerName && <div className="faint" style={{ fontSize: 12 }}>{m.trainerName}</div>}</td>
                      <td className="mono hide-sm">{m.dni}</td>
                      <td><StateTag state={m.state} /></td>
                      <td className="hide-sm">{m.planName ?? '—'}</td>
                      <td className="num hide-sm">{date(m.endDate)}{m.daysLeft != null && m.daysLeft >= 0 && m.daysLeft <= 7 ? <span className="warn"> · {m.daysLeft}d</span> : ''}</td>
                      <td className={`n ${m.debtCents ? 'bad' : 'faint'}`}>{m.debtCents ? money(m.debtCents) : '—'}</td>
                      <td className="hide-sm faint">{ago(m.lastVisit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.total > d.items.length && <p className="faint" style={{ padding: 12 }}>Mostrando {d.items.length} de {d.total}. Afina la búsqueda para ver el resto.</p>}
            </div>
          )}
        </Load>
      </div>
      <QuickAdd open={adding} onClose={() => { setParam('nuevo', null); list.reload(); }} />
    </div>
  );
}
