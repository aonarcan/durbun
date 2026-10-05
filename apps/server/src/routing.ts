import type { LineStringGeometry, RouteResult, TravelMode } from '@durbun/core';
import type { HttpClient } from './kit/http.ts';

/**
 * Directions through FOSSGIS's public OSRM servers (routing.openstreetmap.de),
 * free for light, non-commercial use. Stage 4 replaces this with our own
 * router, which adds tolls, fuel and live İstanbul traffic.
 */

const BASE = 'https://routing.openstreetmap.de';
const PROFILES: Record<TravelMode, string> = { car: 'routed-car', foot: 'routed-foot' };
export const ROUTE_PROVIDER = 'FOSSGIS OSRM · © OpenStreetMap';

export type LngLat = [lng: number, lat: number];

export interface Router {
  route(mode: TravelMode, from: LngLat, to: LngLat): Promise<RouteResult>;
}

export function isTravelMode(value: unknown): value is TravelMode {
  return value === 'car' || value === 'foot';
}

/** "29.05,41.02" → [29.05, 41.02]; undefined unless both numbers are in range. */
export function parseLngLat(value: unknown): LngLat | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(',');
  if (parts.length !== 2) return undefined;
  const [lng, lat] = parts.map((p) => Number(p.trim())) as [number, number];
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return undefined;
  return [lng, lat];
}

export function osrmUrl(mode: TravelMode, from: LngLat, to: LngLat): string {
  const pair = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  return `${BASE}/${PROFILES[mode]}/route/v1/driving/${pair(from)};${pair(to)}?overview=full&geometries=geojson&steps=false`;
}

interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: { distance: number; duration: number; geometry: LineStringGeometry }[];
}

export function parseOsrm(body: OsrmResponse, mode: TravelMode): RouteResult {
  if (body.code !== 'Ok') {
    throw new Error(body.code === 'NoRoute' ? 'No route found' : `Routing failed: ${body.message ?? body.code ?? 'unknown'}`);
  }
  const r = body.routes?.[0];
  if (!r || r.geometry?.type !== 'LineString') throw new Error('No route found');
  return {
    mode,
    distance: r.distance,
    duration: r.duration,
    geometry: { type: 'LineString', coordinates: r.geometry.coordinates },
    provider: ROUTE_PROVIDER,
  };
}

interface CacheEntry {
  at: number;
  result: RouteResult;
}

/**
 * Router with a 5-minute cache and a limit of 20 requests a minute, so a
 * private tool never leans on a shared public service.
 */
export function createRouter(http: HttpClient, now = Date.now): Router {
  const cache = new Map<string, CacheEntry>();
  const recent: number[] = [];
  return {
    async route(mode, from, to) {
      const key = osrmUrl(mode, from, to);
      const t = now();
      const hit = cache.get(key);
      if (hit && t - hit.at < 5 * 60_000) return hit.result;

      while (recent.length && t - recent[0]! > 60_000) recent.shift();
      if (recent.length >= 20) throw Object.assign(new Error('Too many route requests; try again in a minute'), { status: 429 });
      recent.push(t);

      const body = await http.getJson<OsrmResponse>(key, { signal: AbortSignal.timeout(15_000) });
      const result = parseOsrm(body, mode);
      cache.set(key, { at: t, result });
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      return result;
    },
  };
}
