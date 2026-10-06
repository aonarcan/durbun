import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { HttpError, type HttpClient } from '../src/kit/http.ts';
import { Memo } from '../src/kit/memo.ts';
import { Scheduler } from '../src/kit/scheduler.ts';
import type { LayerDefinition, SourceDefinition } from '../src/kit/source.ts';
import { Store } from '../src/kit/store.ts';
import {
  BusHeadings,
  busFeatures,
  linesByBus,
  lineVehicles,
  parseLineStops,
  soapResult,
  stopFeatures,
  todayAt,
  trDate,
  type ArchiveTrip,
  type FleetVehicle,
  type IettStop,
  type LineVehicle,
} from '../src/sources/iett.ts';
import { ibbPiers, lineCode, metroIstanbul, pierFeatures, railFeatures, type IbbPier } from '../src/sources/istanbul-rail.ts';
import { arrivalsAt, IstanbulTransit } from '../src/transit.ts';
import { readRouteShapes, RouteShapes, simplify, stopLinesFrom, unzipFirst } from '../src/transit-cache.ts';

const text = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = <T>(name: string): T => JSON.parse(text(name)) as T;
const soapList = <T>(name: string, method: string): T[] => JSON.parse(soapResult(text(name), method)) as T[];

// 6 Oct 2026, 12:25:30 in İstanbul: the fixtures were fetched a few seconds before.
const NOW = new Date('2026-10-06T09:25:30Z');

describe('İETT answers', () => {
  it('reads SOAP results and faults', () => {
    expect(soapList<FleetVehicle>('iett-fleet.xml', 'GetFiloAracKonum_json').length).toBe(42);
    const fault =
      '<soap:Envelope><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>ORA-01722: geçersiz sayı</faultstring></soap:Fault></soap:Body></soap:Envelope>';
    expect(() => soapResult(fault, 'GetIettArsivGorev_json')).toThrow('İETT: ORA-01722: geçersiz sayı');
  });

  it('turns İstanbul clock times and dates into instants', () => {
    expect(new Date(todayAt('12:24:52', NOW)!).toISOString()).toBe('2026-10-06T09:24:52.000Z');
    // 23:59 read at 00:01 belongs to yesterday.
    expect(new Date(todayAt('23:59:00', new Date('2026-10-06T21:01:00Z'))!).toISOString()).toBe('2026-10-06T20:59:00.000Z');
    expect(trDate(NOW)).toBe('20261006');
    expect(trDate(new Date('2026-10-06T22:30:00Z'), 1)).toBe('20261006'); // 01:30 on the 7th, yesterday is the 6th
  });

  it('maps the fleet: in-service buses only, heading from the last move', () => {
    const list = soapList<FleetVehicle>('iett-fleet.xml', 'GetFiloAracKonum_json');
    const headings = new BusHeadings();
    const first = busFeatures(list, NOW, headings);
    // Buses whose last position is older than ten minutes (in the depot) are left out.
    expect(first.length).toBeLessThan(list.length);
    expect(first.every((f) => Date.parse(f.properties.observedAt!) > NOW.getTime() - 10 * 60_000)).toBe(true);
    const bus = first.find((f) => f.properties.title === 'C-472')!;
    expect(bus.properties).toMatchObject({ id: 'bus:C-472', layer: 'buses', kind: 'moving' });
    expect(bus.properties.details).toMatchObject({ speed: expect.stringMatching(/km\/sa$/), operator: expect.any(String) });
    expect(bus.properties.style).toEqual({ moving: 1 }); // no heading from a single position
    // Next report: 300 m further north-east.
    const moved = list.map((v) => (v.KapiNo === 'C-472' ? { ...v, Boylam: String(Number(v.Boylam) + 0.0025), Enlem: String(Number(v.Enlem) + 0.002) } : v));
    const next = busFeatures(moved, NOW, headings).find((f) => f.properties.title === 'C-472')!;
    expect(next.properties.style?.track).toBeGreaterThan(30);
    expect(next.properties.style?.track).toBeLessThan(60);
  });

  it('maps stops, lines, line buses and line stops', () => {
    const stops = stopFeatures(soapList<IettStop>('iett-stops.xml', 'GetDurak_json'));
    const s = stops.find((f) => f.properties.id === 'stop:113333')!;
    expect(s.properties.title).toBe('FABRİKALAR');
    expect(s.properties.details).toMatchObject({ stopCode: '113333', district: expect.any(String) });
    const buses = lineVehicles(soapList<LineVehicle>('iett-line-500T.xml', 'GetHatOtoKonum_json'));
    expect(buses.length).toBe(22);
    expect(buses[0]).toMatchObject({ id: 'bus:C-472', direction: 'G', towards: '4.LEVENT METRO', nearestStopCode: '225851', at: '2026-10-06T09:25:55.000Z' });
    const lineStops = parseLineStops(soapResult(text('iett-line-stops-500T.xml'), 'DurakDetay_GYY'));
    expect(lineStops.length).toBe(130);
    expect(lineStops[0]).toMatchObject({ direction: 'D', order: 1, code: '301341', name: '4.LEVENT METRO' });
    const going = lineStops.filter((x) => x.direction === 'G');
    expect(going.map((x) => x.order)).toEqual(going.map((_, i) => i + 1));
  });

  it("learns each bus's usual lines from yesterday's trips", () => {
    const map = linesByBus(soapList<ArchiveTrip>('iett-archive.xml', 'GetIettArsivGorev_json'));
    expect(map.get('C-472')).toEqual(['500T']);
    expect(map.get('A-006')).toEqual(['559C']);
  });

  it('counts buses on their way to a stop', () => {
    const stops = parseLineStops(soapResult(text('iett-line-stops-500T.xml'), 'DurakDetay_GYY'));
    const going = stops.filter((s) => s.direction === 'G');
    const target = going[20]!;
    const bus = (door: string, at: number, direction: 'G' | 'D' = 'G') => ({
      id: `bus:${door}`,
      doorNo: door,
      lng: 29,
      lat: 41,
      direction,
      nearestStopCode: (direction === 'G' ? going : stops.filter((s) => s.direction === 'D'))[at]!.code,
    });
    const out = arrivalsAt(target.code, '500T', stops, [bus('A', 17), bus('B', 20), bus('C', 23), bus('D', 5, 'D')]);
    expect(out.map((a) => [a.doorNo, a.stopsAway])).toEqual([
      ['A', 3],
      ['B', 0],
    ]);
  });
});

