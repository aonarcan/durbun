import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerEvent } from '@durbun/core';
import type { Store } from './kit/store.ts';

export interface AppOptions {
  store: Store;
  cesiumIonToken: string;
  /** Built web app to serve, if it exists. */
  webDist?: string;
}

/** The HTTP API plus, in production, the built web app. */
export async function buildApp({ store, cesiumIonToken, webDist }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/config', async () => ({ cesiumIonToken }));

  app.get('/api/layers', async () => store.layerSummaries());

  app.get<{ Params: { id: string } }>('/api/layers/:id', async (req, reply) => {
    const fc = store.getCollection(req.params.id);
    if (!fc) return reply.code(404).send({ error: 'Unknown layer' });
    return fc;
  });

  app.get('/api/sources', async () => store.allHealth());

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
