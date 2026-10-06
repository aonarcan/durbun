import { distanceKm, type Airport, type FlightRoute, type TrackPoint } from '@durbun/core';
import type { HttpClient } from './kit/http.ts';

/**
 * The whole current flight of one aircraft, fetched when someone selects it.
 *
 * Dürbün itself only remembers positions since it started, so for the part
 * before that it asks:
 * - adsb.lol, whose map keeps a trace of every aircraft for about a day
 *   (open data, ODbL), cut at the start of the current flight;
 * - OpenSky's track of the current flight, only when adsb.lol misses the
 *   take-off or has holes (coverage over inland Anatolia is thin);
 * - adsb.im's route database for the departure and destination airports.
 * Everything is cached, so keeping an aircraft selected costs a handful of
 * requests, not one per update.
 */

const FT_TO_M = 0.3048;

export interface FlightPath {
  points: TrackPoint[];
  /** The path begins on the ground, so it shows the whole flight so far. */
  fromGround: boolean;
  /** When the aircraft left the ground, if the path shows it. */
  takeoffAt?: number;
  route?: FlightRoute;
  /** Which outside sources filled in the path. */
  sources: string[];
}

export interface FlightPathOptions {
  /** Positions Dürbün recorded itself. */
  own: TrackPoint[];
  /** Callsign, for the route; left out for aircraft whose owners asked for privacy. */
  callsign?: string;
  /** Where the aircraft is now. */
  at?: [number, number];
}

export interface FlightPaths {
  path(hex: string, opts: FlightPathOptions): Promise<FlightPath>;
}

/** One history source's view of an aircraft: positions, and when each flight began. */
export interface History {
  points: TrackPoint[];
  legStarts: number[];
}

// ---- adsb.lol traces (readsb format) ----

export interface ReadsbTrace {
  icao: string;
  /** Seconds; each point's first value is an offset from this. */
  timestamp: number;
  /** [offset s, lat, lon, altitude ft | "ground" | null, speed, track, flags, ...] */
  trace: unknown[][];
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function parseTrace(t: ReadsbTrace): History {
  const points: TrackPoint[] = [];
  const legStarts: number[] = [];
  for (const p of t.trace ?? []) {
    const [dt, lat, lon, alt, , , flags] = p;
    if (typeof dt !== 'number' || typeof lat !== 'number' || typeof lon !== 'number') continue;
    const tMs = Math.round((t.timestamp + dt) * 1000);
    const altM = alt === 'ground' ? 0 : typeof alt === 'number' ? Math.max(1, Math.round(alt * FT_TO_M)) : null;
    points.push([round5(lon), round5(lat), tMs, altM]);
    // Flag 2 marks the first point of a new flight ("leg").
    if (typeof flags === 'number' && flags & 2) legStarts.push(tMs);
  }
  return { points, legStarts };
}

// ---- OpenSky tracks ----

export interface OpenSkyTrack {
  icao24: string;
  startTime: number;
  endTime: number;
  /** [time s, lat, lon, barometric altitude m, true track, on ground] */
  path: [number, number | null, number | null, number | null, number | null, boolean][];
}

export function parseOpenSkyTrack(t: OpenSkyTrack): History {
  const points: TrackPoint[] = [];
  for (const [time, lat, lon, alt, , ground] of t.path ?? []) {
    if (lat === null || lon === null) continue;
    // OpenSky sometimes says "not on the ground" on the runway; 0 m or less is the ground anyway.
    points.push([round5(lon), round5(lat), time * 1000, ground || (alt !== null && alt <= 0) ? 0 : alt === null ? null : Math.round(alt)]);
  }
  return { points, legStarts: [t.startTime * 1000] };
}

// ---- where the current flight begins ----

/**
 * When the current flight began: the source's own marker, or else the end of
 * a silence that began on the ground (parked, then a new flight), or of any
 * silence over six hours. Silences in the air are coverage holes, not new flights.
 */
export function legStart(h: History, now: number): number | undefined {
  const pts = h.points.filter((p) => p[2] <= now);
  if (pts.length === 0) return undefined;
  const marked = h.legStarts.filter((t) => t <= now).at(-1);
  let afterGap: number | undefined;
  for (let i = pts.length - 1; i > 0; i--) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const gap = b[2] - a[2];
    if ((gap > 30 * 60_000 && a[3] === 0) || gap > 6 * 3600_000) {
      afterGap = b[2];
      break;
    }
  }
  const found = [marked, afterGap].filter((t): t is number => t !== undefined);
  return found.length ? Math.max(...found) : pts[0]![2];
}

/**
 * For positions without markers (Dürbün's own): the current flight is the
 * last stretch in the air, with the taxiing before it.
 */
