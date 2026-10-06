import { point, type Feature } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { LayerDefinition, SourceDefinition } from '../src/kit/source.ts';
import { Store } from '../src/kit/store.ts';
import { TrackStore } from '../src/kit/tracks.ts';

const t0 = Date.parse('2026-10-06T08:00:00Z');
const plane = (id: string, lng: number, lat: number, at: number, altM = 3000): Feature => ({
  type: 'Feature',
  geometry: point(lng, lat),
  properties: {
    id,
    layer: 'aircraft',
    source: 's',
    title: id,
    observedAt: new Date(at).toISOString(),
    style: { altM },
  },
});

describe('tracks', () => {
  it('records new positions, skips repeats and forgets old ones', () => {
    const tracks = new TrackStore(new Map([['aircraft', 60 * 60_000]]));
    tracks.record('aircraft', [plane('a', 29, 41, t0)], t0);
    tracks.record('aircraft', [plane('a', 29, 41, t0)], t0 + 1000); // same report again
    tracks.record('aircraft', [plane('a', 29.0001, 41, t0 + 30_000)], t0 + 30_000); // moved 8 m
    tracks.record('aircraft', [plane('a', 29.1, 41, t0 + 60_000, 3500)], t0 + 60_000);
    expect(tracks.track('a')).toEqual([
      [29, 41, t0, 3000],
      [29.1, 41, t0 + 60_000, 3500],
    ]);
    // An hour later the first point is gone; two hours later the whole track.
    tracks.record('aircraft', [], t0 + 60 * 60_000 + 30_000);
    expect(tracks.track('a')).toHaveLength(1);
    tracks.record('aircraft', [], t0 + 3 * 60 * 60_000);
    expect(tracks.track('a')).toBeUndefined();
  });

  it('draws short trails for items that moved recently', () => {
    const tracks = new TrackStore(new Map([['aircraft', 60 * 60_000]]));
    for (let i = 0; i < 10; i++) {
      tracks.record('aircraft', [plane('a', 29 + i * 0.05, 41, t0 + i * 30_000), plane('b', 33, 40, t0)], t0 + i * 30_000);
    }
    const tails = tracks.tails('aircraft', 2, t0 + 9 * 30_000);
    expect(tails).toHaveLength(1); // b never moved
    expect(tails[0]!.properties.id).toBe('a');
    // The last two minutes: points at 2:30 … 4:30, with altitude.
    expect(tails[0]!.geometry).toEqual({
      type: 'LineString',
      coordinates: [5, 6, 7, 8, 9].map((i) => [Number((29 + i * 0.05).toFixed(10)), 41, 3000]),
    });
  });

  it('serves trails and paths from the store', async () => {
    const layer: LayerDefinition = {
      id: 'aircraft',
      name: { tr: 'Uçaklar', en: 'Aircraft' },
      group: 'air-sea',
      color: '#000',
      defaultOn: false,
      attribution: 'x',
      tracks: { keepMinutes: 60, tailMinutes: 5 },
    };
    const src: SourceDefinition = {
      id: 's',
      name: { tr: 's', en: 's' },
      layer: 'aircraft',
      homepage: 'https://example.org',
      intervalSec: 30,
      fetch: async () => [],
    };
    let now = t0;
    const store = new Store([layer], [src], new Set(), () => now, {});
    store.recordSuccess('s', [plane('aircraft:abc', 29, 41, t0)], 5);
    now += 30_000;
    store.recordSuccess('s', [plane('aircraft:abc', 29.1, 41.05, now)], 5);
    const app = await buildApp({ store, cesiumIonToken: '' });
    const tails = (await app.inject('/api/layers/aircraft/tails')).json();
    expect(tails.features).toHaveLength(1);
    const track = (await app.inject(`/api/tracks/${encodeURIComponent('aircraft:abc')}`)).json();
    expect(track.points).toHaveLength(2);
    expect((await app.inject('/api/tracks/nope')).statusCode).toBe(404);
    expect((await app.inject('/api/layers/nope/tails')).statusCode).toBe(404);
    await app.close();
  });
});