/** A pretend İBB gateway answering from the fixtures. */
function fakeIett(): HttpClient & { calls: string[] } {
  const calls: string[] = [];
  const byMethod: Record<string, string> = {
    GetHat_json: 'iett-lines.xml',
    DurakDetay_GYY: 'iett-line-stops-500T.xml',
    GetHatOtoKonum_json: 'iett-line-500T.xml',
    GetDuyurular_json: 'iett-notices.xml',
    GetIettArsivGorev_json: 'iett-archive.xml',
  };
  return {
    calls,
    getText: async () => '',
    getBuffer: async () => Buffer.alloc(0),
    getJson: async () => {
      throw new HttpError('HTTP 404', 404);
    },
    postJson: async () => {
      throw new HttpError('HTTP 404', 404);
    },
    getResponse: async () => new Response(''),
    async postText(_url, body) {
      const method = /<(\w+) xmlns="http:\/\/tempuri.org\/"/.exec(body)![1]!;
      calls.push(method);
      // Only line 500T has buses and stops in the fixtures.
      if ((method === 'GetHatOtoKonum_json' || method === 'DurakDetay_GYY') && !body.includes('500T')) {
        return `<soap:Envelope><soap:Body><${method}Response xmlns="http://tempuri.org/"><${method}Result>${method === 'DurakDetay_GYY' ? '' : '[]'}</${method}Result></${method}Response></soap:Body></soap:Envelope>`;
      }
      return text(byMethod[method]!);
    },
  };
}

