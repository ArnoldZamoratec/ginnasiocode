/**
 * Cliente HTTP. El access token vive solo en memoria (no en localStorage, para que un XSS no lo
 * pueda leer en reposo); la sesión se recupera con el refresh token en cookie httpOnly.
 */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Errores de validación de Zod: { campo: mensaje } */
  get fields(): Record<string, string> {
    const d = this.details as { issues?: { path: (string | number)[]; message: string }[] } | undefined;
    const out: Record<string, string> = {};
    for (const i of d?.issues ?? []) out[String(i.path[0] ?? '')] ??= i.message;
    return out;
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(t: string | null) { accessToken = t; }
export function onUnauthorized(fn: () => void) { onSessionLost = fn; }

const BASE = '/api';
const HEADERS = { 'X-Requested-With': 'gymos' };

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: User;
}
export interface User {
  id: number; email: string; role: 'member' | 'reception' | 'trainer' | 'admin'; name: string; memberId: number | null; branchId: number | null;
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) return res.json();
  return res.text();
}

function toError(status: number, body: unknown): ApiError {
  const e = (body as { error?: { code: string; message: string; details?: unknown } })?.error;
  if (e) return new ApiError(status, e.code, e.message, e.details);
  if (status === 0) return new ApiError(0, 'NETWORK', 'Sin conexión con el servidor. Revisa tu red e intenta de nuevo.');
  return new ApiError(status, 'HTTP_' + status, 'Ocurrió un error inesperado. Intenta de nuevo.');
}

export async function refreshSession(): Promise<Session | null> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: HEADERS, credentials: 'same-origin' });
    if (!res.ok) return null;
    const s = (await res.json()) as Session;
    accessToken = s.accessToken;
    return s;
  } catch {
    return null;
  }
}

/** Una sola renovación en vuelo aunque varias peticiones reciban 401 a la vez. */
function refreshOnce(): Promise<boolean> {
  refreshing ??= refreshSession().then((s) => !!s).finally(() => { refreshing = null; });
  return refreshing;
}

async function raw(method: string, path: string, body?: unknown, retry = true): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...HEADERS,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw toError(0, null);
  }
  if (res.status === 401 && retry && accessToken && !path.startsWith('/auth/')) {
    if (await refreshOnce()) return raw(method, path, body, false);
    accessToken = null;
    onSessionLost?.();
  }
  return res;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await raw(method, path, body);
  const data = await parse(res);
  if (!res.ok) throw toError(res.status, data);
  return data as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>('POST', path, body);

/** Descarga autenticada (comprobantes PDF). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await raw('GET', path);
  if (!res.ok) throw toError(res.status, await parse(res));
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
