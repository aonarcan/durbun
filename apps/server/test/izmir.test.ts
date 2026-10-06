import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { csvRows, csvTable, num, unzipAll } from '../src/kit/gtfs.ts';
import { HttpError, type HttpClient } from '../src/kit/http.ts';
import { Store } from '../src/kit/store.ts';
import {
  cleanStops,
  IZMIR_RAIL_FEEDS,
  IzmirTransit,
  izdenizPierFeatures,
  izmirRouteShapes,
  izmirStopFeatures,
  railFromGtfs,
  stopLines,
  type IzdenizPier,
} from '../src/sources/izmir.ts';

const text = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = <T>(name: string): T => JSON.parse(text(name)) as T;
const NOW = new Date('2026-10-06T10:20:00Z');

/** A ZIP of stored (uncompressed) files, like a small GTFS feed. */
function zipOf(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('GTFS and CSV reading', () => {
  it('reads quoted fields, byte-order marks and Windows line ends', () => {
    expect(csvRows('﻿a,b\r\n"x, y",2\r\n"say ""hi""",3\n')).toEqual([
      ['a', 'b'],
      ['x, y', '2'],
      ['say "hi"', '3'],
    ]);
    expect(csvTable('id;name\n1;Konak\n', ';')).toEqual([{ id: '1', name: 'Konak' }]);
    expect(num('38,41395667')).toBe(38.41395667);
    expect(stopLines('29-30')).toEqual(['29', '30']);
  });

  it('unzips every file of a small feed', () => {
    const files = unzipAll(zipOf({ 'routes.txt': 'route_id\n1\n', 'stops.txt': 'stop_id\n7\n' }));
    expect([...files.keys()]).toEqual(['routes.txt', 'stops.txt']);
    expect(files.get('stops.txt')!.toString()).toBe('stop_id\n7\n');
  });
});

describe('İzmir layers', () => {
  it('maps ESHOT stops with their lines', () => {
    const stops = izmirStopFeatures(text('eshot-stops.csv'));
    const bahribaba = stops.find((f) => f.properties.id === 'izmir-stop:10007')!;
    expect(bahribaba.properties).toMatchObject({ title: 'Bahribaba', layer: 'bus-stops', kind: 'stop' });
    expect(bahribaba.properties.details).toMatchObject({ stopCode: '10007', city: 'İzmir', lines: '29, 30' });
  });

  it('maps İzdeniz piers', () => {
    const piers = izdenizPierFeatures(json<IzdenizPier[]>('izmir-piers.json'));
    expect(piers.length).toBeGreaterThan(5);
    expect(piers[0]!.properties).toMatchObject({ id: 'izdeniz:1', title: 'Konak İskelesi', kind: 'izdeniz', layer: 'piers' });
  });

  it('draws tram lines station to station in their own colours', () => {
    const files = json<Record<string, string>>('izmir-tram-gtfs.json');
    const zip = unzipAll(zipOf(files));
    const fs = railFromGtfs(IZMIR_RAIL_FEEDS[1]!, zip, NOW);
    const konak = fs.find((f) => f.properties.title === 'Konak Tramvayı')!;
    expect(konak.properties.style).toMatchObject({ color: '#ad1457' });
    expect(konak.geometry?.type === 'LineString' && konak.geometry.coordinates.length).toBeGreaterThan(10);
    const stations = fs.filter((f) => f.properties.kind === 'station');
    expect(stations.find((s) => s.properties.title === 'Halkapınar')?.properties.details).toMatchObject({ operator: 'İzmir Tramvayı' });
  });

  it("cleans trips that repeat stations (İZBAN's old timetable)", () => {
    expect(cleanStops(['4', '5', '6', '9', '9', '9', '10', '6', '5'])).toEqual(['4', '5', '6', '9', '10']);
  });

  it('builds line shapes per direction from the route file', () => {
    const shapes = izmirRouteShapes(text('eshot-routes-29.csv'));
    expect(Object.keys(shapes).sort()).toEqual(['29:1', '29:2']);
    expect(shapes['29:1']!.length).toBeGreaterThan(20);
  });
});

describe('İzmir lookups', () => {
  const stops = izmirStopFeatures(text('eshot-stops.csv'));
  const http = {
    getText: async (url: string) => {
      if (url.includes('duyurulari')) return text('eshot-notices.csv');
      throw new HttpError('HTTP 404', 404);
    },
    async getJson<T>(url: string): Promise<T> {
      if (url.includes('duragayaklasanotobusler/10007')) return json('izmir-approaching-10007.json');
      if (url.includes('hatotobuskonumlari/29')) return json('izmir-linebuses-29.json');
      throw new HttpError('HTTP 503', 503);
    },
  } as unknown as HttpClient;
  const lines = {
    within: async () => ({ names: { '29': 'KADRİYE MAH. - KONAK', '30': 'KAYNAK - KONAK' }, shapes: izmirRouteShapes(text('eshot-routes-29.csv')) }),
  };

  it('lists the lines at a stop and the buses coming, in stops still to go', async () => {
    const transit = new IzmirTransit(http, lines, () => stops, () => NOW.getTime());
    const stop = await transit.stop('10007');
    expect(stop.lines).toEqual([
      { code: '29', name: 'KADRİYE MAH. - KONAK' },
      { code: '30', name: 'KAYNAK - KONAK' },
    ]);
    expect(stop.arrivals[0]).toMatchObject({ line: '29', vehicleId: expect.stringMatching(/^izmir-bus:/), stopsAway: 1 });
    expect(stop.arrivals.map((a) => a.stopsAway)).toEqual([...stop.arrivals.map((a) => a.stopsAway)].sort((a, b) => a - b));
  });

  it("draws a line with its route, stops, buses and today's notices", async () => {
    const transit = new IzmirTransit(http, lines, () => stops, () => NOW.getTime());
    const line = await transit.line('29');
    expect(line.name).toBe('KADRİYE MAH. - KONAK');
    expect(line.routes.map((r) => [r.direction, r.approximate])).toEqual([
      ['G', false],
      ['D', false],
    ]);
    expect(line.stops.every((s) => s.id?.startsWith('izmir-stop:'))).toBe(true);
    expect(line.stops.some((s) => s.code === '10007')).toBe(true);
    // KoorX is the latitude and KoorY the longitude, with decimal commas.
    expect(line.vehicles[0]!.lat).toBeGreaterThan(38);
    expect(line.vehicles[0]!.lng).toBeGreaterThan(26.5);
    expect(new Set(line.vehicles.map((v) => v.id)).size).toBe(line.vehicles.length);
    expect(line.notices).toContain('29 NO.LU HAT DENEME DUYURUSU');
    expect(line.notices).not.toContain('29 NO.LU HAT ESKİ DUYURU');
  });

  it('answers with what it has when İzmir’s live service is down', async () => {
    const transit = new IzmirTransit(http, lines, () => stops, () => NOW.getTime());
    const stop = await transit.stop('10005');
    expect(stop.arrivals).toEqual([]);
    expect(stop.lines.length).toBeGreaterThan(0);
  });

  it('answers /api/transit/izmir-stop', async () => {
    const layer = { id: 'bus-stops', name: { tr: 'd', en: 'd' }, group: 'transport' as const, color: '#000', defaultOn: false, attribution: 'x' };
    const store = new Store([layer], [{ id: 'izmir-stops', name: { tr: 'd', en: 'd' }, layer: 'bus-stops', homepage: '', intervalSec: 60, fetch: async () => [] }], new Set());
    store.setSourceFeatures('izmir-stops', stops);
    const izmir = new IzmirTransit(http, lines, () => store.getCollection('bus-stops')!.features, () => NOW.getTime());
    const app = await buildApp({ store, cesiumIonToken: '', izmir });
    const res = await app.inject('/api/transit/izmir-stop/10007');
    expect(res.json()).toMatchObject({ code: '10007', feature: { properties: { title: 'Bahribaba' } } });
    expect((await app.inject('/api/transit/izmir-line/29')).json()).toMatchObject({ code: '29' });
    // İstanbul lookups aren't configured here.
    expect((await app.inject('/api/transit/stop/113333')).statusCode).toBe(503);
    await app.close();
  });
});