describe('bus, line and stop lookups', () => {
  it("finds a bus's line from yesterday's trips and the line's live buses", async () => {
    const http = fakeIett();
    const transit = new IstanbulTransit(http, undefined, undefined, () => NOW.getTime());
    const bus = await transit.bus('C-472');
    expect(bus.line?.code).toBe('500T');
    expect(bus.line?.name).toBe('TUZLA ŞİFA MAHALLESİ - 4. LEVENT METRO');
    expect(bus).toMatchObject({ direction: 'G', towards: '4.LEVENT METRO', nearestStop: { code: '225851' } });
    expect(bus.line?.routes.map((r) => [r.direction, r.approximate])).toEqual([
      ['G', true],
      ['D', true],
    ]);
    expect(bus.line?.vehicles.length).toBe(22);
    expect(bus.line?.notices[0]).toMatch(/seferimiz/);
    // A bus that wasn't out yesterday: no line, no guess.
    expect(await transit.bus('Z-999')).toEqual({ doorNo: 'Z-999', recentLines: [] });
    // Line buses are remembered for 20 s, yesterday's trips for hours.
    const before = http.calls.length;
    await transit.bus('C-451');
    expect(http.calls.slice(before)).toEqual([]);
  });

  it('uses street-level shapes when they are ready', async () => {
    const shapes = {
      get: (code: string) => (code === '500T_G_D0' ? ([[29, 41], [29.1, 41.1]] as [number, number][]) : undefined),
      within: async () => ({}),
    };
    const transit = new IstanbulTransit(fakeIett(), shapes as unknown as RouteShapes, undefined, () => NOW.getTime());
    const line = await transit.line('500T');
    expect(line.routes.map((r) => [r.direction, r.approximate, r.coordinates.length])).toEqual([
      ['G', false, 2],
      ['D', true, 66],
    ]);
  });

  it('lists the lines at a stop and the buses heading there', async () => {
    const stopLines = { within: async () => ({ '113333': ['121A', '500T'] }) };
    const transit = new IstanbulTransit(fakeIett(), undefined, stopLines as never, () => NOW.getTime());
    const stop = await transit.stop('113333');
    expect(stop.lines).toEqual([{ code: '121A', name: expect.any(String) }, { code: '500T', name: 'TUZLA ŞİFA MAHALLESİ - 4. LEVENT METRO' }]);
    expect(stop.linesPending).toBeUndefined();
    expect(stop.arrivals.every((a) => a.line === '500T' && a.stopsAway >= 0)).toBe(true);
    // Before the line list is built: say so.
    const early = new IstanbulTransit(fakeIett(), undefined, { within: async () => undefined } as never, () => NOW.getTime());
    expect(await early.stop('113333')).toMatchObject({ lines: [], linesPending: true });
  });

  it('answers /api/transit with the map feature attached', async () => {
    const layers: LayerDefinition[] = [{ id: 'buses', name: { tr: 'b', en: 'b' }, group: 'transport', color: '#000', defaultOn: false, attribution: 'x' }];
    const store = new Store(layers, [{ id: 'iett-buses', name: { tr: 'b', en: 'b' }, layer: 'buses', homepage: '', intervalSec: 30, fetch: async () => [] }], new Set());
    const features = busFeatures(soapList<FleetVehicle>('iett-fleet.xml', 'GetFiloAracKonum_json'), NOW);
    store.setSourceFeatures('iett-buses', features);
    const transit = new IstanbulTransit(fakeIett(), undefined, undefined, () => NOW.getTime());
    const app = await buildApp({ store, cesiumIonToken: '', transit });
    const res = await app.inject('/api/transit/bus/C-472');
    expect(res.json()).toMatchObject({ doorNo: 'C-472', line: { code: '500T' }, feature: { properties: { id: 'bus:C-472' } } });
    expect((await app.inject('/api/transit/bus/%3Cscript%3E')).statusCode).toBe(400);
    expect((await app.inject('/api/transit/train/1')).statusCode).toBe(404);
    await app.close();
  });
});

