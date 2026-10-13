/** Reloj inyectable: las pruebas fijan la hora para verificar vencimientos y políticas de tiempo. */
let fixed: Date | null = null;

export const clock = {
  now(): Date {
    return fixed ? new Date(fixed) : new Date();
  },
  set(d: Date | string | null): void {
    fixed = d === null ? null : new Date(d);
  },
};
