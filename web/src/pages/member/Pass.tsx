import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { get, ApiError } from '../../lib/api.ts';
import { useApi, useInterval } from '../../lib/hooks.ts';
import { MemberTop } from '../../components/Shell.tsx';
import { Button, ErrorState, StateTag } from '../../components/ui.tsx';
import { date } from '../../lib/format.ts';
import type { Membership } from '../../lib/types.ts';

interface Pass { payload: string; expiresAt: string; ttlSeconds: number }

/**
 * Pase de ingreso. El código está firmado y rota antes de expirar (60 s por defecto), así una captura
 * de pantalla compartida no sirve. Se renueva solo y al volver a la app.
 */
export function MemberPass() {
  const me = useApi<{ member: { firstName: string; lastName: string }; membership: Membership | null }>('/me');
  const [pass, setPass] = useState<Pass | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [now, setNow] = useState(Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);

  async function load() {
    try {
      const p = await get<Pass>('/me/pass');
      setPass(p);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }

  useEffect(() => {
    load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    // Brillo máximo no se puede forzar en web; sí evitamos que la pantalla se apague mientras se muestra.
    let lock: { release(): Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => undefined); };
  }, []);

  useEffect(() => {
    if (pass && canvas.current) QRCode.toCanvas(canvas.current, pass.payload, { margin: 0, width: 640, errorCorrectionLevel: 'M', color: { dark: '#0c0c0b', light: '#ffffff' } });
  }, [pass]);

  useInterval(() => {
    setNow(Date.now());
    if (pass && new Date(pass.expiresAt).getTime() - Date.now() < 8000) load();
  }, 1000);

  const left = pass ? Math.max(0, Math.round((new Date(pass.expiresAt).getTime() - now) / 1000)) : 0;
  const m = me.data?.membership;
  const blocked = m && ['expired', 'frozen', 'not_started'].includes(m.state);

  return (
    <>
      <MemberTop title="Pase de ingreso" />
      <main className="m-page">
        <div className="pass">
          {me.data && (
            <div>
              <h1 className="display" style={{ fontSize: 40 }}>{me.data.member.firstName} {me.data.member.lastName.split(' ')[0]}</h1>
              <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
                {m ? <StateTag state={m.state} /> : <StateTag state="none" />}
                {m && <span className="mono faint" style={{ fontSize: 12 }}>{m.planName} · vence {date(m.endDate)}</span>}
              </div>
            </div>
          )}
          {error ? <ErrorState error={error} retry={load} /> : (
            <>
              <div className={`qr ${!pass || left === 0 ? 'stale' : ''}`} aria-label="Código QR de ingreso">
                <canvas ref={canvas} />
              </div>
              <div className="ttl" aria-hidden><i style={{ width: pass ? `${(left / pass.ttlSeconds) * 100}%` : 0 }} /></div>
              <p className="mono faint" style={{ fontSize: 12 }}>{pass ? `Se renueva solo · ${left}s` : 'Generando código…'}</p>
            </>
          )}
          {blocked && (
            <div className="notice bad" style={{ textAlign: 'left' }}>
              {m!.state === 'expired' && 'Tu plan está vencido: el código no te dará acceso hasta renovar en recepción.'}
              {m!.state === 'frozen' && `Tu plan está congelado hasta el ${date(m!.frozenUntil)}. Pide en recepción reactivarlo si quieres volver antes.`}
              {m!.state === 'not_started' && `Tu plan empieza el ${date(m!.startDate)}.`}
            </div>
          )}
          <p className="muted" style={{ maxWidth: '34ch' }}>Muestra este código en recepción. Si no tienes señal, puedes dar tu DNI.</p>
          <Button size="sm" variant="ghost" onClick={load}>Actualizar código</Button>
        </div>
      </main>
    </>
  );
}
