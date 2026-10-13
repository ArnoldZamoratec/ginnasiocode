import { useState } from 'react';
import { api, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Button, Empty, Field, FormError, Load, PageHead, Sheet, Skeleton, Tag, Icon, useToast } from '../../components/ui.tsx';
import type { Staff } from '../../lib/types.ts';

interface Schedule { id: number; class_type_id: number; class_name: string; branch_id: number; branch_name: string; trainer_id: number | null; trainer_name: string | null; weekday: number; start_time: string; duration_min: number; capacity: number; room: string; active: number }
interface ClassType { id: number; name: string; description: string; intensity: number }
const WD = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function SchedulePage() {
  const { branches } = useAuth();
  const q = useApi<Schedule[]>('/admin/schedules');
  const types = useApi<ClassType[]>('/admin/class-types');
  const trainers = useApi<Staff[]>('/admin/staff?role=trainer');
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState(false);
  const [f, setF] = useState({ classTypeId: '', branchId: String(branches[0]?.id ?? ''), trainerId: '', weekday: '1', startTime: '19:00', durationMin: '50', capacity: '20', room: 'Sala 1' });
  const [t, setT] = useState({ name: '', description: '', intensity: '2' });
  const toast = useToast();
  const save = useAction(async () => {
    const r = await post<{ sessionsCreated: number }>('/admin/schedules', {
      classTypeId: Number(f.classTypeId), branchId: Number(f.branchId), trainerId: f.trainerId ? Number(f.trainerId) : null,
      weekday: Number(f.weekday), startTime: f.startTime, durationMin: Number(f.durationMin), capacity: Number(f.capacity), room: f.room,
    });
    toast(`Clase agregada al horario; ${r.sessionsCreated} sesiones generadas para las próximas 2 semanas.`);
    setAdding(false); q.reload();
  });
  const saveType = useAction(async () => {
    const r = await post<ClassType>('/admin/class-types', { name: t.name, description: t.description, intensity: Number(t.intensity) });
    await types.reload();
    setF({ ...f, classTypeId: String(r.id) });
    setNewType(false); setT({ name: '', description: '', intensity: '2' });
  });
  const toggle = useAction(async (s: Schedule) => {
    await api('PATCH', `/admin/schedules/${s.id}`, { active: !s.active });
    toast(s.active ? 'Desactivada. Las sesiones futuras sin reservas se retiraron; las que tienen reservas cancélalas desde Clases para avisar.' : 'Reactivada.');
    q.reload();
  });

  return (
    <div className="page">
      <PageHead eyebrow="Configuración" title="Horario semanal" actions={<Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Agregar clase</Button>} />
      <Load q={q} skeleton={<Skeleton lines={10} />}>
        {(rows) => rows.length === 0 ? <Empty glyph="0" title="Horario vacío" action={<Button onClick={() => setAdding(true)}>Agregar la primera clase</Button>} /> : (
          <div className="stack-lg">
            {[1, 2, 3, 4, 5, 6, 7].filter((d) => rows.some((r) => r.weekday === d)).map((d) => (
              <section key={d} className="section">
                <div className="section-head"><h2>{WD[d]}</h2><span className="aside">{rows.filter((r) => r.weekday === d && r.active).length} clases</span></div>
                <div className="table-wrap">
                  <table className="t">
                    <tbody>
                      {rows.filter((r) => r.weekday === d).map((s) => (
                        <tr key={s.id} className={s.active ? '' : 'voided'}>
                          <td className="mono" style={{ width: 90 }}>{s.start_time}</td>
                          <td><b>{s.class_name}</b><div className="faint" style={{ fontSize: 12 }}>{s.duration_min} min · {s.room}</div></td>
                          <td className="hide-sm">{s.trainer_name ?? '—'}</td>
                          <td className="hide-sm">{s.branch_name}</td>
                          <td className="n">{s.capacity} cupos</td>
                          <td>{s.active ? <Tag tone="ok">Activa</Tag> : <Tag>Inactiva</Tag>}</td>
                          <td className="right"><Button size="sm" variant="ghost" onClick={() => toggle.run(s)}>{s.active ? 'Desactivar' : 'Activar'}</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </Load>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Agregar clase al horario" wide
        footer={<><Button onClick={() => setAdding(false)}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={!f.classTypeId || !f.branchId} onClick={() => save.run()}>Agregar</Button></>}>
        <div className="form-grid">
          <Field label="Tipo de clase">
            <div className="row">
              <select className="select" value={f.classTypeId} onChange={(e) => setF({ ...f, classTypeId: e.target.value })}>
                <option value="">Elige…</option>
                {(types.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button size="sm" variant="ghost" onClick={() => setNewType((v) => !v)}>Nuevo</Button>
            </div>
          </Field>
          <Field label="Sede">
            <select className="select" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              {branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          {newType && (
            <div className="full stack" style={{ border: '1px dashed var(--line-2)', padding: 14 }}>
              <div className="form-grid">
                <Field label="Nombre"><input className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
                <Field label="Intensidad (1–3)"><input className="input num" type="number" min={1} max={3} value={t.intensity} onChange={(e) => setT({ ...t, intensity: e.target.value })} /></Field>
                <Field label="Descripción" className="full"><input className="input" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} /></Field>
              </div>
              <FormError error={saveType.error} />
              <Button size="sm" busy={saveType.busy} disabled={t.name.trim().length < 2} onClick={() => saveType.run()}>Crear tipo</Button>
            </div>
          )}
          <Field label="Día">
            <select className="select" value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>{WD.slice(1).map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</select>
          </Field>
          <Field label="Hora de inicio"><input className="input" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
          <Field label="Duración (min)"><input className="input num" type="number" min={15} max={240} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
          <Field label="Cupo"><input className="input num" type="number" min={1} max={200} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
          <Field label="Sala"><input className="input" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></Field>
          <Field label="Entrenador">
            <select className="select" value={f.trainerId} onChange={(e) => setF({ ...f, trainerId: e.target.value })}>
              <option value="">Por asignar</option>
              {(trainers.data ?? []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </select>
          </Field>
        </div>
        <FormError error={save.error} />
      </Sheet>
    </div>
  );
}
