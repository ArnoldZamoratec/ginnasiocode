import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../../lib/api.ts';
import { useApi } from '../../lib/hooks.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Empty, Kpi, Load, PageHead, Section, Seg, Skeleton } from '../../components/ui.tsx';
import { Columns, Heatmap, HBars, LineChart } from '../../components/charts.tsx';
import { addDays, ago, date, longDate, METHOD, moneyParts, monthName, today, WEEKDAYS_MON } from '../../lib/format.ts';

interface Overview { today: string; activeMembers: number; expiringSoon: number; revenueMtdCents: number; revenuePrevMtdCents: number; visitsToday: number; avgVisitsPerDay: number; classOccupancy30d: number | null; debtTotalCents: number; renewalRate: number }
interface Revenue { renewalRate: number; series: { month: string; projectedCents: number; soldCents: number; expectedRenewalsCents: number; realCents: number; closed: boolean }[] }
interface Income { series: { period: string; cash: number; card: number; transfer: number; total: number }[]; totals: { cash: number; card: number; transfer: number; total: number; voidedCents: number } }
interface Heat { total: number; grid: number[][]; peak: { wd: number; h: number; v: number } }
interface Occupancy { bySlot: { slot: string; sessions: number; capacity: number; booked: number; occupancy: number | null }[]; byClass: { className: string; sessions: number; occupancy: number | null; attendance: number | null; fullSessions: number; waitlisted: number }[] }
interface Retention { month: string; ending: number; renewed: number; notRenewed: number; renewalRate: number | null; items: { memberId: number; fullName: string; phone: string | null; planName: string; endDate: string; daysSinceExpiry: number; lastVisit: string | null; withinGrace: boolean }[] }
interface Churn { graceDays: number; series: { month: string; activeAtStart: number; newMembers: number; churned: number; atRisk: number; churnRate: number | null }[] }

/** Monto sin céntimos para cifras grandes: “S/ 4,549”. */
const k = (cents: number) => { const p = moneyParts(cents); return `${p.symbol} ${p.value}`; };
const short = (cents: number) => `${Math.round(cents / 100 / 1000)}k`;

