// Dev-only Vite plugin: serve the Vercel `/api` functions inside `npm run dev`.
//
// In production, files under `api/` run as Vercel serverless functions. Plain `vite` has no
// such server, so without this plugin every `/api/*` request 404s. Here we mount a connect
// middleware that maps the URL to the handler file (honouring `[param]` dynamic segments),
// adapts the Node req/res into the minimal VercelRequest/VercelResponse shape the handlers
// use, and invokes the handler's default export via Vite's SSR module loader (so the TS is
// transpiled on the fly). `.env.local` is loaded into process.env for R2/ADMIN_KEY access.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface Route {
  segments: string[]; // e.g. ['projects', '[id]', 'snapshots']
  file: string; // absolute path to the .ts handler
  paramCount: number;
}

/** Recursively collect handler files under `api/`, skipping `_lib` and temp dirs. */
function collectRoutes(apiDir: string, base = '', acc: Route[] = []): Route[] {
  for (const entry of readdirSync(apiDir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = join(apiDir, entry.name);
    if (entry.isDirectory()) {
      collectRoutes(full, `${base}${entry.name}/`, acc);
    } else if (entry.name.endsWith('.ts') && entry.name !== 'tsconfig.json') {
      const rel = `${base}${entry.name.replace(/\.ts$/, '')}`;
      const segments = rel.split('/').filter((s) => s && s !== 'index');
      acc.push({ segments, file: full, paramCount: segments.filter((s) => s.startsWith('[')).length });
    }
  }
  return acc;
}

/** Match a request path's segments to a route, capturing `[param]` values. */
function matchRoute(routes: Route[], pathSegs: string[]): { route: Route; params: Record<string, string> } | null {
  const candidates: { route: Route; params: Record<string, string> }[] = [];
  for (const route of routes) {
    if (route.segments.length !== pathSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < route.segments.length; i++) {
      const r = route.segments[i];
      if (r.startsWith('[') && r.endsWith(']')) params[r.slice(1, -1)] = decodeURIComponent(pathSegs[i]);
      else if (r !== pathSegs[i]) { ok = false; break; }
    }
    if (ok) candidates.push({ route, params });
  }
  // Prefer the most-static match (fewest dynamic params).
  candidates.sort((a, b) => a.route.paramCount - b.route.paramCount);
  return candidates[0] ?? null;
}

function loadEnvLocal(root: string): void {
  const file = resolve(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolvePromise(undefined);
      const ct = String(req.headers['content-type'] ?? '');
      if (ct.includes('application/json')) {
        try { resolvePromise(JSON.parse(data)); } catch { resolvePromise(undefined); }
      } else resolvePromise(data);
    });
    req.on('error', () => resolvePromise(undefined));
  });
}

export function apiDevPlugin(): Plugin {
  return {
    name: 'annotate-audio:api-dev',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      loadEnvLocal(root);
      const apiDir = resolve(root, 'api');
      if (!existsSync(apiDir)) return;
      const routes = collectRoutes(apiDir);

      server.middlewares.use(async (req, res: ServerResponse, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const pathSegs = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
        const matched = matchRoute(routes, pathSegs);
        if (!matched) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: `No API route for ${url.pathname}` }));
        }

        // Build the query object (search params + captured route params).
        const query: Record<string, string | string[]> = { ...matched.params };
        for (const key of url.searchParams.keys()) {
          const all = url.searchParams.getAll(key);
          query[key] = all.length > 1 ? all : all[0];
        }

        const vreq = Object.assign(req, { query, body: await readBody(req) });
        const vres = {
          statusCode: 200,
          setHeader: (k: string, v: string) => res.setHeader(k, v),
          status(code: number) { this.statusCode = code; return this; },
          json(obj: unknown) {
            res.statusCode = this.statusCode;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(obj));
            return this;
          },
          send(payload: unknown) {
            res.statusCode = this.statusCode;
            res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
            return this;
          },
          end(payload?: unknown) {
            res.statusCode = this.statusCode;
            res.end(payload as string | undefined);
            return this;
          },
        };

        try {
          const mod = await server.ssrLoadModule(matched.route.file);
          const handler = mod.default;
          if (typeof handler !== 'function') throw new Error('handler has no default export');
          await handler(vreq, vres);
        } catch (err) {
          server.config.logger.error(`[api-dev] ${url.pathname}: ${(err as Error).stack ?? err}`);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        }
      });
    },
  };
}
