import { useEffect, useState } from 'react';
import { get, post } from '../lib/api.ts';
import { useApi, useAction } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { Button, Field, FormError, Seg, Sheet, Skeleton, useToast } from './ui.tsx';
import { addDays, date, METHOD, money, today } from '../lib/format.ts';
import type { Debt, Membership, Payment, Plan } from '../lib/types.ts';

type Method = 'cash' | 'card' | 'transfer';
interface PayState { pay: boolean; amount: string; method: Method; reference: string }

/** Bloque de cobro reutilizable: monto (por defecto el total), método y n.º de operación para transferencias. */
function PaymentFields({ p, set, max }: { p: PayState; set: (p: PayState) => void; max: number }) {
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <label className="check"><input type="checkbox" checked={p.pay} onChange={(e) => set({ ...p, pay: e.target.checked })} /> Registrar pago ahora</label>
      {p.pay && (
        <div className="form-grid">
          <Field label="Monto" hint={`Total: ${money(max)}. Un monto menor deja saldo pendiente.`}>
            <input className="input num" inputMode="decimal" value={p.amount} onChange={(e) => set({ ...p, amount: e.target.value })} />
          </Field>
          <Field label="Método">
            <Seg label="Método de pago" value={p.method} onChange={(method) => set({ ...p, method })} options={Object.entries(METHOD).map(([value, label]) => ({ value: value as Method, label }))} />
          </Field>
          {p.method === 'transfer' && (
            <Field label="N.º de operación" className="full"><input className="input" value={p.reference} onChange={(e) => set({ ...p, reference: e.target.value })} /></Field>
          )}
        </div>
      )}
    </div>
  );
}
const toCents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
const paymentBody = (p: PayState) => (p.pay && toCents(p.amount) > 0 ? { payment: { amountCents: toCents(p.amount), method: p.method, reference: p.reference || null } } : {});
const initPay = (cents: number): PayState => ({ pay: true, amount: (cents / 100).toFixed(2), method: 'cash', reference: '' });

