import { useState } from 'react';
import { api, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useAuth, type Branch } from '../../lib/auth.tsx';
import { Button, Field, FormError, Load, PageHead, Sheet, Skeleton, Tag, Icon, useToast } from '../../components/ui.tsx';

export function BranchesPage() {
  const q = useApi<Branch[]>('/branches');
  const [edit, setEdit] = useState<Branch | 'new' | null>(null);
  const [f, setF] = useState({ name: '', address: '', opensAt: '06:00', closesAt: '22:00', capacity: '120' });
  const toast = useToast();
  const { reloadBranches } = useAuth();
  const open = (b: Branch | 'new') => {
    setEdit(b);
    setF(b === 'new' ? { name: '', address: '', opensAt: '06:00', closesAt: '22:00', capacity: '120' } : { name: b.name, address: b.address, opensAt: b.opens_at, closesAt: b.closes_at, capacity: String(b.capacity) });
  };
  const save = useAction(async () => {
    const body = { ...f, capacity: Number(f.capacity) };
    if (edit === 'new') await post('/admin/branches', body); else await api('PATCH', `/admin/branches/${(edit as Branch).id}`, body);
    toast('Sede guardada.');
    setEdit(null); q.reload(); reloadBranches();
  });
  const toggle = useAction(async (b: Branch) => { await api('PATCH', `/admin/branches/${b.id}`, { active: !b.active }); q.reload(); reloadBranches(); });
  return (
    <div className="page narrow">
      <PageHead eyebrow="Configuración" title="Sedes" actions={<Button variant="primary" onClick={() => open('new')}><Icon name="plus" size={16} />Nueva sede</Button>} />
      <Load q={q} skeleton={<Skeleton lines={4} />}>
        {(rows) => (
          <div className="list">
            {rows.map((b) => (
              <div key={b.id} className="list-item">
                <div className="grow">
                  <h3 className="display" style={{ fontSize: 28 }}>{b.name}</h3>
                  <div className="muted" style={{ fontSize: 13.5 }}>{b.address || 'Sin dirección'} · <span className="mono">{b.opens_at}–{b.closes_at}</span> · aforo {b.capacity}</div>
                </div>
                {b.active ? <Tag tone="ok">Abierta</Tag> : <Tag>Inactiva</Tag>}
                <Button size="sm" variant="ghost" onClick={() => open(b)}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => toggle.run(b)}>{b.active ? 'Desactivar' : 'Activar'}</Button>
              </div>
            ))}
          </div>
        )}
      </Load>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Nueva sede' : 'Editar sede'}
        footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Guardar</Button></>}>
        <div className="form-grid">
          <Field label="Nombre" className="full"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Dirección" className="full"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Abre"><input className="input" type="time" value={f.opensAt} onChange={(e) => setF({ ...f, opensAt: e.target.value })} /></Field>
          <Field label="Cierra"><input className="input" type="time" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} /></Field>
          <Field label="Aforo"><input className="input num" type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        </div>
        <FormError error={save.error} />
      </Sheet>
    </div>
  );
}

