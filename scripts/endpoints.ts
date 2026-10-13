// Genera docs/endpoints.md a partir de las rutas declaradas (misma fuente que OpenAPI).
import { writeFileSync } from 'node:fs';
import { allRoutes } from '../server/src/app.ts';

const ROLE: Record<string, string> = { member: 'socio', reception: 'recepción', trainer: 'entrenador', admin: 'admin' };
const byTag = new Map<string, typeof allRoutes>();
for (const r of allRoutes) byTag.set(r.tag, [...(byTag.get(r.tag) ?? []), r]);
let md = `# Endpoints\n\n${allRoutes.length} operaciones bajo \`/api\`. Generado con \`npm run docs:endpoints\`; la especificación completa (esquemas de entrada y salida) está en \`/api/openapi.json\` y se navega en \`/api/docs\`.\n`;
for (const [tag, routes] of byTag) {
  md += `\n## ${tag}\n\n| Método | Ruta | Descripción | Acceso |\n|---|---|---|---|\n`;
  for (const r of routes) {
    const auth = r.auth === 'public' ? 'público' : r.auth === 'any' ? 'cualquier sesión*' : (r.auth as string[]).map((a) => ROLE[a]).join(', ');
    md += `| \`${r.method.toUpperCase()}\` | \`${r.path}\` | ${r.summary} | ${auth} |\n`;
  }
}
md += `\n\* “Cualquier sesión” igual aplica control por datos: un socio solo ve lo suyo, un entrenador solo a sus socios asignados (sin finanzas) y recepción no ve salud ni entrenamiento.\n`;
writeFileSync(new URL('../docs/endpoints.md', import.meta.url), md);
console.log(`docs/endpoints.md: ${allRoutes.length} endpoints`);
