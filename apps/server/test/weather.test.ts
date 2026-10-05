import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { circlePolygon, distanceKm } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createCloudTiles, infraredToClouds, tileBounds, wmsUrl } from '../src/clouds.ts';
import { createHttpClient } from '../src/kit/http.ts';
import { Scheduler } from '../src/kit/scheduler.ts';
import type { LayerDefinition, SourceDefinition } from '../src/kit/source.ts';
import { Store } from '../src/kit/store.ts';
import { provinces } from '../src/provinces.ts';
import { compass, parseMgmObservations, type MgmCentre, type MgmObservation } from '../src/sources/mgm-observations.ts';
import { parseMgmAlerts, plateOfTown, type MgmAlert } from '../src/sources/mgm-warnings.ts';
import { parseRainViewer, type RainViewerMaps } from '../src/sources/rainviewer.ts';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

describe('province outlines', () => {
  const all = provinces();

  it('has all 81 provinces with Turkish names', () => {
    expect(all.size).toBe(81);
    expect(all.get(34)?.name).toBe('İstanbul');
    expect(all.get(6)?.name).toBe('Ankara');
    expect(all.get(81)?.name).toBe('Düzce');
  });

  it('puts each label point inside Türkiye', () => {
    for (const p of all.values()) {
      expect(p.label[0]).toBeGreaterThan(25.5);
      expect(p.label[0]).toBeLessThan(45);
      expect(p.label[1]).toBeGreaterThan(35.5);
      expect(p.label[1]).toBeLessThan(42.2);
    }
  });
});

describe('MGM weather warnings', () => {
  const alerts = fixture<MgmAlert[]>('mgm-alarm.json');

  it('reads the province from a 9PPDD town code', () => {
    expect(plateOfTown(93401)).toBe(34);
    expect(plateOfTown(90401)).toBe(4);
    expect(plateOfTown(98101)).toBe(81);
  });

  it('makes one outline per province per warning', () => {
    const features = parseMgmAlerts(alerts);
    expect(features).toHaveLength(3 + 14 + 2);
    const kars = features.find((f) => f.id === 'mgm-warning:2026100503:36')!;
    expect(kars.properties.title).toBe('Kars: Sarı uyarı (Gök gürültülü sağanak)');
    expect(kars.properties.kind).toBe('yellow');
    expect(kars.properties.validUntil).toBe('2026-10-06T19:00:15.154Z');
    expect(kars.properties.details?.districts).toBe(8);
    expect(['Polygon', 'MultiPolygon']).toContain(kars.geometry.type);
  });

  it('uses the highest level in a province and draws higher levels last', () => {
    const mixed: MgmAlert = {
      alertNo: 1,
      weather: { yellow: ['rain'], orange: ['wind'], red: [] },
      towns: { yellow: [93401, 93402, 90601], orange: [93403], red: [] },
      text: { orange: 'Fırtına' },
      begin: '2026-10-06T00:00:00Z',
      end: '2026-10-06T12:00:00Z',
    };
    const features = parseMgmAlerts([mixed, mixed]);
    expect(features.map((f) => [f.properties.details?.province, f.properties.kind])).toEqual([
      ['Ankara', 'yellow'],
      ['İstanbul', 'orange'],
    ]);
    const ist = features[1]!;
    expect(ist.properties.title).toBe('İstanbul: Turuncu uyarı (Kuvvetli rüzgâr)');
    expect(ist.properties.text).toBe('Fırtına');
    expect(ist.properties.details?.districts).toBe(3);
  });
});

