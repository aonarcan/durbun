import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import {
  combineStarts,
  FlightHistory,
  flightStart,
  legStart,
  mergeTracks,
  parseOpenSkyTrack,
  parseTrace,
  pickRoute,
  type FlightPaths,
  type OpenSkyTrack,
  type ReadsbTrace,
  type RouteAnswer,
} from '../src/flights.ts';
import type { HttpClient } from '../src/kit/http.ts';
import { HttpError } from '../src/kit/http.ts';
import { Store } from '../src/kit/store.ts';
import type { TrackPoint } from '../src/kit/tracks.ts';

const json = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

// CAI5A (TC-MKG, a 737 MAX 8) on 6 Oct 2026: off the stand in Antalya at 08:11 UTC, over İstanbul
// at 09:00 on its way to Leipzig. adsb.lol lost it between 08:14 and 08:45; OpenSky saw part of that.
const full = json<ReadsbTrace>('adsblol-trace-full-4bb567.json');
const recent = json<ReadsbTrace>('adsblol-trace-recent-4bb567.json');
const openSky = json<OpenSkyTrack>('opensky-track-4bb567.json');
const routes = json<RouteAnswer[]>('adsbim-routeset-cai5a.json');
const NOW = Date.parse('2026-10-06T09:01:00Z');
const at = (iso: string) => Date.parse(`2026-10-06T${iso}Z`);
const maxGapMin = (pts: TrackPoint[]) => Math.max(...pts.slice(1).map((p, i) => (p[2] - pts[i]![2]) / 60_000));

function fakeHttp(opts: { delayMs?: number; fail?: RegExp } = {}): HttpClient & { urls: string[] } {
  const urls: string[] = [];
  const answer = async <T>(url: string): Promise<T> => {
    urls.push(url);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.fail?.test(url)) throw new HttpError('HTTP 404', 404);
    if (url.includes('trace_full_4bb567')) return full as T;
    if (url.includes('trace_recent_4bb567')) return recent as T;
    if (url.includes('opensky-network.org/api/tracks/all?icao24=4bb567')) return openSky as T;
    if (url.includes('adsb.im/api/0/routeset')) return routes as T;
    throw new HttpError('HTTP 404', 404);
  };
  return {
    urls,
    getText: async () => '',
    getBuffer: async () => Buffer.alloc(0),
    getJson: answer,
    postJson: answer,
  };
}

describe('flight history sources', () => {
  it('reads adsb.lol traces: feet to metres, ground as 0, flight starts', () => {
    const h = parseTrace(full);
    expect(h.points.length).toBeGreaterThan(400);
    expect(h.legStarts.map((t) => new Date(t).toISOString().slice(11, 16))).toEqual(['20:38', '08:11']);
    expect(h.points.at(-1)![3]).toBe(Math.round(38_000 * 0.3048)); // cruising at FL380 over İstanbul
    expect(h.points.find((p) => p[2] >= at('08:11:00'))![3]).toBe(0);
    expect(legStart(h, NOW)).toBe(h.legStarts[1]);
  });

  it('reads OpenSky tracks', () => {
    const h = parseOpenSkyTrack(openSky);
    expect(h.points.length).toBe(44);
    expect(h.legStarts).toEqual([openSky.startTime * 1000]);
    expect(h.points[0]![3]).toBe(0); // still on the ground in Antalya
  });

  it('finds the start of the current flight without markers', () => {
    const p = (min: number, alt: number | null): TrackPoint => [30, 37, at('08:00:00') + min * 60_000, alt];
    // A coverage hole in the air is the same flight; a long stop on the ground is a new one.
    expect(legStart({ points: [p(0, 0), p(5, 3000), p(50, 11000)], legStarts: [] }, NOW)).toBe(p(0, 0)[2]);
    expect(legStart({ points: [p(-200, 9000), p(-150, 0), p(0, 0), p(5, 3000)], legStarts: [] }, NOW)).toBe(p(0, 0)[2]);
    // Dürbün's own positions: the last stretch in the air and the taxiing before it.
    expect(flightStart([p(0, 9000), p(10, 0), p(20, 0), p(25, 0), p(30, 2000), p(40, 9000)])).toBe(p(10, 0)[2]);
    expect(flightStart([p(0, 0), p(5, 0)])).toBeUndefined();
    expect(combineStarts([at('08:11:00'), at('08:13:00')])).toBe(at('08:11:00'));
    expect(combineStarts([at('02:00:00'), at('08:13:00')])).toBe(at('08:13:00'));
  });

  it('merges sources, thins repeats and drops glitches', () => {
    const t = at('08:30:00');
    const a: TrackPoint[] = [
      [30, 38, t, 10000],
      [30.05, 38.05, t + 30_000, 10000],
      [35, 41, t + 40_000, 10000], // 500 km in 10 s
      [30.1, 38.1, t + 60_000, 10000],
    ];
    const b: TrackPoint[] = [[30.02, 38.02, t + 5_000, 10000]]; // too close to the first
    expect(mergeTracks([a, b], t).map((p) => p[2])).toEqual([t, t + 30_000, t + 60_000]);
  });

  it('picks the leg the aircraft is on from a route with stops', () => {
    const answer: RouteAnswer = {
      callsign: 'X',
      plausible: true,
      _airports: [
        { icao: 'LTFM', iata: 'IST', name: 'Istanbul Airport', lat: 41.26, lon: 28.71 },
        { icao: 'LTAC', iata: 'ESB', name: 'Esenboğa', lat: 40.13, lon: 32.99 },
        { icao: 'LTCG', iata: 'TZX', name: 'Trabzon', lat: 41.0, lon: 39.79 },
      ],
    };
    expect(pickRoute(answer, [36, 40.5])).toMatchObject({ from: { iata: 'ESB' }, to: { iata: 'TZX' } });
    expect(pickRoute({ ...answer, plausible: false }, [36, 40.5])).toBeUndefined();
  });
});

