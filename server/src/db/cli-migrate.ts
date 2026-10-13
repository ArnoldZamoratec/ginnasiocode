import { config } from '../config.ts';
import { openDb } from './db.ts';
import { migrate } from './migrate.ts';

const conn = openDb(config.dbPath);
const done = migrate(conn, console.log);
console.log(done.length ? `${done.length} migración(es) aplicada(s).` : 'La base de datos ya está al día.');
