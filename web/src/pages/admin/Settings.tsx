import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/hooks.ts';
import { useAuth, type Settings } from '../../lib/auth.tsx';
import { Button, Field, FormError, PageHead, Section, Skeleton, useToast } from '../../components/ui.tsx';
import { money } from '../../lib/format.ts';

type Key = keyof Settings;
interface Def { key: Key; label: string; hint: string; kind: 'text' | 'int' | 'num' | 'bool' | 'money' | 'list' }

const GROUPS: { title: string; defs: Def[] }[] = [
  { title: 'Negocio', defs: [
    { key: 'gym_name', label: 'Nombre del gimnasio', hint: 'Aparece en la app, avisos y comprobantes.', kind: 'text' },
    { key: 'currency', label: 'Moneda', hint: 'Código ISO (PEN, USD…).', kind: 'text' },
    { key: 'locale', label: 'Formato regional', hint: 'Ej.: es-PE.', kind: 'text' },
    { key: 'timezone', label: 'Zona horaria', hint: 'Ej.: America/Lima. Define “hoy” para vencimientos y reportes.', kind: 'text' },
    { key: 'day_pass_price_cents', label: 'Precio del pase diario', hint: 'Para invitados sin membresía.', kind: 'money' },
  ] },
  { title: 'Acceso', defs: [
    { key: 'checkin_allow_with_debt', label: 'Permitir ingreso con deuda', hint: 'Si se desactiva, quien tenga saldo pendiente no ingresa.', kind: 'bool' },
    { key: 'checkin_dedupe_minutes', label: 'Ventana anti-duplicado (min)', hint: 'Un segundo escaneo dentro de este tiempo no cuenta como otra visita.', kind: 'int' },
    { key: 'pass_ttl_seconds', label: 'Vigencia del QR (s)', hint: 'Más corto = más seguro frente a capturas compartidas.', kind: 'int' },
  ] },
  { title: 'Membresías', defs: [
    { key: 'expiring_soon_days', label: 'Aviso “por vencer” (días)', hint: 'Desde cuántos días antes se marca en ámbar.', kind: 'int' },
    { key: 'reminder_days', label: 'Recordatorios (días antes)', hint: 'Separados por coma. 0 = el mismo día.', kind: 'list' },
    { key: 'freeze_min_days', label: 'Congelamiento mínimo (días)', hint: 'El máximo se define por plan.', kind: 'int' },
    { key: 'renewal_grace_days', label: 'Gracia para renovar (días)', hint: 'Tras vencer, cuánto esperar antes de contarlo como baja en reportes.', kind: 'int' },
  ] },
  { title: 'Clases', defs: [
    { key: 'booking_window_days', label: 'Reservas con anticipación (días)', hint: 'Hasta cuántos días antes se puede reservar.', kind: 'int' },
    { key: 'cancel_min_hours', label: 'Cancelación mínima (horas)', hint: 'El socio puede cancelar hasta este plazo; luego solo recepción.', kind: 'num' },
  ] },
];

export function SettingsPage() {
  const { settings, reloadSettings } = useAuth();
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const toast = useToast();
  useEffect(() => {
    if (!settings) return;
    const out: Record<string, string | boolean> = {};
    for (const g of GROUPS) for (const d of g.defs) {
      const v = settings[d.key];
      out[d.key] = d.kind === 'bool' ? Boolean(v) : d.kind === 'money' ? ((v as number) / 100).toFixed(2) : d.kind === 'list' ? (v as number[]).join(', ') : String(v);
    }
    setF(out);
  }, [settings]);

  const save = useAction(async () => {
    const body: Record<string, unknown> = {};
    for (const g of GROUPS) for (const d of g.defs) {
      const v = f[d.key];
      const parsed = d.kind === 'bool' ? v : d.kind === 'int' ? parseInt(String(v), 10) : d.kind === 'num' ? Number(String(v).replace(',', '.'))
        : d.kind === 'money' ? Math.round(Number(String(v).replace(',', '.')) * 100) : d.kind === 'list' ? String(v).split(',').map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x)) : String(v).trim();
      if (JSON.stringify(parsed) !== JSON.stringify(settings![d.key])) body[d.key] = parsed;
    }
    if (!Object.keys(body).length) { toast('No hay cambios.'); return; }
    await api('PUT', '/admin/settings', body);
    await reloadSettings();
    toast('Ajustes guardados. Quedan registrados en la auditoría.');
  });

  if (!settings) return <div className="page"><Skeleton lines={10} /></div>;
  return (
    <div className="page narrow">
      <PageHead eyebrow="Configuración" title="Ajustes" actions={<Button variant="primary" busy={save.busy} onClick={() => save.run()}>Guardar</Button>} />
      <div className="stack-lg">
        <p className="muted">Decisiones de negocio configurables. Los valores iniciales son razonables para un gimnasio en Lima; ajústalos a tu política.</p>
        {GROUPS.map((g, i) => (
          <Section key={g.title} idx={String(i + 1).padStart(2, '0')} title={g.title}>
            <div className="form-grid">
              {g.defs.map((d) => d.kind === 'bool' ? (
                <label key={d.key} className="check full" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={Boolean(f[d.key])} onChange={(e) => setF({ ...f, [d.key]: e.target.checked })} />
                  <span><b>{d.label}</b><br /><span className="faint" style={{ fontSize: 12.5 }}>{d.hint}</span></span>
                </label>
              ) : (
                <Field key={d.key} label={d.label} hint={d.kind === 'money' && f[d.key] ? `${d.hint} Actual: ${money(settings[d.key] as number)}.` : d.hint}>
                  <input className={`input ${d.kind !== 'text' ? 'num' : ''}`} inputMode={d.kind === 'text' || d.kind === 'list' ? 'text' : 'decimal'} value={String(f[d.key] ?? '')} onChange={(e) => setF({ ...f, [d.key]: e.target.value })} />
                </Field>
              ))}
            </div>
          </Section>
        ))}
        <FormError error={save.error} />
      </div>
    </div>
  );
}
