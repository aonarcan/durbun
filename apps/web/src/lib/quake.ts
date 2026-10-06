import {
  circlePolygon,
  distanceKm,
  distanceToAreaKm,
  pointOf,
  type Feature,
  type MultiPolygonGeometry,
  type PolygonGeometry,
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

/** Kilometres from a point to a province (0 inside it); shared with the server. */
export { distanceToAreaKm };

const timeOf = (f: Feature) => (f.properties.observedAt ? Date.parse(f.properties.observedAt) : NaN);

export function quakeFocus(
  quake: Feature,
  allQuakes: Feature[],
  provinces: ProvinceFeature[],
  others: Feature[],
): QuakeFocus | undefined {
  const centre = pointOf(quake);
  if (!centre) return undefined;
  const magnitude = quake.properties.value ?? 0;
  const time = timeOf(quake);
  const radii = ringsFor(magnitude);
  const reach = radii[radii.length - 1]!;
  const aftershockKm = aftershockRadiusKm(magnitude);

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
