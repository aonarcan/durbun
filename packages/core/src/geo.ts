/**
 * Minimal GeoJSON types plus the one feature shape every collector produces.
 * Collectors normalise each source into this shape so the map, the API and
 * later stages never need to know where a feature came from.
 */

export type Position = [lng: number, lat: number] | [lng: number, lat: number, alt: number];

export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}

export interface MultiLineStringGeometry {
  type: 'MultiLineString';
  coordinates: Position[][];
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}

export type Geometry = PointGeometry | LineStringGeometry | MultiLineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

/** Properties every Dürbün feature carries, whatever its source. */
export interface FeatureProps {
  /** Stable id, unique within its layer (source id + the source's own id). */
  id: string;
  layer: string;
  source: string;
  /** Short Turkish title shown on the map and in the info panel. */
  title: string;
  /** English title when the source provides one. */
  titleEn?: string;
  /** Longer Turkish text. */
  text?: string;
  textEn?: string;
  /** Sub-type within the layer, e.g. "accident" or "roadworks". */
  kind?: string;
  /** When the thing happened or was measured (ISO 8601, UTC). */
  observedAt?: string;
  /** When it stops applying, if the source says (ISO 8601, UTC). */
  validUntil?: string;
  /** Source-specific values shown in the info panel, already human-readable. */
  details?: Record<string, string | number | boolean | null>;
  /** Numeric value used for styling, e.g. earthquake magnitude. */
  value?: number;
  /** Extra flat values the map styles with (e.g. wind direction for an arrow). */
  style?: Record<string, number | string>;
  /** Link to the original item (a news story). */
  url?: string;
  /** Planned states over time, e.g. when each direction of a strait is open. */
  schedule?: ScheduleRow[];
}

/** One row of a schedule: a label (e.g. "Kuzey → Güney") and its periods. */
export interface ScheduleRow {
  label: string;
  periods: { from: string; to: string; state: string }[];
}

export interface Feature<G extends Geometry = Geometry> {
  type: 'Feature';
  id?: string;
  /** Null for items without a place, such as a news story that names no province. */
  geometry: G | null;
  properties: FeatureProps;
}

/** [lng, lat] of a point feature, or undefined for any other shape. */
export function pointOf(f: Feature): [number, number] | undefined {
  return f.geometry?.type === 'Point' ? [f.geometry.coordinates[0], f.geometry.coordinates[1]] : undefined;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

export function point(lng: number, lat: number): PointGeometry {
  return { type: 'Point', coordinates: [lng, lat] };
}

/** True when a coordinate pair is a real position (not 0,0, not NaN, in range). */
export function isValidLngLat(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90 &&
    !(lng === 0 && lat === 0)
  );
}

/** Rough bounding box of Türkiye and its seas, used to sanity-check coordinates. */
export const TURKEY_BOUNDS = { minLng: 25.0, minLat: 35.5, maxLng: 45.5, maxLat: 42.5 } as const;

export function isInTurkey(lng: number, lat: number): boolean {
  return (
    lng >= TURKEY_BOUNDS.minLng &&
    lng <= TURKEY_BOUNDS.maxLng &&
    lat >= TURKEY_BOUNDS.minLat &&
    lat <= TURKEY_BOUNDS.maxLat
  );
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometres. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A circle as a polygon ring of n points, radius in kilometres. */
export function circlePolygon(centre: [number, number], radiusKm: number, n = 96): PolygonGeometry {
  const rad = Math.PI / 180;
  const latR = centre[1] * rad;
  const lngR = centre[0] * rad;
  const d = radiusKm / EARTH_RADIUS_KM;
  const ring: Position[] = [];
  for (let i = 0; i <= n; i++) {
    const brg = (i / n) * 2 * Math.PI;
    const lat = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brg));
    const lng = lngR + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(latR), Math.cos(d) - Math.sin(latR) * Math.sin(lat));
    ring.push([Number((lng / rad).toFixed(5)), Number((lat / rad).toFixed(5))]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/** Kilometres from a point to an area: 0 inside it, else to the nearest edge. */
export function distanceToAreaKm(p: [number, number], geometry: PolygonGeometry | MultiPolygonGeometry): number {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  // A flat projection around the point is accurate enough at these distances.
  const kx = 111.32 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (const rings of polygons) {
    if (insideRings(p, rings)) return 0;
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        best = Math.min(best, segmentKm(p, ring[i - 1]!, ring[i]!, kx, ky));
      }
    }
  }
  return best;
}

/** Whether a point lies inside an area (holes excluded). */
export function insideArea(p: [number, number], geometry: PolygonGeometry | MultiPolygonGeometry): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => insideRings(p, rings));
}

function segmentKm(p: [number, number], a: Position, b: Position, kx: number, ky: number): number {
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Even–odd rule over an outer ring and its holes. */
function insideRings(p: [number, number], rings: Position[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
