# Dürbün

Türkiye için canlı bir harita: trafik, afetler, ulaşım ve daha fazlası, tek ekranda. Kişisel kullanım içindir.

Dürbün is a live map of Türkiye that pulls Turkish public sources (AFAD, İBB and more to come) into one 2D and 3D view. It runs on your own computer and is meant for you and a few friends.

**Stage 3 of 5 (public transport), İstanbul part done.** What works now:

- Four views: regular map, satellite, night, and a 3D globe that keeps the same place when you switch. In 3D, right-drag rotates and tilts, and buttons on the right do the same.
- **Earthquakes** from AFAD: pick the last 1 hour to 7 days and a minimum magnitude (all, 2+, 3+, 4+, 5+). Click one for the **earthquake view**: distance rings, the aftershocks recorded since, the provinces within reach, other events nearby, a link to AFAD's page for the event, and a note when it may itself be an aftershock of a bigger one. A strong earthquake (M4.5+ in the last 6 hours) puts a banner at the top of the map.
- **Weather**: MGM's yellow, orange and red warnings on province outlines; current temperature and wind for all 81 province centres; the last two hours of rain radar with a play button; and satellite clouds from Meteosat.
- **Fires**: satellite heat detections from NASA FIRMS for the last 6 to 24 hours, with the province each is in.
- **Aircraft** from adsb.fi and adsb.lol (and OpenSky with a free account), merged so each aircraft appears once, gliding between updates. In 3D they fly at their real altitude.
- **Ships** from AISStream (free key), coloured by type; ships under way are drawn bold, ships at anchor or moored paler.
- **Paths**: aircraft and ships leave a short fading trail. Click an aircraft to see its whole current flight from the stand it left, coloured by altitude, with the departure and destination airports and the rest of the way dotted; stretches nobody saw are dashed. "Tüm yolu göster" fits the whole path on screen. The flight history comes from adsb.lol's traces, with OpenSky filling holes; ship paths are what the server has seen (up to 12 hours).
- **The Straits**: when the İstanbul and Çanakkale straits are open or suspended in each direction today (KEGM), with a timeline and the ships waiting at each end.
- **News**: the latest headlines from 15 Turkish outlets in a **Haberler** tab, with search and an outlet filter; stories that name a province in their headline can also be shown as pins on the map.
- **İstanbul public transport**:
  - **Buses**: every İETT bus live (about 6,000 by day), as dots when zoomed out and pointed icons from street level. Click a bus to see the line it is running now, where it's heading and its nearest stop, with the line's route, stops and other buses drawn on the map, and the operator's notices for that line. The bus feed runs only while someone has the layer on.
  - **Bus stops** (from zoom 14): click one for the lines calling there and the buses on their way ("3 durak önce"); tap a line to draw it.
  - **Metro, tram, funicular, cable car and Marmaray** in their official colours, lines being built dashed, and Metro İstanbul's live service notices (a disrupted line's stations turn yellow). Stations show lifts, escalators and toilets.
  - **Ferry piers** of Şehir Hatları and İDO with opening hours; the ferries themselves are on the Ships layer.
- İBB traffic notices in İstanbul, İstanbul's on-duty pharmacies, and directions to a pharmacy by car or on foot.
- A source status page (`Kaynak durumu`) that shows whether each source is working, how fresh its data is, and its last error.
- Turkish first, English with one click.

