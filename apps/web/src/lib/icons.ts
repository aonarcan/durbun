import type { Feature } from '@durbun/core';

/**
 * Map symbols drawn on a canvas, shared by the 2D map (as images) and the 3D
 * globe (as billboards). All point up (north) and are turned by the map.
 */

export const PLANE_COLORS = {
  ground: '#7a8394',
  low: '#2ca25f',
  mid: '#1f78b4',
  high: '#6a3d9a',
  emergency: '#e5001b',
} as const;

export type PlaneBand = keyof typeof PLANE_COLORS;

/** Altitude band for colouring: under 10,000 ft, under 25,000 ft, above. */
export function planeBand(kind: string | undefined, altFt: number | undefined): PlaneBand {
  if (kind === 'emergency') return 'emergency';
  if (kind === 'ground') return 'ground';
  const alt = altFt ?? 0;
  return alt < 10_000 ? 'low' : alt < 25_000 ? 'mid' : 'high';
}

export const SHIP_COLORS: Record<string, string> = {
  cargo: '#2f855a',
  tanker: '#c53030',
  passenger: '#2b6cb0',
  highspeed: '#d69e2e',
  fishing: '#dd6b20',
  pleasure: '#b83280',
  service: '#4a5568',
  other: '#718096',
  unknown: '#a0aec0',
};

/** Canvas size in pixels; images are drawn at 2× and shown at half size. */
export const ICON_PX = 44;

function canvas(size = ICON_PX): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
}

/** A plane seen from above, nose up. */
export function planeCanvas(color: string): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.translate(ICON_PX / 2, ICON_PX / 2);
  ctx.scale(ICON_PX / 44, ICON_PX / 44);
  ctx.beginPath();
  // fuselage and wings, in a 44-unit box centred on the origin
  ctx.moveTo(0, -19);
  ctx.bezierCurveTo(2.2, -19, 2.8, -15, 2.8, -11);
  ctx.lineTo(2.8, -4);
  ctx.lineTo(18, 4);
  ctx.lineTo(18, 8);
  ctx.lineTo(2.8, 3.5);
  ctx.lineTo(2.4, 12);
  ctx.lineTo(7, 16);
  ctx.lineTo(7, 19);
  ctx.lineTo(0, 17);
  ctx.lineTo(-7, 19);
  ctx.lineTo(-7, 16);
  ctx.lineTo(-2.4, 12);
  ctx.lineTo(-2.8, 3.5);
  ctx.lineTo(-18, 8);
  ctx.lineTo(-18, 4);
  ctx.lineTo(-2.8, -4);
  ctx.lineTo(-2.8, -11);
  ctx.bezierCurveTo(-2.8, -15, -2.2, -19, 0, -19);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  return c;
}

/** A moving ship: a pointed hull, bow up. A ship at rest: a small round marker. */
export function shipCanvas(color: string, moving: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.translate(ICON_PX / 2, ICON_PX / 2);
  ctx.beginPath();
  if (moving) {
    ctx.moveTo(0, -16);
    ctx.bezierCurveTo(6, -8, 7, -2, 7, 6);
    ctx.lineTo(7, 14);
    ctx.lineTo(-7, 14);
    ctx.lineTo(-7, 6);
    ctx.bezierCurveTo(-7, -2, -6, -8, 0, -16);
  } else {
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
  }
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  return c;
}

export function imageData(c: HTMLCanvasElement): ImageData {
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
}

/** Every image the 2D map needs, by name. */
export function mapImages(): Record<string, HTMLCanvasElement> {
  const images: Record<string, HTMLCanvasElement> = {};
  for (const [band, color] of Object.entries(PLANE_COLORS)) images[`durbun-plane-${band}`] = planeCanvas(color);
  for (const [cat, color] of Object.entries(SHIP_COLORS)) {
    images[`durbun-ship-${cat}`] = shipCanvas(color, true);
    images[`durbun-ship-still-${cat}`] = shipCanvas(color, false);
  }
  return images;
}

/**
 * Where a moving aircraft is likely to be now, from its last position,
 * ground speed and track (at most 90 s ahead, so a lost aircraft doesn't fly off).
 */
export function extrapolate(
  lng: number,
  lat: number,
  speedKn: number | undefined,
  trackDeg: number | undefined,
  seconds: number,
): [number, number] {
  if (!speedKn || trackDeg === undefined || seconds <= 0) return [lng, lat];
  const km = (speedKn * 1.852 * Math.min(seconds, 90)) / 3600;
  const rad = (trackDeg * Math.PI) / 180;
  const dLat = (km * Math.cos(rad)) / 110.57;
  const dLng = (km * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

/** Aircraft features moved to where they probably are now (see extrapolate). */
export function aircraftNow(features: Feature[], now: number): Feature[] {
  return features.map((f) => {
    if (f.geometry?.type !== 'Point' || f.properties.kind !== 'air') return f;
    const t = f.properties.observedAt ? Date.parse(f.properties.observedAt) : NaN;
    if (!Number.isFinite(t)) return f;
    const s = f.properties.style ?? {};
    const [lng, lat] = extrapolate(
      f.geometry.coordinates[0],
      f.geometry.coordinates[1],
      typeof s.speedKn === 'number' ? s.speedKn : undefined,
      typeof s.track === 'number' ? s.track : undefined,
      (now - t) / 1000,
    );
    return { ...f, geometry: { type: 'Point', coordinates: [lng, lat] } };
  });
}
