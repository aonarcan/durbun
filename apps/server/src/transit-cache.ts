import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import type { HttpClient } from './kit/http.ts';

/**
 * Two large İBB open-data files, boiled down once and kept on disk:
 * - every İETT route's street-level shape (a 257 MB GeoJSON → about 20 MB),
 * - which lines call at each stop (from the GTFS timetable, 150 MB unzipped → under 1 MB).
 * Each is built in the background the first time it's needed and rebuilt
 * when older than two weeks; until then callers get nothing and fall back.
 */

const MAX_AGE_MS = 14 * 24 * 3600_000;

export const ROUTES_URL =
  'https://data.ibb.gov.tr/dataset/b48d2095-851c-413c-8d36-87d2310a22b5/resource/4ccb4d29-c2b6-414a-b324-d2c9962b18e2/download/iett-hat-guzergahlar-verisi.geojson';
const GTFS = 'https://data.ibb.gov.tr/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource';
export const GTFS_URLS = {
  routes: `${GTFS}/46dbe388-c8c2-45c4-ac72-c06953de56a2/download/routes.csv`,
  trips: `${GTFS}/7ff49bdd-b0d2-4a6e-9392-b598f77f5070/download/trips.csv`,
  stops: `${GTFS}/2299bc82-983b-4bdf-8520-5cef8c555e29/download/stops.csv`,
  stopTimes: `${GTFS}/80401c1c-c240-4a32-8f40-ef697100a681/download/stop_times.zip`,
};

// ---- shapes ----

/** Douglas–Peucker on lng/lat, with the tolerance in metres. */
export function simplify(points: [number, number][], toleranceM: number): [number, number][] {
  if (points.length < 3) return points;
  const kx = 111_320 * Math.cos((points[0]![1] * Math.PI) / 180);
  const ky = 110_570;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = [points[a]![0] * kx, points[a]![1] * ky];
    const [dx, dy] = [points[b]![0] * kx - ax, points[b]![1] * ky - ay];
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = [points[i]![0] * kx - ax, points[i]![1] * ky - ay];
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > best) [best, at] = [d, i];
    }
    if (best > toleranceM) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

interface ShapeFile {
  builtAt: number;
  /** Route code ("500T_G_D0") → flat [lng, lat, lng, lat, …] with 5 decimals. */
  shapes: Record<string, number[]>;
}

/** Reads the route GeoJSON line by line (one feature per line) without holding it all in memory. */
export async function readRouteShapes(lines: AsyncIterable<string>): Promise<Record<string, number[]>> {
  const shapes: Record<string, number[]> = {};
  for await (const raw of lines) {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('{') || !line.includes('"Feature"')) continue;
    let f: { properties?: { GUZERGAH_KODU?: string }; geometry?: { type: string; coordinates: unknown } };
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    const code = f.properties?.GUZERGAH_KODU?.trim();
    if (!code || f.geometry?.type !== 'LineString') continue;
    const coords = (f.geometry.coordinates as [number, number][]).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    shapes[code] = simplify(coords, 6).flatMap((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]);
  }
  return shapes;
}

/** A file in the cache folder, loaded once and rebuilt in the background when missing or old. */
abstract class CachedBuild<T> {
  private data?: T;
  private builtAt = 0;
  private loading?: Promise<void>;
  private lastFailure = 0;

  constructor(
    protected readonly http: HttpClient,
    private readonly file: string,
    protected readonly now: () => number = Date.now,
    private readonly log: (line: string) => void = (l) => console.log(l),
  ) {}

  protected abstract build(): Promise<T>;
  protected abstract label: string;

  /** What is known now; starts loading or rebuilding if needed. */
  current(): T | undefined {
    this.ensure();
    return this.data;
  }