export function SellSheet({ open, onClose, memberId, renewFrom, onDone }: {
  open: boolean; onClose: () => void; memberId: number; renewFrom?: Membership | null; onDone: () => void;
}) {
  const plans = useApi<Plan[]>(open ? '/plans' : null);
  const [planId, setPlanId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [p, setP] = useState<PayState>(initPay(0));
  const toast = useToast();
  const renew = !!renewFrom && renewFrom.planActive;
  const plan = plans.data?.find((x) => x.id === (renew ? renewFrom!.planId : planId));
  useEffect(() => { if (plan) setP((x) => ({ ...x, amount: (plan.price_cents / 100).toFixed(2) })); }, [plan]);
  useEffect(() => { if (open && !planId && plans.data?.length) setPlanId(renewFrom?.planId && plans.data.some((x) => x.id === renewFrom.planId) ? renewFrom.planId : plans.data[0].id); }, [open, plans.data, planId, renewFrom]);

  const save = useAction(async () => {
    const r = renew
      ? await post<{ membership: Membership; payment: Payment | null }>(`/memberships/${renewFrom!.id}/renew`, paymentBody(p))
      : await post<{ membership: Membership; payment: Payment | null }>(`/members/${memberId}/memberships`, { planId, ...(startDate ? { startDate } : {}), ...paymentBody(p) });
    toast(`${r.membership.planName}: ${date(r.membership.startDate)} → ${date(r.membership.endDate)}${r.payment ? ` · cobrado ${money(r.payment.amount_cents)}` : ''}`);
    onDone();
    onClose();
  });
  // Sin fecha, el plan empieza al día siguiente del vencimiento vigente (sin huecos ni solapes).
  const autoStart = renewFrom && renewFrom.endDate >= today() ? addDays(renewFrom.endDate, 1) : today();

  return (
    <Sheet open={open} onClose={onClose} eyebrow={renew ? 'Renovación en un clic' : 'Venta'} title={renew ? `Renovar ${renewFrom!.planName}` : 'Vender plan'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={!plan} onClick={() => save.run()}>{renew ? 'Renovar' : 'Confirmar venta'}{p.pay && toCents(p.amount) > 0 ? ` · ${money(toCents(p.amount))}` : ''}</Button></>}>
      {!plans.data ? <Skeleton lines={3} /> : (
        <>
          {!renew && (
            <div className="list" role="radiogroup" aria-label="Plan">
              {plans.data.map((x) => (
                <label key={x.id} className="list-item" style={{ cursor: 'pointer' }}>
                  <input type="radio" name="plan" checked={planId === x.id} onChange={() => setPlanId(x.id)} style={{ accentColor: 'var(--accent)', width: 18, height: 18 }} />
                  <span className="grow"><b>{x.name}</b><br /><span className="faint" style={{ fontSize: 12.5 }}>{x.duration_days} días{x.includes_classes ? ' · incluye clases' : ' · solo sala'}{x.max_freeze_days ? ` · congela hasta ${x.max_freeze_days} d` : ''}</span></span>
                  <span className="display num" style={{ fontSize: 26 }}>{money(x.price_cents)}</span>
                </label>
              ))}
            </div>
          )}
          {renew && plan && (
            <dl className="kv">
              <dt>Plan</dt><dd>{plan.name} · {plan.duration_days} días</dd>
              <dt>Empieza</dt><dd>{date(autoStart)} <span className="faint">(sin huecos tras el vencimiento actual)</span></dd>
              <dt>Precio</dt><dd className="num">{money(plan.price_cents)}</dd>
            </dl>
          )}
          {!renew && (
            <Field label="Inicio" hint={`Vacío: ${date(autoStart)} (continúa tras el plan vigente).`}>
              <input className="input" type="date" min={today()} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          )}
          {renewFrom && !renewFrom.planActive && <div className="notice">El plan {renewFrom.planName} ya no está a la venta. Elige uno vigente.</div>}
          {plan && <PaymentFields p={p} set={setP} max={plan.price_cents} />}
          <FormError error={save.error} />
        </>
      )}
    </Sheet>
  );
}

interface Preview { proration: { totalDays: number; consumedDays: number; remainingDays: number; consumedValueCents: number; creditCents: number; leftoverCreditCents: number; newAmountDueCents: number }; plan: { id: number; name: string; priceCents: number }; newStart: string; newEnd: string }

export function ChangePlanSheet({ open, onClose, m, onDone }: { open: boolean; onClose: () => void; m: Membership; onDone: () => void }) {
  const plans = useApi<Plan[]>(open ? '/plans' : null);
  const [planId, setPlanId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);
  const [p, setP] = useState<PayState>(initPay(0));
  const toast = useToast();
  useEffect(() => {
    setPreview(null); setPErr(null);
    if (!planId) return;
    get<Preview>(`/memberships/${m.id}/change-plan?planId=${planId}`)
      .then((r) => { setPreview(r); setP(initPay(r.proration.newAmountDueCents)); })
      .catch((e) => setPErr(e.message));
  }, [planId, m.id]);
  const save = useAction(async () => {
    await post(`/memberships/${m.id}/change-plan`, { planId, ...paymentBody(p) });
    toast(`Cambio a ${preview!.plan.name} registrado.`);
    onDone(); onClose();
  });
  const pr = preview?.proration;
  return (
    <Sheet open={open} onClose={onClose} eyebrow={`Desde ${m.planName}`} title="Cambiar de plan" wide
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={!preview} onClick={() => save.run()}>Confirmar cambio</Button></>}>
      <Field label="Nuevo plan">
        <select className="select" value={planId ?? ''} onChange={(e) => setPlanId(Number(e.target.value) || null)}>
          <option value="">Elige un plan…</option>
          {(plans.data ?? []).filter((x) => x.id !== m.planId).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.duration_days} días · {money(x.price_cents)}</option>)}
        </select>
      </Field>
      {pErr && <div className="notice bad">{pErr}</div>}
      {pr && preview && (
        <>
          <div className="table-wrap">
            <table className="t">
              <tbody>
                <tr><td>Plan actual · usado {pr.consumedDays} de {pr.totalDays} días</td><td className="n">{money(pr.consumedValueCents)}</td></tr>
                <tr><td>Pagado del plan actual</td><td className="n">{money(m.paidCents + m.creditCents)}</td></tr>
                <tr><td><b>Crédito a favor</b> (lo no usado)</td><td className="n ok">− {money(pr.creditCents)}</td></tr>
                <tr><td>Precio de {preview.plan.name}</td><td className="n">{money(preview.plan.priceCents)}</td></tr>
              </tbody>
              <tfoot><tr><td>A pagar por el cambio</td><td className="n display" style={{ fontSize: 28 }}>{money(pr.newAmountDueCents)}</td></tr></tfoot>
            </table>
          </div>
          <p className="muted">Nuevo periodo: <b>{date(preview.newStart)} → {date(preview.newEnd)}</b>.{pr.leftoverCreditCents > 0 && ` Queda un crédito no aplicable de ${money(pr.leftoverCreditCents)} (el plan nuevo es más barato que el saldo); regístralo como devolución si corresponde.`}</p>
          {pr.newAmountDueCents > 0 && <PaymentFields p={p} set={setP} max={pr.newAmountDueCents} />}
        </>
      )}
      <FormError error={save.error} />
    </Sheet>
  );
}

