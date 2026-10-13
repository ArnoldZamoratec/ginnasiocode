import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../../lib/api.ts';
import { useApi, useAction, useInterval } from '../../lib/hooks.ts';
import { Button, Empty, ErrorState, FormError, Sheet, Skeleton, Icon, useToast } from '../../components/ui.tsx';
import { kg, MUSCLE, shortDate } from '../../lib/format.ts';
import type { Exercise, RoutineItem, Workout } from '../../lib/types.ts';

function Stepper({ label, value, step, onChange, decimals }: { label: string; value: number; step: number; onChange: (v: number) => void; decimals?: boolean }) {
  return (
    <div className="stepper-wrap">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" onClick={() => onChange(Math.max(0, +(value - step).toFixed(2)))} aria-label={`Menos ${label}`}>−</button>
        <input inputMode={decimals ? 'decimal' : 'numeric'} value={value} aria-label={label}
          onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(v)) onChange(v); }} onFocus={(e) => e.target.select()} />
        <button type="button" onClick={() => onChange(+(value + step).toFixed(2))} aria-label={`Más ${label}`}>+</button>
      </div>
    </div>
  );
}

interface Block { exerciseId: number; name: string; muscle: string; plan?: RoutineItem }

function ExerciseBlock({ b, w, current, onLog, onUndo, busy }: {
  b: Block; w: Workout; current: boolean; busy: boolean;
  onLog: (exerciseId: number, reps: number, weight: number, rest: number) => void; onUndo: (setId: number) => void;
}) {
  const sets = w.sets.filter((s) => s.exercise_id === b.exerciseId);
  const prev = w.previous[b.exerciseId];
  const last = sets[sets.length - 1];
  const targetReps = Number(b.plan?.reps.split('-').pop()?.replace('s', '')) || 10;
  const [weight, setWeight] = useState<number>(last?.weight_kg ?? b.plan?.target_kg ?? prev?.weight_kg ?? 0);
  const [reps, setReps] = useState<number>(last?.reps ?? prev?.reps ?? targetReps);
  const planned = b.plan?.sets ?? 0;
  const done = planned > 0 && sets.length >= planned;
  const [expanded, setExpanded] = useState(current);
  useEffect(() => { if (current) setExpanded(true); }, [current]);

  return (
    <article className={`ex ${done ? 'done' : ''} ${current ? 'current' : ''}`} id={`ex-${b.exerciseId}`}>
      <button className="ex-head" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', borderBottom: expanded ? undefined : 0 }} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <div className="grow">
          <span className="eyebrow">{MUSCLE[b.muscle] ?? b.muscle}</span>
          <h3 style={{ marginTop: 4 }}>{b.name}</h3>
          <div className="mono faint" style={{ fontSize: 12, marginTop: 6 }}>
            {b.plan ? `${b.plan.sets}×${b.plan.reps}${b.plan.target_kg ? ` · ${kg(b.plan.target_kg)}` : ''} · descanso ${b.plan.rest_sec}s` : 'Ejercicio libre'}
          </div>
        </div>
        <div className="right">
          <div className="display" style={{ fontSize: 34 }}>{sets.length}{planned ? <span className="faint">/{planned}</span> : ''}</div>
          <div className="eyebrow">series</div>
        </div>
      </button>
      {expanded && (
        <>
          {prev && <div className="mono faint" style={{ fontSize: 12, padding: '8px 16px', borderBottom: '1px solid var(--line)' }}>La última vez ({shortDate(prev.started_at)}): {kg(prev.weight_kg)} × {prev.reps}</div>}
          {b.plan?.notes && <div className="muted" style={{ fontSize: 13, padding: '8px 16px', borderBottom: '1px solid var(--line)' }}>{b.plan.notes}</div>}
          <div className="sets">
            {sets.map((s, i) => (
              <div className="set" key={s.id}>
                <span className="n">{s.set_number}</span>
                <span><b>{s.weight_kg}</b> <span className="faint">kg</span></span>
                <span><b>{s.reps}</b> <span className="faint">reps</span></span>
                {i === sets.length - 1 ? <button className="btn ghost sm" onClick={() => onUndo(s.id)} aria-label="Deshacer última serie">Deshacer</button> : <span />}
              </div>
            ))}
          </div>
          <form className="log-form" onSubmit={(e) => { e.preventDefault(); onLog(b.exerciseId, reps, weight, b.plan?.rest_sec ?? 90); }}>
            <Stepper label="Peso (kg)" value={weight} step={2.5} onChange={setWeight} decimals />
            <Stepper label="Repeticiones" value={reps} step={1} onChange={setReps} />
            <Button variant={done ? undefined : 'primary'} size="lg" busy={busy}>{done ? 'Serie extra' : `Registrar serie ${sets.length + 1}`}</Button>
          </form>
        </>
      )}
    </article>
  );
}

