import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './api.ts';

export interface Query<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (fn: (d: T | undefined) => T | undefined) => void;
}

/** Carga un recurso GET. `path = null` desactiva la carga. Mantiene los datos previos mientras recarga. */
export function useApi<T>(path: string | null): Query<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(path);
      if (n === seq.current) { setDataState(d); setError(null); }
    } catch (e) {
      if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e)));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { load(); }, [load]);

  return { data, error, loading, reload: load, setData: (fn) => setDataState(fn) };
}

/** Ejecuta una acción con estado de envío y error de formulario. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e)));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [fn]);
  return { run, busy, error, setError };
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}
