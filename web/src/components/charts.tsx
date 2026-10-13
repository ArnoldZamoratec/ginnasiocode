import { useState, type ReactNode } from 'react';
import { WEEKDAYS_MON } from '../lib/format.ts';

const W = 640;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export interface Series { name: string; values: (number | null)[]; color: string; dashed?: boolean }

/** Líneas con ejes finos. Pensado para evolución de un ejercicio o de medidas corporales. */
export function LineChart({ labels, series, height = 220, format = (v: number) => String(v), zeroBased = false }: {
  labels: string[]; series: Series[]; height?: number; format?: (v: number) => string; zeroBased?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.length) return null;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  let min = zeroBased ? 0 : Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min = zeroBased ? 0 : min - span * 0.12;
  max = max + span * 0.12;
  const x = (i: number) => pad.l + (labels.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
  const ticks = [0, 0.5, 1].map((t) => min + t * (max - min));
  const every = Math.max(1, Math.ceil(labels.length / 7));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 8} y={y(t) + 3} textAnchor="end">{format(Math.round(t * 10) / 10)}</text>
          </g>
        ))}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={height - pad.b} y2={height - pad.b} />
        {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle">{l}</text>
        ))}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
          return (
            <g key={s.name}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} points={pts.map((p) => p.join(',')).join(' ')} />
              {pts.map(([px, py], i) => <rect key={i} x={px - 3} y={py - 3} width={6} height={6} fill={s.color} />)}
            </g>
          );
        })}
        {labels.map((_, i) => (
          <rect key={i} x={x(i) - (W / labels.length) / 2} y={0} width={W / labels.length} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--fg-3)" />
            <g transform={`translate(${Math.min(x(hover) + 8, W - 150)}, ${pad.t})`}>
              <rect width={142} height={18 + series.length * 16} fill="var(--fg)" />
              <text x={8} y={13} style={{ fill: 'var(--bg)' }}>{labels[hover]}</text>
              {series.map((s, i) => (
                <text key={s.name} x={8} y={29 + i * 16} style={{ fill: 'var(--bg)' }}>{s.name}: {s.values[hover] == null ? '—' : format(s.values[hover]!)}</text>
              ))}
            </g>
          </g>
        )}
      </svg>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.name, color: s.color, dashed: s.dashed }))} />}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}><i style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

/** Columnas agrupadas (p. ej. proyectado vs. real por mes). */
export function Columns({ labels, groups, height = 240, format }: {
  labels: string[]; groups: { name: string; values: number[]; color: string; outline?: boolean }[]; height?: number; format: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 56, r: 8, t: 10, b: 26 };
  const max = niceMax(Math.max(1, ...groups.flatMap((g) => g.values)));
  const band = (W - pad.l - pad.r) / labels.length;
  const bw = Math.min(26, (band * 0.7) / groups.length);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(max * t)} y2={y(max * t)} />
            <text x={pad.l - 8} y={y(max * t) + 3} textAnchor="end">{format(max * t)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = pad.l + band * i + band / 2;
          return (
            <g key={l} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + band * i} y={0} width={band} height={height} fill={hover === i ? 'var(--bg-2)' : 'transparent'} />
              {groups.map((g, gi) => {
                const v = g.values[i];
                const bx = cx - (groups.length * bw) / 2 + gi * bw;
                return g.outline
                  ? <rect key={g.name} x={bx + 1} y={y(v)} width={bw - 3} height={Math.max(0, height - pad.b - y(v))} fill="none" stroke={g.color} strokeWidth={1.5} strokeDasharray="3 2" />
                  : <rect key={g.name} x={bx + 1} y={y(v)} width={bw - 3} height={Math.max(0, height - pad.b - y(v))} fill={g.color} />;
              })}
              <text x={cx} y={height - 8} textAnchor="middle">{l}</text>
            </g>
          );
        })}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={height - pad.b} y2={height - pad.b} />
        {hover != null && (
          <g pointerEvents="none" transform={`translate(${Math.min(pad.l + band * hover + band, W - 170)}, ${pad.t})`}>
            <rect width={164} height={18 + groups.length * 16} fill="var(--fg)" />
            <text x={8} y={13} style={{ fill: 'var(--bg)' }}>{labels[hover]}</text>
            {groups.map((g, i) => <text key={g.name} x={8} y={29 + i * 16} style={{ fill: 'var(--bg)' }}>{g.name}: {format(g.values[hover])}</text>)}
          </g>
        )}
      </svg>
      <Legend items={groups.map((g) => ({ label: g.name, color: g.color, dashed: g.outline }))} />
    </div>
  );
}

/** Mapa de calor día × hora. Solo muestra el horario operativo (05–22 h). */
export function Heatmap({ grid, peak, from = 5, to = 23, unit = 'visitas' }: { grid: number[][]; peak?: { wd: number; h: number; v: number }; from?: number; to?: number; unit?: string }) {
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const max = Math.max(0.0001, ...grid.flat());
  return (
    <div className="heat" style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))` }} role="table" aria-label="Mapa de calor de visitas">
      <span />
      {hours.map((h) => <span key={h} className="hl">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
      {grid.map((row, wd) => (
        <Row key={wd} label={WEEKDAYS_MON[wd]}>
          {hours.map((h) => {
            const v = row[h] ?? 0;
            const isPeak = peak && peak.wd === wd + 1 && peak.h === h;
            return <span key={h} className={`c ${isPeak ? 'peak' : ''}`} style={{ opacity: v ? 0.08 + 0.92 * (v / max) : 0.04 }}
              data-tip={`${WEEKDAYS_MON[wd]} ${String(h).padStart(2, '0')}:00 · ${v} ${unit}`} />;
          })}
        </Row>
      ))}
    </div>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <><span className="lbl">{label}</span>{children}</>;
}

/** Barras horizontales con etiqueta y valor (porcentajes). */
export function HBars({ items, max = 100, suffix = '%' }: { items: { label: string; value: number | null; hint?: string }[]; max?: number; suffix?: string }) {
  const top = Math.max(...items.map((i) => i.value ?? 0));
  return (
    <div className="bars">
      {items.map((i) => (
        <div className="bar" key={i.label} title={i.hint}>
          <span>{i.label}</span>
          <div className="track"><div className={`fill ${i.value === top && top > 0 ? 'hi' : ''}`} style={{ width: `${((i.value ?? 0) / max) * 100}%` }} /></div>
          <span className="num right">{i.value == null ? '—' : `${i.value}${suffix}`}</span>
        </div>
      ))}
    </div>
  );
}
