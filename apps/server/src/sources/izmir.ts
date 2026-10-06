import { join } from 'node:path';
import {
  isValidLngLat,
  point,
  type Feature,
  type StopAnswer,
  type StopArrival,
  type TransitLine,
  type TransitRoute,
  type TransitStop,
  type TransitVehicle,
} from '@durbun/core';
import { csvRows, csvTable, num, unzipAll } from '../kit/gtfs.ts';
import type { HttpClient } from '../kit/http.ts';
import { Memo } from '../kit/memo.ts';
import type { SourceDefinition } from '../kit/source.ts';
import { CachedBuild, simplify } from '../transit-cache.ts';

/**
 * İzmir's public transport from İzmir Büyükşehir Belediyesi's open data
 * (İzmir BB Açık Veri Lisansı):
 * - ESHOT bus stops (with the lines calling at each) and line routes as CSV files;
 * - the İzmir open API: buses approaching a stop (with stops still to go)
 *   and every bus on a line; İzdeniz ferry piers;
 * - GTFS feeds of Metro İzmir, the trams and İZBAN for the rail network.
 * There is no feed of every bus at once, so İzmir buses appear when a stop
 * or a line is picked.
 */

const API = 'https://openapi.izmir.bel.tr/api';
const FILES = 'https://openfiles.izmir.bel.tr/211488/docs';
export const IZMIR_URLS = {
  stops: `${FILES}/eshot-otobus-duraklari.csv`,
  routes: `${FILES}/eshot-otobus-hat-guzergahlari.csv`,
  notices: `${FILES}/eshot-otobus-hat-duyurulari.csv`,
  busGtfs: 'https://www.eshot.gov.tr/gtfs/bus-eshot-gtfs.zip',
  approaching: (stop: string) => `${API}/iztek/duragayaklasanotobusler/${encodeURIComponent(stop)}`,
  lineBuses: (line: string) => `${API}/iztek/hatotobuskonumlari/${encodeURIComponent(line)}`,
  piers: `${API}/izdeniz/iskeleler`,
};

const TR_OFFSET_MS = 3 * 3600_000;

/** "2026-08-20 15:50:00" (İzmir time) → ms. */
function localTime(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim());
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - TR_OFFSET_MS : NaN;
}

