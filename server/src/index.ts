import { config } from './config.ts';
import { openDb, useDb } from './db/db.ts';
import { migrate } from './db/migrate.ts';
import { createApp } from './app.ts';
import { startScheduler } from './jobs.ts';
import { seedTemplates } from './modules/notifications.ts';

const conn = openDb(config.dbPath);
useDb(conn);
migrate(conn, (m) => console.log(`[db] ${m}`));
seedTemplates();

const app = createApp();
app.listen(config.port, () => {
  console.log(`GymOS API escuchando en http://localhost:${config.port}  ·  docs: http://localhost:${config.port}/api/docs`);
  if (!process.env.JWT_SECRET) console.log('[aviso] JWT_SECRET no definido: se usa un secreto temporal (las sesiones se pierden al reiniciar).');
});
startScheduler();