describe('İstanbul rail and piers', () => {
  const inputs = {
    lines: json<{ Data: never[] }>('metro-lines.json').Data,
    stations: json<{ Data: never[] }>('metro-stations.json').Data,
    status: json<{ Data: never[] }>('metro-status.json').Data,
    track: json<{ features: never[] }>('ibb-rail-lines.geojson').features,
    trackStations: json<{ features: never[] }>('ibb-rail-stations.geojson').features,
  };

  it('names lines from their titles', () => {
    expect(lineCode('M7 (U3) Mahmutbey - Bahçeşehir- Esenyurt Metro Hattı')).toBe('M7');
    expect(lineCode('M1B (U2) Kirazlı - Halkalı Metro Hattı')).toBe('M1B');
    expect(lineCode('TF2 Eyüp - Pier Loti Teleferik Hattı')).toBe('TF2');
    expect(lineCode('Halkalı Gebze (Marmaray) Banliyö Hattı')).toBe('Marmaray');
    expect(lineCode('Sirkeci - Kazlıçeşme Tramvay Hattı')).toBeUndefined();
  });

  it('draws lines in official colours, sections being built dashed, and flags disruptions', () => {
    const fs = railFeatures(inputs, NOW);
    const m2 = fs.find((f) => f.properties.id === 'rail:M2')!;
    expect(m2.properties.style).toMatchObject({ color: '#009944', building: 0 });
    expect(m2.properties.details).toMatchObject({ hours: '05:57 – 00:00', operator: 'Metro İstanbul' });
    // Today M7 runs in two parts because of repairs.
    const m7 = fs.find((f) => f.properties.id === 'rail:M7')!;
    expect(m7.properties.kind).toBe('disrupted');
    expect(String(m7.properties.details?.serviceStatus)).toMatch(/Onarım/);
    const building = fs.filter((f) => f.properties.kind === 'building');
    expect(building.map((f) => f.properties.title).sort()).toEqual([
      'M11 (yapım aşamasında)',
      'M7 (yapım aşamasında)',
      'M7 (yapım aşamasında)',
      'M7 (yapım aşamasında)',
    ]);
    // A line in service without a short code keeps its full name.
    expect(fs.some((f) => f.properties.title === 'Sirkeci - Kazlıçeşme Tramvay Hattı' && f.properties.kind === 'line')).toBe(true);
    expect(fs.find((f) => f.properties.id === 'rail:Marmaray')?.properties.details?.operator).toBe('TCDD Taşımacılık');
    expect(fs.find((f) => f.properties.id === 'rail:M11')?.geometry?.type).toBe('MultiLineString');
  });

  it("lists stations with their lifts, and other lines' stations from İBB's map", () => {
    const fs = railFeatures(inputs, NOW);
    const yildiz = fs.find((f) => f.properties.title === 'Yıldız')!;
    expect(yildiz.properties.kind).toBe('station-disrupted');
    expect(yildiz.properties.details).toMatchObject({ lifts: '9', escalators: '24', toilet: 'Var' });
    expect(fs.some((f) => f.properties.kind === 'station' && f.properties.style?.line === 'Marmaray')).toBe(true);
    expect(fs.some((f) => f.properties.kind === 'station' && f.properties.style?.line === 'M11')).toBe(true);
  });

  it('maps piers by operator', () => {
    const piers = pierFeatures(json<IbbPier[]>('ibb-piers.json'));
    expect(piers.length).toBe(65);
    expect(piers.filter((p) => p.properties.kind === 'ido').length).toBe(16);
    const bakirkoy = piers.find((p) => p.properties.title === 'İDO Bakırköy Terminali')!;
    expect(bakirkoy.properties.details).toMatchObject({ hours: '07:20 - 20:40', parking: '1465 araç' });
    expect(ibbPiers.intervalSec).toBe(86_400);
    expect(metroIstanbul().intervalSec).toBe(300);
  });
});

