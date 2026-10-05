import { describe, expect, it } from 'vitest';
import { cesiumPitch, mapPitch, metersPerPixel, normaliseBearing, rangeFromZoom, zoomFromRange } from './camera.ts';

describe('camera conversions', () => {
  const fovy = (60 * Math.PI) / 180;

  it('gives about 0.9 m per pixel at zoom 16 in İstanbul', () => {
    expect(metersPerPixel(41, 16)).toBeCloseTo(0.9014, 3);
  });

  it('round-trips zoom through the 3D camera distance', () => {
    for (const zoom of [3, 9.5, 14, 18]) {
      const range = rangeFromZoom(41, zoom, 900, fovy);
      expect(zoomFromRange(41, range, 900, fovy)).toBeCloseTo(zoom, 9);
    }
  });

  it('halves the distance for each zoom level', () => {
    const a = rangeFromZoom(41, 10, 900, fovy);
    const b = rangeFromZoom(41, 11, 900, fovy);
    expect(a / b).toBeCloseTo(2, 9);
  });

  it('maps pitch between the engines and clamps the horizon', () => {
    expect(cesiumPitch(0)).toBe(-90);
    expect(cesiumPitch(60)).toBe(-30);
    expect(mapPitch(-90)).toBe(0);
    expect(mapPitch(-30)).toBe(60);
    expect(mapPitch(10)).toBe(85);
  });

  it('keeps bearings between 0 and 360', () => {
    expect(normaliseBearing(-30)).toBe(330);
    expect(normaliseBearing(370)).toBe(10);
  });
});
