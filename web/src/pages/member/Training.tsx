import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useUser } from '../../lib/auth.tsx';
import { MemberTop } from '../../components/Shell.tsx';
import { Button, Empty, FormError, Load, Section, Skeleton } from '../../components/ui.tsx';
import { ExerciseProgressPanel, MeasurementsPanel, WorkoutHistory } from '../../components/Progress.tsx';
import { kg, MUSCLE } from '../../lib/format.ts';
import type { Routine, Workout } from '../../lib/types.ts';

export function RoutineDays({ r, day, onDay }: { r: Routine; day: string; onDay: (d: string) => void }) {
  const items = r.items.filter((i) => i.day_label === day);
  return (
    <div className="stack">
      {r.days.length > 1 && (
        <div className="seg" role="group" aria-label="Día de la rutina">
          {r.days.map((d) => <button key={d} aria-pressed={d === day} onClick={() => onDay(d)}>Día {d}</button>)}
        </div>
      )}
      <div className="list">
        {items.map((i, n) => (
          <div key={i.id ?? n} className="list-item">
            <span className="display faint" style={{ fontSize: 22, width: 26 }}>{n + 1}</span>
            <div className="grow">
              <b>{i.exercise_name}</b>
              <div className="faint" style={{ fontSize: 12.5 }}>{MUSCLE[i.muscle_group] ?? i.muscle_group}{i.notes ? ` · ${i.notes}` : ''}</div>
            </div>
            <div className="right">
              <div className="display" style={{ fontSize: 24 }}>{i.sets}×{i.reps}</div>
              <div className="mono faint" style={{ fontSize: 11 }}>{i.target_kg ? kg(i.target_kg) : 'peso libre'} · {i.rest_sec}s</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MemberTraining() {
  const user = useUser();
  const nav = useNavigate();
  const mid = user.memberId!;
  const routines = useApi<Routine[]>(`/members/${mid}/routines`);
  const [day, setDay] = useState<string | null>(null);
  const start = useAction(async (routineId: number | null, dayLabel?: string) => {
    const w = await post<Workout>(`/members/${mid}/workouts`, routineId ? { routineId, dayLabel } : {});
    nav(`/entreno/sesion/${w.id}`);
  });

  return (
    <>
      <MemberTop title="Entreno" />
      <main className="m-page">
        <Load q={routines} skeleton={<Skeleton block lines={6} />}>
          {(list) => {
            const r = list.find((x) => x.active);
            const d = day ?? r?.days[0] ?? 'A';
            return r ? (
              <section className="stack">
                <div>
                  <span className="eyebrow">Tu rutina{r.trainer_name ? ` · por ${r.trainer_name}` : ''}</span>
                  <h1 className="display" style={{ fontSize: 44, marginTop: 6 }}>{r.name}</h1>
                  {r.goal && <p className="muted" style={{ marginTop: 6 }}>{r.goal}</p>}
                </div>
                <RoutineDays r={r} day={d} onDay={setDay} />
                <Button variant="primary" size="lg" block busy={start.busy} onClick={() => start.run(r.id, d)}>Empezar día {d}</Button>
                <FormError error={start.error} />
              </section>
            ) : (
              <Empty glyph="—" title="Aún no tienes rutina" action={<Button busy={start.busy} onClick={() => start.run(null)}>Entrenamiento libre</Button>}>
                Pide a tu entrenador que te arme una. Mientras tanto puedes registrar un entrenamiento libre.
              </Empty>
            );
          }}
        </Load>

        <Section idx="01" title="Progreso por ejercicio"><ExerciseProgressPanel memberId={mid} /></Section>
        <MeasurementsPanel memberId={mid} />
        <Section idx="03" title="Historial"><WorkoutHistory memberId={mid} /></Section>
      </main>
    </>
  );
}
