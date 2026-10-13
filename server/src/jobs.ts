import { all, run } from './db/db.ts';
import { clock } from './lib/clock.ts';
import { getSettings } from './lib/settings.ts';
import { addDays } from './lib/dates.ts';
import { formatDate } from './lib/format.ts';
import { membershipState } from './domain/membership.ts';
import { memberMemberships, pickCurrent, todayLocal } from './modules/memberships.ts';
import { notify, deliverOutbox } from './modules/notifications.ts';
import { generateSessions } from './modules/classes.ts';

/**
 * Recordatorios de vencimiento. Idempotentes gracias a dedupe_key: correr el job varias veces
 * al día no duplica avisos.
 */
export function runExpiryReminders(): number {
  const s = getSettings();
  const today = todayLocal();
  let sent = 0;
  const memberIds = all<{ member_id: number }>(
    "SELECT DISTINCT member_id FROM memberships WHERE status = 'active' AND end_date >= ? AND end_date <= ?",
    [addDays(today, -1), addDays(today, Math.max(...s.reminder_days, 0))],
  ).map((r) => r.member_id);
  for (const id of memberIds) {
    const list = memberMemberships(id);
    const cur = pickCurrent(list, today);
    if (!cur) continue;
    // Si ya tiene una renovación programada que continúa la cobertura, no se le recuerda.
    const renewed = list.some((m) => m.status === 'active' && m.start_date > cur.end_date && m.start_date <= addDays(cur.end_date, 1));
    if (renewed) continue;
    const st = membershipState(cur, today, s.expiring_soon_days);
    if (st.state === 'frozen') continue;
    if (st.daysLeft === 0 && s.reminder_days.includes(0)) {
      if (notify(id, 'membership_expires_today', { plan: cur.plan_name }, `exp0:${cur.id}`)) sent++;
    } else if (st.daysLeft !== null && st.daysLeft > 0 && s.reminder_days.includes(st.daysLeft)) {
      if (notify(id, 'membership_expiring', { plan: cur.plan_name, fecha: formatDate(cur.end_date), dias: st.daysLeft }, `exp${st.daysLeft}:${cur.id}`)) sent++;
    } else if (st.state === 'expired' && st.daysLeft === -1) {
      if (notify(id, 'membership_expired', { plan: cur.plan_name, fecha: formatDate(cur.end_date) }, `expired:${cur.id}`)) sent++;
    }
  }
  return sent;
}

/** Reservas confirmadas de clases que terminaron hace más de 1 h sin check-in → inasistencia. */
export function markNoShows(): number {
  const cutoff = new Date(clock.now().getTime() - 3_600_000).toISOString();
  return run(
    `UPDATE reservations SET status = 'no_show' WHERE status = 'booked' AND session_id IN
       (SELECT id FROM class_sessions WHERE status = 'scheduled' AND ends_at < ?)`, [cutoff],
  ).changes;
}

export function housekeeping(): void {
  const old = new Date(clock.now().getTime() - 30 * 86_400_000).toISOString();
  run('DELETE FROM login_attempts WHERE created_at < ?', [old]);
  run('DELETE FROM refresh_tokens WHERE expires_at < ?', [old]);
}

export async function runJobs(): Promise<void> {
  try {
    generateSessions(todayLocal(), 14);
    markNoShows();
    runExpiryReminders();
    housekeeping();
    await deliverOutbox();
  } catch (err) {
    console.error('[jobs]', err);
  }
}

export function startScheduler(intervalMs = 10 * 60_000): NodeJS.Timeout {
  void runJobs();
  return setInterval(() => void runJobs(), intervalMs);
}