describe('MGM observations', () => {
  const features = parseMgmObservations(
    fixture<MgmCentre[]>('mgm-iller.json'),
    fixture<MgmObservation[]>('mgm-sondurum.json'),
  );

  it('joins province centres to their stations', () => {
    expect(features).toHaveLength(8);
    const ist = features.find((f) => f.id === 'mgm-now:34')!;
    expect(ist.properties.title).toBe('İstanbul 16.7 °C');
    expect(ist.properties.value).toBe(16.7);
    expect(ist.geometry.coordinates).toEqual([28.8208, 40.9819]);
    expect(ist.properties.style).toEqual({ windDir: 75, windKmh: 8 });
    expect(ist.properties.details).toMatchObject({
      condition: 'Çok bulutlu',
      humidity: '%76',
      wind: '8 km/sa, DKD',
      pressureHpa: 1022.8,
      rain24h: '0 mm',
      visibilityKm: 10,
    });
  });

  it('leaves out values MGM marks as missing', () => {
    const [centre] = fixture<MgmCentre[]>('mgm-iller.json');
    const obs: MgmObservation = {
      istNo: centre!.sondurumIstNo,
      sicaklik: -9999,
      nem: 50,
      ruzgarHiz: -9999,
      ruzgarYon: -9999,
      hadiseKodu: 'XYZ',
      denizeIndirgenmisBasinc: -9999,
      yagis24Saat: -9999,
      gorus: -9999,
      veriZamani: '2026-10-05T20:00:00.000Z',
    };
    const [f] = parseMgmObservations([centre!], [obs]);
    expect(f!.properties.title).toBe(centre!.il);
    expect(f!.properties.value).toBeUndefined();
    expect(f!.properties.style).toEqual({});
    expect(f!.properties.details).toMatchObject({ temperatureC: null, wind: null, condition: 'XYZ', rain24h: null });
  });

  it('names compass points in Turkish', () => {
    expect([0, 45, 90, 180, 270, 350, -10].map(compass)).toEqual(['K', 'KD', 'D', 'G', 'B', 'K', 'K']);
  });
});

describe('RainViewer radar', () => {
  it('lists frames as tile templates, oldest first', () => {
    const r = parseRainViewer(fixture<RainViewerMaps>('rainviewer.json'));
    expect(r.frames).toHaveLength(13);
    expect(r.frames[0]!.url).toBe('https://tilecache.rainviewer.com/v2/radar/8f20e8802be0/256/{z}/{x}/{y}/2/1_1.png');
    expect(r.frames[0]!.time).toBe('2026-10-05T18:20:00.000Z');
    expect(r.maxzoom).toBe(7);
  });

  it('fails loudly on an empty list', () => {
    expect(() => parseRainViewer({ host: 'h', radar: {} })).toThrow(/no radar frames/);
  });
});

describe('cloud tiles', () => {
  it('computes Web Mercator tile bounds', () => {
    const [minX, minY, maxX, maxY] = tileBounds(0, 0, 0);
    expect(minX).toBeCloseTo(-20037508.34, 1);
    expect(maxY).toBeCloseTo(20037508.34, 1);
    expect(maxX - minX).toBeCloseTo(maxY - minY, 6);
    const [x0, , , y1] = tileBounds(6, 37, 24);
    expect(x0).toBeCloseTo(-20037508.34 + 37 * 626172.14, 0);
    expect(y1).toBeCloseTo(20037508.34 - 24 * 626172.14, 0);
    expect(wmsUrl(6, 37, 24)).toContain('crs=EPSG:3857');
    expect(wmsUrl(6, 37, 24)).toContain('layers=msg_fes:ir108');
  });

  function grey(values: number[]): Buffer {
    const png = new PNG({ width: values.length, height: 1 });
    values.forEach((v, i) => {
      png.data[i * 4] = v;
      png.data[i * 4 + 1] = v;
      png.data[i * 4 + 2] = v;
      png.data[i * 4 + 3] = 255;
    });
    return PNG.sync.write(png);
  }

  it('turns warm ground clear and cold cloud tops white', () => {
    const out = PNG.sync.read(infraredToClouds(grey([40, 105, 145, 185, 250])));
    const alpha = [0, 1, 2, 3, 4].map((i) => out.data[i * 4 + 3]);
    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBe(0);
    expect(alpha[2]).toBeGreaterThan(100);
    expect(alpha[2]).toBeLessThan(140);
    expect(alpha[3]).toBe(235);
    expect(alpha[4]).toBe(235);
    expect(out.data[8]).toBe(255);
  });

  it('caches converted tiles for ten minutes', async () => {
    let calls = 0;
    let t = 0;
    const http = createHttpClient('test', async () => {
      calls += 1;
      return new Response(new Uint8Array(grey([200])));
    });
    const tile = createCloudTiles(http, () => t);
    await tile(5, 18, 12);
    await tile(5, 18, 12);
    expect(calls).toBe(1);
    t = 11 * 60_000;
    await tile(5, 18, 12);
    expect(calls).toBe(2);
  });
});