describe('whole flight on demand', () => {
  const own: TrackPoint[] = [[28.62, 41.69, at('09:00:30'), 11582]];

  it('joins adsb.lol, OpenSky and its own positions from the stand in Antalya', async () => {
    const http = fakeHttp();
    const flights = new FlightHistory(http, () => NOW);
    const path = await flights.path('4bb567', { own, callsign: 'CAI5A', at: [28.62, 41.69] });
    const first = path.points[0]!;
    expect(new Date(first[2]).toISOString().slice(11, 16)).toBe('08:11');
    expect(first[1]).toBeCloseTo(36.88, 1); // Antalya
    expect(path.fromGround).toBe(true);
    expect(new Date(path.takeoffAt!).toISOString().slice(11, 15)).toBe('08:1');
    expect(path.points.at(-1)).toEqual(own[0]);
    // OpenSky fills most of adsb.lol's half-hour hole.
    expect(maxGapMin(path.points)).toBeLessThan(12);
    expect(path.sources).toEqual(['adsb.lol', 'OpenSky']);
    expect(path.route).toMatchObject({ from: { iata: 'AYT', city: 'Antalya' }, to: { iata: 'LEJ' } });
    // Nothing from the earlier flights in the trace.
    expect(path.points.every((p) => p[2] >= at('08:11:00'))).toBe(true);
  });

  it('asks the outside sources once and serves repeats from memory', async () => {
    const http = fakeHttp();
    let now = NOW;
    const flights = new FlightHistory(http, () => now);
    await flights.path('4bb567', { own, callsign: 'CAI5A' });
    const first = http.urls.length;
    expect(first).toBe(4); // two trace files, OpenSky, the route
    now += 60_000;
    await flights.path('4bb567', { own, callsign: 'CAI5A' });
    expect(http.urls.length).toBe(first);
    now += 4 * 60_000; // the traces are stale now, OpenSky and the route are not
    await flights.path('4bb567', { own, callsign: 'CAI5A' });
    expect(http.urls.length).toBe(first + 2);
  });

  it('answers with its own positions when the sources are slow, and fills in later', async () => {
    const http = fakeHttp({ delayMs: 60 });
    const flights = new FlightHistory(http, () => NOW, 20);
    const quick = await flights.path('4bb567', { own });
    expect(quick.points).toEqual(own);
    expect(quick.sources).toEqual([]);
    await new Promise((r) => setTimeout(r, 200));
    const later = await flights.path('4bb567', { own });
    expect(later.points.length).toBeGreaterThan(40);
    expect(later.sources).toContain('adsb.lol');
  });

  it('copes without any outside history, and drops a route that starts elsewhere', async () => {
    const flights = new FlightHistory(fakeHttp({ fail: /adsb\.lol|opensky/ }), () => NOW);
    const ownFlight: TrackPoint[] = [
      [29.3, 40.9, at('08:40:00'), 0], // Sabiha Gökçen, not Antalya
      [29.35, 40.95, at('08:45:00'), 1500],
      [29.6, 41.1, at('08:50:00'), 6000],
    ];
    const path = await flights.path('4bb567', { own: ownFlight, callsign: 'CAI5A' });
    expect(path.points).toEqual(ownFlight);
    expect(path.fromGround).toBe(true);
    expect(path.route).toBeUndefined();
    expect(path.sources).toEqual([]);
  });

  it('serves the whole flight from /api/tracks', async () => {
    const calls: unknown[] = [];
    const flights: FlightPaths = {
      async path(hex, opts) {
        calls.push([hex, opts]);
        return { points: [[30, 37, 1, 0], [30.1, 37.1, 2, 500]], fromGround: true, sources: ['adsb.lol'] };
      },
    };
    const app = await buildApp({ store: new Store([], [], new Set()), cesiumIonToken: '', flights });
    const res = await app.inject('/api/tracks/aircraft:4bb567');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'aircraft:4bb567', fromGround: true, sources: ['adsb.lol'] });
    expect(calls[0]).toEqual(['4bb567', { own: [] }]);
    expect((await app.inject('/api/tracks/ship:123')).statusCode).toBe(404);
    await app.close();
  });
});