export function flightStart(points: TrackPoint[]): number | undefined {
  let i = points.length - 1;
  while (i >= 0 && points[i]![3] === 0) i--; // taxiing in after landing
  if (i < 0) return undefined;
  while (i > 0 && points[i - 1]![3] !== 0) i--; // the flight itself
  while (i > 0 && points[i - 1]![3] === 0 && points[i]![2] - points[i - 1]![2] < 30 * 60_000) i--; // taxiing out
  return points[i]![2];
}

/** Where both sources name a start, the earlier wins unless they are clearly different flights. */
export function combineStarts(starts: (number | undefined)[]): number | undefined {
  const found = starts.filter((t): t is number => t !== undefined);
  if (found.length === 0) return undefined;
  const [lo, hi] = [Math.min(...found), Math.max(...found)];
  return hi - lo > 3 * 3600_000 ? hi : lo;
}

// ---- merging ----

const MAX_KMH = 1400;

/**
 * Positions from all sources since `since`, in time order, without
 * near-duplicates (one per 10 s near the ground, 20 s higher up) or glitches
 * that would need supersonic speed.
 */
export function mergeTracks(lists: TrackPoint[][], since: number): TrackPoint[] {
  const all = lists
    .flat()
    .filter((p) => p[2] >= since)
    .sort((a, b) => a[2] - b[2]);
  const out: TrackPoint[] = [];
  let rejected = 0;
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const last = out[out.length - 1];
    const newest = i === all.length - 1;
    if (last) {
      const dt = p[2] - last[2];
      const low = p[3] !== null && p[3] < 3000;
      if (dt < (low ? 10_000 : 20_000) && !(newest && dt > 0)) continue;
      const km = distanceKm([last[0], last[1]], [p[0], p[1]]);
      // A few glitches in a row are skipped; more than that means the last kept point was the odd one.
      if (km > 5 && km / (Math.max(dt, 1) / 3_600_000) > MAX_KMH && rejected < 3) {
        rejected++;
        continue;
      }
    }
    rejected = 0;
    out.push(p);
  }
  return out;
}

export function hasGap(points: TrackPoint[], ms: number): boolean {
  for (let i = 1; i < points.length; i++) if (points[i]![2] - points[i - 1]![2] > ms) return true;
  return false;
}

// ---- routes (adsb.im) ----

export interface RouteAnswer {
  callsign: string;
  plausible?: boolean | number;
  _airports?: { icao: string; iata?: string; name: string; location?: string; lat: number; lon: number }[];
}

/**
 * Departure and destination from a route answer. Routes with stops list
 * more airports; the leg the aircraft is on is the one it sits closest to.
 */
export function pickRoute(answer: RouteAnswer | undefined, at?: [number, number]): FlightRoute | undefined {
  if (!answer?.plausible || !answer._airports || answer._airports.length < 2) return undefined;
  const airports: Airport[] = answer._airports.map((a) => ({
    icao: a.icao,
    ...(a.iata ? { iata: a.iata } : {}),
    name: a.name,
    ...(a.location ? { city: a.location } : {}),
    lng: a.lon,
    lat: a.lat,
  }));
  let best = 0;
  if (at && airports.length > 2) {
    let bestDetour = Infinity;
    for (let i = 0; i < airports.length - 1; i++) {
      const [a, b] = [airports[i]!, airports[i + 1]!];
      const detour = distanceKm([a.lng, a.lat], at) + distanceKm(at, [b.lng, b.lat]) - distanceKm([a.lng, a.lat], [b.lng, b.lat]);
      if (detour < bestDetour) [best, bestDetour] = [i, detour];
    }
  }
  return { from: airports[best]!, to: airports[best + 1]! };
}

// ---- fetching, with caches ----

interface Cached<T> {
  at: number;
  value?: T;
  pending?: Promise<T | undefined>;
}

const MIN = 60_000;

