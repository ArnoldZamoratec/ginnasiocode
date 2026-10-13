import { useEffect, useState, type FormEvent } from 'react';
import { post } from '../lib/api.ts';
import { useApi, useAction } from '../lib/hooks.ts';
import { Button, Empty, Field, FormError, Load, Section, Sheet, Skeleton, useToast } from './ui.tsx';
import { LineChart } from './charts.tsx';
import { ago, date, kg, MUSCLE, shortDate, today } from '../lib/format.ts';
import type { Measurement } from '../lib/types.ts';

interface ExerciseProgress { exerciseId: number; name: string; muscleGroup: string; sessions: number; lastAt: string; best1RM: number }
interface Points { exercise: { id: number; name: string }; points: { date: string; topWeightKg: number; topReps: number; e1rm: number; volumeKg: number; sets: number }[] }

export function ExerciseProgressPanel({ memberId }: { memberId: number }) {
  const list = useApi<ExerciseProgress[]>(`/members/${memberId}/progress/exercises`);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { if (!sel && list.data?.length) setSel(list.data[0].exerciseId); }, [list.data, sel]);
  const pts = useApi<Points>(sel ? `/members/${memberId}/progress/exercises/${sel}` : null);
  return (
    <Load q={list} skeleton={<Skeleton block />}>
      {(items) => items.length === 0 ? (
        <Empty glyph="0" title="Aún sin registros">Las series que se registren en modo entrenando aparecerán aquí como gráficos de evolución.</Empty>
      ) : (
        <div className="stack">
          <select className="select" value={sel ?? ''} onChange={(e) => setSel(Number(e.target.value))} aria-label="Ejercicio">
            {items.map((i) => <option key={i.exerciseId} value={i.exerciseId}>{i.name} · {MUSCLE[i.muscleGroup] ?? i.muscleGroup} · {i.sessions} sesiones</option>)}
          </select>
          <Load q={pts} skeleton={<Skeleton block lines={1} />}>
            {(p) => {
              const first = p.points[0], last = p.points[p.points.length - 1];
              const delta = last && first ? Math.round((last.e1rm - first.e1rm) * 10) / 10 : 0;
              return (
                <>
                  <div className="kpis">
                    <div className="kpi hero"><span className="eyebrow">1RM estimado</span><div className="v">{last?.e1rm ?? '—'}<small>kg</small></div><div className="d">{delta >= 0 ? '+' : ''}{delta} kg desde {first ? shortDate(first.date) : '—'}</div></div>
                    <div className="kpi"><span className="eyebrow">Mejor serie reciente</span><div className="v">{last?.topWeightKg ?? '—'}<small>kg × {last?.topReps}</small></div><div className="d">{last ? date(last.date) : ''}</div></div>
                    <div className="kpi"><span className="eyebrow">Sesiones</span><div className="v">{p.points.length}</div></div>
                  </div>
                  {p.points.length < 2 ? <p className="muted">Con dos sesiones o más se dibuja la evolución.</p> : (
                    <LineChart labels={p.points.map((x) => shortDate(x.date))} format={(v) => `${v}`}
                      series={[
                        { name: '1RM estimado (kg)', values: p.points.map((x) => x.e1rm), color: 'var(--accent-text)' },
                        { name: 'Peso máximo (kg)', values: p.points.map((x) => x.topWeightKg), color: 'var(--fg-2)', dashed: true },
                      ]} />
                  )}
                </>
              );
            }}
          </Load>
        </div>
      )}
    </Load>
  );
}

const MEASURES: { key: keyof Measurement; label: string; unit: string; body: string }[] = [
  { key: 'weight_kg', label: 'Peso', unit: 'kg', body: 'weightKg' },
  { key: 'body_fat_pct', label: 'Grasa', unit: '%', body: 'bodyFatPct' },
  { key: 'waist_cm', label: 'Cintura', unit: 'cm', body: 'waistCm' },
  { key: 'chest_cm', label: 'Pecho', unit: 'cm', body: 'chestCm' },
  { key: 'hip_cm', label: 'Cadera', unit: 'cm', body: 'hipCm' },
  { key: 'arm_cm', label: 'Brazo', unit: 'cm', body: 'armCm' },
  { key: 'thigh_cm', label: 'Muslo', unit: 'cm', body: 'thighCm' },
];

