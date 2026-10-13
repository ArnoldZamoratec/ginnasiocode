import { useEffect, useRef, useState } from 'react';
import { api, post } from '../../lib/api.ts';
import { useApi, useAction } from '../../lib/hooks.ts';
import { Button, Empty, Field, FormError, Load, PageHead, Section, Skeleton, Tag, useToast } from '../../components/ui.tsx';
import { dateTime } from '../../lib/format.ts';

interface Template { key: string; name: string; subject: string; body: string; send_email: boolean; send_inapp: boolean; variables: string[] }
interface Mail { id: number; to_email: string; subject: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null }

function Editor({ t, onSaved }: { t: Template; onSaved: () => void }) {
  const [f, setF] = useState(t);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  useEffect(() => { setF(t); }, [t]);
  useEffect(() => {
    const id = setTimeout(() => post<{ subject: string; body: string }>(`/admin/templates/${t.key}/preview`, { subject: f.subject, body: f.body }).then(setPreview).catch(() => undefined), 250);
    return () => clearTimeout(id);
  }, [f.subject, f.body, t.key]);
  const save = useAction(async () => {
    await api('PUT', `/admin/templates/${t.key}`, { subject: f.subject, body: f.body, send_email: f.send_email, send_inapp: f.send_inapp });
    toast(`Plantilla “${t.name}” guardada.`);
    onSaved();
  });
  const insert = (v: string) => {
    const el = body.current;
    const token = `{{${v}}}`;
    if (!el) return setF({ ...f, body: f.body + token });
    const s = el.selectionStart, e = el.selectionEnd;
    setF({ ...f, body: f.body.slice(0, s) + token + f.body.slice(e) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };
  const dirty = f.subject !== t.subject || f.body !== t.body || f.send_email !== t.send_email || f.send_inapp !== t.send_inapp;
  return (
    <div className="cols">
      <div className="span-7 stack">
        <Field label="Asunto / título"><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Mensaje"><textarea ref={body} className="input" style={{ minHeight: 150 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="eyebrow">Insertar</span>
          {t.variables.map((v) => <button key={v} type="button" className="chip mono" onClick={() => insert(v)}>{`{{${v}}}`}</button>)}
        </div>
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={f.send_inapp} onChange={(e) => setF({ ...f, send_inapp: e.target.checked })} />Aviso en la app</label>
          <label className="check"><input type="checkbox" checked={f.send_email} onChange={(e) => setF({ ...f, send_email: e.target.checked })} />Correo</label>
        </div>
        <FormError error={save.error} />
        <div className="row"><Button variant="primary" busy={save.busy} disabled={!dirty} onClick={() => save.run()}>Guardar cambios</Button>{dirty && <Button variant="ghost" onClick={() => setF(t)}>Descartar</Button>}</div>
      </div>
      <div className="span-5 stack">
        <span className="eyebrow">Vista previa con datos de ejemplo</span>
        <div style={{ border: '1px solid var(--line-2)', padding: 18 }}>
          <b style={{ fontSize: 17 }}>{preview?.subject ?? '…'}</b>
          <p className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{preview?.body}</p>
        </div>
      </div>
    </div>
  );
}

export function TemplatesPage() {
  const q = useApi<Template[]>('/admin/templates');
  const outbox = useApi<Mail[]>('/admin/outbox');
  const [sel, setSel] = useState<string | null>(null);
  const t = q.data?.find((x) => x.key === sel) ?? q.data?.[0];
  return (
    <div className="page">
      <PageHead eyebrow="Configuración" title="Avisos" />
      <div className="stack-lg">
        <Load q={q} skeleton={<Skeleton block lines={4} />}>
          {(list) => (
            <div className="stack">
              <div className="tabs" role="tablist">
                {list.map((x) => <button key={x.key} role="tab" aria-selected={t?.key === x.key} onClick={() => setSel(x.key)}>{x.name}</button>)}
              </div>
              {t && <Editor t={t} onSaved={q.reload} />}
            </div>
          )}
        </Load>
        <Section idx="—" title="Correo saliente" aside={<Button size="sm" variant="ghost" onClick={outbox.reload}>Actualizar</Button>}>
          <Load q={outbox} skeleton={<Skeleton lines={5} />}>
            {(rows) => rows.length === 0 ? <Empty glyph="0" title="Bandeja vacía" /> : (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Creado</th><th>Para</th><th>Asunto</th><th>Estado</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 40).map((m) => (
                      <tr key={m.id}>
                        <td className="num">{dateTime(m.created_at)}</td>
                        <td className="mono" style={{ fontSize: 12.5 }}>{m.to_email}</td>
                        <td>{m.subject}{m.last_error && <div className="bad" style={{ fontSize: 12 }}>{m.last_error}</div>}</td>
                        <td>{m.status === 'sent' ? <Tag tone="ok">Enviado</Tag> : m.status === 'failed' ? <Tag tone="bad">Falló</Tag> : <Tag tone="warn">En cola</Tag>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Load>
          <p className="faint" style={{ fontSize: 12.5 }}>En desarrollo los correos se registran en la consola del servidor. Configura SMTP en <span className="mono">server/.env</span> para enviarlos.</p>
        </Section>
      </div>
    </div>
  );
}
