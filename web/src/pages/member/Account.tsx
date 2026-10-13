import { useEffect, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { download, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { useAuth, useUser } from '../../lib/auth.tsx';
import { MemberTop, ThemeToggle } from '../../components/Shell.tsx';
import { Button, Empty, Field, FormError, Load, Section, Skeleton, StateTag, Icon, useToast } from '../../components/ui.tsx';
import { ago, date, METHOD, money } from '../../lib/format.ts';
import type { Debt, Membership, Payment } from '../../lib/types.ts';

interface Note { id: number; template_key: string; title: string; body: string; read_at: string | null; created_at: string }

function Notifications() {
  const ctx = useOutletContext<{ refreshUnread?: () => void } | undefined>();
  const q = useApi<{ items: Note[]; unread: number }>('/me/notifications');
  // Al abrir la bandeja se marcan como leídos; el resaltado se mantiene en esta vista.
  useEffect(() => {
    if (q.data?.unread) post('/me/notifications/read', {}).then(() => ctx?.refreshUnread?.()).catch(() => undefined);
  }, [q.data?.unread, ctx]);
  return (
    <Load q={q}>
      {(d) => d.items.length === 0 ? <Empty glyph="0" title="Sin avisos">Aquí verás recordatorios de vencimiento, cupos liberados y clases canceladas.</Empty> : (
        <div className="list">
          {d.items.map((n) => (
            <div key={n.id} className={`list-item ${n.read_at ? '' : 'unread'}`} style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <b>{n.title}</b>
                <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{n.body}</p>
              </div>
              <span className="mono faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{ago(n.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Load>
  );
}

function Payments({ memberId }: { memberId: number }) {
  const q = useApi<{ items: Payment[]; debt: Debt }>(`/members/${memberId}/payments`);
  const toast = useToast();
  return (
    <Load q={q}>
      {(d) => (
        <div className="stack">
          {d.debt.totalCents > 0 && <div className="notice bad">Saldo pendiente: <b className="num">{money(d.debt.totalCents)}</b> · {d.debt.items.map((i) => i.plan).join(', ')}</div>}
          {d.items.length === 0 ? <Empty glyph="0" title="Sin pagos registrados" /> : (
            <div className="list">
              {d.items.map((p) => (
                <div key={p.id} className="list-item">
                  <div className="grow">
                    <b className={p.status === 'voided' ? 'faint' : ''}>{p.concept}</b>
                    <div className="mono faint" style={{ fontSize: 11.5 }}>{p.receipt_number} · {date(p.paid_at)} · {METHOD[p.method]}</div>
                    {p.status === 'voided' && <span className="tag bad" style={{ marginTop: 6 }}>Anulado</span>}
                  </div>
                  <div className="right">
                    <div className="display num" style={{ fontSize: 24, textDecoration: p.status === 'voided' ? 'line-through' : undefined }}>{money(p.amount_cents)}</div>
                    <button className="linkish" style={{ fontSize: 12.5 }} onClick={() => download(`/payments/${p.id}/receipt.pdf`, `comprobante-${p.receipt_number}.pdf`).catch((e) => toast(e.message, 'bad'))}>
                      Comprobante PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Load>
  );
}

function History({ memberId }: { memberId: number }) {
  const q = useApi<{ items: Membership[] }>(`/members/${memberId}/memberships`);
  return (
    <Load q={q} skeleton={<Skeleton lines={3} />}>
      {(d) => d.items.length === 0 ? <Empty glyph="0" title="Sin planes" /> : (
        <div className="list">
          {d.items.map((m) => (
            <div key={m.id} className="list-item">
              <div className="grow"><b>{m.planName}</b><div className="mono faint" style={{ fontSize: 12 }}>{date(m.startDate)} → {date(m.endDate)}{m.freezes.length ? ` · ${m.freezeDaysUsed} días congelado` : ''}</div></div>
              <StateTag state={m.state} />
            </div>
          ))}
        </div>
      )}
    </Load>
  );
}

function Password() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const toast = useToast();
  const a = useAction(async () => {
    await post('/auth/change-password', { current: cur, next });
    setCur(''); setNext('');
    toast('Contraseña actualizada. Cerramos tus otras sesiones.');
  });
  return (
    <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); a.run(); }}>
      <Field label="Contraseña actual"><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números."><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <FormError error={a.error} />
      <Button busy={a.busy} disabled={!cur || next.length < 10}>Cambiar contraseña</Button>
    </form>
  );
}

export function MemberAccount() {
  const user = useUser();
  const { logout } = useAuth();
  const [tab, setTab] = useState<'avisos' | 'pagos' | 'planes' | 'cuenta'>('avisos');
  const tabs = [['avisos', 'Avisos'], ['pagos', 'Pagos'], ['planes', 'Planes'], ['cuenta', 'Cuenta']] as const;
  return (
    <>
      <MemberTop title="Cuenta" right={<ThemeToggle />} />
      <main className="m-page">
        <div>
          <span className="eyebrow">{user.email}</span>
          <h1 className="display" style={{ fontSize: 44, marginTop: 6 }}>{user.name}</h1>
        </div>
        <div className="tabs" role="tablist">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === 'avisos' && <Notifications />}
        {tab === 'pagos' && <Payments memberId={user.memberId!} />}
        {tab === 'planes' && <History memberId={user.memberId!} />}
        {tab === 'cuenta' && (
          <div className="stack-lg">
            <Section title="Contraseña"><Password /></Section>
            <Button variant="danger" onClick={logout}><Icon name="logout" size={16} />Cerrar sesión</Button>
          </div>
        )}
      </main>
    </>
  );
}
