import { existsSync } from 'node:fs';
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { createHttpClient } from './kit/http.ts';
import { Scheduler } from './kit/scheduler.ts';
import { Store } from './kit/store.ts';
import { layers, sources } from './sources/index.ts';

const store = new Store(layers, sources, config.disabledSources);
const http = createHttpClient(config.userAgent);
const scheduler = new Scheduler(sources, store, http);
const app = await buildApp({ store, cesiumIonToken: config.cesiumIonToken, webDist: config.webDist });

await app.listen({ port: config.port, host: config.host });
const where = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
if (existsSync(config.webDist)) {
  console.log(`Dürbün is running: open ${where}`);
} else {
  console.log(`Dürbün API is running at ${where}/api (no built web app yet: use "npm run dev", or "npm run build" then "npm start")`);
}
scheduler.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    scheduler.stop();
    await app.close();
    process.exit(0);
  });
}
