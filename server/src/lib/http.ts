import type { Request, Response, Router, NextFunction } from 'express';
import { z, ZodError, type ZodType } from 'zod';
import { AppError, forbidden, fromSqliteError, unauthorized } from './errors.ts';
import { verifyJwt } from './crypto.ts';
import { config } from '../config.ts';
import { clock } from './clock.ts';

z.config(z.locales.es());

export type Role = 'member' | 'reception' | 'trainer' | 'admin';
export const STAFF: Role[] = ['reception', 'trainer', 'admin'];

export interface AuthUser {
  id: number;
  role: Role;
  name: string;
  memberId: number | null;
  branchId: number | null;
}

export interface Ctx<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  user: AuthUser;
  ip: string;
  req: Request;
  res: Response;
}

type AuthRule = Role[] | 'public' | 'any';

export interface RouteDef {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: AuthRule;
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  response?: ZodType;
  status?: number;
  produces?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: Ctx<any, any, any>) => unknown;
}

type Empty = z.ZodObject<{}>;

/** Declara una ruta: validación, roles y documentación OpenAPI salen de la misma definición. */
export function route<P extends ZodType = Empty, Q extends ZodType = Empty, B extends ZodType = z.ZodUnknown>(
  def: Omit<RouteDef, 'handler' | 'params' | 'query' | 'body'> & {
    params?: P;
    query?: Q;
    body?: B;
    handler: (ctx: Ctx<z.output<P>, z.output<Q>, z.output<B>>) => unknown;
  },
): RouteDef {
  return def as RouteDef;
}

export interface AccessClaims {
  sub: number;
  role: Role;
  name: string;
  mid: number | null;
  bid: number | null;
  typ: 'access';
}

function authenticate(req: Request): AuthUser | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const claims = verifyJwt<AccessClaims>(header.slice(7), config.jwtSecret, clock.now().getTime());
  if (!claims || claims.typ !== 'access') return null;
  return { id: claims.sub, role: claims.role, name: claims.name, memberId: claims.mid, branchId: claims.bid };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function mount(router: Router, defs: RouteDef[]): void {
  for (const def of defs) {
    router[def.method](def.path, async (req: Request, res: Response) => {
      const user = authenticate(req);
      if (def.auth !== 'public') {
        if (!user) throw unauthorized();
        if (def.auth !== 'any' && !def.auth.includes(user.role)) throw forbidden();
      }
      const ctx: Ctx<unknown, unknown, unknown> = {
        params: def.params ? def.params.parse(req.params) : req.params,
        query: def.query ? def.query.parse(req.query) : {},
        body: def.body ? def.body.parse(req.body ?? {}) : undefined,
        user: user as AuthUser,
        ip: clientIp(req),
        req,
        res,
      };
      const result = await def.handler(ctx);
      if (res.headersSent) return;
      if (result === undefined) res.status(204).end();
      else res.status(def.status ?? 200).json(result);
    });
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let e: AppError;
  if (err instanceof AppError) e = err;
  else if (err instanceof ZodError) {
    e = new AppError(422, 'VALIDATION_ERROR', 'Revisa los datos ingresados.',
      err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    e = new AppError(400, 'MALFORMED_JSON', 'El cuerpo de la solicitud no es JSON válido.');
  } else if ((err as { type?: string })?.type === 'entity.too.large') {
    e = new AppError(413, 'PAYLOAD_TOO_LARGE', 'La solicitud es demasiado grande.');
  } else {
    e = fromSqliteError(err) ?? new AppError(500, 'INTERNAL', 'Ocurrió un error inesperado. Intenta nuevamente.');
    if (e.status === 500) console.error(`[${req.method} ${req.path}]`, err);
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}

// ---------------------------------------------------------------- OpenAPI

function jsonSchema(schema: ZodType, io: 'input' | 'output') {
  const s = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

export function buildOpenApi(defs: RouteDef[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const d of defs) {
    const path = '/api' + d.path.replace(/:(\w+)/g, '{$1}');
    const parameters: unknown[] = [];
    for (const [loc, schema] of [['path', d.params], ['query', d.query]] as const) {
      if (!schema) continue;
      const js = jsonSchema(schema, 'output') as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, prop] of Object.entries(js.properties ?? {})) {
        parameters.push({ name, in: loc, required: loc === 'path' || (js.required ?? []).includes(name), schema: prop });
      }
    }
    const roles = d.auth === 'public' ? 'público' : d.auth === 'any' ? 'cualquier usuario autenticado' : d.auth.join(', ');
    const okStatus = String(d.status ?? 200);
    paths[path] ??= {};
    paths[path][d.method] = {
      tags: [d.tag],
      summary: d.summary,
      description: `${d.description ? d.description + '\n\n' : ''}**Roles:** ${roles}`,
      ...(d.auth === 'public' ? { security: [] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(d.body ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(d.body, 'input') } } } } : {}),
      responses: {
        [okStatus]: d.produces
          ? { description: 'Archivo', content: { [d.produces]: { schema: { type: 'string', format: 'binary' } } } }
          : { description: 'OK', ...(d.response ? { content: { 'application/json': { schema: jsonSchema(d.response, 'output') } } } : {}) },
        '4XX': { description: 'Error de negocio o validación', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'GymOS API',
      version: '1.0.0',
      description: 'API REST de GymOS. Autenticación con Bearer JWT de corta duración (15 min) y refresh token rotativo en cookie httpOnly. Todos los errores comparten el formato `{ error: { code, message, details? } }`.',
    },
    servers: [{ url: '/' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', example: 'MEMBERSHIP_EXPIRED' },
                message: { type: 'string', example: 'La membresía venció el 10/10/2026.' },
                details: {},
              },
            },
          },
        },
      },
    },
    paths,
  };
}

// --------------------------------------------------------- esquemas comunes
export const idParam = z.object({ id: z.coerce.number().int().positive() }).strict();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD');
export const money = z.number().int('El monto va en céntimos (entero)').positive('El monto debe ser mayor a cero').max(10_000_000);
