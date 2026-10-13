import { z } from 'zod';
import { all, run } from '../db/db.ts';

/**
 * Reglas de negocio configurables. Los valores por defecto están documentados en docs/DECISIONES.md
 * y pueden cambiarse desde Admin › Configuración sin desplegar código.
 */
export const settingsSchema = z.object({
  gym_name: z.string().min(2).max(60),
  currency: z.string().length(3),
  locale: z.string().min(2).max(10),
  timezone: z.string().min(3).max(60),
  expiring_soon_days: z.number().int().min(1).max(60),
  reminder_days: z.array(z.number().int().min(0).max(60)).max(5),
  checkin_dedupe_minutes: z.number().int().min(0).max(240),
  checkin_allow_with_debt: z.boolean(),
  cancel_min_hours: z.number().min(0).max(72),
  booking_window_days: z.number().int().min(1).max(60),
  freeze_min_days: z.number().int().min(1).max(90),
  renewal_grace_days: z.number().int().min(0).max(90),
  day_pass_price_cents: z.number().int().min(0),
  pass_ttl_seconds: z.number().int().min(20).max(600),
}).strict();

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  gym_name: 'GymOS',
  currency: 'PEN',
  locale: 'es-PE',
  timezone: 'America/Lima',
  expiring_soon_days: 7,
  reminder_days: [7, 3, 0],
  checkin_dedupe_minutes: 10,
  checkin_allow_with_debt: true,
  cancel_min_hours: 2,
  booking_window_days: 7,
  freeze_min_days: 7,
  renewal_grace_days: 15,
  day_pass_price_cents: 2500,
  pass_ttl_seconds: 60,
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = JSON.parse(r.value);
  cache = merged as Settings;
  return cache;
}

export function saveSettings(patch: Partial<Settings>, actorId: number | null): Settings {
  const next = settingsSchema.parse({ ...getSettings(), ...patch });
  for (const [key, value] of Object.entries(patch)) {
    run(
      `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [key, JSON.stringify(value), actorId],
    );
  }
  cache = next;
  return next;
}

export function resetSettingsCache(): void {
  cache = null;
}
