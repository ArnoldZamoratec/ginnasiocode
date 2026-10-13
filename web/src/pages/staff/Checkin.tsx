import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, post } from '../../lib/api.ts';
import { useApi, useAction, useInterval } from '../../lib/hooks.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Button, Field, FormError, PageHead, Seg, Sheet, StateTag, Icon, useToast } from '../../components/ui.tsx';
import { date, DENY, METHOD, money, time } from '../../lib/format.ts';
import type { CheckInResult } from '../../lib/types.ts';

interface Recent { items: { id: number; member_id: number; fullName: string; result: string; reason: string | null; method: string; checked_in_at: string }[]; estimatedInside: number; todayCount: number }

type Detector = { detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]> };
const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

/** Escaneo con la cámara del dispositivo (BarcodeDetector). Los lectores USB funcionan como teclado en el campo de texto. */
function Camera({ onCode }: { onCode: (c: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const det = new Ctor({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      video.current!.srcObject = s;
      video.current!.play();
      const tick = async () => {
        if (stopped || !video.current) return;
        try {
          const codes = await det.detect(video.current);
          const c = codes[0]?.rawValue;
          // Evita registrar el mismo código varias veces mientras sigue frente a la cámara.
          if (c && (c !== last.current.code || Date.now() - last.current.at > 4000)) {
            last.current = { code: c, at: Date.now() };
            cb.current(c);
          }
        } catch { /* cuadro sin decodificar */ }
        raf = window.setTimeout(tick, 250);
      };
      tick();
    }).catch(() => setErr('No se pudo usar la cámara. Revisa el permiso del navegador o usa el lector / DNI.'));
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  if (err) return <div className="notice bad">{err}</div>;
  return <div className="video"><video ref={video} muted playsInline /><div className="reticle" /></div>;
}

function Verdict({ r, fresh }: { r: CheckInResult | null; fresh: boolean }) {
  if (!r) {
    return (
      <div className="verdict idle">
        <div className="display">Listo</div>
        <p>Escanea el QR del socio o escribe su DNI.</p>
      </div>
    );
  }
  const m = r.membership;
  const granted = r.result === 'granted';
  const needsSale = !granted && ['EXPIRED', 'NO_MEMBERSHIP'].includes(r.reason ?? '');
  return (
    <div className={`verdict ${r.result} ${r.duplicate ? 'dup' : ''}`} data-fresh={fresh} aria-live="assertive">
      <div className="verdict-band">
        <div className="grow">
          <div className="display">{granted ? (r.duplicate ? 'Ya ingresó' : 'Adelante') : 'Alto'}</div>
          <div className="sub">{granted ? r.message : r.message}</div>
        </div>
        <span className="mono" style={{ fontSize: 13 }}>{time(r.checkedInAt)}</span>
      </div>
      <div className="verdict-body">
        <div className="person">
          <div className="avatar">{r.member.initials}</div>
          <div className="grow">
            <h3>{r.member.fullName}</h3>
            <div className="mono faint" style={{ fontSize: 12.5 }}>DNI {r.member.dni}{r.member.trainerName ? ` · Entrenador: ${r.member.trainerName}` : ''}</div>
          </div>
        </div>
        {r.warnings.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            {r.warnings.map((w) => <div key={w.code} className={`notice ${w.code === 'DEBT' ? 'bad' : ''}`}>{w.message}</div>)}
          </div>
        )}
        <dl className="kv">
          <dt>Plan</dt><dd>{m ? <span className="row wrap" style={{ gap: 8 }}>{m.planName} <StateTag state={m.state} /></span> : 'Sin plan'}</dd>
          {m && <><dt>Vigencia</dt><dd className="num">{date(m.startDate)} → {date(m.endDate)}{m.daysLeft != null && m.daysLeft >= 0 && granted ? ` · ${m.daysLeft} días` : ''}</dd></>}
          <dt>Deuda</dt><dd className={r.debtCents ? 'bad num' : 'num'}>{r.debtCents ? money(r.debtCents) : 'Al día'}</dd>
          {r.classesToday.length > 0 && <><dt>Clases hoy</dt><dd>{r.classesToday.map((c) => `${c.time} ${c.className}${c.status === 'waitlist' ? ' (espera)' : ''}`).join(' · ')}</dd></>}
        </dl>
        <div className="row wrap">
          {needsSale && <Link className="btn primary" to={`/socios/${r.member.id}?accion=vender`}>Vender o renovar plan</Link>}
          {r.debtCents > 0 && <Link className="btn" to={`/socios/${r.member.id}?accion=cobrar`}>Cobrar deuda</Link>}
          {m && granted && ['expiring', 'expires_today'].includes(m.state) && <Link className="btn" to={`/socios/${r.member.id}?accion=renovar`}>Renovar ahora</Link>}
          <Link className="btn ghost" to={`/socios/${r.member.id}`}>Ver ficha <Icon name="arrow" size={16} /></Link>
        </div>
      </div>
    </div>
  );
}

function GuestVisit({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { branchId, settings } = useAuth();
  const [f, setF] = useState({ fullName: '', dni: '', phone: '', kind: 'day_pass' as 'day_pass' | 'trial' | 'tour', method: 'cash', reference: '', notes: '' });
  const toast = useToast();
  const save = useAction(async () => {
    await post('/guest-visits', {
      fullName: f.fullName, dni: f.dni || null, phone: f.phone || null, kind: f.kind, branchId, notes: f.notes || null,
      ...(f.kind === 'day_pass' ? { payment: { method: f.method, reference: f.reference || null } } : {}),
    });
    toast(f.kind === 'day_pass' ? `Pase diario cobrado: ${money(settings?.day_pass_price_cents)}.` : 'Visita registrada.');
    setF({ ...f, fullName: '', dni: '', phone: '', notes: '', reference: '' });
    onDone();
    onClose();
  });
  return (
    <Sheet open={open} onClose={onClose} title="Visita de invitado" eyebrow="Sin membresía"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" busy={save.busy} disabled={f.fullName.trim().length < 3} onClick={() => save.run()}>{f.kind === 'day_pass' ? `Cobrar ${money(settings?.day_pass_price_cents)}` : 'Registrar'}</Button></>}>
      <Seg label="Tipo" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'day_pass', label: 'Pase diario' }, { value: 'trial', label: 'Clase de prueba' }, { value: 'tour', label: 'Recorrido' }]} />
      <div className="form-grid">
        <Field label="Nombre completo" className="full"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus /></Field>
        <Field label="DNI (opcional)"><input className="input" value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value })} /></Field>
        <Field label="Teléfono (opcional)"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        {f.kind === 'day_pass' && (
          <>
            <Field label="Método de pago">
              <select className="select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
                {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {f.method === 'transfer' && <Field label="N.º de operación"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
          </>
        )}
        <Field label="Nota" className="full"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ej.: viene recomendado por un socio" /></Field>
      </div>
      <FormError error={save.error} />
    </Sheet>
  );
}