The full plan, with the stages still to come, is in the [planning document](https://claude.ai/code/artifact/27cdaa8f-31b9-4e74-b072-f6d303cfc954).

## Run it on your computer

You need **Node.js 22 or newer**. On Windows, install the LTS version from <https://nodejs.org> and open a new terminal afterwards (if `npx` or `npm` is "not recognized", Node.js isn't installed yet).

```sh
git clone https://github.com/aonarcan/durbun.git
cd durbun
npm install
npm start
```

Then open <http://localhost:8080>. The first start builds the web page (about a minute); after that the first data arrives within a few seconds.

### Updating to a new version

Stop Dürbün first (Ctrl+C in its window), then:

```sh
git checkout main
git pull
npm ci
npm start
```

`npm start` rebuilds the web page by itself whenever an update changed it. `git checkout main` makes sure you're on the branch that gets the updates; the server also warns at start-up, and the source status page shows the version, if the folder is on another branch.

`npm ci` installs exactly the versions the repository lists and never rewrites `package-lock.json`, so the next `git pull` won't be blocked by a changed lock file. If a pull does complain about `package-lock.json`, run `git checkout -- package-lock.json` and pull again.

To change settings, copy `.env.example` to `.env` and edit it. Everything is optional:

| Setting | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 8080). |
| `HOST` | `127.0.0.1` (default) keeps it to this computer; `0.0.0.0` lets other devices on your network or Tailscale reach it. |
| `CESIUM_ION_TOKEN` | Free Cesium ion token (see below). Adds 3D terrain and 3D buildings. |
| `AISSTREAM_API_KEY` | Free AISStream key for the Ships layer: sign in at <https://aisstream.io> with GitHub and create one under **API Keys**. |
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | Optional free OpenSky account for more aircraft: on your **Account** page at <https://opensky-network.org>, create an **API client**. |
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
npm test           # unit tests (parsers, scheduler, API, camera maths, earthquake and weather helpers)
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

A source can also return image tiles instead of features (`{ raster: { frames, tileSize, maxzoom, opacity } }`), as the rain radar does; the map then shows the frames as an image layer, with a play button when there is more than one.

## Data sources and fair use

Dürbün is a private, non-commercial tool. Each source is polled gently, identifies itself with a user agent, and is credited on the map.

