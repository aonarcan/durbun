import type { Feature } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import {
  afadEventUrl,
  aftershockDays,
  aftershockRadiusKm,
  distanceToAreaKm,
  notableQuake,
  quakeFocus,
  ringsFor,
  type ProvinceFeature,
} from './quake.ts';

const at = (id: string, lng: number, lat: number, m: number, time: string, layer = 'earthquakes'): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { id, layer, source: 'test', title: id, value: m, observedAt: time },
});

// Two square "provinces" side by side: west covers 28–29°E, east 29–30°E, both 40–41°N.
const square = (plate: number, name: string, w: number): ProvinceFeature => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [w, 40],
        [w + 1, 40],
        [w + 1, 41],
        [w, 41],
        [w, 40],
      ],
    ],
  },
  properties: { plate, name, labelLng: w + 0.5, labelLat: 40.5 },
});
const provinces = [square(1, 'Batı', 28), square(2, 'Doğu', 29), square(3, 'Uzak', 33)];

describe('earthquake focus', () => {
  const main = at('main', 28.5, 40.5, 4.8, '2026-10-05T10:00:00Z');
  const quakes = [
    main,
    at('before', 28.5, 40.5, 2.0, '2026-10-05T09:00:00Z'),
    at('after-near', 28.6, 40.5, 2.5, '2026-10-05T11:00:00Z'),
    at('after-near-2', 28.5, 40.6, 3.1, '2026-10-05T10:30:00Z'),
    at('after-far', 31.0, 40.5, 3.0, '2026-10-05T11:00:00Z'),
  ];
  const incidents = [
    at('crash', 28.9, 40.5, 0, '2026-10-05T10:20:00Z', 'incidents'),
    at('old crash', 28.9, 40.5, 0, '2026-10-05T08:00:00Z', 'incidents'),
    at('far crash', 32.0, 40.5, 0, '2026-10-05T10:20:00Z', 'incidents'),
  ];
  const focus = quakeFocus(main, quakes, provinces, incidents)!;

  it('picks rings by magnitude', () => {
    expect(ringsFor(2.5)).toEqual([10, 25, 50]);
    expect(ringsFor(4.8)).toEqual([25, 50, 100]);
    expect(ringsFor(6.1)).toEqual([50, 100, 200]);
    expect(focus.rings.map((r) => r.km)).toEqual([25, 50, 100]);
  });

  it('uses the Gardner–Knopoff distance for aftershocks', () => {
    expect(aftershockRadiusKm(4)).toBe(30);
    expect(aftershockRadiusKm(6)).toBe(53);
    expect(aftershockRadiusKm(7)).toBe(71);
    expect(Math.round(aftershockDays(5))).toBe(144);
  });

  it('lists later events nearby, oldest first', () => {
    expect(focus.aftershocks.map((f) => f.properties.id)).toEqual(['after-near-2', 'after-near']);
    expect(focus.mainshock).toBeUndefined();
  });

  it('points an aftershock back to its main shock', () => {
    const after = quakeFocus(quakes[2]!, quakes, provinces, [])!;
    expect(after.mainshock?.properties.id).toBe('main');
    const far = quakeFocus(quakes[4]!, quakes, provinces, [])!;
    expect(far.mainshock).toBeUndefined();
  });

  it('lists provinces within reach, the epicentre’s own first', () => {
    expect(focus.provinces.map((p) => [p.name, p.km])).toEqual([
      ['Batı', 0],
      ['Doğu', 42],
    ]);
  });

  it('lists other items nearby that came after the event', () => {
    expect(focus.nearby.map((n) => n.feature.properties.id)).toEqual(['crash']);
    expect(focus.nearby[0]!.km).toBeCloseTo(33.9, 0);
  });
});

describe('distance to a province', () => {
  it('is zero inside and to the nearest edge outside', () => {
    const p = provinces[0]!.geometry;
    expect(distanceToAreaKm([28.5, 40.5], p)).toBe(0);
    expect(distanceToAreaKm([27.5, 40.5], p)).toBeCloseTo(42.3, 0);
    expect(distanceToAreaKm([28.5, 41.5], p)).toBeCloseTo(55.3, 0);
  });
});

describe('banner for a notable earthquake', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  it('finds the strongest M4.5+ of the last six hours', () => {
    const list = [
      at('small', 28, 40, 3.9, '2026-10-05T11:00:00Z'),
      at('notable', 28, 40, 4.6, '2026-10-05T09:00:00Z'),
      at('bigger', 28, 40, 5.2, '2026-10-05T07:00:00Z'),
      at('old', 28, 40, 6.0, '2026-10-05T05:00:00Z'),
    ];
    expect(notableQuake(list, now)?.properties.id).toBe('bigger');
    expect(notableQuake(list.slice(0, 1), now)).toBeUndefined();
  });

  it('links to AFAD’s event page', () => {
    expect(afadEventUrl('730562')).toBe('https://deprem.afad.gov.tr/event-detail/730562');
  });
});
