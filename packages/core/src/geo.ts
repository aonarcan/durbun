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

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}

export type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

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
}

export interface Feature<G extends Geometry = Geometry> {
  type: 'Feature';
  id?: string;
  geometry: G;
  properties: FeatureProps;
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
