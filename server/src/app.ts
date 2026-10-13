import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount, errorHandler, buildOpenApi, clientIp, type RouteDef } from './lib/http.ts';
import { AppError } from './lib/errors.ts';
import { config } from './config.ts';
import { authRoutes } from './modules/auth.ts';
import { memberRoutes } from './modules/members.ts';
import { membershipRoutes } from './modules/memberships.ts';
import { checkinRoutes } from './modules/checkin.ts';
import { classRoutes } from './modules/classes.ts';
import { paymentRoutes } from './modules/payments.ts';
import { trainingRoutes } from './modules/training.ts';
import { reportRoutes } from './modules/reports.ts';
import { notificationRoutes } from './modules/notifications.ts';
import { adminRoutes } from './modules/admin.ts';

export const allRoutes: RouteDef[] = [
  ...authRoutes, ...memberRoutes, ...membershipRoutes, ...checkinRoutes, ...classRoutes,
  ...paymentRoutes, ...trainingRoutes, ...reportRoutes, ...notificationRoutes, ...adminRoutes,
];

/** Límite global simple por IP (ventana deslizante en memoria). El login tiene además su propio bloqueo. */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, _res: Response, next: NextFunction) => {
    if (config.isTest) return next();
    const ip = clientIp(req), now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => t > now - windowMs);
    list.push(now);
    hits.set(ip, list);
    if (list.length > max) return next(new AppError(429, 'RATE_LIMITED', 'Demasiadas solicitudes. Espera un momento.'));
    if (hits.size > 10_000) hits.clear();
    next();
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=()');
    if (req.path.startsWith('/api/') && req.path !== '/api/docs') res.setHeader('Cache-Control', 'no-store');
    next();
  });

  if (!config.isProd) {
    app.use((req, res, next) => {
      if (req.headers.origin === config.corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
        if (req.method === 'OPTIONS') return res.status(204).end();
      }
      next();
    });
  }

  app.use('/api', rateLimit(600, 60_000));
  app.use('/api', express.json({ limit: '64kb', strict: true }));

  const openapi = buildOpenApi(allRoutes);
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.get('/api/docs', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data:");
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>GymOS API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#ui', persistAuthorization: true });</script></body></html>`);
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  const router = express.Router();
  mount(router, allRoutes);
  app.use('/api', router);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.')));

  // En producción el mismo proceso sirve el frontend compilado.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  if (config.isProd && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