export function CheckinPage() {
  const { branchId } = useAuth();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [guest, setGuest] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resetAt = useRef(0);
  const recent = useApi<Recent>(`/checkin/recent${branchId ? `?branchId=${branchId}` : ''}`);
  useInterval(() => recent.reload(), 15_000);
  useInterval(() => { if (resetAt.current && Date.now() > resetAt.current) { resetAt.current = 0; setResult(null); input.current?.focus(); } }, 1000);

  async function submit(value: string) {
    const v = value.trim();
    if (v.length < 4 || !branchId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<CheckInResult>('/checkin', { code: v, branchId });
      setResult(r);
      setFresh(true);
      setTimeout(() => setFresh(false), 400);
      resetAt.current = Date.now() + (r.result === 'granted' ? 12_000 : 30_000);
      navigator.vibrate?.(r.result === 'granted' ? 40 : [120, 80, 120]);
      recent.reload();
    } catch (e) {
      setResult(null);
      setError(e as ApiError);
    } finally {
      setBusy(false);
      setCode('');
      input.current?.focus();
    }
  }

  return (
    <div className="page">
      <PageHead eyebrow="Recepción" title="Check-in" actions={<>
        <Button onClick={() => setGuest(true)}>Invitado</Button>
        <Link className="btn" to="/socios?nuevo=1"><Icon name="plus" size={16} />Alta rápida</Link>
      </>} />
      <div className="checkin">
        <div className="scanbox">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(code); }}>
            <input ref={input} className="input xl" value={code} onChange={(e) => setCode(e.target.value)} placeholder="DNI o QR" autoFocus autoComplete="off" spellCheck={false}
              aria-label="Código QR o DNI del socio" inputMode="text" />
            <Button variant="primary" busy={busy} disabled={code.trim().length < 4}>Validar</Button>
          </form>
          <div className="row wrap">
            {hasDetector
              ? <Button size="sm" onClick={() => setCamera((v) => !v)}><Icon name="qr" size={16} />{camera ? 'Apagar cámara' : 'Escanear con cámara'}</Button>
              : <span className="faint" style={{ fontSize: 12.5 }}>Lector QR USB o DNI. La cámara no está disponible en este navegador.</span>}
          </div>
          {camera && <Camera onCode={submit} />}
          {error && (
            <div className="errorbox" role="alert">
              <b>{error.code === 'MEMBER_NOT_FOUND' ? 'No encontrado' : error.code === 'INVALID_PASS' ? 'Código inválido' : 'Error'}</b>
              <p>{error.message}</p>
              {error.code === 'MEMBER_NOT_FOUND' && <Link className="btn sm" to="/socios?nuevo=1">Registrar socio nuevo</Link>}
            </div>
          )}

          <section className="section" style={{ marginTop: 12 }}>
            <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="kpi"><span className="eyebrow">Visitas hoy</span><div className="v">{recent.data?.todayCount ?? '—'}</div></div>
              <div className="kpi"><span className="eyebrow">Adentro aprox.</span><div className="v">{recent.data?.estimatedInside ?? '—'}</div><div className="d">últimos 90 min</div></div>
            </div>
            <div className="feed" aria-label="Últimos ingresos">
              {(recent.data?.items ?? []).slice(0, 12).map((v) => (
                <Link key={v.id} to={`/socios/${v.member_id}`} className="feed-item" style={{ textDecoration: 'none' }}>
                  <span className="t">{time(v.checked_in_at)}</span>
                  <span>{v.fullName}</span>
                  {v.result === 'granted' ? <span className="tag ok">{v.method === 'qr' ? 'QR' : v.method === 'dni' ? 'DNI' : 'Manual'}</span> : <span className="tag bad">{DENY[v.reason ?? ''] ?? 'Denegado'}</span>}
                </Link>
              ))}
              {recent.data && recent.data.items.length === 0 && <p className="faint" style={{ padding: '12px 0' }}>Todavía no hay ingresos hoy.</p>}
            </div>
          </section>
        </div>
        <Verdict r={result} fresh={fresh} />
      </div>
      <GuestVisit open={guest} onClose={() => setGuest(false)} onDone={recent.reload} />
    </div>
  );
}
