import type { Feature, LayerSummary } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { shownFeatures, windowFor, windowLabel } from './filters.ts';

const layer = {
  id: 'earthquakes',
  timeWindows: { options: [1, 24, 168], default: 24 },
} as LayerSummary;

const quake = (id: string, observedAt?: string): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [29, 41] },
  properties: { id, layer: 'earthquakes', source: 'afad', title: id, ...(observedAt ? { observedAt } : {}) },
});

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
    expect(shownFeatures(layer, fc, { earthquakes: 1 }, now).map((f) => f.properties.id)).toEqual(['30 min']);
    expect(shownFeatures(layer, fc, {}, now)).toHaveLength(2);
    expect(shownFeatures(layer, fc, { earthquakes: 168 }, now)).toHaveLength(3);
  });

  it('leaves layers without a window alone', () => {
    const other = { id: 'pharmacies' } as LayerSummary;
    expect(shownFeatures(other, fc, {}, now)).toHaveLength(4);
  });

  it('labels windows', () => {
    expect(windowLabel(24, 'tr')).toBe('24 sa');
    expect(windowLabel(72, 'tr')).toBe('3 gün');
    expect(windowLabel(168, 'en')).toBe('7 days');
  });
});
