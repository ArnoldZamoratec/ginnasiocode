import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { ApiError } from '../lib/api.ts';
import { Button, Field } from '../components/ui.tsx';
import { ThemeToggle, homeFor } from '../components/Shell.tsx';

const DEMO = [
  { role: 'Socio', email: 'socio@gymos.pe', hint: 'Lucía · plan por vencer' },
  { role: 'Recepción', email: 'recepcion@gymos.pe', hint: 'Check-in, ventas y caja' },
  { role: 'Entrenador', email: 'entrenador@gymos.pe', hint: 'Renzo · rutinas y progreso' },
  { role: 'Admin', email: 'admin@gymos.pe', hint: 'Reportes y configuración' },
];

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      nav(homeFor(u.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-art">
        <div className="row between">
          <span className="eyebrow">GymOS · Gestión de gimnasio</span>
          <ThemeToggle />
        </div>
        <h1>Entra.<br />Entrena.<br /><em>Vuelve.</em></h1>
        <p className="muted hide-sm" style={{ maxWidth: '44ch' }}>
          Acceso por QR, membresías, clases con lista de espera, rutinas y reportes. Todo en un solo lugar, sin vueltas.
        </p>
      </div>
      <form className="login-form" onSubmit={submit} noValidate>
        <div>
          <span className="eyebrow">Iniciar sesión</span>
          <h2 className="display" style={{ fontSize: 48, marginTop: 8 }}>Tu cuenta</h2>
        </div>
        <Field label="Correo">
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Contraseña">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <div className="notice bad" role="alert">{error}</div>}
        <Button variant="primary" size="lg" block busy={busy} disabled={!email || !password}>Ingresar</Button>
        {import.meta.env.DEV && (
          <div className="stack">
            <span className="eyebrow">Cuentas de demostración · contraseña GymOS-2026</span>
            <div className="demo">
              {DEMO.map((d) => (
                <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPassword('GymOS-2026'); }}>
                  <b>{d.role}</b><span>{d.email} <span className="faint">— {d.hint}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