  /** What is known, waiting up to `ms` for a saved file to load (a build from scratch takes longer). */
  async within(ms: number): Promise<T | undefined> {
    const now = this.current();
    if (now !== undefined) return now;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.loading, new Promise((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
    return this.data;
  }

  /** Waits for the first load or build (tests, and callers that can wait). */
  async ready(): Promise<T | undefined> {
    this.ensure();
    await this.loading;
    return this.data;
  }

  private ensure(): void {
    if (this.loading) return;
    const stale = !this.data || this.now() - this.builtAt > MAX_AGE_MS;
    // After a failure, wait ten minutes before trying again.
    if (!stale || this.now() - this.lastFailure < 10 * 60_000) return;
    this.loading = this.load().finally(() => {
      this.loading = undefined;
    });
  }

  private async load(): Promise<void> {
    if (!this.data) {
      try {
        const saved = JSON.parse(await readFile(this.file, 'utf8')) as { builtAt: number; data: T };
        this.data = saved.data;
        this.builtAt = saved.builtAt;
        if (this.now() - this.builtAt <= MAX_AGE_MS) return;
      } catch {
        // Nothing saved yet.
      }
    }
    try {
      const started = this.now();
      this.log(`[${this.label}] building from İBB open data…`);
      const data = await this.build();
      this.data = data;
      this.builtAt = this.now();
      await mkdir(join(this.file, '..'), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify({ builtAt: this.builtAt, data }));
      await rename(`${this.file}.tmp`, this.file);
      this.log(`[${this.label}] ready in ${Math.round((this.now() - started) / 1000)} s`);
    } catch (err) {
      this.lastFailure = this.now();
      this.log(`[${this.label}] failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Street-level shapes of every İETT route variant. */
export class RouteShapes extends CachedBuild<ShapeFile['shapes']> {
  protected label = 'iett-routes';

  constructor(http: HttpClient, cacheDir: string, now?: () => number, log?: (line: string) => void) {
    super(http, join(cacheDir, 'iett-routes.json'), now, log);
  }

  protected async build(): Promise<ShapeFile['shapes']> {
    const res = await this.http.getResponse(ROUTES_URL, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.body) throw new Error('empty download');
    const lines = createInterface({ input: Readable.fromWeb(res.body as never), crlfDelay: Infinity });
    const shapes = await readRouteShapes(lines);
    if (Object.keys(shapes).length < 100) throw new Error(`only ${Object.keys(shapes).length} routes`);
    return shapes;
  }

  /** [lng, lat] points of one route variant, if known. */
  get(code: string): [number, number][] | undefined {
    const flat = this.current()?.[code];
    if (!flat) return undefined;
    const out: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
    return out;
  }
}

// ---- which lines call at each stop ----

/** The first file inside a ZIP archive as a stream, using the central directory for its size. */
export function unzipFirst(zip: Buffer): Readable {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a ZIP file');
  const cd = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad ZIP directory');
  const method = zip.readUInt16LE(cd + 10);
  const compressed = zip.readUInt32LE(cd + 20);
  const local = zip.readUInt32LE(cd + 42);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + compressed);
  if (method === 0) return Readable.from([data]);
  if (method === 8) return Readable.from([data]).pipe(createInflateRaw());
  throw new Error(`unsupported ZIP compression ${method}`);
}

/** A semicolon-separated GTFS file from İBB (with a byte-order mark) → rows. */
function semicolonRows(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split(';'));
}

/**
 * stop_times rows ("trip_id,stop_id,…", one per line) joined to trips →
 * routes and stops → stop code → line codes.
 */
export async function stopLinesFrom(files: {
  routes: string;
  trips: string;
  stops: string;
  stopTimes: AsyncIterable<string>;
}): Promise<Record<string, string[]>> {
  const routeName = new Map(semicolonRows(files.routes).map((r) => [r[0]!, r[2]!.trim()]));
  const tripLine = new Map(semicolonRows(files.trips).map((r) => [r[0]!, routeName.get(r[1]!) ?? '']));
  const stopCode = new Map(semicolonRows(files.stops).map((r) => [r[0]!, r[1]!.trim()]));
  const lines = new Map<string, Set<string>>();
  let header = true;
  for await (const row of files.stopTimes) {
    if (header) {
      header = false;
      continue;
    }
    const c1 = row.indexOf(',');
    const c2 = row.indexOf(',', c1 + 1);
    if (c1 < 0 || c2 < 0) continue;
    const line = tripLine.get(row.slice(0, c1));
    if (!line) continue;
    const id = row.slice(c1 + 1, c2);
    const code = stopCode.get(id) ?? id;
    const set = lines.get(code) ?? new Set<string>();
    set.add(line);
    lines.set(code, set);
  }
  const byCode = (a: string, b: string) => a.localeCompare(b, 'tr', { numeric: true });
  return Object.fromEntries([...lines].map(([code, set]) => [code, [...set].sort(byCode)]));
}

export class StopLines extends CachedBuild<Record<string, string[]>> {
  protected label = 'iett-stop-lines';

  constructor(http: HttpClient, cacheDir: string, now?: () => number, log?: (line: string) => void) {
    super(http, join(cacheDir, 'iett-stop-lines.json'), now, log);
  }

  protected async build(): Promise<Record<string, string[]>> {
    const signal = AbortSignal.timeout(10 * 60_000);
    const [routes, trips, stops, zip] = await Promise.all([
      this.http.getText(GTFS_URLS.routes, { signal }),
      this.http.getText(GTFS_URLS.trips, { signal }),
      this.http.getText(GTFS_URLS.stops, { signal }),
      this.http.getBuffer(GTFS_URLS.stopTimes, { signal }),
    ]);
    const stopTimes = createInterface({ input: unzipFirst(zip), crlfDelay: Infinity });
    const result = await stopLinesFrom({ routes, trips, stops, stopTimes });
    if (Object.keys(result).length < 1000) throw new Error(`only ${Object.keys(result).length} stops`);
    return result;
  }

  /** Lines calling at a stop (by its code), if known. */
  get(code: string): string[] | undefined {
    return this.current()?.[code];
  }
}