export function FreezeSheet({ open, onClose, m, onDone }: { open: boolean; onClose: () => void; m: Membership; onDone: () => void }) {
  const { settings } = useAuth();
  const left = m.freezeDaysAllowed - m.freezeDaysUsed;
  const [f, setF] = useState({ startDate: today(), days: String(Math.min(left, settings?.freeze_min_days ?? 7)), reason: '' });
  const toast = useToast();
  const save = useAction(async () => {
    const r = await post<Membership>(`/memberships/${m.id}/freezes`, { startDate: f.startDate, days: Number(f.days), reason: f.reason });
    toast(`Congelado. Nuevo vencimiento: ${date(r.endDate)}.`);
    onDone(); onClose();
  });
  const days = Number(f.days) || 0;
  return (
    <Sheet open={open} onClose={onClose} eyebrow={m.planName} title="Congelar plan"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={f.reason.trim().length < 3 || days < 1} onClick={() => save.run()}>Congelar {days} días</Button></>}>
      {left <= 0 ? <div className="notice bad">Este plan no permite (más) congelamientos. Usados {m.freezeDaysUsed} de {m.freezeDaysAllowed} días.</div> : (
        <>
          <p className="muted">Disponibles: <b>{left}</b> de {m.freezeDaysAllowed} días · mínimo {settings?.freeze_min_days ?? 7} por congelamiento. Los días se suman al vencimiento.</p>
          <div className="form-grid">
            <Field label="Desde"><input className="input" type="date" min={today()} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="Días"><input className="input num" type="number" min={1} max={left} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
            <Field label="Motivo" className="full"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ej.: viaje, lesión, reposo médico" /></Field>
          </div>
          {days > 0 && <p>Vencimiento pasa de <b>{date(m.endDate)}</b> a <b className="ok">{date(addDays(m.endDate, days))}</b>.</p>}
        </>
      )}
      <FormError error={save.error} />
    </Sheet>
  );
}

export function PaySheet({ open, onClose, memberId, debt, onDone }: { open: boolean; onClose: () => void; memberId: number; debt: Debt | null; onDone: () => void }) {
  const items = debt?.items ?? [];
  const [msId, setMsId] = useState<number | null>(null);
  const [concept, setConcept] = useState('');
  const sel = items.find((i) => i.membershipId === msId);
  const [p, setP] = useState<PayState>(initPay(0));
  const toast = useToast();
  useEffect(() => { if (open) setMsId(items[0]?.membershipId ?? null); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setP(initPay(sel?.balanceCents ?? 0)); }, [sel?.balanceCents]);
  const save = useAction(async () => {
    const r = await post<Payment>('/payments', {
      memberId, membershipId: msId, amountCents: toCents(p.amount), method: p.method, reference: p.reference || null, ...(msId ? {} : { concept }),
    });
    toast(`Pago ${r.receipt_number} registrado: ${money(r.amount_cents)}.`);
    onDone(); onClose();
  });
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Caja" title="Registrar pago"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={toCents(p.amount) <= 0 || (!msId && concept.trim().length < 3)} onClick={() => save.run()}>Cobrar {toCents(p.amount) > 0 ? money(toCents(p.amount)) : ''}</Button></>}>
      <Field label="Concepto">
        <select className="select" value={msId ?? ''} onChange={(e) => setMsId(Number(e.target.value) || null)}>
          {items.map((i) => <option key={i.membershipId} value={i.membershipId}>Saldo {i.plan} ({date(i.startDate)}) · {money(i.balanceCents)}</option>)}
          <option value="">Otro concepto (venta libre)</option>
        </select>
      </Field>
      {!msId && <Field label="Descripción"><input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej.: toalla, candado, evaluación" /></Field>}
      <PaymentFields p={{ ...p, pay: true }} set={(x) => setP({ ...x, pay: true })} max={sel?.balanceCents ?? toCents(p.amount)} />
      <FormError error={save.error} />
    </Sheet>
  );
}

export function VoidSheet({ payment, onClose, onDone }: { payment: Payment | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const toast = useToast();
  const save = useAction(async () => {
    await post(`/payments/${payment!.id}/void`, { reason });
    toast(`Comprobante ${payment!.receipt_number} anulado.`);
    setReason('');
    onDone(); onClose();
  });
  return (
    <Sheet open={!!payment} onClose={onClose} eyebrow={payment?.receipt_number} title="Anular pago"
      footer={<><Button onClick={onClose}>Volver</Button><Button variant="danger" busy={save.busy} disabled={reason.trim().length < 5} onClick={() => save.run()}>Anular {payment ? money(payment.amount_cents) : ''}</Button></>}>
      {payment && (
        <>
          <p>Los pagos no se borran: quedan marcados como <b>anulados</b>, con tu nombre, fecha y motivo en el registro de auditoría. Si el pago cubría un plan, ese saldo vuelve a figurar como deuda.</p>
          <dl className="kv"><dt>Concepto</dt><dd>{payment.concept}</dd><dt>Método</dt><dd>{METHOD[payment.method]}{payment.reference ? ` · ${payment.reference}` : ''}</dd></dl>
          <Field label="Motivo"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Ej.: monto mal digitado" /></Field>
          <FormError error={save.error} />
        </>
      )}
    </Sheet>
  );
}
