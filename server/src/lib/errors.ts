/**
 * Error de dominio con forma de respuesta consistente:
 *   { "error": { "code": "MEMBERSHIP_EXPIRED", "message": "…", "details": … } }
 * `message` está en español y es apto para mostrarse al usuario final.
 */
export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} no existe.`);
export const forbidden = (msg = 'No tienes permiso para esta acción.') => new AppError(403, 'FORBIDDEN', msg);
export const unauthorized = (msg = 'Tu sesión expiró. Vuelve a ingresar.') => new AppError(401, 'UNAUTHORIZED', msg);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details);
export const unprocessable = (code: string, msg: string, details?: unknown) => new AppError(422, code, msg, details);

/** Traduce los RAISE(ABORT, 'CODIGO') de los triggers a errores de dominio. */
export function fromSqliteError(err: unknown): AppError | undefined {
  const msg = (err as Error)?.message ?? '';
  if (msg.includes('CLASS_FULL')) return conflict('CLASS_FULL', 'La clase ya no tiene cupos.');
  if (msg.includes('PAYMENT_DELETE_FORBIDDEN')) return conflict('PAYMENT_DELETE_FORBIDDEN', 'Los pagos no se eliminan; anúlalos.');
  if (msg.includes('PAYMENT_IMMUTABLE')) return conflict('PAYMENT_IMMUTABLE', 'El pago ya fue anulado o no puede modificarse.');
  if (msg.includes('UNIQUE constraint failed: reservations')) return conflict('ALREADY_BOOKED', 'Ya tienes una reserva para esta clase.');
  if (msg.includes('UNIQUE constraint failed: members.dni')) return conflict('DNI_TAKEN', 'Ya existe un socio con ese DNI.');
  if (msg.includes('UNIQUE constraint failed: users.email')) return conflict('EMAIL_TAKEN', 'Ese correo ya está registrado.');
  if (msg.includes('UNIQUE constraint failed')) return conflict('DUPLICATE', 'Ya existe un registro con esos datos.');
  if (msg.includes('FOREIGN KEY constraint failed')) return unprocessable('INVALID_REFERENCE', 'Uno de los datos relacionados no existe.');
  return undefined;
}
