# Dürbün

Türkiye için canlı bir harita: trafik, afetler, ulaşım ve daha fazlası, tek ekranda. Kişisel kullanım içindir.

Dürbün is a live map of Türkiye that pulls Turkish public sources (AFAD, İBB and more to come) into one 2D and 3D view. It runs on your own computer and is meant for you and a few friends.

**Stage 1 of 5 (foundation).** What works now:

- Four views: regular map, satellite, night, and a 3D globe that keeps the same place when you switch. In 3D, right-drag rotates and tilts, and buttons on the right do the same.
- Three live sources: AFAD earthquakes (choose the last 1 hour to 7 days), İBB traffic notices in İstanbul, and İstanbul's on-duty pharmacies.
- Directions to a selected pharmacy by car or on foot, drawn on the map, with a link to Google Maps for turn-by-turn navigation.
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
| `CESIUM_ION_TOKEN` | Free Cesium ion token (see below). Adds 3D terrain and 3D buildings. |
| `DISABLED_SOURCES` | Comma-separated source ids to switch off. |

### 3D terrain and buildings (free Cesium ion token)

1. Create a free account at <https://ion.cesium.com/signup>. The free Community plan covers personal, non-commercial use.
2. Open **Access Tokens** in the ion dashboard and copy the **Default** token.
3. Put it in `.env` as `CESIUM_ION_TOKEN=...` and restart with `npm start` (no rebuild needed).

The 3D view then shows terrain and buildings. Pick the buildings at the bottom right of the 3D view:

- **OSM** (default): grey buildings with real heights from OpenStreetMap. This is the one that works in Türkiye.
- **Google**: Google's photorealistic 3D cities. Google has no 3D models for Türkiye, so cities here look flat; it is worth it abroad. If it doesn't load, add **Google Photorealistic 3D Tiles** from the **Asset Depot** in ion. The free plan allows 1,000 Google loads a month.
- **Kapalı**: terrain and imagery only.

### Directions and your location

Directions start from where you are, which the browser shares only on a secure page: `http://localhost:8080` on the computer running Dürbün works; a plain `http://` address from another device does not (use the Google Maps link there). To compute the route, your start point and the destination are sent to FOSSGIS's public OSRM servers. Car times leave out traffic for now; stage 4 adds İstanbul's live speeds, tolls and fuel.

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
| Directions | [FOSSGIS OSRM](https://routing.openstreetmap.de) (OpenStreetMap data) | On request, cached 5 min, at most 20 a minute |

Basemaps: [OpenFreeMap](https://openfreemap.org) (© OpenStreetMap contributors), Esri World Imagery, and CesiumJS for 3D.

## Credits

Dürbün draws on ideas from two MIT-licensed projects: [Osiris](https://github.com/simplifaisoul/osiris) and [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view). See [NOTICE.md](NOTICE.md).
