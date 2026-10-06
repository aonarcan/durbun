import { readFileSync } from 'node:fs';
import type { RouteResult } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { HttpClient } from '../src/kit/http.ts';
import { Store } from '../src/kit/store.ts';
import { createRouter, osrmUrl, parseLngLat, parseOsrm, type Router } from '../src/routing.ts';

const osrm = JSON.parse(readFileSync(new URL('./fixtures/osrm-foot.json', import.meta.url), 'utf8'));

describe('routing helpers', () => {
  it('reads "lng,lat" and rejects anything else', () => {
    expect(parseLngLat('29.05,41.02')).toEqual([29.05, 41.02]);
    expect(parseLngLat(' 29.05 , 41.02 ')).toEqual([29.05, 41.02]);
    expect(parseLngLat('41.02')).toBeUndefined();
    expect(parseLngLat('200,41')).toBeUndefined();
    expect(parseLngLat('a,b')).toBeUndefined();
    expect(parseLngLat(undefined)).toBeUndefined();
  });

  it('builds the FOSSGIS URL for each mode', () => {
    expect(osrmUrl('car', [28.9784, 41.0082], [29.027, 40.9905])).toBe(
      'https://routing.openstreetmap.de/routed-car/route/v1/driving/28.978400,41.008200;29.027000,40.990500?overview=full&geometries=geojson&steps=false',
    );
    expect(osrmUrl('foot', [1, 2], [3, 4])).toContain('/routed-foot/');
  });

  it('turns an OSRM answer into a route', () => {
    const r = parseOsrm(osrm, 'foot');
    expect(r.distance).toBeCloseTo(7641.6);
    expect(r.duration).toBeCloseTo(6121.3);
    expect(r.geometry.coordinates[0]).toEqual([28.978392, 41.008203]);
    expect(r.provider).toContain('OpenStreetMap');
  });

  it('explains when there is no route', () => {
    expect(() => parseOsrm({ code: 'NoRoute' }, 'car')).toThrow('No route found');
    expect(() => parseOsrm({ code: 'InvalidQuery', message: 'bad' }, 'car')).toThrow('Routing failed: bad');
  });
});

describe('router', () => {
  function fakeHttp(): HttpClient & { calls: number } {
    const h = {
      calls: 0,
      async getText() {
        return '';
      },
      async getBuffer() {
        return Buffer.alloc(0);
      },
      async getJson<T>() {
        h.calls += 1;
        return osrm as T;
      },
      async postJson<T>() {
        return {} as T;
      },
      async postText() {
        return '';
      },
      async getResponse() {
        return new Response('');
      },
    };
    return h;
  }

  it('caches the same route for five minutes', async () => {
    let t = 0;
    const http = fakeHttp();
    const router = createRouter(http, () => t);
    await router.route('foot', [28.97, 41], [29.02, 40.99]);
    await router.route('foot', [28.97, 41], [29.02, 40.99]);
    expect(http.calls).toBe(1);
    t = 6 * 60_000;
    await router.route('foot', [28.97, 41], [29.02, 40.99]);
    expect(http.calls).toBe(2);
  });

  it('stops after 20 new routes in a minute', async () => {
    const router = createRouter(fakeHttp(), () => 0);
    for (let i = 0; i < 20; i++) await router.route('car', [29 + i / 1000, 41], [29.1, 41]);
    await expect(router.route('car', [28, 41], [29.1, 41])).rejects.toThrow(/Too many/);
  });
});

describe('/api/route', () => {
  const store = new Store([], [], new Set());
  const result: RouteResult = {
    mode: 'car',
    distance: 1000,
    duration: 120,
    geometry: { type: 'LineString', coordinates: [[29, 41], [29.01, 41]] },
    provider: 'test',
  };

  it('returns a route', async () => {
    const router: Router = { route: async () => result };
    const app = await buildApp({ store, cesiumIonToken: '', router });
    const res = await app.inject('/api/route?from=29,41&to=29.01,41&mode=car');
    expect(res.statusCode).toBe(200);
    expect(res.json().distance).toBe(1000);
    await app.close();
  });

  it('rejects bad input and reports upstream failures', async () => {
    const router: Router = {
      route: async () => {
        throw new Error('No route found');
      },
    };
    const app = await buildApp({ store, cesiumIonToken: '', router });
    expect((await app.inject('/api/route?from=29,41&mode=car')).statusCode).toBe(400);
    expect((await app.inject('/api/route?from=29,41&to=29.01,41&mode=boat')).statusCode).toBe(400);
    const failed = await app.inject('/api/route?from=29,41&to=29.01,41&mode=foot');
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toBe('No route found');
    await app.close();
  });
});