/** "29-30" → ["29", "30"]. */
export const stopLines = (s: string | undefined) =>
  (s ?? '')
    .split(/[-,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

// ---- stops ----

export function izmirStopFeatures(csv: string): Feature[] {
  return csvTable(csv, ';').flatMap((r) => {
    const lat = num(r.ENLEM);
    const lng = num(r.BOYLAM);
    const code = r.DURAK_ID;
    if (!code || !isValidLngLat(lng, lat)) return [];
    const id = `izmir-stop:${code}`;
    const lines = stopLines(r.DURAKTAN_GECEN_HATLAR);
    return [
      {
        type: 'Feature',
        id,
        geometry: point(Number(lng.toFixed(6)), Number(lat.toFixed(6))),
        properties: {
          id,
          layer: 'bus-stops',
          source: 'izmir-stops',
          title: r.DURAK_ADI || code,
          kind: 'stop',
          details: { stopCode: code, city: 'İzmir', lines: lines.join(', ') || null },
        },
      } satisfies Feature,
    ];
  });
}

export const izmirStops: SourceDefinition = {
  id: 'izmir-stops',
  name: { tr: 'ESHOT durakları (İzmir)', en: 'ESHOT bus stops (İzmir)' },
  layer: 'bus-stops',
  homepage: 'https://acikveri.bizizmir.com/dataset/eshot-otobus-duraklari',
  intervalSec: 24 * 3600,
  timeoutSec: 120,
  async fetch({ http, signal }) {
    const features = izmirStopFeatures(await http.getText(IZMIR_URLS.stops, { signal }));
    if (features.length < 1000) throw new Error(`only ${features.length} stops`);
    return features;
  },
};

// ---- İzdeniz piers ----

export interface IzdenizPier {
  IskeleId: number;
  Adi: string;
  Enlem: number | string;
  Boylam: number | string;
  AktifMi?: boolean;
  ArabaliVapurIskelesiMi?: boolean;
}

export function izdenizPierFeatures(list: IzdenizPier[]): Feature[] {
  return list.flatMap((p) => {
    const lat = num(p.Enlem);
    const lng = num(p.Boylam);
    if (p.AktifMi === false || !p.Adi || !isValidLngLat(lng, lat)) return [];
    const id = `izdeniz:${p.IskeleId}`;
    return [
      {
        type: 'Feature',
        id,
        geometry: point(lng, lat),
        properties: {
          id,
          layer: 'piers',
          source: 'izdeniz-piers',
          title: `${p.Adi.trim()} İskelesi`,
          kind: 'izdeniz',
          details: { operator: 'İzdeniz', carFerry: p.ArabaliVapurIskelesiMi ? 'Evet' : null },
        },
      } satisfies Feature,
    ];
  });
}

export const izdenizPiers: SourceDefinition = {
  id: 'izdeniz-piers',
  name: { tr: 'İzdeniz iskeleleri (İzmir)', en: 'İzdeniz piers (İzmir)' },
  layer: 'piers',
  homepage: 'https://acikveri.bizizmir.com/dataset/izdeniz-vapur-iskeleleri',
  intervalSec: 24 * 3600,
  timeoutSec: 60,
  async fetch({ http, signal }) {
    const list = await http.getJson<IzdenizPier[]>(IZMIR_URLS.piers, { signal });
    if (!Array.isArray(list) || list.length === 0) throw new Error('No piers in the answer');
    return izdenizPierFeatures(list);
  },
};

// ---- rail: Metro İzmir, trams, İZBAN (GTFS) ----

interface RailFeed {
  key: string;
  url: string;
  operator: string;
  color: string;
}

export const IZMIR_RAIL_FEEDS: RailFeed[] = [
  { key: 'metro', url: 'https://www.izmirmetro.com.tr/gtfs/rail-metro-gtfs.zip', operator: 'Metro İzmir', color: '#0038ef' },
  { key: 'tram', url: 'https://www.tramizmir.com/gtfs/rail-tramizmir-gtfs.zip', operator: 'İzmir Tramvayı', color: '#ad1457' },
  { key: 'izban', url: 'https://www.izban.com.tr/gtfs/rail-izban-gtfs.zip', operator: 'İZBAN', color: '#3b5b92' },
];

/**
 * A trip's stations without the faults some feeds have: the same station
 * listed several times in a row is kept once, and a trip that comes back to a
 * station it already called at is cut there.
 */
export function cleanStops(stops: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of stops) {
    if (out[out.length - 1] === s) continue;
    if (seen.has(s)) break;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * A rail GTFS feed → one line per route (drawn station to station, as these
 * feeds have no shapes) and its stations. A route's line follows its trip
 * with the most stops; lines that repeat another in reverse are dropped.
 */
export function railFromGtfs(feed: RailFeed, files: Map<string, Buffer>, now: Date): Feature[] {
  const table = (name: string) => {
    const b = files.get(name);
    return b ? csvTable(b.toString('utf8')) : [];
  };
  const stops = new Map(table('stops.txt').map((s) => [s.stop_id!, s]));
  const routes = table('routes.txt');
  const trips = table('trips.txt');
  const sequence = new Map<string, { seq: number; stop: string }[]>();
  for (const st of table('stop_times.txt')) {
    const list = sequence.get(st.trip_id!) ?? [];
    list.push({ seq: Number(st.stop_sequence), stop: st.stop_id! });
    sequence.set(st.trip_id!, list);
  }
  const observedAt = now.toISOString();
  const out: Feature[] = [];
  const stationLines = new Map<string, { names: Set<string>; color: string }>();
  const drawn = new Set<string>();
  for (const r of routes) {
    const ofRoute = trips.filter((t) => t.route_id === r.route_id);
    const longest = ofRoute
      .map((t) => cleanStops((sequence.get(t.trip_id!) ?? []).sort((a, b) => a.seq - b.seq).map((x) => x.stop)))
      .sort((a, b) => b.length - a.length)[0];
    if (!longest || longest.length < 2) continue;
    // The same stations in reverse is the same line.
    const key = [...longest].sort().join('|');
    if (drawn.has(key)) continue;
    drawn.add(key);
    const coords = longest.flatMap((id) => {
      const s = stops.get(id);
      const lng = num(s?.stop_lon);
      const lat = num(s?.stop_lat);
      return s && isValidLngLat(lng, lat) ? [[lng, lat] as [number, number]] : [];
    });
    if (coords.length < 2) continue;
    const color = r.route_color ? `#${r.route_color.replace('#', '').toLowerCase()}` : feed.color;
    const name = r.route_short_name || r.route_long_name || feed.operator;
    const id = `izmir-rail:${feed.key}:${r.route_id}`;
    out.push({
      type: 'Feature',
      id,
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        id,
        layer: 'metro',
        source: 'izmir-rail',
        title: name,
        kind: 'line',
        observedAt,
        style: { color, building: 0, line: name },
        details: { lineName: r.route_long_name || null, operator: feed.operator, city: 'İzmir' },
      },
    });
    for (const sid of longest) {
      const entry = stationLines.get(sid) ?? { names: new Set<string>(), color };
      entry.names.add(r.route_long_name || name);
      stationLines.set(sid, entry);
    }
  }
  for (const [sid, { names, color }] of stationLines) {
    const s = stops.get(sid);
    const lng = num(s?.stop_lon);
    const lat = num(s?.stop_lat);
    if (!s || !isValidLngLat(lng, lat)) continue;
    const id = `izmir-station:${feed.key}:${sid}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(lng, lat),
      properties: {
        id,
        layer: 'metro',
        source: 'izmir-rail',
        title: s.stop_name?.trim() || sid,
        kind: 'station',
        observedAt,
        style: { color, line: feed.operator },
        details: { line: [...names].join(' · '), operator: feed.operator, city: 'İzmir' },
      },
    });
  }
  return out;
}

export const izmirRail: SourceDefinition = {
  id: 'izmir-rail',
  name: { tr: 'Metro İzmir, tramvaylar ve İZBAN', en: 'Metro İzmir, trams and İZBAN' },
  layer: 'metro',
  homepage: 'https://acikveri.bizizmir.com/dataset/toplu-ulasim-gtfs-verileri',
  intervalSec: 24 * 3600,
  timeoutSec: 120,
  async fetch({ http, signal, now }) {
    const parts = await Promise.all(
      IZMIR_RAIL_FEEDS.map(async (feed) => {
        try {
          return railFromGtfs(feed, unzipAll(await http.getBuffer(feed.url, { signal })), now);
        } catch {
          return [];
        }
      }),
    );
    const all = parts.flat();
    if (all.length === 0) throw new Error('No rail feed could be read');
    return all;
  },
};

// ---- ESHOT lines: names and route shapes, built into the cache folder ----

interface IzmirLinesData {
  names: Record<string, string>;
  /** "29:1" (line, direction 1 or 2) → flat [lng, lat, …]. */
  shapes: Record<string, number[]>;
}

export function izmirRouteShapes(csv: string): Record<string, number[]> {
  const raw = new Map<string, [number, number][]>();
  for (const r of csvRows(csv, ';').slice(1)) {
    const [line, dir, lng, lat] = [r[0]?.trim(), r[1]?.trim(), num(r[2]), num(r[3])];
    if (!line || !dir || !isValidLngLat(lng, lat)) continue;
    const key = `${line}:${dir}`;
    const list = raw.get(key) ?? [];
    list.push([lng, lat]);
    raw.set(key, list);
  }
  return Object.fromEntries(
    [...raw].map(([k, pts]) => [k, simplify(pts, 6).flatMap((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5])]),
  );
}

export class IzmirBusLines extends CachedBuild<IzmirLinesData> {
  protected label = 'izmir-bus-lines';

  constructor(http: HttpClient, cacheDir: string, now?: () => number, log?: (line: string) => void) {
    super(http, join(cacheDir, 'izmir-bus-lines.json'), now, log);
  }

  protected async build(): Promise<IzmirLinesData> {
    const signal = AbortSignal.timeout(10 * 60_000);
    const [routes, gtfs] = await Promise.all([
      this.http.getText(IZMIR_URLS.routes, { signal }),
      this.http.getBuffer(IZMIR_URLS.busGtfs, { signal }),
    ]);
    const routesTxt = unzipAll(gtfs).get('routes.txt')?.toString('utf8') ?? '';
    const names = Object.fromEntries(csvTable(routesTxt).map((r) => [r.route_short_name!, r.route_long_name!]));
    const shapes = izmirRouteShapes(routes);
    if (Object.keys(shapes).length < 50) throw new Error(`only ${Object.keys(shapes).length} routes`);
    return { names, shapes };
  }
}

// ---- lookups for the info panel ----

interface Approaching {
  KalanDurakSayisi: number;
  HatNumarasi: number | string;
  HatAdi?: string;
  OtobusId: number | string;
  KoorX?: string;
  KoorY?: string;
}

interface LineBuses {
  HatOtobusKonumlari?: { OtobusId: number | string; Yon?: number; KoorX?: string; KoorY?: string }[];
  HataVarMi?: boolean;
  HataMesaj?: string;
}

export class IzmirTransit {
  private readonly approaching: Memo<Approaching[]>;
  private readonly lineBuses: Memo<TransitVehicle[]>;
  private readonly notices: Memo<{ line: string; text: string; from: number; to: number }[]>;

  constructor(
    private readonly http: HttpClient,
    private readonly lines: Pick<IzmirBusLines, 'within'> | undefined,
    /** İzmir stop features as the map has them (with the lines calling at each). */
    private readonly stops: () => Feature[],
    private readonly now: () => number = Date.now,
  ) {
    this.approaching = new Memo(20_000, now, 20_000);
    this.lineBuses = new Memo(20_000, now, 20_000);
    this.notices = new Memo(30 * 60_000, now);
  }

  /** İzmir's live bus service sometimes hangs for a minute before failing; the panel doesn't wait that long. */
  private signal() {
    return AbortSignal.timeout(12_000);
  }

  private busesOn(line: string): Promise<TransitVehicle[]> {
    return this.lineBuses.get(line, async () => {
      const a = await this.http.getJson<LineBuses>(IZMIR_URLS.lineBuses(line), { signal: this.signal() });
      if (a.HataVarMi) throw new Error(a.HataMesaj || 'İzmir API error');
      const seen = new Set<string>();
      return (a.HatOtobusKonumlari ?? []).flatMap((b) => {
        const id = String(b.OtobusId);
        // KoorX is the latitude, KoorY the longitude, with decimal commas.
        const [lat, lng] = [num(b.KoorX), num(b.KoorY)];
        if (seen.has(id) || !isValidLngLat(lng, lat)) return [];
        seen.add(id);
        return [{ id: `izmir-bus:${id}`, doorNo: id, lng, lat }];
      });
    });
  }

  private lineNotices() {
    return this.notices.get('all', async () =>
      csvTable(await this.http.getText(IZMIR_URLS.notices, { signal: this.signal() }), ';').map((r) => ({
        line: r.HAT_NO ?? '',
        text: (r.BASLIK ?? '').replace(/\s+/g, ' ').trim(),
        from: localTime(r.BASLAMA_TARIHI ?? ''),
        to: localTime(r.BITIS_TARIHI ?? ''),
      })),
    );
  }

  private stopsOf(line: string): TransitStop[] {
    return this.stops().flatMap((f) => {
      if (!f.properties.id.startsWith('izmir-stop:') || f.geometry?.type !== 'Point') return [];
      if (!stopLines(String(f.properties.details?.lines ?? '').replace(/\s/g, '')).includes(line)) return [];
      const [lng, lat] = f.geometry.coordinates;
      return [{ id: f.properties.id, code: String(f.properties.details?.stopCode ?? ''), name: f.properties.title, lng: lng!, lat: lat! }];
    });
  }

  async line(code: string): Promise<TransitLine> {
    const [data, vehicles, notices] = await Promise.all([
      this.lines?.within(3000),
      this.busesOn(code).catch(() => [] as TransitVehicle[]),
      this.lineNotices().catch(() => []),
    ]);
    const now = this.now();
    const routes: TransitRoute[] = (['1', '2'] as const).flatMap((d) => {
      const flat = data?.shapes[`${code}:${d}`];
      if (!flat || flat.length < 4) return [];
      const coordinates: [number, number][] = [];
      for (let i = 0; i < flat.length; i += 2) coordinates.push([flat[i]!, flat[i + 1]!]);
      return [{ direction: d === '1' ? 'G' : 'D', coordinates, approximate: false } satisfies TransitRoute];
    });
    return {
      code,
      name: data?.names[code] ?? code,
      routes,
      stops: this.stopsOf(code),
      vehicles,
      notices: notices.filter((n) => n.line === code && !(n.from > now) && !(n.to < now)).map((n) => n.text),
    };
  }

  async stop(code: string): Promise<StopAnswer> {
    const feature = this.stops().find((f) => f.properties.id === `izmir-stop:${code}`);
    const [data, list] = await Promise.all([
      this.lines?.within(3000),
      this.approaching.get(code, () => this.http.getJson<Approaching[]>(IZMIR_URLS.approaching(code), { signal: this.signal() })).catch(
        () => [] as Approaching[],
      ),
    ]);
    const lines = stopLines(String(feature?.properties.details?.lines ?? '').replace(/\s/g, '')).map((l) => ({
      code: l,
      ...(data?.names[l] ? { name: data.names[l] } : {}),
    }));
    const arrivals: StopArrival[] = (Array.isArray(list) ? list : [])
      .map((a) => ({
        line: String(a.HatNumarasi),
        doorNo: String(a.OtobusId),
        vehicleId: `izmir-bus:${a.OtobusId}`,
        stopsAway: Math.max(0, Number(a.KalanDurakSayisi) || 0),
      }))
      .sort((a, b) => a.stopsAway - b.stopsAway)
      .slice(0, 12);
    return { code, lines, arrivals };
  }
}
