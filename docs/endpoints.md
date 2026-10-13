# Endpoints

88 operaciones bajo `/api`. Generado con `npm run docs:endpoints`; la especificación completa (esquemas de entrada y salida) está en `/api/openapi.json` y se navega en `/api/docs`.

## Autenticación

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `POST` | `/auth/login` | Iniciar sesión | público |
| `POST` | `/auth/refresh` | Renovar access token (rota el refresh token) | público |
| `POST` | `/auth/logout` | Cerrar sesión | público |
| `GET` | `/auth/me` | Usuario actual | cualquier sesión* |
| `POST` | `/auth/change-password` | Cambiar contraseña (cierra otras sesiones) | cualquier sesión* |

## Socios

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/members` | Buscar socios | recepción, entrenador, admin |
| `POST` | `/members` | Alta rápida de socio | recepción, admin |
| `GET` | `/members/:id` | Ficha del socio | cualquier sesión* |
| `PATCH` | `/members/:id` | Actualizar datos del socio | cualquier sesión* |
| `PUT` | `/members/:id/trainer` | Asignar entrenador | recepción, admin |
| `POST` | `/members/:id/account` | Crear acceso a la app para el socio | recepción, admin |
| `GET` | `/me` | Inicio del socio: plan, deuda, próximas clases | socio |

## Membresías

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/plans` | Planes disponibles | cualquier sesión* |
| `GET` | `/members/:id/memberships` | Historial de membresías de un socio | cualquier sesión* |
| `POST` | `/members/:id/memberships` | Vender plan (con pago opcional) | recepción, admin |
| `POST` | `/memberships/:id/renew` | Renovar en un clic (mismo plan, sin huecos) | recepción, admin |
| `GET` | `/memberships/:id/change-plan` | Simular cambio de plan con prorrateo | recepción, admin |
| `POST` | `/memberships/:id/change-plan` | Cambiar de plan (prorrateo) | recepción, admin |
| `POST` | `/memberships/:id/freezes` | Congelar membresía | recepción, admin |
| `POST` | `/memberships/:id/freezes/:freezeId/end` | Reactivar antes de tiempo | recepción, admin |

## Acceso

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/me/pass` | Pase de ingreso QR (rota cada minuto) | socio |
| `POST` | `/checkin` | Registrar ingreso por QR, DNI o selección manual | recepción, admin |
| `GET` | `/checkin/recent` | Últimos ingresos (feed de recepción) | recepción, admin |
| `GET` | `/members/:id/visits` | Historial de visitas de un socio | cualquier sesión* |
| `POST` | `/guest-visits` | Registrar visita de invitado (pase diario, prueba o recorrido) | recepción, admin |
| `GET` | `/guest-visits` | Visitas de invitados del día | recepción, admin |

## Clases

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/classes/sessions` | Calendario de clases (semana) | cualquier sesión* |
| `GET` | `/classes/sessions/:id` | Detalle de clase (con lista de asistentes para el personal) | cualquier sesión* |
| `POST` | `/classes/sessions/:id/book` | Reservar (o entrar a la lista de espera si está llena) | socio, recepción, admin |
| `POST` | `/reservations/:id/cancel` | Cancelar reserva (promueve automáticamente la lista de espera) | socio, recepción, admin |
| `POST` | `/reservations/:id/attendance` | Marcar asistencia | entrenador, recepción, admin |
| `GET` | `/me/reservations` | Mis reservas | socio |
| `POST` | `/classes/sessions/:id/cancel` | Cancelar clase y avisar a los inscritos | entrenador, admin |
| `PATCH` | `/classes/sessions/:id` | Ajustar cupo, sala o entrenador de una sesión | admin |
| `GET` | `/admin/class-types` | Tipos de clase | admin, entrenador, recepción |
| `POST` | `/admin/class-types` | Crear tipo de clase | admin |
| `GET` | `/admin/schedules` | Horario semanal | admin |
| `POST` | `/admin/schedules` | Agregar clase al horario semanal | admin |
| `PATCH` | `/admin/schedules/:id` | Activar o desactivar una clase del horario | admin |

