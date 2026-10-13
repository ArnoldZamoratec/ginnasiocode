import { useState } from 'react';
import { api, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { Button, Empty, Field, FormError, Load, PageHead, Sheet, Skeleton, Tag, Icon, useToast } from '../../components/ui.tsx';
import { money } from '../../lib/format.ts';
import type { Plan } from '../../lib/types.ts';

export function PlansPage() {
  const q = useApi<Plan[]>('/plans?all=true');
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  const [f, setF] = useState({ name: '', description: '', durationDays: '30', price: '', includesClasses: true, maxFreezeDays: '0' });
  const toast = useToast();
  const open = (p: Plan | 'new') => {
    setEdit(p);
    setF(p === 'new' ? { name: '', description: '', durationDays: '30', price: '', includesClasses: true, maxFreezeDays: '0' }
      : { name: p.name, description: p.description, durationDays: String(p.duration_days), price: (p.price_cents / 100).toFixed(2), includesClasses: p.includes_classes, maxFreezeDays: String(p.max_freeze_days) });
  };
  const save = useAction(async () => {
    const body = { name: f.name, description: f.description, durationDays: Number(f.durationDays), priceCents: Math.round(Number(f.price.replace(',', '.')) * 100), includesClasses: f.includesClasses, maxFreezeDays: Number(f.maxFreezeDays) };
    if (edit === 'new') await post('/admin/plans', body); else await api('PATCH', `/admin/plans/${(edit as Plan).id}`, body);
    toast('Plan guardado.');
    setEdit(null); q.reload();
  });
  const toggle = useAction(async (p: Plan) => { await api('PATCH', `/admin/plans/${p.id}`, { active: !p.active }); q.reload(); });
  return (
    <div className="page">
      <PageHead eyebrow="Configuración" title="Planes y precios" actions={<Button variant="primary" onClick={() => open('new')}><Icon name="plus" size={16} />Nuevo plan</Button>} />
      <Load q={q} skeleton={<Skeleton lines={6} />}>
        {(plans) => plans.length === 0 ? <Empty glyph="0" title="Sin planes" action={<Button onClick={() => open('new')}>Crear plan</Button>} /> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Plan</th><th className="n">Días</th><th className="n">Precio</th><th className="n hide-sm">Por día</th><th className="hide-sm">Clases</th><th className="n hide-sm">Congelar</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className={p.active ? '' : 'voided'}>
                    <td><b>{p.name}</b>{p.description && <div className="faint" style={{ fontSize: 12 }}>{p.description}</div>}</td>
                    <td className="n">{p.duration_days}</td>
                    <td className="n display" style={{ fontSize: 22 }}>{money(p.price_cents)}</td>
                    <td className="n hide-sm faint">{money(Math.round(p.price_cents / p.duration_days))}</td>
                    <td className="hide-sm">{p.includes_classes ? 'Incluye' : 'Solo sala'}</td>
                    <td className="n hide-sm">{p.max_freeze_days ? `${p.max_freeze_days} d` : '—'}</td>
                    <td>{p.active ? <Tag tone="ok">A la venta</Tag> : <Tag>Retirado</Tag>}</td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" onClick={() => open(p)}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle.run(p)}>{p.active ? 'Retirar' : 'Reactivar'}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Load>
      <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>Cambiar el precio afecta solo a ventas futuras: las membresías ya vendidas conservan su precio. Retirar un plan lo quita de la venta sin afectar a quienes lo tienen.</p>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Nuevo plan' : 'Editar plan'}
        footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Guardar</Button></>}>
        <div className="form-grid">
          <Field label="Nombre" className="full"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Descripción" className="full"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Duración (días)"><input className="input num" type="number" min={1} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></Field>
          <Field label="Precio"><input className="input num" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Días de congelamiento" hint="0 = no permite congelar."><input className="input num" type="number" min={0} value={f.maxFreezeDays} onChange={(e) => setF({ ...f, maxFreezeDays: e.target.value })} /></Field>
          <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={f.includesClasses} onChange={(e) => setF({ ...f, includesClasses: e.target.checked })} />Incluye clases grupales</label>
        </div>
        <FormError error={save.error} />
      </Sheet>
    </div>
  );
}