export class FlightHistory implements FlightPaths {
  private readonly traces = new Map<string, Cached<History>>();
  private readonly openSky = new Map<string, Cached<History>>();
  private readonly routes = new Map<string, Cached<FlightRoute>>();

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => number = Date.now,
    /** How long to wait for the outside sources before answering with what is known. */
    private readonly waitMs = 8000,
  ) {}

  async path(hex: string, opts: FlightPathOptions): Promise<FlightPath> {
    const now = this.now();
    const history = (async () => {
      const lol = await this.cached(this.traces, hex, 3 * MIN, 2 * MIN, () => this.loadTrace(hex));
      // OpenSky only when adsb.lol can't show the whole flight: no start, no take-off, or holes.
      const lolStart = lol ? legStart(lol, now) : undefined;
      const lolPath = lol && lolStart !== undefined ? mergeTracks([lol.points, opts.own], lolStart) : [];
      const needOpenSky = lolPath.length < 2 || lolPath[0]![3] !== 0 || hasGap(lolPath, 5 * MIN);
      const os = needOpenSky ? await this.cached(this.openSky, hex, 15 * MIN, 10 * MIN, () => this.loadOpenSky(hex)) : undefined;
      return { lol, os };
    })();
    const callsign = opts.callsign?.trim();
    const route = callsign
      ? this.cached(this.routes, callsign, 3 * 60 * MIN, 30 * MIN, () => this.loadRoute(callsign, opts.at))
      : Promise.resolve(undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), this.waitMs);
    });
    // Whatever isn't back in time keeps loading into the cache for the next request.
    const [found, r] = await Promise.all([Promise.race([history, timeout]), Promise.race([route, timeout])]);
    clearTimeout(timer);
    const lol = found?.lol;
    const os = found?.os;

    const start =
      combineStarts([lol && legStart(lol, now), os && legStart(os, now)]) ?? flightStart(opts.own) ?? opts.own[0]?.[2] ?? now;
    const points = mergeTracks([lol?.points ?? [], os?.points ?? [], opts.own], start);
    const fromGround = points[0]?.[3] === 0;
    const takeoffAt = fromGround ? points.find((p) => p[3] !== null && p[3] > 0)?.[2] : undefined;
    // A route whose departure is far from where the path leaves the ground belongs to another flight.
    const first = points[0];
    const routeFits = r && !(fromGround && first && distanceKm([first[0], first[1]], [r.from.lng, r.from.lat]) > 40);
    const used = (h: History | undefined) => !!h && h.points.some((p) => p[2] >= start);
    return {
      points,
      fromGround,
      ...(takeoffAt !== undefined ? { takeoffAt } : {}),
      ...(routeFits ? { route: r } : {}),
      sources: [...(used(lol) ? ['adsb.lol'] : []), ...(used(os) ? ['OpenSky'] : [])],
    };
  }

  private async loadTrace(hex: string): Promise<History | undefined> {
    const base = `https://adsb.lol/data/traces/${hex.slice(-2)}/`;
    const get = (name: string) => this.http.getJson<ReadsbTrace>(`${base}${name}_${hex}.json`, { signal: AbortSignal.timeout(15_000) });
    const [full, recent] = await Promise.allSettled([get('trace_full'), get('trace_recent')]);
    const parts = [full, recent].flatMap((r) => (r.status === 'fulfilled' ? [parseTrace(r.value)] : []));
    if (parts.length === 0) return undefined;
    // The two files overlap; keep each moment once, in time order.
    const byTime = new Map(parts.flatMap((p) => p.points).map((p) => [p[2], p]));
    return {
      points: [...byTime.values()].sort((a, b) => a[2] - b[2]),
      legStarts: [...new Set(parts.flatMap((p) => p.legStarts))].sort((a, b) => a - b),
    };
  }

  private async loadOpenSky(hex: string): Promise<History | undefined> {
    const track = await this.http.getJson<OpenSkyTrack | null>(
      `https://opensky-network.org/api/tracks/all?icao24=${hex}&time=0`,
      { signal: AbortSignal.timeout(15_000) },
    );
    return track?.path?.length ? parseOpenSkyTrack(track) : undefined;
  }

  private async loadRoute(callsign: string, at?: [number, number]): Promise<FlightRoute | undefined> {
    const answer = await this.http.postJson<RouteAnswer[]>(
      'https://adsb.im/api/0/routeset',
      { planes: [{ callsign, lat: at?.[1] ?? 0, lng: at?.[0] ?? 0 }] },
      { signal: AbortSignal.timeout(15_000) },
    );
    return pickRoute(answer?.[0], at);
  }

  private cached<T>(
    map: Map<string, Cached<T>>,
    key: string,
    ttl: number,
    failTtl: number,
    load: () => Promise<T | undefined>,
  ): Promise<T | undefined> {
    const now = this.now();
    const hit = map.get(key);
    if (hit?.pending) return hit.pending;
    if (hit && now - hit.at < (hit.value === undefined ? failTtl : ttl)) return Promise.resolve(hit.value);
    if (map.size > 500) {
      for (const [k, c] of map) if (!c.pending && now - c.at > 3 * 3600_000) map.delete(k);
    }
    const pending = load()
      .catch(() => undefined)
      .then((value) => {
        map.set(key, { at: this.now(), ...(value !== undefined ? { value } : {}) });
        return value;
      });
    map.set(key, { at: hit?.at ?? 0, ...(hit?.value !== undefined ? { value: hit.value } : {}), pending });
    return pending;
  }
}
