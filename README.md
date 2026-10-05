# Dürbün

Türkiye için canlı bir harita: trafik, afetler, ulaşım ve daha fazlası, tek ekranda. Kişisel kullanım içindir.

Dürbün is a live map of Türkiye that pulls Turkish public sources (AFAD, İBB and more to come) into one 2D and 3D view. It runs on your own computer and is meant for you and a few friends.

**Stage 1 of 5 (foundation).** What works now:

- Four views: regular map, satellite, night, and a 3D globe that keeps the same place when you switch.
- Three live sources: AFAD earthquakes (last 7 days), İBB traffic notices in İstanbul, and İstanbul's on-duty pharmacies.
- A source status page (`Kaynak durumu`) that shows whether each source is working, how fresh its data is, and its last error.
- Turkish first, English with one click.

The full plan, with the stages still to come, is in the [planning document](https://claude.ai/code/artifact/27cdaa8f-31b9-4e74-b072-f6d303cfc954).

## Run it on your computer

You need **Node.js 22 or newer**. On Windows, install the LTS version from <https://nodejs.org> and open a new terminal afterwards (if `npx` or `npm` is "not recognized", Node.js isn't installed yet).

```sh
git clone https://github.com/aonarcan/durbun.git
cd durbun
npm install
npm run build
npm start
```

Then open <http://localhost:8080>. The first data arrives within a few seconds.

To change settings, copy `.env.example` to `.env` and edit it. Everything is optional:

| Setting | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 8080). |
| `HOST` | `127.0.0.1` (default) keeps it to this computer; `0.0.0.0` lets other devices on your network or Tailscale reach it. |
| `CESIUM_ION_TOKEN` | Free token from <https://ion.cesium.com/signup>. Adds 3D terrain and Google's photorealistic 3D cities (1,000 loads a month on the free plan). |
| `DISABLED_SOURCES` | Comma-separated source ids to switch off. |

## Developing

```sh
npm run dev        # server on :8080 plus the web app with hot reload on http://localhost:5173
npm test           # unit tests (parsers, scheduler, API, camera maths)
npm run typecheck  # TypeScript across all packages
```

```
packages/core    shared types: the feature format, layers, source health
apps/server      Fastify API and the collectors (run with tsx, no build step)
  src/kit          source definition, polite HTTP client, scheduler, store
  src/sources      one file per source: fetch + parse into Dürbün features
apps/web         Vite + React app: MapLibre for 2D, CesiumJS for 3D
```

### Adding a source

1. Create `apps/server/src/sources/<name>.ts` exporting a `SourceDefinition`: an id, a Turkish and English name, the layer it feeds, a public homepage, a polling interval, and a `fetch` that returns features.
2. Keep parsing in its own exported function and test it against a saved response in `apps/server/test/fixtures/`.
3. Add it (and a new layer, if needed) to `apps/server/src/sources/index.ts`.
4. It is done when it shows as working on the source status page.

The scheduler handles timeouts (30 s by default), backs off after failures (doubling up to 30 minutes) and keeps the last good data on the map while a source is down.

## Data sources and fair use

Dürbün is a private, non-commercial tool. Each source is polled gently, identifies itself with a user agent, and is credited on the map.

| Layer | Source | Polled every |
| --- | --- | --- |
| Earthquakes | [AFAD](https://deprem.afad.gov.tr/last-earthquakes) event API | 1 min |
| Traffic notices (İstanbul) | [İBB Ulaşım Yönetim Merkezi](https://uym.ibb.gov.tr/yharita6/) traffic map | 1 min |
| On-duty pharmacies (İstanbul) | İBB pharmacy service | 30 min |

Basemaps: [OpenFreeMap](https://openfreemap.org) (© OpenStreetMap contributors), Esri World Imagery, and CesiumJS for 3D.

## Credits

Dürbün draws on ideas from two MIT-licensed projects: [Osiris](https://github.com/simplifaisoul/osiris) and [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view). See [NOTICE.md](NOTICE.md).