function Overview() {
  const q = useApi<Overview>('/reports/overview');
  return (
    <Load q={q} skeleton={<Skeleton block lines={1} />}>
      {(o) => {
        const delta = o.revenuePrevMtdCents ? Math.round(((o.revenueMtdCents - o.revenuePrevMtdCents) / o.revenuePrevMtdCents) * 100) : null;
        return (
          <div className="kpis">
            <Kpi hero label="Socios activos" value={o.activeMembers} detail={<Link to="/socios?estado=expiring" className="linkish">{o.expiringSoon} por vencer</Link>} />
            <Kpi label="Ingresos del mes" value={k(o.revenueMtdCents)} detail={delta == null ? '—' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs. mismo día del mes anterior`} />
            <Kpi label="Visitas hoy" value={o.visitsToday} detail={`promedio ${o.avgVisitsPerDay}/día (30 d)`} />
            <Kpi label="Ocupación clases" value={o.classOccupancy30d ?? '—'} unit={o.classOccupancy30d != null ? '%' : undefined} detail="últimos 30 días" />
            <Kpi label="Deuda por cobrar" value={k(o.debtTotalCents)} detail={<Link to="/socios?estado=debt" className="linkish">ver socios</Link>} />
            <Kpi label="Tasa de renovación" value={o.renewalRate} unit="%" detail="histórica 6 meses" />
          </div>
        );
      }}
    </Load>
  );
}

function RevenueBlock() {
  const [months, setMonths] = useState('6');
  const q = useApi<Revenue>(`/reports/revenue?months=${months}`);
  const t = today();
  const [range, setRange] = useState<'30' | '90' | '365'>('30');
  const from = addDays(t, -Number(range) + 1);
  const income = useApi<Income>(`/reports/income${qs({ from, to: t, groupBy: range === '30' ? 'day' : range === '90' ? 'week' : 'month' })}`);
  return (
    <div className="stack-lg">
      <Section idx="02" title="Proyectado vs. real" aside={<Seg label="Meses" value={months} onChange={setMonths} options={[{ value: '6', label: '6 m' }, { value: '12', label: '12 m' }]} />}>
        <Load q={q} skeleton={<Skeleton block lines={1} />}>
          {(r) => (
            <>
              <Columns labels={r.series.map((s) => monthName(s.month, true) + (s.month.slice(0, 4) !== t.slice(0, 4) ? ` ${s.month.slice(2, 4)}` : ''))} format={short}
                groups={[
                  { name: 'Proyectado', values: r.series.map((s) => s.projectedCents), color: 'var(--fg-2)', outline: true },
                  { name: 'Real cobrado', values: r.series.map((s) => s.realCents), color: 'var(--accent)' },
                ]} />
              <p className="muted" style={{ fontSize: 13 }}>Proyectado = planes que inician en el mes + renovaciones esperadas ({r.renewalRate}% histórico) para meses en curso o futuros. Real = pagos válidos cobrados (sin anulados).</p>
            </>
          )}
        </Load>
      </Section>
      <Section idx="03" title="Ingresos por método" aside={<Seg label="Periodo" value={range} onChange={setRange} options={[{ value: '30', label: '30 d' }, { value: '90', label: '90 d' }, { value: '365', label: '12 m' }]} />}>
        <Load q={income} skeleton={<Skeleton block lines={1} />}>
          {(r) => r.series.length === 0 ? <Empty glyph="0" title="Sin ingresos en el periodo" /> : (
            <>
              <div className="kpis">
                <Kpi hero label="Total" value={k(r.totals.total)} />
                {(['cash', 'card', 'transfer'] as const).map((m) => <Kpi key={m} label={METHOD[m]} value={k(r.totals[m])} detail={`${r.totals.total ? Math.round((r.totals[m] / r.totals.total) * 100) : 0}%`} />)}
                <Kpi label="Anulado" value={k(r.totals.voidedCents)} detail="excluido del total" />
              </div>
              <LineChart labels={r.series.map((s) => (s.period.length === 7 ? monthName(s.period, true) : `${Number(s.period.slice(8))}/${Number(s.period.slice(5, 7))}`))} zeroBased format={(v) => short(v)}
                series={[
                  { name: 'Efectivo', values: r.series.map((s) => s.cash), color: 'var(--fg)' },
                  { name: 'Tarjeta', values: r.series.map((s) => s.card), color: 'var(--accent-text)' },
                  { name: 'Transferencia', values: r.series.map((s) => s.transfer), color: 'var(--fg-3)', dashed: true },
                ]} />
            </>
          )}
        </Load>
      </Section>
    </div>
  );
}

function HeatBlock() {
  const { branchId } = useAuth();
  const q = useApi<Heat>(`/reports/heatmap${qs({ branchId })}`);
  return (
    <Section idx="04" title="Horas pico" aside="Promedio de visitas por hora · últimas 4 semanas">
      <Load q={q} skeleton={<Skeleton block lines={0} />}>
        {(h) => h.total === 0 ? <Empty glyph="0" title="Sin ingresos registrados" /> : (
          <div className="stack">
            <p>Pico: <b>{WEEKDAYS_MON[h.peak.wd - 1]} {String(h.peak.h).padStart(2, '0')}:00</b> con <b className="num">{h.peak.v}</b> visitas en promedio.</p>
            <Heatmap grid={h.grid} peak={h.peak} />
          </div>
        )}
      </Load>
    </Section>
  );
}

function OccupancyBlock() {
  const q = useApi<Occupancy>('/reports/occupancy');
  return (
    <Section idx="05" title="Ocupación de clases" aside="Últimas 4 semanas">
      <Load q={q} skeleton={<Skeleton lines={5} />}>
        {(o) => (
          <div className="stack-lg">
            <HBars items={o.bySlot.map((s) => ({ label: s.slot, value: s.occupancy, hint: `${s.booked}/${s.capacity} en ${s.sessions} clases` }))} />
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Clase</th><th className="n">Sesiones</th><th className="n">Ocupación</th><th className="n hide-sm">Asistencia</th><th className="n">Llenas</th><th className="n hide-sm">Pasaron por espera</th></tr></thead>
                <tbody>
                  {o.byClass.map((c) => (
                    <tr key={c.className}>
                      <td><b>{c.className}</b></td><td className="n">{c.sessions}</td>
                      <td className={`n ${(c.occupancy ?? 0) >= 90 ? 'warn' : (c.occupancy ?? 0) < 40 ? 'faint' : ''}`}>{c.occupancy ?? '—'}%</td>
                      <td className="n hide-sm">{c.attendance ?? '—'}%</td><td className="n">{c.fullSessions}</td><td className="n hide-sm">{c.waitlisted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Load>
    </Section>
  );
}

function RetentionBlock() {
  const t = today();
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(t.slice(0, 7) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7); });
  const [month, setMonth] = useState(months[1]);
  const q = useApi<Retention>(`/reports/retention?month=${month}`);
  return (
    <Section idx="06" title="Socios que no renovaron" aside={
      <select className="select" style={{ width: 'auto', minHeight: 32 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mes">
        {months.map((m) => <option key={m} value={m}>{monthName(m)} {m.slice(0, 4)}</option>)}
      </select>}>
      <Load q={q} skeleton={<Skeleton lines={6} />}>
        {(r) => (
          <div className="stack">
            <div className="kpis">
              <Kpi label="Vencieron" value={r.ending} />
              <Kpi label="Renovaron" value={r.renewed} />
              <Kpi hero label="Tasa de renovación" value={r.renewalRate ?? '—'} unit={r.renewalRate != null ? '%' : undefined} />
              <Kpi label="No renovaron" value={r.notRenewed} detail="lista para llamar" />
            </div>
            {r.items.length === 0 ? <Empty glyph="✓" title="Todos renovaron">Nadie quedó sin renovar en {monthName(r.month)}.</Empty> : (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Socio</th><th>Plan</th><th>Venció</th><th className="hide-sm">Última visita</th><th>Teléfono</th></tr></thead>
                  <tbody>
                    {r.items.map((i) => (
                      <tr key={i.memberId}>
                        <td><Link className="linkish" to={`/socios/${i.memberId}`}>{i.fullName}</Link>{i.withinGrace && <div className="warn" style={{ fontSize: 12 }}>Aún en periodo de gracia</div>}</td>
                        <td>{i.planName}</td>
                        <td className="num">{date(i.endDate)} <span className="faint">· hace {i.daysSinceExpiry} d</span></td>
                        <td className="hide-sm faint">{ago(i.lastVisit)}</td>
                        <td>{i.phone ? <a className="mono" href={`tel:${i.phone.replace(/\s/g, '')}`}>{i.phone}</a> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Load>
    </Section>
  );
}

function ChurnBlock() {
  const q = useApi<Churn>('/reports/churn?months=6');
  return (
    <Section idx="07" title="Churn mensual" aside="Activos al inicio del mes que se fueron sin renovar">
      <Load q={q} skeleton={<Skeleton block lines={1} />}>
        {(c) => (
          <div className="stack">
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Mes</th><th className="n">Activos al inicio</th><th className="n">Nuevos</th><th className="n">Se fueron</th><th className="n">En riesgo</th><th className="n">Churn</th></tr></thead>
                <tbody>
                  {c.series.map((s) => (
                    <tr key={s.month}>
                      <td>{monthName(s.month)} {s.month.slice(0, 4)}</td><td className="n">{s.activeAtStart}</td><td className="n">{s.newMembers}</td>
                      <td className="n">{s.churned}</td><td className={`n ${s.atRisk ? 'warn' : 'faint'}`}>{s.atRisk || '—'}</td>
                      <td className="n display" style={{ fontSize: 22 }}>{s.churnRate ?? '—'}{s.churnRate != null && '%'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>“En riesgo”: su plan terminó pero todavía están dentro de los {c.graceDays} días de gracia para renovar.</p>
          </div>
        )}
      </Load>
    </Section>
  );
}

export function Dashboard() {
  const t = today();
  return (
    <div className="page">
      <PageHead eyebrow={longDate(t)} title="Panel" />
      <div className="stack-lg" style={{ gap: 44 }}>
        <Section idx="01" title="Hoy en números"><Overview /></Section>
        <div id="ingresos"><RevenueBlock /></div>
        <div className="cols">
          <div className="span-7"><HeatBlock /></div>
          <div className="span-5"><OccupancyBlock /></div>
        </div>
        <RetentionBlock />
        <ChurnBlock />
      </div>
    </div>
  );
}
