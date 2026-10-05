/**
 * One camera, two engines. MapLibre describes the view as centre + zoom +
 * bearing + pitch; CesiumJS as a camera at a distance from a target with a
 * heading and pitch. These conversions keep the same place on screen when
 * switching between 2D and 3D.
 */

export interface CameraState {
  lng: number;
  lat: number;
  zoom: number;
  /** Degrees clockwise from north. */
  bearing: number;
  /** Degrees from straight down (0) towards the horizon (85 max). */
  pitch: number;
}

export const DEFAULT_CAMERA: CameraState = { lng: 29.0, lat: 41.02, zoom: 9.5, bearing: 0, pitch: 0 };

const EARTH_CIRCUMFERENCE = 40_075_016.686;
const TILE_SIZE = 512;
export const MAX_MAP_PITCH = 85;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Ground metres per screen pixel at the given latitude and MapLibre zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos(rad(lat))) / (TILE_SIZE * 2 ** zoom);
}

/** Camera-to-centre distance (m) that shows the same ground height as the 2D map. */
export function rangeFromZoom(lat: number, zoom: number, viewportHeightPx: number, fovyRad: number): number {
  return (viewportHeightPx * metersPerPixel(lat, zoom)) / (2 * Math.tan(fovyRad / 2));
}

/** Inverse of rangeFromZoom. */
export function zoomFromRange(lat: number, range: number, viewportHeightPx: number, fovyRad: number): number {
  const mpp = (2 * range * Math.tan(fovyRad / 2)) / viewportHeightPx;
  return Math.log2((EARTH_CIRCUMFERENCE * Math.cos(rad(lat))) / (TILE_SIZE * mpp));
}

/** MapLibre pitch (0 = down) to Cesium pitch (-90 = down), in degrees. */
export function cesiumPitch(mapPitchDeg: number): number {
  return Math.min(mapPitchDeg, MAX_MAP_PITCH) - 90;
}

/** Cesium pitch (degrees) to MapLibre pitch, clamped to what MapLibre can show. */
export function mapPitch(cesiumPitchDeg: number): number {
  return Math.min(Math.max(cesiumPitchDeg + 90, 0), MAX_MAP_PITCH);
}

export function normaliseBearing(deg: number): number {
  const b = deg % 360;
  return b < 0 ? b + 360 : b;
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, 1), 20);
}
