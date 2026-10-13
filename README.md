# GymOS

Gestión de gimnasio: acceso por QR, membresías, clases con lista de espera, rutinas y progreso, pagos con comprobante PDF y reportes. Hay cuatro roles: socio, recepción, entrenador y administración.

- Arquitectura, dirección visual, modelo de datos y decisiones de negocio: [docs/arquitectura.md](docs/arquitectura.md)
- Lista de endpoints: [docs/endpoints.md](docs/endpoints.md). La documentación interactiva (OpenAPI) está en `http://localhost:3001/api/docs`.

## Requisitos

- **Node.js 22.18 o superior** (probado con 24). Node ejecuta TypeScript y SQLite de forma nativa, así que no hace falta instalar una base de datos ni compilar el servidor.

## Ejecutar en local

```bash
npm install          # instala server/ y web/ (workspaces)
npm run setup        # crea server/.env con secretos aleatorios (no lo sobrescribe si ya existe)
npm run seed         # base de demostración: borra y recrea server/data/gymos.db (detén el servidor antes)
npm run dev          # API en :3001 y web en :5173
```

Abre **http://localhost:5173**. La pantalla de ingreso muestra las cuentas de demostración en modo desarrollo; todas usan la contraseña **`GymOS-2026`**.

| Rol | Correo | Para probar |
|---|---|---|
| Socio | `socio@gymos.pe` | Plan por vencer en 5 días, pase QR, reservas, modo entrenando, progreso. Mejor en el celular o en una ventana angosta. |
| Recepción | `recepcion@gymos.pe` | Check-in, alta rápida, venta y renovación, caja, anulación de pagos. Pensado para tablet. |
| Entrenador | `entrenador@gymos.pe` | Socios asignados, rutinas, registro de medidas y progreso. |
| Admin | `admin@gymos.pe` | Panel de reportes, planes, horario, sedes, personal, avisos, ajustes y auditoría. |

Para entrar desde el celular en la misma red, ejecuta `npm run dev -w web -- --host` y abre la IP que muestra Vite.

### Probar el check-in

Con la cuenta de recepción, escribe estos DNI en **Check-in**. Cada uno representa un caso borde:

| DNI | Socio | Resultado esperado |
|---|---|---|
| `70223344` | Mateo Flores | Activo: entra |
| `70334455` | Camila Rojas | Vence hoy: entra, con aviso de último día |
| `70445566` | Sebastián Chávez | Vencido hace 3 días: no entra; ofrece renovar |
| `70556677` | Valentina Torres | Congelada: no entra |
| `70667788` | Diego Gutiérrez | Sin plan: no entra; ofrece vender |
| `70778899` | Fiorella Paredes | Con deuda: entra con aviso (configurable) |
| `70889900` | Joaquín Silva | Su plan empieza en 3 días: no entra |
| `70112233` | Lucía Ramírez | Por vencer: entra con aviso |

Para probar el QR, ingresa como socio y abre **Ingreso**. Puedes escanearlo con la cámara de la tablet desde Check-in (en navegadores con `BarcodeDetector`, como Chrome) o con un lector USB, que funciona como teclado. El código caduca en 60 s.

## Pruebas

```bash
npm test             # 72 pruebas: unitarias de reglas de negocio + integración HTTP
npm run typecheck    # tipos de server/ y web/
```

- **Unitarias** (`server/test/unit`):
  - Estados de membresía, incluido el vencimiento el mismo día.
  - Prorrateo y congelamiento.
  - Cupos, lista de espera FIFO y política de cancelación.
  - Fechas y zona horaria.
- **Integración** (`server/test/integration`):
  - Levantan la API sobre una base de datos en memoria con un reloj fijo.
  - **Check-in:** cada estado de membresía, QR vigente, vencido y alterado, y doble escaneo.
  - **Pagos:** pago parcial y deuda, cobro de más, anulación con auditoría y deuda que reaparece, permisos de anulación, y triggers que impiden borrar o editar pagos.
  - **Reservas:** sin sobreventa, sin doble reserva, promoción automática de la lista de espera (saltando a quien ya no tiene plan) y cancelación tardía.
  - **Seguridad:** rotación de sesión, detección de token robado, bloqueo por fuerza bruta, permisos por rol y registro de consultas a datos personales.

## Producción

```bash
npm run build                          # compila web/ a web/dist
NODE_ENV=production npm start          # la API sirve también el frontend compilado en :3001
```

En producción `JWT_SECRET` y `PASS_SECRET` son obligatorios (mínimo 32 caracteres) y la cookie de sesión se marca como `Secure`, así que sirve la app detrás de HTTPS. Para enviar correos de verdad, configura `MAIL_TRANSPORT=smtp` y `SMTP_URL` en `server/.env` e instala `nodemailer` en `server/`. Sin eso, los correos quedan en la bandeja de salida (Admin › Avisos) y se registran en la consola.

Las tareas programadas corren dentro del mismo proceso cada 10 minutos: recordatorios de vencimiento, marcado de “no vino” en clases y despacho de correo.