describe('raster layers in the store', () => {
  const radarLayer: LayerDefinition = {
    id: 'radar',
    name: { tr: 'Radar', en: 'Radar' },
    group: 'weather',
    color: '#000',
    defaultOn: false,
    attribution: 'test',
  };
  let frames = 2;
  const radarSource: SourceDefinition = {
    id: 'radar-source',
    name: { tr: 'Radar', en: 'Radar' },
    layer: 'radar',
    homepage: 'https://example.org',
    intervalSec: 60,
    async fetch() {
      return {
        raster: {
          frames: Array.from({ length: frames }, (_, i) => ({ time: `2026-10-05T10:0${i}:00.000Z`, url: `u${i}` })),
          tileSize: 256,
          maxzoom: 7,
          opacity: 0.7,
        },
      };
    },
  };

  it('stores frames on the layer, versions changes and reports them as items', async () => {
    const store = new Store([radarLayer], [radarSource], new Set());
    const events: unknown[] = [];
    store.on('event', (e) => events.push(e));
    const scheduler = new Scheduler([radarSource], store, createHttpClient('test'), { log: () => {} });
    await scheduler.runOnce(radarSource);
    await scheduler.runOnce(radarSource);
    frames = 3;
    await scheduler.runOnce(radarSource);

    const [summary] = store.layerSummaries();
    expect(summary?.version).toBe(2);
    expect(summary?.count).toBe(3);
    expect(summary?.raster?.frames.map((f) => f.url)).toEqual(['u0', 'u1', 'u2']);
    expect(store.sourceHealth('radar-source')).toMatchObject({ status: 'ok', itemCount: 3, newestItemAt: '2026-10-05T10:02:00.000Z' });
    const layerEvents = events.filter((e) => (e as { type: string }).type === 'layer') as { raster?: { frames: unknown[] } }[];
    expect(layerEvents).toHaveLength(2);
    expect(layerEvents[1]?.raster?.frames).toHaveLength(3);
  });
});

describe('weather API', () => {
  it('serves province outlines and cloud tiles', async () => {
    const store = new Store([], [], new Set());
    const app = await buildApp({
      store,
      cesiumIonToken: '',
      cloudTile: async (z) => {
        if (z === 9) throw new Error('upstream down');
        return Buffer.from('png');
      },
    });

    const prov = await app.inject('/api/provinces');
    expect(prov.statusCode).toBe(200);
    expect(prov.headers['cache-control']).toBe('public, max-age=86400');
    expect(prov.json().features).toHaveLength(81);

    const tile = await app.inject('/api/tiles/clouds/5/18/12');
    expect(tile.statusCode).toBe(200);
    expect(tile.headers['content-type']).toBe('image/png');
    expect(tile.headers['cache-control']).toBe('public, max-age=600');
    expect((await app.inject('/api/tiles/clouds/5/40/12')).statusCode).toBe(400);
    expect((await app.inject('/api/tiles/clouds/12/1/1')).statusCode).toBe(400);
    expect((await app.inject('/api/tiles/clouds/9/1/1')).statusCode).toBe(502);
    await app.close();

    const bare = await buildApp({ store, cesiumIonToken: '' });
    expect((await bare.inject('/api/tiles/clouds/1/1/1')).statusCode).toBe(503);
    await bare.close();
  });
});

describe('geometry helpers', () => {
  it('measures great-circle distance', () => {
    // İstanbul (Sultanahmet) to Ankara (Kızılay): about 350 km.
    expect(distanceKm([28.977, 41.006], [32.854, 39.92])).toBeGreaterThan(345);
    expect(distanceKm([28.977, 41.006], [32.854, 39.92])).toBeLessThan(355);
  });

  it('draws a closed circle at the right radius', () => {
    const c = circlePolygon([29, 41], 50, 32);
    const ring = c.coordinates[0]!;
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const p of ring) expect(distanceKm([29, 41], p as [number, number])).toBeCloseTo(50, 0);
  });
});
