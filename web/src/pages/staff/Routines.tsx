import { useState } from 'react';
import { api, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { Button, Empty, Field, FormError, Load, PageHead, Sheet, Skeleton, Icon, useToast } from '../../components/ui.tsx';
import { RoutineDays } from '../member/Training.tsx';
import { MUSCLE } from '../../lib/format.ts';
import type { Exercise, Routine } from '../../lib/types.ts';

interface Item { dayLabel: string; exerciseId: number; name: string; muscle: string; sets: number; reps: string; targetKg: string; restSec: number; notes: string }
const DAYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Editor de rutina: días A–F, ejercicios de la biblioteca filtrables por músculo, series × reps, peso objetivo y descanso. */
export function RoutineEditor({ routine, memberId, onSaved }: { routine: Routine | null; memberId: number | null; onSaved: (r: Routine) => void }) {
  const lib = useApi<Exercise[]>('/exercises');
  const [name, setName] = useState(routine?.name ?? '');
  const [goal, setGoal] = useState(routine?.goal ?? '');
  const [items, setItems] = useState<Item[]>(() => (routine?.items ?? []).map((i) => ({
    dayLabel: i.day_label, exerciseId: i.exercise_id, name: i.exercise_name, muscle: i.muscle_group, sets: i.sets, reps: i.reps,
    targetKg: i.target_kg != null ? String(i.target_kg) : '', restSec: i.rest_sec, notes: i.notes ?? '',
  })));
  const usedDays = [...new Set(items.map((i) => i.dayLabel))].sort();
  const [day, setDay] = useState(usedDays[0] ?? 'A');
  const [muscle, setMuscle] = useState('');
  const days = [...new Set([...usedDays, day])].sort();
  const nextDay = DAYS.find((d) => !days.includes(d));

  const update = (idx: number, patch: Partial<Item>) => setItems((x) => x.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const move = (idx: number, dir: -1 | 1) => setItems((x) => {
    const same = x.map((it, i) => ({ it, i })).filter((o) => o.it.dayLabel === day);
    const pos = same.findIndex((o) => o.i === idx);
    const other = same[pos + dir];
    if (!other) return x;
    const y = [...x];
    [y[idx], y[other.i]] = [y[other.i], y[idx]];
    return y;
  });

  const save = useAction(async () => {
    const body = {
      name, goal,
      items: items.map((i) => ({ dayLabel: i.dayLabel, exerciseId: i.exerciseId, sets: i.sets, reps: i.reps, targetKg: i.targetKg ? Number(i.targetKg.replace(',', '.')) : null, restSec: i.restSec, notes: i.notes || null })),
    };
    const r = routine ? await api<Routine>('PUT', `/routines/${routine.id}`, body) : await post<Routine>('/routines', { ...body, memberId });
    onSaved(r);
  });

  const options = (lib.data ?? []).filter((e) => !muscle || e.muscle_group === muscle);
  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Fuerza 3 días" /></Field>
        <Field label="Objetivo"><input className="input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ej.: ganar fuerza en básicos" /></Field>
      </div>
      <div className="row wrap">
        <div className="seg" role="group" aria-label="Día">
          {days.map((d) => <button key={d} type="button" aria-pressed={d === day} onClick={() => setDay(d)}>Día {d} <span className="faint">{items.filter((i) => i.dayLabel === d).length}</span></button>)}
        </div>
        {nextDay && <Button size="sm" variant="ghost" onClick={() => setDay(nextDay)}><Icon name="plus" size={14} />Día {nextDay}</Button>}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Ejercicio</th><th className="n">Series</th><th>Reps</th><th className="n">Kg</th><th className="n">Desc. s</th><th className="hide-sm">Nota</th><th /></tr></thead>
          <tbody>
            {items.map((it, idx) => it.dayLabel !== day ? null : (
              <tr key={idx}>
                <td><b>{it.name}</b><div className="faint" style={{ fontSize: 12 }}>{MUSCLE[it.muscle] ?? it.muscle}</div></td>
                <td className="n"><input className="input num" style={{ width: 64, minHeight: 34 }} type="number" min={1} max={20} value={it.sets} onChange={(e) => update(idx, { sets: Number(e.target.value) })} aria-label="Series" /></td>
                <td><input className="input" style={{ width: 80, minHeight: 34 }} value={it.reps} onChange={(e) => update(idx, { reps: e.target.value })} aria-label="Repeticiones" /></td>
                <td className="n"><input className="input num" style={{ width: 72, minHeight: 34 }} inputMode="decimal" value={it.targetKg} onChange={(e) => update(idx, { targetKg: e.target.value })} aria-label="Peso objetivo" /></td>
                <td className="n"><input className="input num" style={{ width: 72, minHeight: 34 }} type="number" min={0} max={600} step={15} value={it.restSec} onChange={(e) => update(idx, { restSec: Number(e.target.value) })} aria-label="Descanso" /></td>
                <td className="hide-sm"><input className="input" style={{ minHeight: 34 }} value={it.notes} onChange={(e) => update(idx, { notes: e.target.value })} aria-label="Nota" /></td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn ghost sm" onClick={() => move(idx, -1)} aria-label="Subir">↑</button>
                  <button type="button" className="btn ghost sm" onClick={() => move(idx, 1)} aria-label="Bajar">↓</button>
                  <button type="button" className="btn ghost sm" onClick={() => setItems((x) => x.filter((_, i) => i !== idx))} aria-label="Quitar">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.some((i) => i.dayLabel === day) && <p className="faint" style={{ padding: 12 }}>Día {day} sin ejercicios. Agrégalos desde la biblioteca.</p>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Agregar al día {day}</span>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={!muscle} onClick={() => setMuscle('')}>Todos</button>
          {Object.entries(MUSCLE).map(([k, v]) => <button type="button" key={k} className="chip" aria-pressed={muscle === k} onClick={() => setMuscle(k)}>{v}</button>)}
        </div>
        <select className="select" value="" onChange={(e) => {
          const ex = lib.data?.find((x) => x.id === Number(e.target.value));
          if (ex) setItems((x) => [...x, { dayLabel: day, exerciseId: ex.id, name: ex.name, muscle: ex.muscle_group, sets: 3, reps: '10', targetKg: '', restSec: 90, notes: '' }]);
        }} aria-label="Agregar ejercicio">
          <option value="">{lib.data ? `Elige entre ${options.length} ejercicios…` : 'Cargando biblioteca…'}</option>
          {options.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.equipment}</option>)}
        </select>
      </div>
      <FormError error={save.error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" busy={save.busy} disabled={name.trim().length < 3 || items.length === 0} onClick={() => save.run()}>Guardar rutina</Button>
      </div>
    </div>
  );
}

export function RoutinesPage() {
  const q = useApi<Routine[]>('/routines/templates');
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const [view, setView] = useState<Record<number, string>>({});
  const toast = useToast();
  return (
    <div className="page">
      <PageHead eyebrow="Plantillas reutilizables" title="Rutinas" actions={<Button variant="primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />Nueva plantilla</Button>} />
      <Load q={q} skeleton={<Skeleton block lines={6} />}>
        {(list) => list.length === 0 ? (
          <Empty glyph="—" title="Sin plantillas" action={<Button onClick={() => setEditing('new')}>Crear la primera</Button>}>
            Crea plantillas por objetivo y asígnalas a tus socios desde su ficha; cada socio recibe una copia que puedes ajustar.
          </Empty>
        ) : (
          <div className="cols">
            {list.map((r) => (
              <article key={r.id} className="span-6 section" style={{ border: '1px solid var(--line-2)', padding: 18 }}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <span className="eyebrow">{r.days.length} días · {r.items.length} ejercicios{r.trainer_name ? ` · ${r.trainer_name}` : ''}</span>
                    <h2 className="display" style={{ fontSize: 30, marginTop: 6 }}>{r.name}</h2>
                    {r.goal && <p className="muted">{r.goal}</p>}
                  </div>
                  <Button size="sm" onClick={() => setEditing(r)}>Editar</Button>
                </div>
                <RoutineDays r={r} day={view[r.id] ?? r.days[0]} onDay={(d) => setView({ ...view, [r.id]: d })} />
              </article>
            ))}
          </div>
        )}
      </Load>
      <Sheet open={!!editing} onClose={() => setEditing(null)} wide title={editing === 'new' ? 'Nueva plantilla' : 'Editar plantilla'}>
        {editing && <RoutineEditor routine={editing === 'new' ? null : editing} memberId={null} onSaved={() => { setEditing(null); q.reload(); toast('Plantilla guardada.'); }} />}
      </Sheet>
    </div>
  );
}
