import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MultiPolygonGeometry, PolygonGeometry } from '@durbun/core';
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
