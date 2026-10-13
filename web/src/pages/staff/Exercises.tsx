import { useState } from 'react';
import { post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { Button, Empty, Field, FormError, Load, PageHead, Sheet, Skeleton, Icon, useToast } from '../../components/ui.tsx';
import { MUSCLE } from '../../lib/format.ts';
import type { Exercise } from '../../lib/types.ts';

export function ExercisesPage() {
  const [muscle, setMuscle] = useState('');
  const [q, setQ] = useState('');
  const list = useApi<Exercise[]>(`/exercises${muscle ? `?muscle=${muscle}` : ''}`);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', muscleGroup: 'pecho', equipment: '', instructions: '' });
  const toast = useToast();
  const save = useAction(async () => {
    await post('/exercises', f);
    toast(`${f.name} agregado a la biblioteca.`);
    setF({ name: '', muscleGroup: f.muscleGroup, equipment: '', instructions: '' });
    setAdding(false);
    list.reload();
  });
  const shown = (list.data ?? []).filter((e) => !q || `${e.name} ${e.equipment}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(shown.map((e) => e.muscle_group))];

  return (
    <div className="page">
      <PageHead eyebrow="Biblioteca" title="Ejercicios" actions={<Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Agregar</Button>} />
      <div className="stack-lg">
        <div className="stack">
          <input className="input" type="search" placeholder="Buscar por nombre o equipo" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            <button className="chip" aria-pressed={!muscle} onClick={() => setMuscle('')}>Todos</button>
            {Object.entries(MUSCLE).map(([k, v]) => <button key={k} className="chip" aria-pressed={muscle === k} onClick={() => setMuscle(k)}>{v}</button>)}
          </div>
        </div>
        <Load q={list} skeleton={<Skeleton lines={10} />}>
          {() => shown.length === 0 ? <Empty glyph="?" title="Sin ejercicios">Ajusta el filtro o agrega uno nuevo.</Empty> : (
            <div className="stack-lg">
              {groups.map((g) => (
                <section key={g} className="section">
                  <div className="section-head"><h2>{MUSCLE[g] ?? g}</h2><span className="aside">{shown.filter((e) => e.muscle_group === g).length}</span></div>
                  <div className="table-wrap">
                    <table className="t">
                      <tbody>
                        {shown.filter((e) => e.muscle_group === g).map((e) => (
                          <tr key={e.id}><td style={{ width: '34%' }}><b>{e.name}</b></td><td className="faint" style={{ width: '18%' }}>{e.equipment}</td><td className="muted hide-sm" style={{ fontSize: 13 }}>{e.instructions}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </Load>
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Nuevo ejercicio"
        footer={<><Button onClick={() => setAdding(false)}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={f.name.trim().length < 3 || f.equipment.trim().length < 2} onClick={() => save.run()}>Guardar</Button></>}>
        <div className="form-grid">
          <Field label="Nombre" className="full"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Grupo muscular">
            <select className="select" value={f.muscleGroup} onChange={(e) => setF({ ...f, muscleGroup: e.target.value })}>
              {Object.entries(MUSCLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Equipo"><input className="input" value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} placeholder="Barra, mancuernas, máquina…" /></Field>
          <Field label="Indicaciones" className="full"><textarea className="input" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
        </div>
        <FormError error={save.error} />
      </Sheet>
    </div>
  );
}
