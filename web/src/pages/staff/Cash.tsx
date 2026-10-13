import { useState } from 'react';
import { Link } from 'react-router-dom';
import { download, post, qs } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useUser } from '../../lib/auth.tsx';
import { Button, Empty, Field, FormError, Kpi, Load, PageHead, Seg, Sheet, Skeleton, Icon, useToast } from '../../components/ui.tsx';
import { VoidSheet } from '../../components/MembershipActions.tsx';
import { addDays, date, longDate, METHOD, money, time, today } from '../../lib/format.ts';
import type { Payment } from '../../lib/types.ts';

interface CashData { items: Payment[]; totals: { count: number; totalCents: number; byMethod: Record<string, number>; voided: number } }

function FreeSale({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ concept: '', amount: '', method: 'cash' as 'cash' | 'card' | 'transfer', reference: '' });
  const toast = useToast();
  const save = useAction(async () => {
    const r = await post<Payment>('/payments', { memberId: null, concept: f.concept, amountCents: Math.round(Number(f.amount.replace(',', '.')) * 100), method: f.method, reference: f.reference || null });
    toast(`Venta ${r.receipt_number}: ${money(r.amount_cents)}.`);
    setF({ concept: '', amount: '', method: 'cash', reference: '' });
    onDone(); onClose();
  });
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Sin socio" title="Venta libre"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={f.concept.trim().length < 3 || !(Number(f.amount) > 0)} onClick={() => save.run()}>Registrar</Button></>}>
      <div className="form-grid">
        <Field label="Concepto" className="full"><input className="input" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder="Ej.: agua, toalla, candado" autoFocus /></Field>
        <Field label="Monto"><input className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Método"><Seg label="Método" value={f.method} onChange={(method) => setF({ ...f, method })} options={Object.entries(METHOD).map(([value, label]) => ({ value: value as 'cash', label }))} /></Field>
        {f.method === 'transfer' && <Field label="N.º de operación" className="full"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
      </div>
      <FormError error={save.error} />
    </Sheet>
  );
}

export function CashPage() {
  const user = useUser();
  const t = today();
  const [from, setFrom] = useState(t);
  const [to, setTo] = useState(t);
  const [method, setMethod] = useState('');
  const q = useApi<CashData>(`/payments${qs({ from, to, method })}`);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [sale, setSale] = useState(false);
  const toast = useToast();
  const single = from === to;
  const canVoid = (p: Payment) => p.status === 'valid' && (user.role === 'admin' || (p.received_by === user.id && date(p.paid_at) === date(t)));
  const preset = (a: string, b: string) => { setFrom(a); setTo(b); };

  return (
    <div className="page">
      <PageHead eyebrow={single ? longDate(from) : `${date(from)} → ${date(to)}`} title="Caja" actions={<>
        <Button onClick={() => setSale(true)}><Icon name="plus" size={16} />Venta libre</Button>
        {user.role === 'admin' && <Link className="btn" to="/panel#ingresos">Reporte de ingresos</Link>}
      </>} />
      <div className="stack-lg">
        <div className="row wrap">
          <div className="chips">
            <button className="chip" aria-pressed={single && from === t} onClick={() => preset(t, t)}>Hoy</button>
            <button className="chip" aria-pressed={single && from === addDays(t, -1)} onClick={() => preset(addDays(t, -1), addDays(t, -1))}>Ayer</button>
            <button className="chip" aria-pressed={from === addDays(t, -6) && to === t} onClick={() => preset(addDays(t, -6), t)}>7 días</button>
            <button className="chip" aria-pressed={from === `${t.slice(0, 7)}-01` && to === t} onClick={() => preset(`${t.slice(0, 7)}-01`, t)}>Este mes</button>
          </div>
          <input className="input" type="date" style={{ width: 'auto' }} value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
          <input className="input" type="date" style={{ width: 'auto' }} value={to} min={from} max={t} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          <select className="select" style={{ width: 'auto' }} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Método">
            <option value="">Todos los métodos</option>
            {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <Load q={q} skeleton={<Skeleton block lines={6} />}>
          {(d) => (
            <>
              <div className="kpis">
                <Kpi hero label="Total cobrado" value={money(d.totals.totalCents)} detail={`${d.totals.count} pagos válidos`} />
                {Object.entries(METHOD).map(([k, v]) => <Kpi key={k} label={v} value={money(d.totals.byMethod[k] ?? 0)} />)}
                <Kpi label="Anulados" value={d.totals.voided} detail="no suman al total" />
              </div>
              {d.items.length === 0 ? <Empty glyph="0" title="Sin movimientos">No hay pagos en este periodo.</Empty> : (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th>Hora</th><th>Comprobante</th><th>Socio / concepto</th><th className="hide-sm">Método</th><th className="hide-sm">Atendió</th><th className="n">Monto</th><th /></tr></thead>
                    <tbody>
                      {d.items.map((p) => (
                        <tr key={p.id} className={p.status === 'voided' ? 'voided' : ''}>
                          <td className="mono">{single ? time(p.paid_at) : `${date(p.paid_at).slice(0, 5)} ${time(p.paid_at)}`}</td>
                          <td className="mono">{p.receipt_number}</td>
                          <td>{p.member_id ? <Link className="linkish" to={`/socios/${p.member_id}`}>{p.member_name}</Link> : <b>Venta libre</b>}
                            <div className="faint" style={{ fontSize: 12 }}>{p.concept}</div>
                            {p.status === 'voided' && <div className="bad" style={{ fontSize: 12 }}>Anulado: {p.void_reason}</div>}</td>
                          <td className="hide-sm">{METHOD[p.method]}{p.reference && <div className="mono faint" style={{ fontSize: 11 }}>{p.reference}</div>}</td>
                          <td className="hide-sm faint">{p.received_by_name}</td>
                          <td className="n amt">{money(p.amount_cents)}</td>
                          <td className="right" style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn ghost sm" aria-label="Comprobante PDF" onClick={() => download(`/payments/${p.id}/receipt.pdf`, `${p.receipt_number}.pdf`).catch((e) => toast(e.message, 'bad'))}><Icon name="download" size={16} /></button>
                            {canVoid(p) && <button className="btn ghost sm" onClick={() => setVoiding(p)}>Anular</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td colSpan={5} className="hide-sm">Total válido</td><td className="n" colSpan={1}>{money(d.totals.totalCents)}</td><td /></tr></tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </Load>
      </div>
      <VoidSheet payment={voiding} onClose={() => setVoiding(null)} onDone={q.reload} />
      <FreeSale open={sale} onClose={() => setSale(false)} onDone={q.reload} />
    </div>
  );
}