## Pagos

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/payments` | Listar pagos con totales (caja) | recepción, admin |
| `POST` | `/payments` | Registrar pago | recepción, admin |
| `POST` | `/payments/:id/void` | Anular pago (no se borra) | recepción, admin |
| `GET` | `/payments/:id/receipt.pdf` | Descargar comprobante PDF | cualquier sesión* |
| `GET` | `/members/:id/payments` | Pagos y deuda de un socio | cualquier sesión* |

## Reportes

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/reports/income` | Ingresos por periodo y método de pago | admin |
| `GET` | `/reports/overview` | Indicadores principales | admin |
| `GET` | `/reports/heatmap` | Mapa de calor de ingresos (día × hora) | admin, recepción |
| `GET` | `/reports/occupancy` | Ocupación de clases por franja horaria | admin |
| `GET` | `/reports/retention` | Socios que no renovaron | admin, recepción |
| `GET` | `/reports/revenue` | Ingresos proyectados vs. reales por mes | admin |
| `GET` | `/reports/churn` | Churn mensual | admin |

## Entrenamiento

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/exercises` | Biblioteca de ejercicios | cualquier sesión* |
| `POST` | `/exercises` | Agregar ejercicio a la biblioteca | entrenador, admin |
| `GET` | `/routines/templates` | Plantillas de rutina | entrenador, admin |
| `POST` | `/routines` | Crear rutina (plantilla o personalizada) | entrenador, admin |
| `GET` | `/routines/:id` | Ver rutina | cualquier sesión* |
| `PUT` | `/routines/:id` | Editar rutina | entrenador, admin |
| `PATCH` | `/routines/:id` | Archivar o reactivar rutina | entrenador, admin |
| `POST` | `/routines/:id/assign` | Asignar plantilla a un socio (crea una copia editable) | entrenador, admin |
| `GET` | `/members/:id/routines` | Rutinas de un socio | cualquier sesión* |
| `POST` | `/members/:id/workouts` | Empezar sesión de entrenamiento | socio, entrenador, admin |
| `GET` | `/workouts/:id` | Sesión de entrenamiento con plan y referencia anterior | cualquier sesión* |
| `POST` | `/workouts/:id/sets` | Registrar serie | socio, entrenador, admin |
| `DELETE` | `/workouts/:id/sets/:setId` | Deshacer serie | socio, entrenador, admin |
| `POST` | `/workouts/:id/finish` | Terminar sesión | socio, entrenador, admin |
| `GET` | `/members/:id/workouts` | Historial de entrenamientos | cualquier sesión* |
| `GET` | `/members/:id/progress/exercises` | Ejercicios con historial y mejor marca | cualquier sesión* |
| `GET` | `/members/:id/progress/exercises/:exerciseId` | Evolución de un ejercicio (serie temporal) | cualquier sesión* |
| `GET` | `/members/:id/measurements` | Medidas corporales | cualquier sesión* |
| `POST` | `/members/:id/measurements` | Registrar medidas corporales | socio, entrenador, admin |
| `GET` | `/trainer/members` | Mis socios asignados con actividad reciente | entrenador, admin |

## Notificaciones

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/me/notifications` | Mis avisos (socio) | socio |
| `POST` | `/me/notifications/read` | Marcar avisos como leídos | socio |
| `GET` | `/admin/templates` | Plantillas de aviso | admin |
| `PUT` | `/admin/templates/:key` | Editar plantilla | admin |
| `POST` | `/admin/templates/:key/preview` | Vista previa con datos de ejemplo | admin |
| `GET` | `/admin/outbox` | Bandeja de correo saliente | admin |

## Administración

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `POST` | `/admin/plans` | Crear plan | admin |
| `PATCH` | `/admin/plans/:id` | Editar plan (el precio nuevo aplica solo a ventas futuras) | admin |
| `GET` | `/branches` | Sedes | cualquier sesión* |
| `POST` | `/admin/branches` | Crear sede | admin |
| `PATCH` | `/admin/branches/:id` | Editar sede | admin |
| `GET` | `/admin/staff` | Personal | admin, recepción |
| `POST` | `/admin/staff` | Dar de alta personal | admin |
| `PATCH` | `/admin/staff/:id` | Editar o desactivar personal | admin |
| `GET` | `/settings` | Configuración del negocio | cualquier sesión* |
| `PUT` | `/admin/settings` | Actualizar configuración | admin |
| `GET` | `/admin/audit` | Registro de auditoría (incluye consultas de datos personales) | admin |

* “Cualquier sesión” igual aplica control por datos: un socio solo ve lo suyo, un entrenador solo a sus socios asignados (sin finanzas) y recepción no ve salud ni entrenamiento.
