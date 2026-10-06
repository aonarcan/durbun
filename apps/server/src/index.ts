import { existsSync } from 'node:fs';
import { buildApp } from './app.ts';
import { config, repoRoot } from './config.ts';
import { createHttpClient } from './kit/http.ts';
import { Scheduler } from './kit/scheduler.ts';
import { Store } from './kit/store.ts';
import { createCloudTiles } from './clouds.ts';
import { FlightHistory } from './flights.ts';
import { createRouter } from './routing.ts';
import { layers, sources } from './sources/index.ts';
import { readVersion } from './version.ts';
import { IstanbulTransit } from './transit.ts';
import { RouteShapes, StopLines } from './transit-cache.ts';
import { IzmirBusLines, IzmirTransit } from './sources/izmir.ts';

const store = new Store(layers, sources, config.disabledSources);
const http = createHttpClient(config.userAgent);
const scheduler = new Scheduler(sources, store, http);
const cloudTile = createCloudTiles(http);
const version = readVersion(repoRoot);
const app = await buildApp({
  store,
  cesiumIonToken: config.cesiumIonToken,
  webDist: config.webDist,
  router: createRouter(http),
  cloudTile,
  version,
  flights: new FlightHistory(http),
  transit: new IstanbulTransit(http, new RouteShapes(http, config.cacheDir), new StopLines(http, config.cacheDir)),
  izmir: new IzmirTransit(http, new IzmirBusLines(http, config.cacheDir), () => store.getCollection('bus-stops')?.features ?? []),
  onWake: (layerId) => scheduler.wake(layerId),
});

await app.listen({ port: config.port, host: config.host });
const where = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
const label = [version.branch, version.commit].filter(Boolean).join(' · ');
if (existsSync(config.webDist)) {
  console.log(`Dürbün${label ? ` (${label})` : ''} is running: open ${where}`);
} else {
  console.log(`Dürbün API is running at ${where}/api (no built web app yet: use "npm run dev", or "npm run build" then "npm start")`);
}
if (version.branch && version.branch !== 'main') {
  console.log(`Note: this folder is on the "${version.branch}" branch, not "main", so it won't get updates. To switch: git checkout main, then git pull.`);
}
scheduler.start();
// Keep the cloud pictures fresh while someone is looking at them, so tiles come straight from memory.
const cloudTimer = setInterval(() => void cloudTile.refresh(), 5 * 60_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    scheduler.stop();
    clearInterval(cloudTimer);
    await app.close();
    process.exit(0);
  });
}