function AddExercise({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (e: Exercise) => void }) {
  const [muscle, setMuscle] = useState('');
  const [q, setQ] = useState('');
  const list = useApi<Exercise[]>(open ? `/exercises${muscle ? `?muscle=${muscle}` : ''}` : null);
  const shown = (list.data ?? []).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title="Agregar ejercicio">
      <input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className="chip" aria-pressed={!muscle} onClick={() => setMuscle('')}>Todos</button>
        {Object.entries(MUSCLE).map(([k, v]) => <button key={k} className="chip" aria-pressed={muscle === k} onClick={() => setMuscle(k)}>{v}</button>)}
      </div>
      <div className="list">
        {shown.map((e) => (
          <button key={e.id} className="list-item" style={{ background: 'none', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }} onClick={() => onPick(e)}>
            <span className="grow"><b>{e.name}</b><br /><span className="faint" style={{ fontSize: 12.5 }}>{MUSCLE[e.muscle_group]} · {e.equipment}</span></span>
            <Icon name="plus" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function WorkoutMode() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const q = useApi<Workout>(`/workouts/${id}`);
  const [extra, setExtra] = useState<Block[]>([]);
  const [picker, setPicker] = useState(false);
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [summary, setSummary] = useState<Workout['summary'] | null>(null);
  useInterval(() => setNow(Date.now()), 1000);

  const w = q.data;
  const blocks = useMemo<Block[]>(() => {
    if (!w) return [];
    const out: Block[] = w.plan.map((p) => ({ exerciseId: p.exercise_id, name: p.exercise_name, muscle: p.muscle_group, plan: p }));
    for (const s of w.sets) if (!out.some((b) => b.exerciseId === s.exercise_id)) out.push({ exerciseId: s.exercise_id, name: s.exercise_name, muscle: '' });
    for (const e of extra) if (!out.some((b) => b.exerciseId === e.exerciseId)) out.push(e);
    return out;
  }, [w, extra]);
  const currentId = blocks.find((b) => {
    const n = w?.sets.filter((s) => s.exercise_id === b.exerciseId).length ?? 0;
    return b.plan ? n < b.plan.sets : n === 0;
  })?.exerciseId;

  const log = useAction(async (exerciseId: number, reps: number, weightKg: number, restSec: number) => {
    const next = await post<Workout>(`/workouts/${id}/sets`, { exerciseId, reps, weightKg });
    q.setData(() => next);
    if (restSec > 0) setRest({ until: Date.now() + restSec * 1000, total: restSec });
    navigator.vibrate?.(30);
  });
  const undo = useAction(async (setId: number) => {
    const next = await api<Workout>('DELETE', `/workouts/${id}/sets/${setId}`);
    q.setData(() => next);
  });
  const finish = useAction(async () => {
    const r = await post<Workout>(`/workouts/${id}/finish`, {});
    setSummary(r.summary ?? null);
  });

  useEffect(() => { if (rest && now >= rest.until) { setRest(null); navigator.vibrate?.([80, 60, 80]); } }, [now, rest]);

  const elapsed = w ? Math.floor((now - new Date(w.started_at).getTime()) / 1000) : 0;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  if (q.error && !w) return <div className="m-page"><ErrorState error={q.error} retry={q.reload} /><Button onClick={() => nav('/entreno')}>Volver</Button></div>;
  if (!w) return <div className="m-page"><Skeleton block lines={6} /></div>;
  if (w.finished_at && !summary) {
    return (
      <main className="m-page">
        <Empty glyph="✓" title="Sesión terminada" action={<Button onClick={() => nav('/entreno')}>Volver a Entreno</Button>}>Esta sesión ya se cerró. Revisa tu progreso en Entreno.</Empty>
      </main>
    );
  }

  return (
    <div style={{ minHeight: '100%', paddingBottom: rest ? 90 : 24 }}>
      <header className="m-top">
        <button className="btn ghost sm" onClick={() => nav('/entreno')} aria-label="Salir (la sesión queda abierta)"><Icon name="back" size={18} /></button>
        <div className="grow">
          <span className="eyebrow">Entrenando{w.day_label ? ` · Día ${w.day_label}` : ''}</span>
          <div style={{ fontWeight: 600 }}>{w.routine_name ?? 'Entrenamiento libre'}</div>
        </div>
        <span className="display num" style={{ fontSize: 28 }} aria-label="Tiempo transcurrido">{mmss(elapsed)}</span>
      </header>
      <main className="m-page train">
        {blocks.length === 0 && <Empty glyph="+" title="Agrega tu primer ejercicio">Elige de la biblioteca y registra cada serie al terminarla.</Empty>}
        {blocks.map((b) => (
          <ExerciseBlock key={b.exerciseId} b={b} w={w} current={b.exerciseId === currentId} busy={log.busy}
            onLog={(e, r, kgs, rs) => log.run(e, r, kgs, rs)} onUndo={(s) => undo.run(s)} />
        ))}
        <FormError error={log.error ?? undo.error} />
        <Button onClick={() => setPicker(true)}><Icon name="plus" size={16} />Agregar ejercicio</Button>
        <Button variant="primary" size="lg" block busy={finish.busy} disabled={w.sets.length === 0} onClick={() => finish.run()}>Terminar sesión</Button>
        <FormError error={finish.error} />
      </main>

      {rest && (
        <div className="rest" style={{ bottom: 0 }} role="timer" aria-live="off">
          <span className="eyebrow" style={{ color: 'inherit', opacity: .7 }}>Descanso</span>
          <b>{mmss(Math.max(0, Math.ceil((rest.until - now) / 1000)))}</b>
          <div className="grow" style={{ height: 4, background: 'rgba(0,0,0,.15)' }}><div style={{ height: '100%', background: 'var(--accent)', width: `${(1 - (rest.until - now) / (rest.total * 1000)) * 100}%` }} /></div>
          <button className="btn sm" style={{ borderColor: 'currentColor' }} onClick={() => setRest(null)}>Saltar</button>
        </div>
      )}

      <AddExercise open={picker} onClose={() => setPicker(false)} onPick={(e) => {
        setExtra((x) => [...x, { exerciseId: e.id, name: e.name, muscle: e.muscle_group }]);
        setPicker(false);
        setTimeout(() => document.getElementById(`ex-${e.id}`)?.scrollIntoView({ behavior: 'smooth' }), 50);
      }} />

      <Sheet open={!!summary} onClose={() => nav('/entreno')} eyebrow="Sesión terminada" title="Buen trabajo"
        footer={<Button variant="primary" block onClick={() => { toast('Sesión guardada.'); nav('/entreno'); }}>Listo</Button>}>
        {summary && (
          <div className="kpis">
            <div className="kpi hero"><span className="eyebrow">Volumen</span><div className="v">{summary.volumeKg.toLocaleString('es-PE')}<small>kg</small></div></div>
            <div className="kpi"><span className="eyebrow">Series</span><div className="v">{summary.sets}</div></div>
            <div className="kpi"><span className="eyebrow">Ejercicios</span><div className="v">{summary.exercises}</div></div>
            <div className="kpi"><span className="eyebrow">Duración</span><div className="v">{Math.round(elapsed / 60)}<small>min</small></div></div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
