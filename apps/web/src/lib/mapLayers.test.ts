import type { Feature } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import {
  featureCentre,
  focusFeatures,
  prepare,
  quakeColor,
  rgba,
  styleLayerIds,
  tailsReachingNow,
  tempColor,
  trackFeatures,
  trackStats,
  type TrackPoint,
} from './mapLayers.ts';
import { quakeFocus } from './quake.ts';

const now = Date.parse('2026-10-05T12:00:00Z');

describe('preparing features for the map', () => {
  it('flattens style values, drops details and works out age and whether a warning has started', () => {
    const f: Feature = {
      type: 'Feature',
      id: 'x',
      geometry: { type: 'Point', coordinates: [29, 41] },
      properties: {
        id: 'x',
        layer: 'weather-now',
        source: 's',
        title: 't',
        observedAt: '2026-10-05T10:00:00Z',
        style: { windDir: 90, windKmh: 12 },
        details: { a: 1 },
      },
    };
    const later = { ...f, properties: { ...f.properties, observedAt: '2026-10-05T15:00:00Z' } };
    const [p, q] = prepare([f, later], now).features.map((x) => x.properties as unknown as Record<string, unknown>);
    expect(p).toMatchObject({ s_windDir: 90, s_windKmh: 12, ageHours: 2, active: 1 });
    expect(p).not.toHaveProperty('details');
    expect(p).not.toHaveProperty('style');
    expect(q!.active).toBe(0);
  });
});

describe('colours', () => {
  it('scales temperature from blue to red', () => {
    expect(tempColor(-30)).toBe('#3f2a8c');
    expect(tempColor(15)).toBe('#3f9a5a');
    expect(tempColor(50)).toBe('#8e1a1a');
    expect(tempColor(undefined)).toBe('#7a8394');
    expect(tempColor(10)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('fades earthquakes with age', () => {
    expect(quakeColor(0.5)).toBe('#a50f15');
    expect(quakeColor(5)).toBe('#e34a33');
    expect(quakeColor(100)).toBe('#fdbb84');
  });
});

describe('layer helpers', () => {
  it('names style layers by shape', () => {
    expect(styleLayerIds({ id: 'weather-warnings', shape: 'areas' })).toEqual([
      'durbun-weather-warnings-fill',
      'durbun-weather-warnings-line',
    ]);
    expect(styleLayerIds({ id: 'radar', raster: { frames: [], tileSize: 256, maxzoom: 7, opacity: 1 } })).toEqual([]);
  });

  it('finds the middle of an area to fly to', () => {
    const area: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [28, 40],
            [30, 40],
            [30, 42],
            [28, 40],
          ],
        ],
      },
      properties: { id: 'a', layer: 'l', source: 's', title: 'a' },
    };
    expect(featureCentre(area)).toEqual({ lng: 29, lat: 41, area: true });
  });

  it('draws rings with labels due north, aftershocks and the epicentre', () => {
    const quake: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [29, 40] },
      properties: { id: 'q', layer: 'earthquakes', source: 's', title: 'q', value: 4.2, observedAt: '2026-10-05T10:00:00Z' },
    };
    const fc = focusFeatures(quakeFocus(quake, [quake], [], []));
    const parts = fc.features.map((f) => (f.properties as unknown as { part: string }).part);
    expect(parts.filter((p) => p === 'ring')).toHaveLength(3);
    expect(parts.at(-1)).toBe('main');
    const label = fc.features.find((f) => (f.properties as unknown as { part: string }).part === 'ring-label')!;
    expect(label.geometry!.coordinates[0]).toBeCloseTo(29, 4);
    expect(focusFeatures(undefined).features).toHaveLength(0);
  });
});

describe('paths', () => {
  const t0 = Date.parse('2026-10-06T08:00:00Z');
  const pts: TrackPoint[] = [
    [29, 41, t0, 0],
    [29.1, 41, t0 + 60_000, 2000],
    [29.2, 41, t0 + 120_000, 9000],
  ];

  it('colours an aircraft path by altitude, piece by piece', () => {
    const fc = trackFeatures(pts, 'aircraft');
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => (f.properties as unknown as { color: string }).color)).toEqual(['#2ca25f', '#6a3d9a']);
    // A ship path is one line; with the current position it gains a point.
    const ship = trackFeatures(pts, 'ships', [29.25, 41]);
    expect(ship.features).toHaveLength(1);
    expect(ship.features[0]!.geometry!.type === 'LineString' && ship.features[0]!.geometry!.coordinates).toHaveLength(4);
    expect(trackFeatures(pts.slice(0, 1), 'aircraft').features).toEqual([]);
  });

  it('measures a path', () => {
    const { km, ms } = trackStats(pts);
    expect(ms).toBe(120_000);
    expect(km).toBeCloseTo(16.8, 0);
  });

  it('extends trails to where each item is now, and drops trails of hidden items', () => {
    const tails = {
      type: 'FeatureCollection' as const,
      features: ['a', 'b'].map((id) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: [[29, 41], [29.1, 41]] as [number, number][] },
        properties: { id, layer: 'aircraft', source: 'tracks', title: id },
      })),
    };
    const now: Feature[] = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [29.15, 41] }, properties: { id: 'a', layer: 'aircraft', source: 's', title: 'a' } },
    ];
    const out = tailsReachingNow(tails, now);
    expect(out.features).toHaveLength(1);
    expect(out.features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [[29, 41], [29.1, 41], [29.15, 41]] });
  });

  it('writes colours with transparency', () => {
    expect(rgba('#1f78b4', 0.5)).toBe('rgba(31, 120, 180, 0.5)');
  });
});
