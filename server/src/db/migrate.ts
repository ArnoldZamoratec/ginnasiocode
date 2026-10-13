import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** Aplica en orden las migraciones NNNN_nombre.sql que aún no figuran en schema_migrations. */
export function migrate(conn: DB, log: (msg: string) => void = () => {}): string[] {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Set(
    (conn.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const done: string[] = [];
  for (const file of files) {
    const version = file.slice(0, 4);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    conn.exec('BEGIN');
    try {
      conn.exec(sql);
      conn.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      conn.exec('COMMIT');
      done.push(file);
      log(`migración aplicada: ${file}`);
    } catch (err) {
      conn.exec('ROLLBACK');
      throw new Error(`Falló la migración ${file}: ${(err as Error).message}`);
    }
  }
  return done;
}
