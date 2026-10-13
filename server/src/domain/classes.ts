/**
 * Reglas de reservas puras: cupos, lista de espera y política de cancelación.
 */

export interface SessionLike {
  status: 'scheduled' | 'cancelled';
  starts_at: string;
  capacity: number;
}

export type BookingDecision =
  | { ok: true; status: 'booked' | 'waitlist' }
  | { ok: false; code: string; message: string };

export function decideBooking(input: {
  session: SessionLike;
  bookedCount: number;
  now: Date;
  windowDays: number;
  hasLiveReservation: boolean;
}): BookingDecision {
  const { session, now } = input;
  const start = new Date(session.starts_at).getTime();
  if (session.status === 'cancelled') return { ok: false, code: 'CLASS_CANCELLED', message: 'Esta clase fue cancelada.' };
  if (start <= now.getTime()) return { ok: false, code: 'CLASS_STARTED', message: 'La clase ya empezó.' };
  if (start - now.getTime() > input.windowDays * 86_400_000) {
    return { ok: false, code: 'BOOKING_TOO_EARLY', message: `Las reservas abren ${input.windowDays} días antes.` };
  }
  if (input.hasLiveReservation) return { ok: false, code: 'ALREADY_BOOKED', message: 'Ya tienes una reserva para esta clase.' };
  return { ok: true, status: input.bookedCount < session.capacity ? 'booked' : 'waitlist' };
}

export type CancelDecision =
  | { ok: true; late: boolean; freesSeat: boolean }
  | { ok: false; code: string; message: string };

/**
 * Cancelación: el socio puede cancelar hasta `minHours` antes del inicio. Pasado ese límite solo
 * el personal puede hacerlo (queda marcada como tardía). Salir de la lista de espera siempre se permite.
 */
export function decideCancel(input: {
  reservationStatus: string;
  startsAt: string;
  now: Date;
  minHours: number;
  byStaff: boolean;
}): CancelDecision {
  if (!['booked', 'waitlist'].includes(input.reservationStatus)) {
    return { ok: false, code: 'NOT_CANCELLABLE', message: 'Esta reserva ya no se puede cancelar.' };
  }
  const msLeft = new Date(input.startsAt).getTime() - input.now.getTime();
  if (input.reservationStatus === 'waitlist') return { ok: true, late: false, freesSeat: false };
  if (msLeft <= 0 && !input.byStaff) return { ok: false, code: 'CLASS_STARTED', message: 'La clase ya empezó.' };
  const late = msLeft < input.minHours * 3_600_000;
  if (late && !input.byStaff) {
    return {
      ok: false,
      code: 'CANCEL_TOO_LATE',
      message: `Solo puedes cancelar hasta ${input.minHours} h antes. Comunícate con recepción.`,
    };
  }
  return { ok: true, late, freesSeat: true };
}

export interface WaitlistEntry { id: number; member_id: number; waitlist_at: string }

/** FIFO: el primero en entrar a la lista de espera es el primero en ser promovido (desempate por id). */
export function orderWaitlist<T extends WaitlistEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.waitlist_at < b.waitlist_at ? -1 : a.waitlist_at > b.waitlist_at ? 1 : a.id - b.id));
}

/**
 * Cuántos de la lista de espera se pueden promover y a quiénes, dados los cupos libres
 * y un filtro de elegibilidad (p. ej. membresía vigente el día de la clase).
 */
export function pickPromotions<T extends WaitlistEntry>(
  waitlist: T[], freeSeats: number, eligible: (e: T) => boolean,
): { promote: T[]; skip: T[] } {
  const promote: T[] = [];
  const skip: T[] = [];
  for (const e of orderWaitlist(waitlist)) {
    if (promote.length >= freeSeats) break;
    (eligible(e) ? promote : skip).push(e);
  }
  return { promote, skip };
}
