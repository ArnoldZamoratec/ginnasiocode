import { getSettings } from './settings.ts';
import { localParts } from './dates.ts';

export function formatMoney(cents: number): string {
  const s = getSettings();
  return new Intl.NumberFormat(s.locale, { style: 'currency', currency: s.currency }).format(cents / 100);
}

export function formatDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

export function formatTime(iso: string): string {
  const p = localParts(iso, getSettings().timezone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function maskDni(dni: string): string {
  return dni.length <= 3 ? '•••' : '•'.repeat(dni.length - 3) + dni.slice(-3);
}
