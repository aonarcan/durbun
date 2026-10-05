import type { Feature, LayerSummary } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { minValueFor, minValueLabel, shownFeatures, windowFor, windowLabel, type Filters } from './filters.ts';

const layer = {
  id: 'earthquakes',
  timeWindows: { options: [1, 24, 168], default: 24 },
} as LayerSummary;

const quake = (id: string, observedAt?: string, value?: number): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [29, 41] },
  properties: {
    id,
    layer: 'earthquakes',
    source: 'afad',
    title: id,
    ...(observedAt ? { observedAt } : {}),
    ...(value !== undefined ? { value } : {}),
  },
});

const w = (windows: Record<string, number>): Filters => ({ windows, minValues: {} });

describe('time windows', () => {
  const now = Date.parse('2026-10-05T18:00:00Z');
  const fc = {
    type: 'FeatureCollection' as const,
    features: [
      quake('30 min', '2026-10-05T17:30:00Z'),
      quake('5 h', '2026-10-05T13:00:00Z'),
      quake('3 days', '2026-10-02T18:00:00Z'),
      quake('no time'),
    ],
  };

  it('uses the default until the viewer picks a window', () => {
    expect(windowFor(layer, {})).toBe(24);
    expect(windowFor(layer, { earthquakes: 1 })).toBe(1);
    expect(windowFor(layer, { earthquakes: 5 })).toBe(24); // not an offered option
  });

  it('hides older features', () => {
    expect(shownFeatures(layer, fc, w({ earthquakes: 1 }), now).map((f) => f.properties.id)).toEqual(['30 min']);
    expect(shownFeatures(layer, fc, w({}), now)).toHaveLength(2);
    expect(shownFeatures(layer, fc, w({ earthquakes: 168 }), now)).toHaveLength(3);
  });

  it('leaves layers without a window alone', () => {
    const other = { id: 'pharmacies' } as LayerSummary;
    expect(shownFeatures(other, fc, w({}), now)).toHaveLength(4);
  });

  it('labels windows', () => {
    expect(windowLabel(24, 'tr')).toBe('24 sa');
    expect(windowLabel(72, 'tr')).toBe('3 gün');
    expect(windowLabel(168, 'en')).toBe('7 days');
  });
});

describe('minimum magnitude', () => {
  const now = Date.parse('2026-10-05T18:00:00Z');
  const quakes = {
    ...layer,
    minValue: { label: 'M', options: [0, 2, 3, 4], default: 2 },
  } as LayerSummary;
  const fc = {
    type: 'FeatureCollection' as const,
    features: [
      quake('M1.2', '2026-10-05T17:00:00Z', 1.2),
      quake('M2.0', '2026-10-05T17:00:00Z', 2.0),
      quake('M3.4', '2026-10-05T17:00:00Z', 3.4),
      quake('no value', '2026-10-05T17:00:00Z'),
    ],
  };
  const ids = (min: Record<string, number>) =>
    shownFeatures(quakes, fc, { windows: {}, minValues: min }, now).map((f) => f.properties.id);

  it('uses the default until the viewer picks one', () => {
    expect(minValueFor(quakes, {})).toBe(2);
    expect(minValueFor(quakes, { earthquakes: 7 })).toBe(2);
    expect(ids({})).toEqual(['M2.0', 'M3.4']);
  });

  it('shows everything at zero, including events without a value', () => {
    expect(ids({ earthquakes: 0 })).toHaveLength(4);
    expect(ids({ earthquakes: 3 })).toEqual(['M3.4']);
  });

  it('labels the options', () => {
    expect(minValueLabel(0, 'tr')).toBe('Tümü');
    expect(minValueLabel(3, 'en')).toBe('3+');
  });
});

describe('expiry', () => {
  it('hides features whose end time has passed', () => {
    const now = Date.parse('2026-10-05T18:00:00Z');
    const warning = (id: string, validUntil: string): Feature => ({
      ...quake(id),
      properties: { ...quake(id).properties, validUntil },
    });
    const fc = {
      type: 'FeatureCollection' as const,
      features: [warning('over', '2026-10-05T17:59:00Z'), warning('running', '2026-10-05T19:00:00Z')],
    };
    const shown = shownFeatures({ id: 'weather-warnings' } as LayerSummary, fc, w({}), now);
    expect(shown.map((f) => f.properties.id)).toEqual(['running']);
  });
});