| Layer | Source | Polled every |
| --- | --- | --- |
| Earthquakes | [AFAD](https://deprem.afad.gov.tr/last-earthquakes) event API | 1 min |
| Traffic notices (İstanbul) | [İBB Ulaşım Yönetim Merkezi](https://uym.ibb.gov.tr/yharita6/) traffic map | 1 min |
| On-duty pharmacies (İstanbul) | İBB pharmacy service | 30 min |
| Weather warnings | [MGM Meteouyarı](https://www.mgm.gov.tr/meteouyari/) (today and tomorrow) | 10 min |
| Current weather, 81 province centres | [MGM](https://www.mgm.gov.tr/) latest observations | 10 min |
| Rain radar | [RainViewer](https://www.rainviewer.com/api.html) public API (free tiles stop at zoom 7, so the radar gets blurry when you zoom in close) | 5 min |
| Clouds | [EUMETSAT EUMETView](https://view.eumetsat.int/) Meteosat 10.8 µm infrared, turned into white clouds on the server; one picture per zoom level covers Türkiye and its neighbours | Every 10 min, only while someone has the layer on |
| Province outlines | [Natural Earth](https://www.naturalearthdata.com/) admin-1 boundaries (public domain) | Bundled |
| Fires | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) public 24-hour files: VIIRS on Suomi NPP, NOAA-20 and NOAA-21, and MODIS | 30 min |
| Aircraft | [adsb.fi](https://adsb.fi) open data (30 s), [adsb.lol](https://adsb.lol) (90 s), [OpenSky](https://opensky-network.org) with a free account (75 s, to stay within its 4,000 daily credits) | |
| Flight paths and routes | [adsb.lol](https://adsb.lol) traces (about a day per aircraft), [OpenSky](https://opensky-network.org) current-flight tracks (only when adsb.lol has holes; no account needed), [adsb.im](https://adsb.im) route database | Only when you click an aircraft; cached 3 min (traces), 15 min (OpenSky), 3 h (routes) |
| Ships | [AISStream](https://aisstream.io) live AIS stream (free key) | Continuous; the map updates every minute |
| Buses (İstanbul) | [İETT](https://data.ibb.gov.tr/dataset/iett-filo-durum-web-servisi) fleet positions (İBB open data) | 30 s, only while someone has the layer on |
| Bus lines, stops and notices | İETT web services on İBB's open-data gateway: stops, lines, the buses and stops of a line, line notices, yesterday's trips (to tell which line a bus runs) | Stops daily; the rest only when you click a bus or stop, cached 20 s to 6 h |
| Bus routes and lines per stop | İBB open data: [İETT route shapes](https://data.ibb.gov.tr/dataset/iett-hat-guzergahlari) and [İETT GTFS](https://data.ibb.gov.tr/dataset/iett-gtfs-verisi) | Downloaded the first time you click a bus or stop (about 260 MB and 30 MB), boiled down into the `cache` folder (about 20 MB), refreshed every two weeks |
| Metro, tram, Marmaray | [Metro İstanbul](https://data.ibb.gov.tr/dataset/metro-istanbul-hat-bilgisi-listesi) lines, stations and service notices; İBB [rail lines](https://data.ibb.gov.tr/dataset/rayli-ulasim-hatlari-vektor-verisi) and [stations](https://data.ibb.gov.tr/dataset/rayli-sistem-istasyon-noktalari-verisi) | Notices 5 min; network daily |
| Ferry piers | İBB traffic map pier list (Şehir Hatları, İDO) | Daily |
| Straits | [Kıyı Emniyeti Genel Müdürlüğü](https://www.kiyiemniyeti.gov.tr/bogaz_trafigi) traffic hours (may answer Turkish connections only) | 5 min |
| News | Public RSS and Atom feeds of Anadolu Ajansı, TRT Haber, BBC Türkçe, DW Türkçe, Euronews Türkçe, Hürriyet, Sabah, Milliyet, Habertürk, NTV, CNN Türk, Sözcü, Cumhuriyet, Halk TV and Medyascope; headline, short snippet and link only | 5 min each |
| Directions | [FOSSGIS OSRM](https://routing.openstreetmap.de) (OpenStreetMap data) | On request, cached 5 min, at most 20 a minute |

A few notes on reading the weather and earthquake layers:

- Warnings that have already started are drawn stronger than those still to come; expired ones disappear. A province is coloured by the highest level any of its districts has.
- The cloud layer is an infrared picture, so it works day and night. On very cold winter nights, frozen ground in the east can show up as thin cloud.
- Earthquake rings show distance from the epicentre, not shaking or damage. Aftershocks are counted inside the Gardner–Knopoff distance for the magnitude (about 30 km for M4, 53 km for M6).

And on the air, sea and news layers:

- A fire detection is a heat anomaly seen from orbit: usually a fire (in autumn, often stubble burning), but factories and gas flares appear too.
- Aircraft and ship coverage depends on volunteer receivers, which are thin over parts of Türkiye; AIS coverage is best around İstanbul and patchy in the Aegean.
- Aircraft whose owners asked for privacy (the FAA's LADD and PIA programmes) are shown without callsign or registration. Military aircraft get no special label.
- Which line a bus runs isn't in İETT's fleet feed. Dürbün looks at the lines the bus ran yesterday and checks each line's live bus list; a bus out of service, or one that wasn't out yesterday, shows no line.
- "N durak önce" counts the stops between a bus and the stop you picked, from the stop İETT says the bus is nearest to; there is no arrival time in İETT's open data. No source gives live metro or tram positions.
- A news pin sits a few kilometres from the province's centre, so pins for one province can be told apart; the place comes from the first province named in the headline, so it is approximate.

Basemaps: [OpenFreeMap](https://openfreemap.org) (© OpenStreetMap contributors), Esri World Imagery, and CesiumJS for 3D.

## Credits

Dürbün draws on ideas from two MIT-licensed projects: [Osiris](https://github.com/simplifaisoul/osiris) and [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view). See [NOTICE.md](NOTICE.md).
