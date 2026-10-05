import {
  circlePolygon,
  distanceKm,
  type Feature,
  type MultiPolygonGeometry,
  type PolygonGeometry,
  type Position,
} from '@durbun/core';

/** A province outline as /api/provinces serves it. */
export interface ProvinceFeature {
  type: 'Feature';
  geometry: PolygonGeometry | MultiPolygonGeometry;
  properties: { plate: number; name: string; labelLng: number; labelLat: number };
}

/** Everything the earthquake view shows around one event. */
export interface QuakeFocus {
  id: string;
  centre: [number, number];
  magnitude: number;
  time: number;
  /** Distance rings, smallest first. */
  rings: { km: number; geometry: PolygonGeometry }[];
  /** Radius used to count aftershocks (Gardner–Knopoff window). */
  aftershockKm: number;
  /** Later events inside that radius, oldest first. */
  aftershocks: Feature[];
  /** A larger earlier event this one may be an aftershock of. */
  mainshock?: Feature;
  /** Provinces that reach inside the largest ring, nearest first (0 km = the epicentre's own). */
  provinces: { plate: number; name: string; km: number; geometry: PolygonGeometry | MultiPolygonGeometry }[];
  /** Other live items (traffic notices etc.) inside the largest ring since the event, nearest first. */
  nearby: { feature: Feature; km: number }[];
}

/** Ring radii in km, chosen so the outer ring roughly covers where the event was felt. */
export function ringsFor(magnitude: number): number[] {
  if (magnitude >= 6) return [50, 100, 200];
  if (magnitude >= 4) return [25, 50, 100];
  return [10, 25, 50];
}

/**
 * The distance window Gardner & Knopoff (1974) use to group aftershocks with
 * a main shock: about 30 km for M4, 53 km for M6, 71 km for M7.
 */
export function aftershockRadiusKm(magnitude: number): number {
  return Math.round(10 ** (0.1238 * magnitude + 0.983));
}

/** Gardner & Knopoff's time window in days: about 41 for M4, 144 for M5, 500 for M6 (far longer than the 7 days Dürbün keeps). */
export function aftershockDays(magnitude: number): number {
  return magnitude >= 6.5 ? 10 ** (0.032 * magnitude + 2.7389) : 10 ** (0.5409 * magnitude - 0.547);
}

/** Kilometres from a point to a province: 0 inside it, else to the nearest edge. */
export function distanceToAreaKm(p: [number, number], geometry: PolygonGeometry | MultiPolygonGeometry): number {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  // A flat projection around the point is accurate enough at these distances.
  const kx = 111.32 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (const rings of polygons) {
    if (insidePolygon(p, rings)) return 0;
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!;
        const b = ring[i]!;
        best = Math.min(best, segmentKm(p, a, b, kx, ky));
      }
    }
  }
  return best;
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

/** Even–odd rule over the outer ring and its holes. */
function insidePolygon(p: [number, number], rings: Position[][]): boolean {
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

const timeOf = (f: Feature) => (f.properties.observedAt ? Date.parse(f.properties.observedAt) : NaN);

export function quakeFocus(
  quake: Feature,
  allQuakes: Feature[],
  provinces: ProvinceFeature[],
  others: Feature[],
): QuakeFocus | undefined {
  if (quake.geometry.type !== 'Point') return undefined;
  const centre: [number, number] = [quake.geometry.coordinates[0], quake.geometry.coordinates[1]];
  const magnitude = quake.properties.value ?? 0;
  const time = timeOf(quake);
  const radii = ringsFor(magnitude);
  const reach = radii[radii.length - 1]!;
  const aftershockKm = aftershockRadiusKm(magnitude);

  const pointOf = (f: Feature): [number, number] | undefined =>
    f.geometry.type === 'Point' ? [f.geometry.coordinates[0], f.geometry.coordinates[1]] : undefined;

  const aftershocks = allQuakes
    .filter((f) => {
      const t = timeOf(f);
      const p = pointOf(f);
      return f.properties.id !== quake.properties.id && p && t > time && distanceKm(centre, p) <= aftershockKm;
    })
    .sort((a, b) => timeOf(a) - timeOf(b));

  // The largest earlier, bigger event whose aftershock window this one falls into.
  let mainshock: Feature | undefined;
  for (const f of allQuakes) {
    const m = f.properties.value ?? 0;
    const t = timeOf(f);
    const p = pointOf(f);
    if (!p || m <= magnitude || !(t < time)) continue;
    if (time - t > aftershockDays(m) * 86_400_000 || distanceKm(centre, p) > aftershockRadiusKm(m)) continue;
    if (!mainshock || m > (mainshock.properties.value ?? 0)) mainshock = f;
  }

  const near = provinces
    .map((p) => ({
      plate: p.properties.plate,
      name: p.properties.name,
      geometry: p.geometry,
      km: Math.round(distanceToAreaKm(centre, p.geometry)),
    }))
    .filter((p) => p.km <= reach)
    .sort((a, b) => a.km - b.km || a.name.localeCompare(b.name, 'tr'));

  const nearby = others
    .flatMap((f) => {
      const p = pointOf(f);
      if (!p) return [];
      const t = timeOf(f);
      if (Number.isFinite(t) && Number.isFinite(time) && t < time) return [];
      const km = distanceKm(centre, p);
      return km <= reach ? [{ feature: f, km: Math.round(km * 10) / 10 }] : [];
    })
    .sort((a, b) => a.km - b.km);

  return {
    id: quake.properties.id,
    centre,
    magnitude,
    time,
    rings: radii.map((km) => ({ km, geometry: circlePolygon(centre, km) })),
    aftershockKm,
    aftershocks,
    ...(mainshock ? { mainshock } : {}),
    provinces: near,
    nearby,
  };
}

/** The strongest recent event worth a banner: M4.5 or more in the last six hours. */
export function notableQuake(quakes: Feature[], now = Date.now(), minMagnitude = 4.5, hours = 6): Feature | undefined {
  let best: Feature | undefined;
  for (const f of quakes) {
    const t = timeOf(f);
    const m = f.properties.value ?? 0;
    if (!(t >= now - hours * 3_600_000) || m < minMagnitude) continue;
    if (!best || m > (best.properties.value ?? 0)) best = f;
  }
  return best;
}

/** AFAD's own page for an event. */
export function afadEventUrl(eventId: string): string {
  return `https://deprem.afad.gov.tr/event-detail/${encodeURIComponent(eventId)}`;
}