describe('big open-data files', () => {
  it('simplifies a route without losing its corners', () => {
    const line: [number, number][] = [];
    for (let i = 0; i <= 100; i++) line.push([29 + i * 0.0001, 41]); // straight 850 m
    for (let i = 1; i <= 100; i++) line.push([29.01, 41 + i * 0.0001]); // then north
    const s = simplify(line, 6);
    expect(s).toEqual([
      [29, 41],
      [29.01, 41],
      [29.01, 41.01],
    ]);
  });

  it('reads the route file one feature per line', async () => {
    const file = [
      '{',
      '"type": "FeatureCollection",',
      '"features": [',
      '{ "type": "Feature", "properties": { "GUZERGAH_KODU": "500T_G_D0" }, "geometry": { "type": "LineString", "coordinates": [ [ 29.000001, 41.0 ], [ 29.0005, 41.0 ], [ 29.001, 41.0 ] ] } },',
      '{ "type": "Feature", "properties": { "GUZERGAH_KODU": "500T_D_D0" }, "geometry": { "type": "LineString", "coordinates": [ [ 29.001, 41.0 ], [ 29.0, 41.0 ] ] } }',
      ']',
      '}',
    ].join('\n');
    const shapes = await readRouteShapes(createInterface({ input: Readable.from([file]) }));
    expect(shapes).toEqual({ '500T_G_D0': [29, 41, 29.001, 41], '500T_D_D0': [29.001, 41, 29, 41] });
  });

  it('builds and keeps route shapes in the cache folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'durbun-cache-'));
    const routes = Array.from({ length: 120 }, (_, i) =>
      JSON.stringify({ type: 'Feature', properties: { GUZERGAH_KODU: `L${i}_G_D0` }, geometry: { type: 'LineString', coordinates: [[29, 41], [29.01, 41.01]] } }),
    ).join(',\n');
    let downloads = 0;
    const http = {
      getResponse: async () => {
        downloads++;
        return new Response(`{\n"features": [\n${routes}\n]\n}`);
      },
    } as unknown as HttpClient;
    const quiet = () => {};
    const shapes = new RouteShapes(http, dir, Date.now, quiet);
    expect(shapes.get('L7_G_D0')).toBeUndefined(); // starts building
    await shapes.ready();
    expect(shapes.get('L7_G_D0')).toEqual([
      [29, 41],
      [29.01, 41.01],
    ]);
    // A new run reads the saved file instead of downloading again.
    const again = new RouteShapes(http, dir, Date.now, quiet);
    await again.ready();
    expect(again.get('L119_G_D0')).toBeDefined();
    expect(downloads).toBe(1);
  });

  it('unzips the timetable and lists the lines at each stop', async () => {
    const stopTimes = 'trip_id,stop_id,stop_sequence\n1,900,1\n1,901,2\n2,900,1\n3,902,1\n';
    const deflated = deflateRawSync(Buffer.from(stopTimes));
    const name = Buffer.from('stop_times.txt');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = 30 + name.length + deflated.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, deflated, central, name, end]);
    const lines = createInterface({ input: unzipFirst(zip) });
    const result = await stopLinesFrom({
      routes: '﻿route_id;agency_id;route_short_name\nr1;1;500T\nr2;1;34AS\n',
      trips: 'trip_id;route_id\n1;r1\n2;r2\n3;r2\n',
      stops: 'stop_id;stop_code\n900;113333\n901;113334\n902;113335\n',
      stopTimes: lines,
    });
    expect(result).toEqual({ '113333': ['34AS', '500T'], '113334': ['500T'], '113335': ['34AS'] });
  });
});

describe('on-demand sources', () => {
  it('remembers answers and failures for a while', async () => {
    let now = 0;
    let calls = 0;
    const memo = new Memo<number>(1000, () => now, 500);
    const load = async () => {
      calls++;
      if (calls === 2) throw new Error('down');
      return calls;
    };
    expect(await memo.get('a', load)).toBe(1);
    expect(await memo.get('a', load)).toBe(1);
    now = 1500;
    await expect(memo.get('a', load)).rejects.toThrow('down');
    now = 1800;
    await expect(memo.get('a', load)).rejects.toThrow('down'); // failure remembered
    now = 2100;
    expect(await memo.get('a', load)).toBe(3);
  });

  it("rests while nobody has the layer on, and wakes when someone does", async () => {
    let now = Date.parse('2026-10-06T09:00:00Z');
    let fetches = 0;
    const layer: LayerDefinition = { id: 'buses', name: { tr: 'b', en: 'b' }, group: 'transport', color: '#000', defaultOn: false, attribution: 'x', lazy: true };
    const source: SourceDefinition = {
      id: 'iett-buses',
      name: { tr: 'b', en: 'b' },
      layer: 'buses',
      homepage: '',
      intervalSec: 30,
      onDemand: true,
      fetch: async () => {
        fetches++;
        return [];
      },
    };
    const store = new Store([layer], [source], new Set(), () => now);
    const scheduler = new Scheduler([source], store, fakeIett(), { log: () => {}, startSpreadSec: 0 });
    scheduler.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(fetches).toBe(0);
    expect(store.sourceHealth('iett-buses').status).toBe('idle');
    // A browser asks for the layer: the source runs at once.
    const app = await buildApp({ store, cesiumIonToken: '', onWake: (id) => scheduler.wake(id) });
    await app.inject('/api/layers/buses');
    await new Promise((r) => setTimeout(r, 30));
    expect(fetches).toBe(1);
    expect(store.sourceHealth('iett-buses').status).toBe('ok');
    expect(store.wanted('buses')).toBe(true);
    now += 4 * 60_000; // nobody has asked for four minutes
    expect(store.wanted('buses')).toBe(false);
    await app.inject('/api/want?layers=buses,unknown');
    expect(store.wanted('buses')).toBe(true);
    scheduler.stop();
    await app.close();
  });
});