export function MeasurementsPanel({ memberId, canEdit = true }: { memberId: number; canEdit?: boolean }) {
  const q = useApi<Measurement[]>(`/members/${memberId}/measurements`);
  const [metric, setMetric] = useState<keyof Measurement>('weight_kg');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ measuredOn: today() });
  const toast = useToast();
  const save = useAction(async () => {
    const body: Record<string, unknown> = { measuredOn: form.measuredOn };
    for (const m of MEASURES) if (form[m.body]) body[m.body] = Number(form[m.body].replace(',', '.'));
    await post(`/members/${memberId}/measurements`, body);
    toast('Medidas registradas.');
    setOpen(false);
    setForm({ measuredOn: today() });
    q.reload();
  });
  const cfg = MEASURES.find((m) => m.key === metric)!;
  return (
    <Section idx="—" title="Medidas corporales" aside={canEdit && <Button size="sm" onClick={() => setOpen(true)}>Registrar medidas</Button>}>
      <Load q={q} skeleton={<Skeleton block />}>
        {(rows) => {
          if (!rows.length) return <Empty glyph="0" title="Sin medidas">Registra peso y medidas cada 3–4 semanas para ver la tendencia.</Empty>;
          const withVal = rows.filter((r) => r[metric] != null);
          const first = withVal[0]?.[metric] as number | undefined, last = withVal[withVal.length - 1]?.[metric] as number | undefined;
          return (
            <div className="stack">
              <div className="chips">
                {MEASURES.filter((m) => rows.some((r) => r[m.key] != null)).map((m) => (
                  <button key={m.key} className="chip" aria-pressed={m.key === metric} onClick={() => setMetric(m.key)}>{m.label}</button>
                ))}
              </div>
              <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
                <span className="display" style={{ fontSize: 64 }}>{last ?? '—'}</span>
                <span className="eyebrow" style={{ paddingBottom: 6 }}>{cfg.unit} · {first != null && last != null ? `${last - first >= 0 ? '+' : ''}${Math.round((last - first) * 10) / 10} ${cfg.unit} desde ${shortDate(withVal[0].measured_on)}` : ''}</span>
              </div>
              {withVal.length >= 2 && <LineChart labels={withVal.map((r) => shortDate(r.measured_on))} series={[{ name: cfg.label, values: withVal.map((r) => r[metric] as number), color: 'var(--accent-text)' }]} />}
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Fecha</th>{MEASURES.map((m) => <th key={m.key} className="n">{m.label}</th>)}</tr></thead>
                  <tbody>
                    {[...rows].reverse().slice(0, 8).map((r) => (
                      <tr key={r.id}><td>{date(r.measured_on)}</td>{MEASURES.map((m) => <td key={m.key} className="n">{r[m.key] ?? '—'}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      </Load>
      <Sheet open={open} onClose={() => setOpen(false)} title="Registrar medidas" footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Guardar</Button></>}>
        <form className="form-grid" onSubmit={(e: FormEvent) => { e.preventDefault(); save.run(); }}>
          <Field label="Fecha" className="full"><input className="input" type="date" max={today()} value={form.measuredOn} onChange={(e) => setForm({ ...form, measuredOn: e.target.value })} /></Field>
          {MEASURES.map((m) => (
            <Field key={m.key} label={`${m.label} (${m.unit})`}>
              <input className="input" inputMode="decimal" value={form[m.body] ?? ''} onChange={(e) => setForm({ ...form, [m.body]: e.target.value })} />
            </Field>
          ))}
        </form>
        <FormError error={save.error} />
      </Sheet>
    </Section>
  );
}

export function WorkoutHistory({ memberId }: { memberId: number }) {
  const q = useApi<{ id: number; started_at: string; finished_at: string | null; day_label: string | null; routine_name: string | null; sets: number; volume_kg: number }[]>(`/members/${memberId}/workouts`);
  return (
    <Load q={q}>
      {(rows) => rows.length === 0 ? <Empty glyph="0" title="Sin sesiones registradas" /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Fecha</th><th>Rutina</th><th className="n">Series</th><th className="n">Volumen</th></tr></thead>
            <tbody>
              {rows.slice(0, 12).map((w) => (
                <tr key={w.id}>
                  <td>{ago(w.started_at)}</td>
                  <td>{w.routine_name ? `${w.routine_name}${w.day_label ? ` · Día ${w.day_label}` : ''}` : 'Libre'}{!w.finished_at && <span className="tag warn" style={{ marginLeft: 8 }}>En curso</span>}</td>
                  <td className="n">{w.sets}</td>
                  <td className="n">{kg(Math.round(w.volume_kg))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Load>
  );
}
