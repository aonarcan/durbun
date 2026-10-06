import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { distanceToAreaKm, insideArea, type MultiPolygonGeometry, type PolygonGeometry } from '@durbun/core';
import { repoRoot } from './config.ts';

/** One of Türkiye's 81 provinces, keyed by its licence-plate code (01 Adana … 81 Düzce). */
export interface Province {
  plate: number;
  name: string;
  geometry: PolygonGeometry | MultiPolygonGeometry;
  /** A point inside the province for labels. */
  label: [number, number];
}

interface ProvinceFile {
  features: {
    geometry: PolygonGeometry | MultiPolygonGeometry;
    properties: { plate: number; name: string; labelLng: number; labelLat: number };
  }[];
}

/** Province outlines from Natural Earth (public domain), simplified to about 1 km. */
export const PROVINCES_FILE = resolve(repoRoot, 'apps/server/data/tr-provinces.geojson');

let cache: Map<number, Province> | undefined;

export function provinces(): Map<number, Province> {
  if (!cache) {
    const file = JSON.parse(readFileSync(PROVINCES_FILE, 'utf8')) as ProvinceFile;
    cache = new Map(
      file.features.map((f) => [
        f.properties.plate,
        {
          plate: f.properties.plate,
          name: f.properties.name,
          geometry: f.geometry,
          label: [f.properties.labelLng, f.properties.labelLat],
        },
      ]),
    );
  }
  return cache;
}

interface Box {
  w: number;
  s: number;
  e: number;
  n: number;
}
let boxes: Map<number, Box> | undefined;

function bounds(geometry: PolygonGeometry | MultiPolygonGeometry): Box {
  const box = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings)
    for (const [x, y] of ring) {
      box.w = Math.min(box.w, x);
      box.e = Math.max(box.e, x);
      box.s = Math.min(box.s, y);
      box.n = Math.max(box.n, y);
    }
  return box;
}

/**
 * The province a point is in, or the nearest one within `withinKm` (for
 * points just off the coast, which the simplified outlines can miss).
 */
export function provinceAt(lng: number, lat: number, withinKm = 0): Province | undefined {
  const all = provinces();
  boxes ??= new Map([...all.values()].map((p) => [p.plate, bounds(p.geometry)]));
  const pad = withinKm / 80; // degrees, generous at Türkiye's latitudes
  let best: { p: Province; km: number } | undefined;
  for (const p of all.values()) {
    const b = boxes.get(p.plate)!;
    if (lng < b.w - pad || lng > b.e + pad || lat < b.s - pad || lat > b.n + pad) continue;
    if (insideArea([lng, lat], p.geometry)) return p;
    if (withinKm > 0) {
      const km = distanceToAreaKm([lng, lat], p.geometry);
      if (km <= withinKm && (!best || km < best.km)) best = { p, km };
    }
  }
  return best?.p;
}
