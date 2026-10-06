import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerEvent } from '@durbun/core';
import type { Store } from './kit/store.ts';
import { PROVINCES_FILE } from './provinces.ts';
import { isTravelMode, parseLngLat, type Router } from './routing.ts';

export interface AppOptions {
  store: Store;
  cesiumIonToken: string;
  /** Directions; /api/route answers 503 without one. */
  router?: Router;
  /** Cloud image tiles; /api/tiles/clouds answers 503 without them. */
  cloudTile?: (z: number, x: number, y: number) => Promise<Buffer>;
  /** Built web app to serve, if it exists. */
  webDist?: string;
}

/** The HTTP API plus, in production, the built web app. */
export async function buildApp({ store, cesiumIonToken, webDist, router, cloudTile }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/config', async () => ({ cesiumIonToken }));

  app.get('/api/layers', async () => store.layerSummaries());

  app.get<{ Params: { id: string } }>('/api/layers/:id', async (req, reply) => {
    const fc = store.getCollection(req.params.id);
    if (!fc) return reply.code(404).send({ error: 'Unknown layer' });
    return fc;
  });

  app.get('/api/sources', async () => store.allHealth());

  // Province outlines for the earthquake view and warnings (Natural Earth, public domain).
  app.get('/api/provinces', async (_req, reply) => {
    reply.header('Content-Type', 'application/geo+json; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(await readFile(PROVINCES_FILE));
  });

  app.get<{ Params: { z: string; x: string; y: string } }>('/api/tiles/clouds/:z/:x/:y', async (req, reply) => {
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map((n) => Number.parseInt(n, 10)) as [number, number, number];
    const valid = [z, x, y].every(Number.isInteger) && z >= 0 && z <= 9 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z;
    if (!valid) return reply.code(400).send({ error: 'Bad tile' });
    if (!cloudTile) return reply.code(503).send({ error: 'Cloud tiles are not available' });
    try {
      const png = await cloudTile(z, x, y);
      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'public, max-age=600');
      return reply.send(png);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Cloud tile failed' });
    }
  });

  app.get<{ Querystring: { from?: string; to?: string; mode?: string } }>('/api/route', async (req, reply) => {
    const from = parseLngLat(req.query.from);
    const to = parseLngLat(req.query.to);
    const mode = req.query.mode ?? 'car';
    if (!from || !to || !isTravelMode(mode)) {
      return reply.code(400).send({ error: 'Use from=lng,lat&to=lng,lat&mode=car|foot' });
    }
    if (!router) return reply.code(503).send({ error: 'Routing is not available' });
    try {
      return await router.route(mode, from, to);
    } catch (err) {
      const status = (err as { status?: number }).status === 429 ? 429 : 502;
      return reply.code(status).send({ error: err instanceof Error ? err.message : 'Routing failed' });
    }
  });

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const send = (event: ServerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    store.on('event', send);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      store.off('event', send);
    });
  });

  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // Single-page app: page paths get index.html; missing files and API paths stay 404.
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0] ?? '';
      if (path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
