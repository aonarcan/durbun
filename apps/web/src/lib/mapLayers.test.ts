import type { Feature } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import {
  featureCentre,
  focusFeatures,
  greatCircle,
  prepare,
  quakeColor,
  rgba,
  styleLayerIds,
  tailsReachingNow,
  tempColor,
  trackBounds,
  trackFeatures,
  transitFeatures,
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

  it('dashes stretches nobody saw, and draws the route', () => {
    const route = {
      from: { icao: 'LTAI', iata: 'AYT', name: 'Antalya International Airport', city: 'Antalya', lng: 30.8, lat: 36.9 },
      to: { icao: 'EDDP', iata: 'LEJ', name: 'Leipzig Halle Airport', city: 'Leipzig', lng: 12.24, lat: 51.43 },
    };
    const flight: TrackPoint[] = [
      [31.5, 38.0, t0, 9000],
      [31.6, 38.1, t0 + 30_000, 9000],
      [30.0, 40.0, t0 + 30 * 60_000, 11000], // 30 min and 250 km later
      [29.9, 40.1, t0 + 31 * 60_000, 11000],
    ];
    const fc = trackFeatures(flight, 'aircraft', undefined, route, false);
    const parts = fc.features.map((f) => (f.properties as unknown as { part: string }).part);
    expect(parts).toEqual(['path', 'gap', 'path', 'gap', 'plan', 'airport', 'airport']);
    // The unseen climb from Antalya starts on the ground and reaches the first seen point's altitude.
    const climb = fc.features[3]!.geometry!.type === 'LineString' ? fc.features[3]!.geometry!.coordinates : [];
    expect(climb[0]).toEqual([30.8, 36.9, 0]);
    expect(climb.at(-1)).toEqual([31.5, 38, 9000]);
    expect(fc.features[5]!.properties).toMatchObject({ label: 'AYT' });
    // Seen from the ground up: no dashed start.
    const fromGround = trackFeatures([[30.8, 36.9, t0, 0], ...flight], 'aircraft', undefined, route, true);
    expect(fromGround.features.filter((f) => (f.properties as unknown as { part: string }).part === 'gap')).toHaveLength(1);
    expect(trackBounds(flight, route)).toEqual([12.24, 36.9, 31.6, 51.43]);
  });

  it('follows the globe between airports', () => {
    const line = greatCircle([28.71, 41.26], [-73.78, 40.64]); // İstanbul to New York
    expect(line.length).toBeGreaterThan(100);
    // Bowing north over Europe and the Atlantic, well above both ends (about 54°N at most).
    expect(Math.max(...line.map((p) => p[1]))).toBeGreaterThan(53);
    expect(line.at(-1)).toEqual([-73.78, 40.64]);
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

describe('bus lines on the map', () => {
  const line = {
    code: '559C',
    name: 'RUMELİ HİSARÜSTÜ - TAKSİM',
    routes: [
      { direction: 'G' as const, coordinates: [[29.0, 41.08], [29.02, 41.06]] as [number, number][], approximate: false },
      { direction: 'D' as const, coordinates: [[29.02, 41.06], [29.0, 41.08]] as [number, number][], approximate: true },
    ],
    stops: [
      { code: '1', name: 'A', lng: 29.0, lat: 41.08, direction: 'G' as const, order: 1 },
      { code: '2', name: 'B', lng: 29.02, lat: 41.06, direction: 'D' as const, order: 1 },
    ],
    vehicles: [{ id: 'bus:A-010', doorNo: 'A-010', lng: 29.01, lat: 41.07 }],
    notices: [],
  };

  it("draws the bus's direction stronger, its stops, and rings where its buses are now", () => {
    const fc = transitFeatures(line, 'G', (id) => (id === 'bus:A-010' ? [29.011, 41.071] : undefined));
    const props = fc.features.map((f) => f.properties as unknown as Record<string, unknown>);
    expect(props.filter((p) => p.part === 'route').map((p) => [p.strong, p.approximate])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    // Only the stops of the bus's direction, each clickable.
    expect(props.filter((p) => p.part === 'stop').map((p) => p.id)).toEqual(['stop:1']);
    const ring = fc.features.find((f) => (f.properties as unknown as { part: string }).part === 'vehicle')!;
    expect(ring.geometry).toEqual({ type: 'Point', coordinates: [29.011, 41.071] });
    expect(transitFeatures(undefined, undefined, () => undefined).features).toEqual([]);
  });

  it('gives the rail network and buses their own map layers', () => {
    expect(styleLayerIds({ id: 'metro', shape: 'network' })).toEqual(['durbun-metro-line', 'durbun-metro-building', 'durbun-metro-circle', 'durbun-metro-label']);
    expect(styleLayerIds({ id: 'buses' })).toEqual(['durbun-buses-circle', 'durbun-buses-icon']);
  });
});
