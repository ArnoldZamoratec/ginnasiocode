import { useState } from 'react';
import { api, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useAuth, useUser } from '../../lib/auth.tsx';
import { Button, Field, FormError, Load, PageHead, Seg, Sheet, Skeleton, Tag, Icon, useToast } from '../../components/ui.tsx';
import { ROLE } from '../../lib/format.ts';
import type { Staff } from '../../lib/types.ts';

type Role = Staff['role'];

export function StaffPage() {
  const me = useUser();
  const { branches } = useAuth();
  const q = useApi<Staff[]>('/admin/staff');
  const [edit, setEdit] = useState<Staff | 'new' | null>(null);
  const [f, setF] = useState({ email: '', fullName: '', role: 'reception' as Role, branchId: String(branches[0]?.id ?? ''), phone: '' });
  const [created, setCreated] = useState<string | null>(null);
  const toast = useToast();
  const open = (s: Staff | 'new') => {
    setEdit(s); setCreated(null);
    setF(s === 'new' ? { email: '', fullName: '', role: 'reception', branchId: String(branches[0]?.id ?? ''), phone: '' }
      : { email: s.email, fullName: s.full_name, role: s.role, branchId: String(s.branch_id ?? ''), phone: s.phone ?? '' });
  };
  const save = useAction(async () => {
    if (edit === 'new') {
      const r = await post<{ temporaryPassword: string | null }>('/admin/staff', { email: f.email, fullName: f.fullName, role: f.role, branchId: f.branchId ? Number(f.branchId) : null, phone: f.phone || null });
      setCreated(r.temporaryPassword);
    } else {
      await api('PATCH', `/admin/staff/${(edit as Staff).id}`, { fullName: f.fullName, role: f.role, branchId: f.branchId ? Number(f.branchId) : null });
      toast('Datos actualizados. Si cambió el rol, deberá volver a ingresar.');
      setEdit(null);
    }
    q.reload();
  });
  const toggle = useAction(async (s: Staff) => { await api('PATCH', `/admin/staff/${s.id}`, { active: !s.active }); toast(s.active ? `${s.full_name} desactivado; sus sesiones se cerraron.` : 'Reactivado.'); q.reload(); });

  return (
    <div className="page">
      <PageHead eyebrow="Configuración" title="Personal" actions={<Button variant="primary" onClick={() => open('new')}><Icon name="plus" size={16} />Dar de alta</Button>} />
      <Load q={q} skeleton={<Skeleton lines={8} />}>
        {(rows) => (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Nombre</th><th>Rol</th><th className="hide-sm">Sede</th><th className="hide-sm">Correo</th><th className="n hide-sm">Socios</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className={s.active ? '' : 'voided'}>
                    <td><b>{s.full_name}</b>{s.id === me.id && <span className="faint"> (tú)</span>}</td>
                    <td>{ROLE[s.role]}</td>
                    <td className="hide-sm">{s.branch_name ?? 'Todas'}</td>
                    <td className="hide-sm mono" style={{ fontSize: 12.5 }}>{s.email}</td>
                    <td className="n hide-sm">{s.role === 'trainer' ? s.assigned_members : '—'}</td>
                    <td>{s.active ? <Tag tone="ok">Activo</Tag> : <Tag>Inactivo</Tag>}</td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" onClick={() => open(s)}>Editar</Button>
                      {s.id !== me.id && <Button size="sm" variant="ghost" onClick={() => toggle.run(s)}>{s.active ? 'Desactivar' : 'Activar'}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Load>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Alta de personal' : 'Editar'}
        footer={created !== null ? <Button variant="primary" onClick={() => setEdit(null)}>Listo</Button> : <><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Guardar</Button></>}>
        {created !== null ? (
          <div className="stack">
            <p>Cuenta creada. Comparte esta contraseña temporal por un canal seguro; <b>solo se muestra una vez</b>.</p>
            <div className="display mono" style={{ fontSize: 32, padding: '14px 16px', border: '1px solid var(--line-2)' }}>{created}</div>
          </div>
        ) : (
          <>
            <Seg label="Rol" value={f.role} onChange={(role) => setF({ ...f, role })} options={(['reception', 'trainer', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE[r] }))} />
            <div className="form-grid">
              <Field label="Nombre completo" className="full"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
              {edit === 'new' && <Field label="Correo"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
              {edit === 'new' && <Field label="Teléfono"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>}
              <Field label="Sede">
                <select className="select" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                  <option value="">Todas</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </div>
            <FormError error={save.error} />
          </>
        )}
      </Sheet>
    </div>
  );
}
