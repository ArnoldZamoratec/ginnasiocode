import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;
type Value = SQLInputValue | boolean | undefined;
export type Params = Record<string, Value> | Value[];

/** Conexión activa. Se reasigna en pruebas (BD en memoria) mediante useDb(). */
export let db: DB = undefined as unknown as DB;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const conn = new DatabaseSync(path);
  conn.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') conn.exec('PRAGMA journal_mode = WAL;');
  return conn;
}

export function useDb(conn: DB): void {
  db = conn;
  stmtCache.clear();
  depth = 0;
}

const stmtCache = new Map<string, ReturnType<DB['prepare']>>();
function stmt(sql: string) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    // Los filtros opcionales arman el WHERE dinámicamente pero pasan siempre el mismo objeto de parámetros.
    s.setAllowUnknownNamedParameters(true);
    stmtCache.set(sql, s);
  }
  return s;
}

/** node:sqlite no acepta booleanos ni undefined: se normalizan. */
function norm(params?: Params): SQLInputValue[] | Record<string, SQLInputValue> {
  if (!params) return [];
  if (Array.isArray(params)) return params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null));
  const out: Record<string, SQLInputValue> = {};
  for (const [k, v] of Object.entries(params)) out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null);
  return out;
}

function call<T>(fn: 'get' | 'all' | 'run', sql: string, params?: Params): T {
  const s = stmt(sql);
  const p = norm(params);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Array.isArray(p) ? (s[fn] as any)(...p) : (s[fn] as any)(p)) as T;
}

export function one<T>(sql: string, params?: Params): T | undefined {
  return call<T | undefined>('get', sql, params);
}
export function all<T>(sql: string, params?: Params): T[] {
  return call<T[]>('all', sql, params);
}
export function run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
  const r = call<{ changes: number | bigint; lastInsertRowid: number | bigint }>('run', sql, params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}
export function insert(sql: string, params?: Params): number {
  return run(sql, params).lastInsertRowid;
}

let depth = 0;
/**
 * Transacción con BEGIN IMMEDIATE (toma el bloqueo de escritura desde el inicio, evitando
 * condiciones de carrera entre lectura de cupo y escritura). Anidable mediante SAVEPOINT.
 */
export function tx<T>(fn: () => T): T {
  const sp = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  }
}
